import type { StripeEnvironment } from "./contracts";

// Public inventory: docs/stripe-subscriptions/configuration.json. Do not import its audit payload.
export const stripeApiVersion = "2026-09-30.endive";
export const stripePremiumMonthlyAmount = 699;
export const stripeTrialDays = 7;
export const stripeSubscriptionReturnUrl = "https://app.nibomo.com/settings/subscription";
export const stripeCheckoutSuccessUrl = `${stripeSubscriptionReturnUrl}?checkout_session_id={CHECKOUT_SESSION_ID}`;
export type StripeCatalog = Readonly<{
  accountId: string;
  livemode: boolean;
  productId: string;
  priceId: string;
  portalConfigurationId: string;
  iconFileId: string;
}>;
export const stripeCatalog: Readonly<Record<StripeEnvironment, StripeCatalog>> = {
  sandbox: {
    accountId: "acct_1UMQBkCVkVWAch1V", livemode: false,
    productId: "prod_VNApGSuXOif51N", priceId: "price_1UMQUDCVkVWAch1VJzr1hELW",
    portalConfigurationId: "bpc_1UMQUECVkVWAch1VcQK8QOoM", iconFileId: "file_1UMQUBCVkVWAch1V4xlvzrLX",
  },
  production: {
    accountId: "acct_1KrGW6E3K3xV54Nr", livemode: true,
    productId: "prod_VNAqU0IRKOL0TD", priceId: "price_1UMQUtE3K3xV54NrvU8rT8ef",
    portalConfigurationId: "bpc_1UMQUtE3K3xV54NruoEezugO", iconFileId: "file_1UMQUqE3K3xV54NruG41UVFn",
  },
};
