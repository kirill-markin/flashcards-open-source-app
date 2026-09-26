import type { PurchaseStatus } from "../resolver";

export const appleAppId = 6760538964;
export const appleBundleId = "com.flashcards-open-source-app.app";
export const appleProductId = "premium_monthly";
export type AppleEnvironment = "production" | "sandbox";
export type AppleSigningSecret = Readonly<{ privateKey: string; keyId: string; issuerId: string }>;
export type ApplePurchaseIdentity = Readonly<{
  originalTransactionId: string;
  appAccountToken: string | null;
  environment: AppleEnvironment;
}>;
export type ApplePurchaseState = ApplePurchaseIdentity & Readonly<{
  transactionId: string;
  status: PurchaseStatus;
  providerStatus: string;
  isTrial: boolean;
  willRenew: boolean;
  until: Date;
  graceUntil: Date | null;
  purchasedAt: Date;
  signedAt: Date;
  revokedAt: Date | null;
  paid: boolean;
}>;
export type AppleNotification = Readonly<{
  eventId: string;
  eventType: string;
  occurredAt: Date;
  environment: AppleEnvironment;
  identity: ApplePurchaseIdentity | null;
  signedPayload: string;
}>;
export class AppleBillingError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, message: string) {
    super(message);
    this.name = "AppleBillingError";
  }
}
