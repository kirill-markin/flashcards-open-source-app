import { z } from "zod";
import countries from "./countries.json";
import { describeStripeOffer, resolveStripeOffer } from "./offers";
import { stripeTrialDays } from "../stripe/catalog";
import { StripeBillingError } from "../stripe/contracts";
import { loadStripeProvider } from "../stripe/provider";

export const supportedRegionalCountryCodes: ReadonlyArray<string> = [
  ...countries.fullPriceCountries, ...countries.discountedCountries,
].map((country) => country.code).sort();

const selectedCountrySchema = z.string().refine((code) => supportedRegionalCountryCodes.includes(code));
const commonShape = { supportedCountryCodes: z.array(selectedCountrySchema) };
export const publicRegionalOfferSchema = z.discriminatedUnion("state", [
  z.object({ ...commonShape, state: z.literal("needs_country"), selectedCountry: z.null(),
    countrySource: z.null(), reason: z.enum(["unknown_country", "detection_unavailable"]), offer: z.null() }),
  z.object({ ...commonShape, state: z.literal("offer"), selectedCountry: selectedCountrySchema,
    countrySource: z.enum(["explicit", "ip"]), offer: z.object({
      pricingBand: z.enum(["full", "discounted"]),
      basePrice: z.object({ currency: z.string().regex(/^[a-z]{3}$/), unitAmount: z.number().int().nonnegative(),
        interval: z.literal("month"), taxBehavior: z.literal("inclusive") }),
      trialDays: z.literal(stripeTrialDays), trialEligibility: z.literal("eligible_new_subscribers"),
      salesAvailable: z.boolean(), salesUnavailableReason: z.enum(["purchases_disabled", "country_unavailable"]).nullable(),
    }) }),
]);
export type PublicRegionalOffer = z.infer<typeof publicRegionalOfferSchema>;

export function needsRegionalCountry(reason: "unknown_country" | "detection_unavailable"): PublicRegionalOffer {
  return { state: "needs_country", selectedCountry: null, countrySource: null, reason, offer: null,
    supportedCountryCodes: [...supportedRegionalCountryCodes] };
}

export async function getPublicRegionalOffer(
  country: string, countrySource: "explicit" | "ip",
): Promise<PublicRegionalOffer> {
  const selection = resolveStripeOffer("production", country);
  const provider = await loadStripeProvider("production");
  const { basePrice } = describeStripeOffer(selection, await provider.retrieveCheckoutPrice(selection.priceId));
  const purchasesEnabled = process.env.STRIPE_CHECKOUT_LIVE_ENABLED === "true";
  const result = publicRegionalOfferSchema.safeParse({
    state: "offer", selectedCountry: selection.selectedCountry, countrySource,
    supportedCountryCodes: supportedRegionalCountryCodes,
    offer: { pricingBand: selection.pricingBand, basePrice, trialDays: stripeTrialDays,
      trialEligibility: "eligible_new_subscribers", salesAvailable: purchasesEnabled && selection.salesAvailable,
      salesUnavailableReason: !purchasesEnabled ? "purchases_disabled" : selection.salesAvailable ? null : "country_unavailable" },
  });
  if (!result.success) throw new StripeBillingError("STRIPE_RESPONSE_INVALID", false,
    "The regional subscription offer returned an invalid price response.");
  return result.data;
}
