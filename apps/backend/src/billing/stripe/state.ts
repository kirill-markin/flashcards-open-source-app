import type Stripe from "stripe";
import { z } from "zod";
import type { PurchasePrice } from "../../productAnalytics/serverFacts/billingFacts";
import type { PurchaseStatus } from "../resolver";
import {
  StripeBillingError, type StripeEnvironment, type StripeInvoiceFinancialState, type StripePurchaseState,
} from "./contracts";
import { stripePresentmentSchema } from "./emailProjection";

export const stripeLifecycleEventTypes = [
  "checkout.session.completed", "checkout.session.expired",
  "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed",
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
  "customer.subscription.paused", "customer.subscription.resumed", "customer.subscription.trial_will_end",
  "invoice.created", "invoice.finalized", "invoice.finalization_failed", "invoice.updated",
  "invoice.paid", "invoice.payment_succeeded", "invoice.payment_failed", "invoice.payment_action_required",
  "invoice.voided", "invoice.marked_uncollectible",
  "charge.refunded", "charge.refund.updated", "refund.created", "refund.updated", "refund.failed",
  "charge.dispute.created", "charge.dispute.updated", "charge.dispute.closed",
  "charge.dispute.funds_withdrawn", "charge.dispute.funds_reinstated",
] as const satisfies ReadonlyArray<Stripe.Event.Type>;

const objectIdSchema = z.union([z.string().min(1), z.object({ id: z.string().min(1) })])
  .transform((value) => typeof value === "string" ? value : value.id);
const referenceSchema = z.object({
  id: z.string().min(1),
  customer: objectIdSchema.nullable().optional(),
  charge: objectIdSchema.nullable().optional(),
});

export type StripeEventReference = Readonly<{
  kind: "checkout" | "subscription" | "invoice" | "charge";
  objectId: string;
  customerId: string | null;
}>;

export function stripeEventReference(event: Stripe.Event): StripeEventReference | null {
  if (!stripeLifecycleEventTypes.some((type) => type === event.type)) return null;
  const parsed = referenceSchema.safeParse(event.data.object);
  if (!parsed.success) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
    "Stripe lifecycle event has invalid object identifiers.");
  const value = parsed.data;
  if (event.type.startsWith("checkout.session.")) {
    return { kind: "checkout", objectId: value.id, customerId: value.customer ?? null };
  }
  if (event.type.startsWith("customer.subscription.")) {
    return { kind: "subscription", objectId: value.id, customerId: value.customer ?? null };
  }
  if (event.type.startsWith("invoice.")) {
    return { kind: "invoice", objectId: value.id, customerId: value.customer ?? null };
  }
  const chargeId = event.type === "charge.refunded" ? value.id : value.charge;
  if (chargeId == null) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
    "Stripe financial lifecycle event has no charge identifier.");
  return { kind: "charge", objectId: chargeId, customerId: null };
}

export function stripeTimestamp(seconds: number): Date {
  const date = new Date(seconds * 1000);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || !Number.isFinite(date.getTime())) {
    throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false, "Stripe returned an invalid lifecycle timestamp.");
  }
  return date;
}

function subscriptionStatus(status: Stripe.Subscription.Status): PurchaseStatus {
  switch (status) {
    case "trialing": case "active": return "active";
    case "past_due": return "in_grace";
    case "unpaid": case "paused": case "canceled": case "incomplete": case "incomplete_expired": return "expired";
    default: throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
      "Stripe returned an unsupported subscription status. Update the lifecycle mapping before granting access.");
  }
}

// https://docs.stripe.com/currencies. UGX is listed as zero-decimal there, but its API amounts are
// two-decimal for backwards compatibility, like ISK.
const stripeZeroDecimalCurrencies: ReadonlySet<string> = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf",
]);
const stripeThreeDecimalCurrencies: ReadonlySet<string> = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

