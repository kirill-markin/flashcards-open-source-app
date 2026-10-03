import { randomUUID } from "node:crypto";
import { z } from "zod";
import { unsafeTransaction } from "../../database/unsafe";
import type { PurchaseStatus } from "../resolver";
import { resolveEntitlementLimits } from "../limits";
import { stripeHostedLocale } from "./checkoutPresentation";
import { lockStripeHumanAccountInExecutor, observeStripeAccountInExecutor,
  stripeSubscriptionCanBill, type StripeHumanActor } from "./checkout";
import { StripeBillingError, type StripeEnvironment } from "./contracts";
import { publishStripeTransitions } from "./facts";
import { hasStripeTrialConsumptionInExecutor } from "./identityStore";
import { loadStripeProvider } from "./provider";

export type StripeSubscriptionDetails = Readonly<{
  identityId: string;
  environment: StripeEnvironment;
  managementAvailable: boolean;
  subscriptions: ReadonlyArray<Readonly<{
    subscriptionId: string; status: PurchaseStatus; providerStatus: string;
    isTrial: boolean; willRenew: boolean; until: string; trialEnd: string | null;
    cancelAt: string | null; invalidated: boolean;
  }>>;
}>;
export type StripeBillingDetails = Readonly<{
  environment: StripeEnvironment;
  checkoutAvailable: boolean;
  premiumAiMonthlyMessages: number | null;
  checkoutUnavailableReason: "purchases_disabled" | "existing_subscription" | "checkout_pending" | null;
  basePrice: Readonly<{ currency: string; unitAmount: number; interval: "month"; taxBehavior: "inclusive" }> | null;
  trialEligible: boolean | null;
  customers: ReadonlyArray<StripeSubscriptionDetails>;
  pendingCheckouts: ReadonlyArray<Readonly<{
    attemptId: string; identityId: string; sessionId: string | null;
    status: "pending" | "open"; expiresAt: string;
  }>>;
}>;
export type StripePortalResult = Readonly<{ url: string }>;

export async function getStripeBillingDetails(actor: StripeHumanActor): Promise<StripeBillingDetails> {
  const observed = await unsafeTransaction(async (executor) => {
    const context = await lockStripeHumanAccountInExecutor(executor, actor);
    const observations = await observeStripeAccountInExecutor(executor, context);
    const hasSubscription = observations.some((customer) => customer.subscriptions.some(stripeSubscriptionCanBill));
    const pending = observations.flatMap((customer) => customer.pending);
    const primary = context.identities.find((identity) => identity.isPrimary && identity.environment === context.environment);
    const trialEligible = primary === undefined ? true
      : primary.customerId === null ? null
      : !await hasStripeTrialConsumptionInExecutor(executor, primary.identityId, primary.environment);
    const price = context.checkoutEnabled ? await (await loadStripeProvider(context.environment)).retrieveKnownPrice() : null;
    let basePrice: StripeBillingDetails["basePrice"] = null;
    if (price !== null) {
      const unitAmount = price.unit_amount;
      if (unitAmount === null) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
        "Stripe returned no verified base price amount.");
      basePrice = { currency: price.currency, unitAmount, interval: "month", taxBehavior: "inclusive" };
    }
    const customers = observations.map((customer): StripeSubscriptionDetails => ({
      identityId: customer.identity.identityId, environment: customer.identity.environment,
      managementAvailable: true,
      subscriptions: customer.transitions.map((transition) => {
        const subscription = customer.subscriptions.find((candidate) => candidate.id === transition.state.subscriptionId);
        if (subscription === undefined) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", true,
          "Stripe subscription details changed during reconciliation. Refresh the subscription.");
        return { subscriptionId: subscription.id, status: transition.purchase.status,
          providerStatus: transition.state.providerStatus, isTrial: transition.state.isTrial,
          willRenew: transition.state.willRenew, until: transition.state.until.toISOString(),
          trialEnd: subscription.trial_end === null ? null : new Date(subscription.trial_end * 1000).toISOString(),
          cancelAt: subscription.cancel_at === null ? null : new Date(subscription.cancel_at * 1000).toISOString(),
          invalidated: transition.purchase.invalidated_at !== null };
      }),
    }));
    const result: StripeBillingDetails = {
      premiumAiMonthlyMessages: resolveEntitlementLimits("premium", "account").aiMonthlyMessages,
      environment: context.environment, checkoutAvailable: context.checkoutEnabled && !hasSubscription && pending.length === 0,
      checkoutUnavailableReason: !context.checkoutEnabled ? "purchases_disabled"
        : hasSubscription ? "existing_subscription" : pending.length > 0 ? "checkout_pending" : null,
      basePrice, trialEligible, customers,
      pendingCheckouts: pending.map((attempt) => ({ attemptId: attempt.attemptId, identityId: attempt.identityId,
        sessionId: attempt.sessionId, status: attempt.status === "open" ? "open" : "pending",
        expiresAt: attempt.expiresAt.toISOString() })),
    };
    return { result, transitions: observations.flatMap((customer) => customer.transitions) };
  });
  await publishStripeTransitions(observed.transitions);
  return observed.result;
}

// identityId selects only an owned historical mapping, never an arbitrary provider customer.
export async function createStripePortal(actor: StripeHumanActor, identityId: string): Promise<StripePortalResult> {
  if (!z.uuid().safeParse(identityId).success) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
    "The selected subscription identity is invalid.");
  return unsafeTransaction(async (executor) => {
    const context = await lockStripeHumanAccountInExecutor(executor, actor);
    const identity = context.identities.find((candidate) => candidate.identityId === identityId);
    if (identity === undefined || identity.customerId === null) throw new StripeBillingError("STRIPE_IDENTITY_MISMATCH", false,
      "The subscription identity does not belong to this account. Refresh Subscription settings.");
    const provider = await loadStripeProvider(identity.environment);
    const customer = await provider.retrieveCustomer(identity.customerId);
    if (customer.metadata.nibomo_identity_id !== identity.identityId) throw new StripeBillingError(
      "STRIPE_IDENTITY_MISMATCH", false, "Stripe customer ownership could not be confirmed.");
    const session = await provider.createPortal(identity.customerId, randomUUID(), stripeHostedLocale(context.locale));
    return { url: session.url };
  });
}
