import { z } from "zod";
import type { DatabaseExecutor } from "../../database";
import {
  BillingHistoryError, ensureHistorySubjectInExecutor, epochSchema, nativeIdSchema,
  parseHistoryFields, persistNativeRecordInExecutor, requireHistoryObservation,
  type HistoryObservation, type HistoryWriteResult,
} from "./store";

const referenceSchema = z.union([nativeIdSchema, z.object({ id: nativeIdSchema })])
  .transform((value) => typeof value === "string" ? value : value.id);
const nullableReferenceSchema = referenceSchema.nullable();
const amountSchema = z.number().int();
const nullableTimeSchema = epochSchema.nullable();
const priceSchema = z.object({
  id: nativeIdSchema, product: referenceSchema, currency: z.string(),
  unit_amount: amountSchema.nullable(), unit_amount_decimal: z.string().nullable().optional(),
  recurring: z.object({
    interval: z.string(), interval_count: z.number().int(), usage_type: z.string().optional(),
  }).nullable().optional(),
});
export const stripeSubscriptionHistorySchema = z.object({
  object: z.literal("subscription"), id: nativeIdSchema,
  customer: referenceSchema, livemode: z.boolean(), created: epochSchema, status: z.string().min(1),
  start_date: epochSchema, trial_start: nullableTimeSchema, trial_end: nullableTimeSchema,
  cancel_at_period_end: z.boolean(), cancel_at: nullableTimeSchema,
  canceled_at: nullableTimeSchema, ended_at: nullableTimeSchema,
  latest_invoice: nullableReferenceSchema,
  collection_method: z.string().optional(),
  items: z.object({
    has_more: z.literal(false),
    data: z.array(z.object({
      id: nativeIdSchema, price: priceSchema, quantity: z.number().int().optional(),
      current_period_start: epochSchema, current_period_end: epochSchema,
    })),
  }),
});
export type StripeSubscriptionHistory = z.input<typeof stripeSubscriptionHistorySchema>;

export const stripeInvoiceHistorySchema = z.object({
  object: z.literal("invoice"), id: nativeIdSchema, customer: referenceSchema,
  livemode: z.boolean(), created: epochSchema, status: z.string().nullable(),
  currency: z.string(), amount_due: amountSchema, amount_paid: amountSchema,
  amount_remaining: amountSchema, amount_overpaid: amountSchema.optional(),
  subtotal: amountSchema, total: amountSchema,
  subtotal_excluding_tax: amountSchema.nullable().optional(), total_excluding_tax: amountSchema.nullable().optional(),
  billing_reason: z.string().nullable(), collection_method: z.string(),
  period_start: epochSchema, period_end: epochSchema,
  parent: z.object({
    type: z.string(),
    subscription_details: z.object({ subscription: referenceSchema }).nullable().optional(),
  }).nullable().optional(),
  status_transitions: z.object({
    finalized_at: nullableTimeSchema, paid_at: nullableTimeSchema,
    marked_uncollectible_at: nullableTimeSchema, voided_at: nullableTimeSchema,
  }),
  lines: z.object({
    has_more: z.literal(false),
    data: z.array(z.object({
      id: nativeIdSchema, amount: amountSchema, currency: z.string(),
      quantity: z.number().int().nullable().optional(),
      period: z.object({ start: epochSchema, end: epochSchema }),
      pricing: z.object({
        type: z.string(),
        price_details: z.object({ price: referenceSchema, product: referenceSchema }).nullable().optional(),
        unit_amount_decimal: z.string().nullable().optional(),
      }).nullable().optional(),
    })),
  }),
});
export type StripeInvoiceHistory = z.input<typeof stripeInvoiceHistorySchema>;

export const stripePaymentHistorySchema = z.object({
  object: z.literal("invoice_payment"), id: nativeIdSchema, livemode: z.boolean(),
  created: epochSchema, invoice: referenceSchema,
  status: z.string().min(1), currency: z.string(),
  amount_paid: amountSchema.nullable(), amount_requested: amountSchema, is_default: z.boolean(),
  payment: z.object({
    type: z.string(), payment_intent: referenceSchema.optional(),
    charge: referenceSchema.optional(), payment_record: referenceSchema.optional(),
  }),
  status_transitions: z.object({ paid_at: nullableTimeSchema, canceled_at: nullableTimeSchema }),
});
export type StripePaymentHistory = z.input<typeof stripePaymentHistorySchema>;

export const stripeRefundHistorySchema = z.object({
  object: z.literal("refund"), id: nativeIdSchema, created: epochSchema,
  amount: amountSchema, currency: z.string(), status: z.string().nullable(),
  charge: nullableReferenceSchema, payment_intent: nullableReferenceSchema,
  reason: z.string().nullable(), failure_reason: z.string().optional(),
});
export type StripeRefundHistory = z.input<typeof stripeRefundHistorySchema>;

