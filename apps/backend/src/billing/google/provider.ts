import { z } from "zod";
import { loadGoogleAuthClient } from "./config";
import {
  GoogleBillingError, googleBasePlanId, googlePackageName, googleProductId, googleTrialOfferId,
  type GoogleOfferPhase, type GooglePurchaseState,
} from "./contracts";

const timestampSchema = z.iso.datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)));
const tokenSchema = z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/);
const accountIdentifiersSchema = z.object({ obfuscatedExternalAccountId: z.string().min(1).max(64).optional() });
const phaseSchema = z.object({
  freeTrial: z.object({}).optional(),
  basePrice: z.object({}).optional(),
  introductoryPrice: z.object({}).optional(),
  prorationPeriod: z.object({
    originalOfferPhaseType: z.enum(["ORIGINAL_OFFER_PHASE_TYPE_UNSPECIFIED", "BASE", "INTRODUCTORY", "FREE_TRIAL"]).optional(),
  }).optional(),
}).refine((phase) => Object.values(phase).filter((value) => value !== undefined).length === 1);
const moneySchema = z.object({
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  units: z.string().regex(/^\d+$/).optional(),
  nanos: z.number().int().min(0).max(999_999_999).optional(),
});
const subscriptionSchema = z.object({
  kind: z.literal("androidpublisher#subscriptionPurchaseV2"),
  subscriptionState: z.enum([
    "SUBSCRIPTION_STATE_PENDING", "SUBSCRIPTION_STATE_ACTIVE", "SUBSCRIPTION_STATE_PAUSED",
    "SUBSCRIPTION_STATE_IN_GRACE_PERIOD", "SUBSCRIPTION_STATE_ON_HOLD", "SUBSCRIPTION_STATE_CANCELED",
    "SUBSCRIPTION_STATE_EXPIRED", "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED",
  ]),
  acknowledgementState: z.enum(["ACKNOWLEDGEMENT_STATE_PENDING", "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"]),
  startTime: timestampSchema.optional(),
  testPurchase: z.object({}).optional(),
  linkedPurchaseToken: tokenSchema.optional(),
  externalAccountIdentifiers: accountIdentifiersSchema.optional(),
  outOfAppPurchaseContext: z.object({
    expiredPurchaseToken: tokenSchema.optional(),
    expiredExternalAccountIdentifiers: accountIdentifiersSchema.optional(),
  }).optional(),
  lineItems: z.array(z.object({
    productId: z.literal(googleProductId),
    expiryTime: timestampSchema.optional(),
    latestSuccessfulOrderId: z.string().min(1).optional(),
    autoRenewingPlan: z.object({ autoRenewEnabled: z.boolean(), recurringPrice: moneySchema.optional() }),
    offerDetails: z.object({ basePlanId: z.literal(googleBasePlanId), offerId: z.literal(googleTrialOfferId).optional() }),
    offerPhase: phaseSchema.optional(),
  })).length(1),
});
type GoogleSubscription = z.infer<typeof subscriptionSchema>;
const providerFailureSchema = z.object({
  response: z.object({ status: z.number().int().min(100).max(599) }).optional(),
});
const transportFailureSchema = z.object({
  code: z.enum(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "TimeoutError", "AbortError"]).optional(),
});

function requirePurchaseToken(purchaseToken: string): string {
  const token = tokenSchema.safeParse(purchaseToken);
  if (!token.success) {
    throw new GoogleBillingError("GOOGLE_PURCHASE_TOKEN_INVALID", false, null,
      "Google purchase token must be a nonempty printable token of at most 4096 characters.");
  }
  return token.data;
}

async function callGoogle<Result>(operation: string, callback: () => Promise<Result>): Promise<Result> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof GoogleBillingError) throw error;
    // SDK errors carry credentials, purchase URLs and provider payloads; never retain their cause.
    const failure = providerFailureSchema.safeParse(error);
    const transportFailure = transportFailureSchema.safeParse(error);
    const httpStatus = failure.success ? failure.data.response?.status ?? null : null;
    const transportCode = transportFailure.success ? transportFailure.data.code : undefined;
    const retryable = httpStatus === 408 || httpStatus === 409 || httpStatus === 429
      || (httpStatus !== null && httpStatus >= 500) || (httpStatus === null && transportCode !== undefined);
    throw new GoogleBillingError("GOOGLE_PROVIDER_FAILED", retryable, httpStatus,
      `Google ${operation} failed: ${httpStatus === null ? transportCode ?? "authentication or transport failure" : `HTTP ${httpStatus}`}. Check Play permissions, AWS federation and provider availability.`);
  }
}

function offerPhase(subscription: GoogleSubscription): GoogleOfferPhase {
  const phase = subscription.lineItems[0].offerPhase;
  if (phase?.freeTrial !== undefined) return "free_trial";
  if (phase?.basePrice !== undefined) return "base_price";
  if (phase?.introductoryPrice !== undefined) return "introductory_price";
  if (phase?.prorationPeriod !== undefined) return "proration";
  return "unknown";
}

