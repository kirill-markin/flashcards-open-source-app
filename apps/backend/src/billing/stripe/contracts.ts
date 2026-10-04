import type Stripe from "stripe";
import type { PurchasePrice } from "../../productAnalytics/serverFacts/billingFacts";
import type { PurchaseStatus } from "../resolver";

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
  | "STRIPE_STORAGE_CONFLICT" | "STRIPE_EMAIL_DATA_INVALID"
  | "STRIPE_EMAIL_FAILED" | "STRIPE_EMAIL_RECOVERY_REQUIRED";

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

export type StripeInvoiceFinancialState = Readonly<{
  invoice: Stripe.Invoice | null;
  firstPaidAt: Date | null;
  firstPaidInvoiceId: string | null;
  payments: ReadonlyArray<Readonly<{
    payment: Stripe.InvoicePayment;
    charge: Stripe.Charge;
    refunds: ReadonlyArray<Stripe.Refund>;
    disputes: ReadonlyArray<Stripe.Dispute>;
  }>>;
}>;

export type StripePurchaseState = Readonly<{
  subscriptionId: string;
  customerId: string;
  environment: StripeEnvironment;
  status: PurchaseStatus;
  providerStatus: string;
  isTrial: boolean;
  willRenew: boolean;
  until: Date;
  trialStartedAt: Date | null;
  firstPaidAt: Date | null;
  productId: string;
  // What the first paid invoice charged, known only while that invoice is the current one.
  firstPaidPrice: PurchasePrice | null;
  canceledAt: Date | null;
  revokedReason: "refund" | "chargeback" | null;
  verifiedAt: Date;
}>;

export type StripeLifecycleResult = Readonly<{
  outcome: "processed" | "ignored" | "duplicate";
  subscriptionIds: ReadonlyArray<string>;
}>;
