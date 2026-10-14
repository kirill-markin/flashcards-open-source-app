import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AwsClient } from "google-auth-library";
import { createStoreReportsAuthClient, type GoogleStorageRetry } from "../../storeAnalytics/googleStorageClient";
import { googlePackageName } from "../google/contracts";
import { googleOrderHistorySchema, googleSubscriptionHistorySchema,
  type GoogleOrderHistory, type GoogleSubscriptionHistory } from "./google";

const tokenSchema = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
const orderResponseSchema = googleOrderHistorySchema.extend({ purchaseToken: tokenSchema });
const subscriptionResponseSchema = googleSubscriptionHistorySchema.extend({
  linkedPurchaseToken: tokenSchema.optional(),
  outOfAppPurchaseContext: z.object({ expiredPurchaseToken: tokenSchema.optional() }).optional(),
});
const httpFailureSchema = z.object({ response: z.object({ status: z.number().int() }).optional() });
const publisherOrigin = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${googlePackageName}`;

export class GoogleHistoryApiError extends Error {
  constructor(readonly code: string, readonly httpStatus: number | null, operation: string) {
    super(`Google history ${operation} failed (${httpStatus === null ? "no HTTP response" : `HTTP ${httpStatus}`}). Check nibomo-store-reports Play permissions and reports-role federation.`);
    this.name = "GoogleHistoryApiError";
  }
}

export type VerifiedGoogleOrder = Readonly<{ purchaseToken: string; order: GoogleOrderHistory }>;
export type VerifiedGoogleSubscription = Readonly<{
  subscription: GoogleSubscriptionHistory; linkedPurchaseToken: string | null; observedAt: Date; observationId: string;
}>;

export class GoogleHistoryClient {
  private readonly authClient: AwsClient;

  constructor(onRetry: (retry: GoogleStorageRetry) => void) {
    this.authClient = createStoreReportsAuthClient(onRetry, ["https://www.googleapis.com/auth/androidpublisher"]);
  }

  private async get(url: string, operation: string): Promise<unknown> {
    try {
      const response = await this.authClient.request<unknown>({ url, method: "GET", timeout: 30_000 });
      return response.data;
    } catch (error) {
      // SDK errors can contain the bearer token and the purchase-token URL.
      const failure = httpFailureSchema.safeParse(error);
      const status = failure.success ? failure.data.response?.status ?? null : null;
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_API_FAILED", status, operation);
    }
  }

  async order(orderId: string): Promise<VerifiedGoogleOrder> {
    const response = orderResponseSchema.safeParse(await this.get(
      `${publisherOrigin}/orders/${encodeURIComponent(orderId)}`, "orders.get"));
    if (!response.success || response.data.orderId !== orderId || response.data.lineItems.length === 0) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_ORDER_INVALID", null, "order validation");
    }
    return { purchaseToken: response.data.purchaseToken, order: googleOrderHistorySchema.parse(response.data) };
  }

  async subscription(purchaseToken: string): Promise<VerifiedGoogleSubscription> {
    if (!tokenSchema.safeParse(purchaseToken).success) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_TOKEN_INVALID", null, "token validation");
    }
    const response = subscriptionResponseSchema.safeParse(await this.get(
      `${publisherOrigin}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`, "subscriptionsv2.get"));
    if (!response.success || response.data.lineItems.length === 0) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_SUBSCRIPTION_INVALID", null, "subscription validation");
    }
    const linked = response.data.linkedPurchaseToken;
    const expired = response.data.outOfAppPurchaseContext?.expiredPurchaseToken;
    if (linked !== undefined && expired !== undefined && linked !== expired) {
      throw new GoogleHistoryApiError("GOOGLE_HISTORY_TOKEN_CONFLICT", null, "subscription predecessor validation");
    }
    return { subscription: googleSubscriptionHistorySchema.parse(response.data),
      linkedPurchaseToken: linked ?? expired ?? null, observedAt: new Date(), observationId: randomUUID() };
  }
}
