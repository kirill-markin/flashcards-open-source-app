import { z } from "zod";
import type { DatabaseExecutor } from "../../database";
import { appleBundleId } from "../apple/contracts";
import {
  BillingHistoryError, ensureHistorySubjectInExecutor, epochSchema, nativeIdSchema,
  parseHistoryFields, persistNativeRecordInExecutor, requireHistoryObservation,
  type HistoryObservation, type HistoryWriteResult,
} from "./store";

// appAccountToken and signed JWS bytes are deliberately absent from the financial projection.
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
  const subjectId = await ensureHistorySubjectInExecutor(executor, "apple", environment, fields.originalTransactionId);
  return persistNativeRecordInExecutor(executor, {
    table: "apple_transactions", keyColumn: "transaction_id", id: fields.transactionId, subjectId, observation,
    columns: ["original_transaction_id", "product_id", "purchased_at", "expires_at", "revoked_at",
      "source_signed_at", "native_fields"],
    values: [fields.originalTransactionId, fields.productId, new Date(fields.purchaseDate),
      fields.expiresDate === undefined ? null : new Date(fields.expiresDate),
      fields.revocationDate === undefined ? null : new Date(fields.revocationDate),
      new Date(fields.signedDate), JSON.stringify(fields)],
    freshnessColumn: "source_signed_at",
  });
}