export const stripePaymentInvoiceContextSchema = z.object({
  object: z.literal("invoice"), id: nativeIdSchema, customer: referenceSchema, livemode: z.boolean(),
});
export type StripePaymentInvoiceContext = z.input<typeof stripePaymentInvoiceContextSchema>;
export const stripeRefundChargeContextSchema = z.object({
  object: z.literal("charge"), id: nativeIdSchema, customer: referenceSchema,
  livemode: z.boolean(), payment_intent: nullableReferenceSchema,
});
export type StripeRefundChargeContext = z.input<typeof stripeRefundChargeContextSchema>;

function assertStripeEnvironment(livemode: boolean, observation: HistoryObservation): void {
  requireHistoryObservation(observation);
  if (livemode !== (observation.environment === "production")) {
    throw new BillingHistoryError("BILLING_HISTORY_INVALID", "Stripe object environment does not match its import.");
  }
}

// Every persistStripe* helper below (subscription, invoice, payment, refund) takes only objects verified
// against the Nibomo catalog and customer scope through the Stripe provider, with the verified parent
// invoice or charge for a payment or refund.
export async function persistStripeSubscriptionInExecutor(
  executor: DatabaseExecutor, input: StripeSubscriptionHistory, observation: HistoryObservation,
): Promise<HistoryWriteResult> {
  const { customer, ...fields } = parseHistoryFields(stripeSubscriptionHistorySchema, input);
  assertStripeEnvironment(fields.livemode, observation);
  const subjectId = await ensureHistorySubjectInExecutor(executor, "stripe", observation.environment, customer);
  return persistNativeRecordInExecutor(executor, {
    table: "stripe_subscriptions", keyColumn: "subscription_id", id: fields.id, subjectId, observation,
    columns: ["created_at_provider", "status", "native_fields"],
    values: [new Date(fields.created * 1000), fields.status, JSON.stringify(fields)], freshnessColumn: "observed_at",
  });
}

export async function persistStripeInvoiceInExecutor(
  executor: DatabaseExecutor, input: StripeInvoiceHistory, observation: HistoryObservation,
): Promise<HistoryWriteResult> {
  const { customer, ...fields } = parseHistoryFields(stripeInvoiceHistorySchema, input);
  assertStripeEnvironment(fields.livemode, observation);
  const subjectId = await ensureHistorySubjectInExecutor(executor, "stripe", observation.environment, customer);
  return persistNativeRecordInExecutor(executor, {
    table: "stripe_invoices", keyColumn: "invoice_id", id: fields.id, subjectId, observation,
    columns: ["subscription_id", "created_at_provider", "status", "native_fields"],
    values: [fields.parent?.subscription_details?.subscription ?? null,
      new Date(fields.created * 1000), fields.status, JSON.stringify(fields)], freshnessColumn: "observed_at",
  });
}

export async function persistStripePaymentInExecutor(
  executor: DatabaseExecutor, invoice: StripePaymentInvoiceContext,
  input: StripePaymentHistory, observation: HistoryObservation,
): Promise<HistoryWriteResult> {
  const fields = parseHistoryFields(stripePaymentHistorySchema, input);
  const parent = parseHistoryFields(stripePaymentInvoiceContextSchema, invoice);
  assertStripeEnvironment(fields.livemode, observation);
  assertStripeEnvironment(parent.livemode, observation);
  if (fields.invoice !== parent.id) {
    throw new BillingHistoryError("BILLING_HISTORY_IDENTITY_CONFLICT", "Stripe payment does not match its invoice.");
  }
  const subjectId = await ensureHistorySubjectInExecutor(executor, "stripe", observation.environment, parent.customer);
  return persistNativeRecordInExecutor(executor, {
    table: "stripe_payments", keyColumn: "payment_id", id: fields.id, subjectId, observation,
    columns: ["invoice_id", "created_at_provider", "status", "native_fields"],
    values: [fields.invoice, new Date(fields.created * 1000), fields.status, JSON.stringify(fields)],
    freshnessColumn: "observed_at",
  });
}

export async function persistStripeRefundInExecutor(
  executor: DatabaseExecutor, charge: StripeRefundChargeContext,
  input: StripeRefundHistory, observation: HistoryObservation,
): Promise<HistoryWriteResult> {
  const fields = parseHistoryFields(stripeRefundHistorySchema, input);
  const parent = parseHistoryFields(stripeRefundChargeContextSchema, charge);
  assertStripeEnvironment(parent.livemode, observation);
  if (fields.charge !== parent.id || fields.payment_intent !== parent.payment_intent) {
    throw new BillingHistoryError("BILLING_HISTORY_IDENTITY_CONFLICT", "Stripe refund does not match its charge.");
  }
  const subjectId = await ensureHistorySubjectInExecutor(executor, "stripe", observation.environment, parent.customer);
  return persistNativeRecordInExecutor(executor, {
    table: "stripe_refunds", keyColumn: "refund_id", id: fields.id, subjectId, observation,
    columns: ["charge_id", "payment_intent_id", "created_at_provider", "status", "native_fields"],
    values: [fields.charge, fields.payment_intent, new Date(fields.created * 1000),
      fields.status, JSON.stringify(fields)], freshnessColumn: "observed_at",
  });
}
