import type { PurchasePrice } from "../../productAnalytics/serverFacts/billingFacts";
import type { PurchaseStatus } from "../resolver";

export const googlePackageName = "com.flashcardsopensourceapp.app";
export const googleProductId = "premium";
export const googleBasePlanId = "monthly";
export const googleTrialOfferId = "free-trial-7d";
export type GoogleEnvironment = "production" | "sandbox";
export type GoogleOfferPhase = "free_trial" | "base_price" | "introductory_price" | "proration" | "unknown";
export type GoogleAcknowledgementState = "pending" | "acknowledged";
export type GoogleOutOfAppPurchaseContext = Readonly<{
  expiredPurchaseToken: string | null;
  expiredObfuscatedExternalAccountId: string | null;
}>;
export type GooglePurchaseState = Readonly<{
  purchaseToken: string;
  productId: typeof googleProductId;
  basePlanId: typeof googleBasePlanId;
  offerId: typeof googleTrialOfferId | null;
  // The base plan's regional recurring price, not the amount of any one order.
  price: PurchasePrice | null;
  status: PurchaseStatus;
  providerStatus: string;
  environment: GoogleEnvironment;
  currentPhase: GoogleOfferPhase;
  isTrial: boolean;
  willRenew: boolean;
  // Evidence of current production paid access, not an exact charge time or amount.
  paid: boolean;
  completed: boolean;
  until: Date | null;
  graceUntil: Date | null;
  // Original subscription signup, not the time of its most recent paid renewal.
  startedAt: Date | null;
  verifiedAt: Date;
  latestSuccessfulOrderId: string | null;
  linkedPurchaseToken: string | null;
  acknowledgementState: GoogleAcknowledgementState;
  obfuscatedExternalAccountId: string | null;
  outOfAppPurchaseContext: GoogleOutOfAppPurchaseContext | null;
}>;

export class GoogleBillingError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly httpStatus: number | null, message: string) {
    super(message);
    this.name = "GoogleBillingError";
  }
}