function purchaseState(purchaseToken: string, subscription: GoogleSubscription, verifiedAt: Date): GooglePurchaseState {
  const item = subscription.lineItems[0];
  const providerStatus = subscription.subscriptionState;
  const completed = providerStatus !== "SUBSCRIPTION_STATE_PENDING"
    && providerStatus !== "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED";
  const until = item.expiryTime === undefined ? null : new Date(item.expiryTime);
  const currentPhase = offerPhase(subscription);
  if (completed && (until === null || subscription.startTime === undefined)) {
    throw new GoogleBillingError("GOOGLE_RESPONSE_INVALID", false, null,
      "Google completed subscription is missing startTime or expiryTime.");
  }
  const grantsAccess = providerStatus === "SUBSCRIPTION_STATE_ACTIVE"
    || providerStatus === "SUBSCRIPTION_STATE_CANCELED" || providerStatus === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
  if (grantsAccess && currentPhase === "unknown") {
    throw new GoogleBillingError("GOOGLE_OFFER_PHASE_MISSING", false, null,
      "Google subscription is missing its current offer phase; trial and paid access cannot be classified.");
  }
  const inGrace = providerStatus === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
  const active = (providerStatus === "SUBSCRIPTION_STATE_ACTIVE" || providerStatus === "SUBSCRIPTION_STATE_CANCELED")
    && until !== null && until.getTime() > verifiedAt.getTime();
  const environment = subscription.testPurchase === undefined ? "production" : "sandbox";
  const price = item.autoRenewingPlan.recurringPrice;
  const positivePrice = price !== undefined && (BigInt(price.units ?? "0") > 0n || (price.nanos ?? 0) > 0);
  const outOfApp = subscription.outOfAppPurchaseContext;
  return {
    purchaseToken, productId: googleProductId, basePlanId: googleBasePlanId, offerId: item.offerDetails.offerId ?? null,
    price: price === undefined ? null : {
      amountMicros: Number(price.units ?? "0") * 1_000_000 + Math.round((price.nanos ?? 0) / 1000),
      currency: price.currencyCode,
    },
    status: inGrace ? "in_grace" : active ? "active" : "expired", providerStatus, environment, currentPhase,
    isTrial: currentPhase === "free_trial",
    willRenew: item.autoRenewingPlan.autoRenewEnabled && providerStatus !== "SUBSCRIPTION_STATE_CANCELED",
    // A failed first post-trial charge can enter grace with the trial's last successful order.
    paid: environment === "production" && active && currentPhase === "base_price"
      && positivePrice && item.latestSuccessfulOrderId !== undefined,
    completed, until, graceUntil: inGrace ? until : null,
    startedAt: subscription.startTime === undefined ? null : new Date(subscription.startTime), verifiedAt,
    latestSuccessfulOrderId: item.latestSuccessfulOrderId ?? null,
    linkedPurchaseToken: subscription.linkedPurchaseToken ?? null,
    acknowledgementState: subscription.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" ? "acknowledged" : "pending",
    obfuscatedExternalAccountId: subscription.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    outOfAppPurchaseContext: outOfApp === undefined ? null : {
      expiredPurchaseToken: outOfApp.expiredPurchaseToken ?? null,
      expiredObfuscatedExternalAccountId: outOfApp.expiredExternalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    },
  };
}

const purchasesUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${googlePackageName}/purchases`;

export class GoogleProvider {
  async currentState(purchaseToken: string): Promise<GooglePurchaseState> {
    const token = requirePurchaseToken(purchaseToken);
    const response = await callGoogle("subscriptionsv2.get", () => loadGoogleAuthClient().request<unknown>({
      url: `${purchasesUrl}/subscriptionsv2/tokens/${encodeURIComponent(token)}`, method: "GET",
    }));
    const subscription = subscriptionSchema.safeParse(response.data);
    if (!subscription.success) {
      throw new GoogleBillingError("GOOGLE_RESPONSE_INVALID", false, null,
        "Google response must contain one premium/monthly auto-renewing subscription with valid state, acknowledgement and offer fields.");
    }
    return purchaseState(token, subscription.data, new Date());
  }

  async acknowledge(purchaseToken: string): Promise<GooglePurchaseState> {
    const before = await this.currentState(purchaseToken);
    if (!before.completed) {
      throw new GoogleBillingError("GOOGLE_PURCHASE_INCOMPLETE", false, null,
        "Google subscription cannot be acknowledged while its initial payment is pending or canceled.");
    }
    if (before.acknowledgementState === "acknowledged") return before;
    try {
      await callGoogle("subscriptions.acknowledge", () => loadGoogleAuthClient().request({
        url: `${purchasesUrl}/subscriptions/${googleProductId}/tokens/${encodeURIComponent(before.purchaseToken)}:acknowledge`,
        method: "POST", data: {},
      }));
    } catch (error) {
      if (!(error instanceof GoogleBillingError) || error.code !== "GOOGLE_PROVIDER_FAILED") throw error;
      const after = await this.currentState(before.purchaseToken);
      if (after.acknowledgementState !== "acknowledged") throw error;
      return { ...after, outOfAppPurchaseContext: before.outOfAppPurchaseContext ?? after.outOfAppPurchaseContext };
    }
    const after = await this.currentState(before.purchaseToken);
    if (after.acknowledgementState !== "acknowledged") {
      throw new GoogleBillingError("GOOGLE_ACKNOWLEDGEMENT_UNCONFIRMED", true, null,
        "Google acknowledgement has not appeared in subscription readback; retry verification.");
    }
    // Play removes this context after acknowledgement; persistence needs the verified attribution.
    return { ...after, outOfAppPurchaseContext: before.outOfAppPurchaseContext ?? after.outOfAppPurchaseContext };
  }
}
