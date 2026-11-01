# Regional subscription pricing

This is the approved pricing policy. Live web purchases remain disabled until the
[Managed activation gates](stripe-subscriptions.md#regional-offers-and-managed-activation-gate) pass.

## Country lists

The canonical [country lists](../apps/backend/src/billing/regionalPricing/countries.json)
contain `fullPriceCountries` and `discountedCountries`, each with a code and English name.
The first group pays full price; the second receives approximately 50% off wherever selling
is supported. The lists are a practical pricing choice, not an audited classification of
worldwide household income.

The universe is the 249 ISO country/territory codes in IANA's public-domain
[iso3166.tab](https://data.iana.org/time-zones/tzdb/iso3166.tab) from TZDB 2026f, retrieved
2026-10-31. Its header identifies the ISO code reference as 2024-02-29. Kosovo (`XK`) is an
explicit non-ISO provider-code exception. Every entry outside the full-price group is discounted.
Provider codes must be mapped explicitly; an unknown code must not silently receive a price.

A pricing band does not establish provider availability, sanctions eligibility or tax coverage.
Some entries have no independent storefront or cannot be sold to through a particular provider.

## Offer and providers

- Keep the [base Premium offer](premium-offer.md#price-and-products): one monthly product per
  provider, the same Premium entitlement, a USD 6.99 standard anchor and a seven-day trial.
- Aim for half the comparable full price in discounted markets. Provider currency conversion,
  allowed price points, rounding and tax presentation may produce different local amounts.
  Confirm exact prices from provider previews before saving them.
- Keep native Apple and Google billing; their storefronts determine the regional price shown.
- Use Stripe Managed Payments for new web subscriptions once eligibility, configuration and
  launch conditions are confirmed. Existing Stripe subscriptions remain on their legacy setup.
  Stripe's [tax coverage](https://docs.stripe.com/payments/managed-payments/tax-compliance)
  is a separate launch condition; the country lists do not promise worldwide tax handling.

## EU web offers

Make cheaper EU offers accessible to customers across the EU. Do not block an offer solely
because of the customer's EU residence or the EU country issuing their card. This is the
chosen commercial design, not a legal opinion. The web offer selector is not strong country
verification; some customers may choose a cheaper offer.

## Public web offer

The marketing site and web app call `GET https://api.nibomo.com/v1/billing/regional-offer`
directly, with `credentials: "omit"`; `/billing/regional-offer` serves the same contract.
A server relay would suggest the server’s country. The API accepts only the trusted API
Gateway transport address for detection, never browser-supplied IP or location headers.

An optional `country=XX` selects any canonical supported offer and wins without an IP
lookup. Without it, a known IP country suggests the offer; language does not select a band.
The [public schema and projection](../apps/backend/src/billing/regionalPricing/publicOffer.ts)
publish the canonical `supportedCountryCodes`, `selectedCountry` and `countrySource`:

- `state: "offer"` has source `explicit` or `ip`, the verified production monthly price,
  band, inclusive tax presentation, generic trial terms and independent sales availability.
  The live purchase gate can leave a valid display quote unavailable for purchase.
- `state: "needs_country"` has null country, source and offer. `unknown_country` means no
  supported country was detected; `detection_unavailable` means missing transport context or
  a failed lookup. Both keep the code list so the person can select manually.
- Invalid explicit codes return 400; provider/configuration failures return 502/503 with
  `error`, `code` and `requestId`. A failed quote never substitutes another price.

Every answer, including errors and preflight, is `no-store`. Credential-free GET/OPTIONS
CORS covers only configured site/app and local development origins. The route creates no
identity, customer or trial history and exposes no personal trial eligibility. Trial copy
must say “for eligible new subscribers”; authenticated billing rechecks eligibility.

IP is a suggestion and selection is a commercial preference. Neither proves billing
jurisdiction or provider/tax eligibility. The authenticated Checkout reservation freezes
the offer; the public quote grants no purchase authorization. Web preference/sign-in UI
and the marketing price block consume this contract in their separate deliveries.
