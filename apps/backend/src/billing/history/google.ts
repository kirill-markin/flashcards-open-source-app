import { z } from "zod";
import type { DatabaseExecutor } from "../../database";
import {
  BillingHistoryError, ensureHistorySubjectInExecutor, nativeIdSchema, parseHistoryFields, persistNativeRecordInExecutor,
  providerTimestampSchema, requireHistoryObservation, type HistoryObservation, type HistoryWriteResult,
} from "./store";

const moneySchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/), units: z.string().regex(/^-?\d+$/).optional(),
  nanos: z.number().int().min(-999_999_999).max(999_999_999).optional(),
});
const emptySchema = z.object({});
const orderPhaseSchema = z.object({
  freeTrialDetails: emptySchema.optional(), introductoryPriceDetails: emptySchema.optional(),
  baseDetails: emptySchema.optional(),
  prorationPeriodDetails: z.object({ originalOfferPhase: z.string().optional() }).optional(),
});
const refundDetailsSchema = z.object({ total: moneySchema.optional(), tax: moneySchema.optional() });
const subscriptionDetailsSchema = z.object({
  basePlanId: z.string().optional(), offerId: z.string().optional(), offerPhase: z.string().optional(),
  offerPhaseDetails: orderPhaseSchema.optional(),
  servicePeriodStartTime: providerTimestampSchema.optional(), servicePeriodEndTime: providerTimestampSchema.optional(),
});

// Google purchase tokens, address fields, and external account identifiers never enter native_fields.
export const googleOrderHistorySchema = z.object({
  orderId: nativeIdSchema, state: z.string().min(1),
  createTime: providerTimestampSchema, lastEventTime: providerTimestampSchema,
  salesChannel: z.string().optional(),
  total: moneySchema.optional(), tax: moneySchema.optional(), developerRevenueInBuyerCurrency: moneySchema.optional(),
  orderDetails: z.object({ taxInclusive: z.boolean().optional() }).optional(),
  lineItems: z.array(z.object({
    productId: nativeIdSchema, listingPrice: moneySchema.optional(), total: moneySchema.optional(),
    tax: moneySchema.optional(), subscriptionDetails: subscriptionDetailsSchema.optional(),
    oneTimePurchaseDetails: z.object({
      quantity: z.number().int().optional(), offerId: z.string().optional(), purchaseOptionId: z.string().optional(),
    }).optional(),
  })),
  orderHistory: z.object({
    processedEvent: z.object({ eventTime: providerTimestampSchema }).optional(),
    cancellationEvent: z.object({ eventTime: providerTimestampSchema }).optional(),
    refundEvent: z.object({
      eventTime: providerTimestampSchema, refundDetails: refundDetailsSchema.optional(),
      refundReason: z.string().optional(),
    }).optional(),
    partialRefundEvents: z.array(z.object({
      createTime: providerTimestampSchema, processTime: providerTimestampSchema.optional(),
      state: z.string().optional(), refundDetails: refundDetailsSchema.optional(),
    })).optional(),
  }).optional(),
});
export type GoogleOrderHistory = z.infer<typeof googleOrderHistorySchema>;

const subscriptionPhaseSchema = z.object({
  freeTrial: emptySchema.optional(), basePrice: emptySchema.optional(), introductoryPrice: emptySchema.optional(),
  prorationPeriod: z.object({ originalOfferPhaseType: z.string().optional() }).optional(),
});
export const googleSubscriptionHistorySchema = z.object({
  kind: z.literal("androidpublisher#subscriptionPurchaseV2"),
  subscriptionState: z.string().min(1), acknowledgementState: z.string().optional(),
  startTime: providerTimestampSchema.optional(), regionCode: z.string().optional(), testPurchase: emptySchema.optional(),
  lineItems: z.array(z.object({
    productId: nativeIdSchema, expiryTime: providerTimestampSchema.optional(),
    latestSuccessfulOrderId: nativeIdSchema.optional(),
    autoRenewingPlan: z.object({
      autoRenewEnabled: z.boolean(), recurringPrice: moneySchema.optional(),
    }).optional(),
    prepaidPlan: z.object({ allowExtendAfterTime: providerTimestampSchema.optional() }).optional(),
    offerDetails: z.object({
      basePlanId: z.string().optional(), offerId: z.string().optional(), offerTags: z.array(z.string()).optional(),
    }).optional(), offerPhase: subscriptionPhaseSchema.optional(),
  })),
  canceledStateContext: z.object({
    userInitiatedCancellation: z.object({
      cancelTime: providerTimestampSchema.optional(),
      cancelSurveyResult: z.object({ reason: z.string().optional() }).optional(),
    }).optional(),
    systemInitiatedCancellation: emptySchema.optional(), developerInitiatedCancellation: emptySchema.optional(),
    replacementCancellation: emptySchema.optional(),
  }).optional(),
  pausedStateContext: z.object({ autoResumeTime: providerTimestampSchema.optional() }).optional(),
});
export type GoogleSubscriptionHistory = z.infer<typeof googleSubscriptionHistorySchema>;

export async function persistGoogleOrderInExecutor(
  executor: DatabaseExecutor, purchaseToken: string, input: GoogleOrderHistory, observation: HistoryObservation,
): Promise<HistoryWriteResult> {
  requireHistoryObservation(observation);
  const fields = parseHistoryFields(googleOrderHistorySchema, input);
  const subjectId = await ensureHistorySubjectInExecutor(executor, "google", observation.environment, purchaseToken);
  return persistNativeRecordInExecutor(executor, {
    table: "google_orders", keyColumn: "order_id", id: fields.orderId, subjectId, observation,
    columns: ["created_at_provider", "last_event_at", "state", "native_fields"],
    values: [new Date(fields.createTime), new Date(fields.lastEventTime), fields.state, JSON.stringify(fields)],
    freshnessColumn: "last_event_at",
  });
}

export async function persistGoogleSubscriptionObservationInExecutor(
  executor: DatabaseExecutor, purchaseToken: string, observationId: string,
  input: GoogleSubscriptionHistory, observation: HistoryObservation,
): Promise<HistoryWriteResult> {
  requireHistoryObservation(observation);
  nativeIdSchema.parse(observationId);
  const fields = parseHistoryFields(googleSubscriptionHistorySchema, input);
  if ((fields.testPurchase !== undefined) !== (observation.environment === "sandbox")) {
    throw new BillingHistoryError("BILLING_HISTORY_INVALID", "Google subscription environment does not match its import.");
  }
  const subjectId = await ensureHistorySubjectInExecutor(executor, "google", observation.environment, purchaseToken);
  return persistNativeRecordInExecutor(executor, {
    table: "google_subscription_observations", keyColumn: "observation_id", id: observationId, subjectId, observation,
    columns: ["observed_at_provider", "subscription_state", "native_fields"],
    values: [observation.observedAt, fields.subscriptionState, JSON.stringify(fields)],
    freshnessColumn: "observed_at_provider",
  });
}
