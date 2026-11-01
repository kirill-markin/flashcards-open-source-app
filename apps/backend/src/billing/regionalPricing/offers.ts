import type Stripe from "stripe";
import countries from "./countries.json";
import taxCoverage from "./taxCoverage.json";
import { stripeCatalog } from "../stripe/catalog";
import { StripeBillingError, type StripeEnvironment } from "../stripe/contracts";

export type RegionalPricingBand = "full" | "discounted";
export type StripeOfferSelection = Readonly<{
  selectedCountry: string | null; pricingBand: RegionalPricingBand;
  priceId: string; checkoutMode: "legacy" | "managed";
}>;
export type StripeOfferPrice = Readonly<{
  currency: string; unitAmount: number; interval: "month"; taxBehavior: "inclusive";
}>;
export type StripeOfferDetails = StripeOfferSelection & Readonly<{ basePrice: StripeOfferPrice }>;

export function describeStripeOffer(offer: StripeOfferSelection, price: Stripe.Price): StripeOfferDetails {
  if (price.id !== offer.priceId || price.unit_amount === null) throw new StripeBillingError(
    "STRIPE_RESPONSE_INVALID", false, "Stripe returned no verified amount for the reserved offer.");
  return { selectedCountry: offer.selectedCountry, pricingBand: offer.pricingBand,
    priceId: offer.priceId, checkoutMode: offer.checkoutMode,
    basePrice: { currency: price.currency, unitAmount: price.unit_amount, interval: "month", taxBehavior: "inclusive" } };
}
export type StripeResolvedOffer = Readonly<{
  selectedCountry: string | null;
  pricingBand: RegionalPricingBand;
  priceId: string;
  checkoutMode: "managed";
  salesAvailable: boolean;
}>;

export function resolveStripeOffer(environment: StripeEnvironment, country: string | null): StripeResolvedOffer {
  const selectedCountry = country === null ? null : country.trim().toUpperCase();
  const full = selectedCountry === null || countries.fullPriceCountries.some((entry) => entry.code === selectedCountry);
  if (!full && !countries.discountedCountries.some((entry) => entry.code === selectedCountry)) {
    throw new StripeBillingError("STRIPE_COUNTRY_INVALID", false, "Choose a known country code for the subscription offer.");
  }
  const catalog = stripeCatalog[environment];
  const prices = catalog.knownPrices.filter((entry) => (entry.priceId === catalog.priceId) === full);
  if (prices.length !== 1) throw new StripeBillingError("STRIPE_CONFIGURATION_INVALID", false,
    "Configure exactly one known subscription Price for each regional offer.");
  const price = prices[0];
  return { selectedCountry, pricingBand: full ? "full" : "discounted", priceId: price.priceId,
    checkoutMode: "managed", salesAvailable: selectedCountry === null || taxCoverage.codes.includes(selectedCountry) };
}

export function requireStripeOfferAvailable(offer: StripeResolvedOffer): void {
  if (!offer.salesAvailable) throw new StripeBillingError("STRIPE_COUNTRY_UNAVAILABLE", false,
    "New subscriptions are unavailable for the selected country. Choose a supported offer country.");
}
