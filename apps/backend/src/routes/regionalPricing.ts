import { Hono } from "hono";
import { getPublicRegionalOffer, needsRegionalCountry, supportedRegionalCountryCodes } from "../billing/regionalPricing/publicOffer";
import { resolveStripeOffer } from "../billing/regionalPricing/offers";
import { StripeBillingError } from "../billing/stripe/contracts";
import { GeoLiteDatabaseError } from "../geolocation/database";
import { getDirectRequestCountryLookup } from "../geolocation/requestCountry";
import type { AppEnv } from "../server/appEnv";
import { HttpError } from "../shared/errors";

export const regionalOfferPath = "/billing/regional-offer";

export function createRegionalPricingRoutes(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get(regionalOfferPath, async (context) => {
    const countries = context.req.queries("country");
    if (countries !== undefined && countries.length !== 1) throw new HttpError(400,
      "Specify country once, using a supported two-letter code.", "STRIPE_COUNTRY_INVALID");
    let country = countries?.[0];
    const countrySource = country === undefined ? "ip" : "explicit";
    try {
      if (country !== undefined) {
        country = resolveStripeOffer("production", country).selectedCountry!;
      } else {
        const lookup = getDirectRequestCountryLookup();
        if (lookup === null) return context.json(needsRegionalCountry("detection_unavailable"));
        let detectedCountry: string | null;
        try {
          detectedCountry = await lookup();
        } catch (error) {
          console.warn(JSON.stringify({
            event: "regional_offer_country_lookup_failed", requestId: context.get("requestId"),
            errorMessage: error instanceof GeoLiteDatabaseError ? error.message
              : "GeoLite country lookup failed while loading or reading the database.",
          }));
          return context.json(needsRegionalCountry("detection_unavailable"));
        }
        if (detectedCountry === null || !supportedRegionalCountryCodes.includes(detectedCountry)) {
          return context.json(needsRegionalCountry("unknown_country"));
        }
        country = detectedCountry;
      }
      return context.json(await getPublicRegionalOffer(country, countrySource));
    } catch (error) {
      if (error instanceof StripeBillingError) {
        console.warn(JSON.stringify({ event: "public_regional_offer_failed", errorCode: error.code, retryable: error.retryable }));
        if (error.code === "STRIPE_COUNTRY_INVALID") throw new HttpError(400, error.message, error.code);
        throw new HttpError(error.retryable || error.code === "STRIPE_CONFIGURATION_INVALID"
          || error.code === "STRIPE_BILLING_UNAVAILABLE" ? 503 : 502,
        "The subscription price could not be verified. Retry and use requestId if it persists.", error.code);
      }
      throw new HttpError(503, "The subscription price could not be loaded. Retry and use requestId if it persists.",
        "STRIPE_BILLING_UNAVAILABLE");
    }
  });
  return app;
}
