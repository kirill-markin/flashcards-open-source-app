import type Stripe from "stripe";

export type StripeEnvironment = "production" | "sandbox";
export type StripeEnvironmentSecret = Readonly<{ apiKey: string; webhookSigningSecret: string }>;
export type StripeBillingSecret = Readonly<{
  sandbox?: StripeEnvironmentSecret;
  production?: StripeEnvironmentSecret;
}>;
export type StripeBillingErrorCode =
  | "STRIPE_BILLING_UNAVAILABLE" | "STRIPE_CONFIGURATION_INVALID" | "STRIPE_PROVIDER_FAILED"
  | "STRIPE_RESPONSE_INVALID" | "STRIPE_SIGNATURE_INVALID" | "STRIPE_IDENTITY_MISMATCH"
  | "STRIPE_ACCOUNT_RETIRED" | "STRIPE_EMAIL_REQUIRED" | "STRIPE_RECOVERY_REQUIRED"
  | "STRIPE_STORAGE_CONFLICT";

export class StripeBillingError extends Error {
  constructor(readonly code: StripeBillingErrorCode, readonly retryable: boolean, message: string) {
    super(message);
    this.name = "StripeBillingError";
  }
}

export type StripeCustomerIdentity = Readonly<{
  identityId: string;
  environment: StripeEnvironment;
  userId: string;
  customerId: string | null;
  isPrimary: boolean;
  createdAt: Date;
  accountDeletedAt: Date | null;
}>;
export type StripeCheckoutStatus = "pending" | "open" | "complete" | "expired" | "abandoned";
// Server-created, persisted before the first provider call; never populated from a client body.
export type StripeCheckoutAttempt = Readonly<{
  attemptId: string;
  identityId: string;
  environment: StripeEnvironment;
  userId: string;
  customerId: string;
  sessionId: string | null;
  status: StripeCheckoutStatus;
  trialDays: 0 | 7;
  locale: Stripe.Checkout.SessionCreateParams.Locale;
  expiresAt: Date;
  createdAt: Date;
  accountDeletedAt: Date | null;
}>;
