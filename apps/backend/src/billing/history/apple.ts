import { z } from "zod";
import type { DatabaseExecutor } from "../../database";
import { appleBundleId } from "../apple/contracts";
import {
  BillingHistoryError, ensureHistorySubjectInExecutor, epochSchema, nativeIdSchema,
  parseHistoryFields, persistNativeRecordInExecutor, requireHistoryObservation,
  type HistoryObservation, type HistoryWriteResult,
} from "./store";

// appAccountToken and signed JWS bytes are deliberately absent from the financial projection.
export const appleRenewalHistorySchema = z.object({
  originalTransactionId: nativeIdSchema, productId: nativeIdSchema,
  environment: z.enum(["Production", "Sandbox"]), signedDate: epochSchema,
  autoRenewProductId: nativeIdSchema.optional(), autoRenewStatus: z.number().int().optional(),
  expirationIntent: z.number().int().optional(), isInBillingRetryPeriod: z.boolean().optional(),
  gracePeriodExpiresDate: epochSchema.optional(), renewalDate: epochSchema.optional(),
  recentSubscriptionStartDate: epochSchema.optional(), priceIncreaseStatus: z.number().int().optional(),
  renewalPrice: z.number().int().nonnegative().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  offerType: z.number().int().optional(), offerIdentifier: z.string().optional(),
  offerDiscountType: z.string().optional(), offerPeriod: z.string().optional(),
});
export const appleTransactionHistorySchema = z.object({
  transactionId: nativeIdSchema, originalTransactionId: nativeIdSchema,
  bundleId: z.literal(appleBundleId), productId: nativeIdSchema,
  environment: z.enum(["Production", "Sandbox"]),
  purchaseDate: epochSchema, originalPurchaseDate: epochSchema.optional(),
  signedDate: epochSchema, expiresDate: epochSchema.optional(),
  revocationDate: epochSchema.optional(), revocationReason: z.number().int().optional(),
  revocationType: z.string().optional(), revocationPercentage: z.number().optional(),
  type: z.string().optional(), transactionReason: z.string().optional(),
  inAppOwnershipType: z.string().optional(), quantity: z.number().int().nonnegative().optional(),
  price: z.number().int().nonnegative().optional(), currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  offerType: z.number().int().optional(), offerIdentifier: z.string().optional(),
  offerDiscountType: z.string().optional(), offerPeriod: z.string().optional(),
  storefront: z.string().optional(), storefrontId: z.string().optional(),
  subscriptionGroupIdentifier: z.string().optional(), isUpgraded: z.boolean().optional(),
  renewalInfo: appleRenewalHistorySchema.optional(),
});
export type AppleTransactionHistory = z.infer<typeof appleTransactionHistorySchema>;

export async function persistAppleTransactionInExecutor(
  executor: DatabaseExecutor, input: AppleTransactionHistory, observation: HistoryObservation,
): Promise<HistoryWriteResult> {
  requireHistoryObservation(observation);
  const fields = parseHistoryFields(appleTransactionHistorySchema, input);
  const environment = fields.environment === "Production" ? "production" : "sandbox";
  if (environment !== observation.environment) {
    throw new BillingHistoryError("BILLING_HISTORY_INVALID", "Apple transaction environment does not match its import.");
  }
  if (fields.renewalInfo !== undefined && (fields.renewalInfo.originalTransactionId !== fields.originalTransactionId
    || fields.renewalInfo.environment !== fields.environment || fields.renewalInfo.productId !== fields.productId)) {
    throw new BillingHistoryError("BILLING_HISTORY_INVALID", "Apple renewal does not match its transaction.");
  }
  await executor.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    ["apple-history:" + environment + ":" + fields.transactionId]);
  const stored = await executor.query<{ renewal_info: AppleTransactionHistory["renewalInfo"] | null }>(
    `SELECT native_fields -> 'renewalInfo' AS renewal_info FROM billing.apple_transactions
      WHERE environment = $1 AND transaction_id = $2`, [environment, fields.transactionId]);
  const previousRenewal = stored.rows[0]?.renewal_info ?? undefined;
  const renewalInfo = previousRenewal !== undefined && (fields.renewalInfo === undefined
    || previousRenewal.signedDate > fields.renewalInfo.signedDate) ? previousRenewal : fields.renewalInfo;
  const nativeFields = parseHistoryFields(appleTransactionHistorySchema, { ...fields, renewalInfo });
  const subjectId = await ensureHistorySubjectInExecutor(executor, "apple", environment, fields.originalTransactionId);
  const result = await persistNativeRecordInExecutor(executor, {
    table: "apple_transactions", keyColumn: "transaction_id", id: fields.transactionId, subjectId, observation,
    columns: ["original_transaction_id", "product_id", "purchased_at", "expires_at", "revoked_at",
      "source_signed_at", "native_fields"],
    values: [fields.originalTransactionId, fields.productId, new Date(fields.purchaseDate),
      fields.expiresDate === undefined ? null : new Date(fields.expiresDate),
      fields.revocationDate === undefined ? null : new Date(fields.revocationDate),
      new Date(fields.signedDate), JSON.stringify(nativeFields)],
    freshnessColumn: "source_signed_at",
  });
  // Renewal state has its own signing time; an older transaction must not suppress a newer renewal.
  if (result === "stale" && fields.renewalInfo !== undefined
    && (previousRenewal === undefined || fields.renewalInfo.signedDate > previousRenewal.signedDate)) {
    await executor.query(`UPDATE billing.apple_transactions
      SET native_fields = jsonb_set(native_fields, '{renewalInfo}', $3::jsonb),
        observed_at = GREATEST(observed_at, $4), updated_at = now()
      WHERE environment = $1 AND transaction_id = $2`,
    [environment, fields.transactionId, JSON.stringify(fields.renewalInfo), observation.observedAt]);
  }
  return result;
}