function stripeMinorUnitsToMicros(amount: number, currency: string): number {
  if (stripeZeroDecimalCurrencies.has(currency)) return amount * 1_000_000;
  if (stripeThreeDecimalCurrencies.has(currency)) return amount * 1_000;
  return amount * 10_000;
}

// The amount the customer was charged in their own currency, summed over the invoice's charges.
function stripeChargedPrice(payments: StripeInvoiceFinancialState["payments"]): PurchasePrice | null {
  const amounts = z.array(stripePresentmentSchema).min(1).safeParse(payments.map(({ charge }) =>
    charge.presentment_details ?? { presentment_amount: charge.amount_captured, presentment_currency: charge.currency }));
  if (!amounts.success) return null;
  const currency = amounts.data[0].presentment_currency;
  if (amounts.data.some((amount) => amount.presentment_currency !== currency)) return null;
  const amountMicros = stripeMinorUnitsToMicros(
    amounts.data.reduce((sum, amount) => sum + amount.presentment_amount, 0), currency);
  return Number.isSafeInteger(amountMicros) ? { amountMicros, currency: currency.toUpperCase() } : null;
}

export function normalizeStripePurchase(
  subscription: Stripe.Subscription, customerId: string, environment: StripeEnvironment,
  financial: StripeInvoiceFinancialState, verifiedAt: Date,
): StripePurchaseState {
  const item = subscription.items.data[0];
  if (item === undefined) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
    "Stripe subscription has no recurring item.");
  const trialStartedAt = subscription.trial_start !== null && subscription.trial_end !== null
    && subscription.trial_end > subscription.trial_start && subscription.trial_start * 1000 <= verifiedAt.getTime()
    ? stripeTimestamp(subscription.trial_start) : null;
  const isTrial = subscription.status === "trialing";
  if (isTrial && (trialStartedAt === null || subscription.trial_end === null)) {
    throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false, "Stripe trial has no verified start or end.");
  }
  const until = stripeTimestamp(isTrial && subscription.trial_end !== null
    ? subscription.trial_end : item.current_period_end);
  let status = subscriptionStatus(subscription.status);
  const invoice = financial.invoice;
  if (subscription.status === "active" && (invoice === null || invoice.status !== "paid")) {
    throw new StripeBillingError("STRIPE_RESPONSE_INVALID", true,
      "Stripe active subscription has no paid current-period invoice. Retry authoritative reconciliation.");
  }
  const refunded = financial.payments.reduce((sum, payment) => sum + payment.refunds
    .filter((refund) => refund.status === "succeeded")
    .reduce((amount, refund) => amount + refund.amount, 0), 0);
  const disputed = financial.payments.some((payment) => payment.disputes
    .some((dispute) => dispute.status !== "won"));
  const revokedReason = isTrial ? null : disputed ? "chargeback"
    : invoice !== null && invoice.amount_paid > 0 && refunded >= invoice.amount_paid ? "refund" : null;
  if (revokedReason !== null) status = "revoked";
  const firstPaidInvoiceIsCurrent = invoice !== null && invoice.id === financial.firstPaidInvoiceId;
  const cancellationReason = subscription.cancellation_details?.reason ?? null;
  return {
    subscriptionId: subscription.id, customerId, environment, status, providerStatus: subscription.status,
    isTrial, willRenew: (subscription.status === "trialing" || subscription.status === "active"
      || subscription.status === "past_due") && !subscription.cancel_at_period_end && subscription.cancel_at === null,
    until, trialStartedAt, firstPaidAt: financial.firstPaidAt,
    productId: typeof item.price.product === "string" ? item.price.product : item.price.product.id,
    firstPaidInvoiceIsCurrent,
    firstPaidPrice: firstPaidInvoiceIsCurrent ? stripeChargedPrice(financial.payments) : null,
    canceledAt: subscription.canceled_at === null ? null : stripeTimestamp(subscription.canceled_at),
    autorenewDisabledReason: cancellationReason === "cancellation_requested" ? "voluntary"
      : cancellationReason === "payment_failed" ? "billing_error" : "unknown",
    revokedReason, verifiedAt,
  };
}
