import type Stripe from "stripe";
import type { StripeEnvironment } from "./contracts";

// Public inventory: docs/stripe-subscriptions/configuration.json. Do not import its audit payload.
export const stripeApiVersion = "2026-09-30.endive";
export const stripePremiumMonthlyAmount = 699;
export const stripeTrialDays = 7;
export const stripeSubscriptionReturnUrl = "https://app.nibomo.com/settings/subscription";
export const stripeCheckoutSuccessUrl = `${stripeSubscriptionReturnUrl}?checkout_session_id={CHECKOUT_SESSION_ID}`;
export type StripeKnownPrice = Readonly<{ priceId: string; unitAmount: number }>;
export type StripeCatalog = Readonly<{
  accountId: string;
  livemode: boolean;
  productId: string;
  priceId: string;
  knownPrices: ReadonlyArray<StripeKnownPrice>;
  portalConfigurationId: string;
  iconFileId: string;
}>;
export const stripeCatalog: Readonly<Record<StripeEnvironment, StripeCatalog>> = {
  sandbox: {
    accountId: "acct_1UMQBkCVkVWAch1V", livemode: false,
    productId: "prod_VNApGSuXOif51N", priceId: "price_1UMQUDCVkVWAch1VJzr1hELW",
    knownPrices: [
      { priceId: "price_1UMQUDCVkVWAch1VJzr1hELW", unitAmount: stripePremiumMonthlyAmount },
      { priceId: "price_1UWZpMCVkVWAch1VvqKgvUc1", unitAmount: 349 },
    ],
    portalConfigurationId: "bpc_1UMQUECVkVWAch1VcQK8QOoM", iconFileId: "file_1URfr3CVkVWAch1VLvRCSVUi",
  },
  production: {
    accountId: "acct_1KrGW6E3K3xV54Nr", livemode: true,
    productId: "prod_VNAqU0IRKOL0TD", priceId: "price_1UMQUtE3K3xV54NrvU8rT8ef",
    knownPrices: [
      { priceId: "price_1UMQUtE3K3xV54NrvU8rT8ef", unitAmount: stripePremiumMonthlyAmount },
      { priceId: "price_1UWZpNE3K3xV54NrDlTNJoIl", unitAmount: 349 },
    ],
    portalConfigurationId: "bpc_1UMQUtE3K3xV54NruoEezugO", iconFileId: "file_1URfr6E3K3xV54Nrdw0XAXLm",
  },
};

export function matchesStripeCatalogPrice(catalog: StripeCatalog, price: Stripe.Price): boolean {
  const known = catalog.knownPrices.find((entry) => entry.priceId === price.id);
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  return known !== undefined && price.livemode === catalog.livemode && productId === catalog.productId
    && price.currency === "usd" && price.unit_amount === known.unitAmount
    && price.tax_behavior === "inclusive" && price.type === "recurring"
    && price.recurring?.interval === "month" && price.recurring.interval_count === 1
    && price.recurring.usage_type === "licensed";
}
