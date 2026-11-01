# Native-store regional subscription pricing

Operating procedure for existing Apple and Google monthly subscriptions. Use the
reviewed runbook on `main` after green `Repository static checks`, within the
owner-authorized price operation. This file records no executed price changes.
Each provider can be applied and verified independently; no mobile release is needed.

The [regional policy](regional-subscription-pricing.md) owns the country bands;
its [country lists](../apps/backend/src/billing/regionalPricing/countries.json) are
canonical. Keep the existing products, monthly period, Premium entitlement and
seven-day trial. Native prices follow the store account's storefront, not a web
country selector. App publication and purchase acceptance remain separate gates in
[Apple subscriptions](apple-subscriptions.md) and [Google Play subscriptions](google-play-subscriptions.md).

## Capture the baseline and preview

1. Read provider state through supported APIs first, using existing operator access;
   use the main Chrome session with existing logins for unsupported operations.
   Do not expand the runtime billing identity's permissions. Verify these identities
   before editing; stop on any mismatch:

   | Provider | Expected existing resources |
   | --- | --- |
   | Apple, SAMO DANNI EOOD | App `6760538964`; group `22415526`; subscription `6816418042` / `premium_monthly` |
   | Google | Developer `6698442103294061634`; app `4974229050839345523`; package `com.flashcardsopensourceapp.app`; product `premium`; base plan `monthly`; offer `free-trial-7d` |

2. Capture all current and scheduled prices, currencies, availability, trial regions
   and eligibility, and preserved/legacy cohort prices before changing either store.
   The planning inventory is 175 storefronts/regions per store; obtain the live list,
   paginate API reads, and reconcile differences before proceeding. Apple's catalog
   reads and credentials are in [Apple subscriptions](apple-subscriptions.md); Google's
   existing catalog can be read with Android Publisher `monetization.subscriptions.get`
   and `monetization.subscriptions.basePlans.offers.get`, where operator access permits.
3. Join every provider storefront to the canonical country codes. Record the explicit
   alias mapping, including Apple's three-letter codes and any parent/child territory
   grouping. List policy countries without an independent storefront, unavailable
   markets, extra provider codes and conflicts. Never assume every policy country is
   sellable. Stop on unknown codes, conflicting bands within one storefront, unexplained
   inventory drift or unexpectedly unavailable storefronts; do not add availability.
4. Keep an immutable, dated pre-change baseline with its policy commit and provider
   resource IDs. For each discounted storefront, target approximately half that
   storefront's comparable full-price baseline, rounded to the nearest allowed local
   price point. Keep full-price storefront amounts unchanged. If a previous operation
   already discounted a price, reuse its original baseline and saved target; never
   halve the current discounted price again. Stop if that baseline cannot be established.
5. Inspect every preview row against the baseline and country mapping. Confirm local
   currency, price point, tax inclusion/exclusion, seven-day trial and eligibility,
   effective date/timezone and subscriber effects. Approximate half with local rounding
   is authorized; individual rounded amounts do not need another owner confirmation.
   A full-price band does not authorize an increase. Stop for material baseline drift
   from the standard anchor, any unexpected increase, loss of trial, or a required app
   change; obtain a concrete price/cohort decision before proceeding.

Retain one dated evidence bundle per provider. Include the baseline, complete preview
and fresh readback, with this table covering every storefront, including unchanged rows:

| Provider code → policy code(s) / band | Currency / tax basis | Baseline amount / price-point ID | Current amount / scheduled change | Target amount / price-point ID | Effective date / zone | New buyer / existing cohort effect | Readback / status |
| --- | --- | --- | --- | --- | --- | --- | --- |

Record capture/save/readback UTC times, policy and runbook commits, resource IDs,
trial/availability comparison, exceptions and provider confirmation. Keep credentials,
account details, subscriber identities, purchase tokens and raw billing payloads out of
shared evidence. An empty template or saved preview is not evidence of activation.

## Apple: preview, apply and read back

Follow Apple's [subscription pricing procedure](https://developer.apple.com/help/app-store-connect/manage-subscriptions/manage-pricing-for-auto-renewable-subscriptions/).

1. Open the existing app → **Subscriptions** → **Premium** group → existing monthly
   subscription → **Subscription Prices** → **+ / Plan Subscription Price Change**.
   Inspect existing scheduled changes first: a new schedule can overwrite one for the
   same storefront. Stop on a conflicting schedule instead of replacing it silently.
2. Select only mapped discounted storefronts, choose the start date, and set the
   allowed local price points from the baseline. Check the complete comparable-price
   preview; correct any automatic changes outside the selected set before confirming.
   Include existing subscribers in the evidence: decreases automatically apply at
   renewal; Apple does not let them retain the higher price.
3. Confirm only the reconciled preview. Reload **View all Subscription Pricing** and
   export current/upcoming prices as CSV. Fresh API reads of the subscription's
   `/prices`, `/introductoryOffers` and availability must agree with the saved schedule,
   unchanged full-price rows and trial configuration. Use the API pagination helpers
   from the existing [catalog client](../scripts/ios/app-store-connect-client.mts).
   Do not use the initial-catalog writer to apply regional prices: it expects the
   original equalized catalog and stops on commercial drift.
4. Read back again after the effective date, allowing for storefront timezones.
   Record scheduled versus active status separately. A save is not proof that the
   lower price is already available; record any unverified storefront as pending.

## Google: preview, apply and read back

Use Google's [base-plan editor](https://support.google.com/googleplay/android-developer/answer/140504?hl=en)
and [price-change rules](https://developer.android.com/google/play/billing/price-changes).

1. Open the existing app → **Monetize with Play > Products > Subscriptions** →
   `premium` → `monthly` → **Set prices**. Select only mapped discounted regions and
   enter the baseline-derived targets. Inspect all converted/rounded amounts before
   saving; preserve unchanged regions and existing availability settings.
2. Reopen `free-trial-7d`; verify its regions remain aligned with the base plan and
   its seven-day free phase and eligibility remain unchanged. Stop on trial drift.
   Do not create a new product, base plan or offer.
3. Save the reconciled base-plan preview, reload, and read back all regional prices,
   currency, base-plan/offer states, regions and phases through the supported API or
   console. Record save and effective/observed times; new-purchase propagation may
   take a few hours, so keep activation pending until verified.
4. Existing subscribers retain their prices in legacy cohorts by default. Record
   that effect explicitly. Do not end a legacy cohort or invoke `migratePrices`;
   cohort migration requires a separate decision and operation.

## Recovery and completion

- Before saving, discard an incorrect preview. After an uncertain save, read fresh
  state before retrying; resume only missing rows from the original baseline.
- Apple: inspect planned changes in **View all Subscription Pricing**. Cancel a
  pending change only if the console permits it, then read back the schedule.
  An effective decrease cannot be reversed; restoring a higher amount requires a
  later increase with its own subscriber effects and owner decision.
- Google: restoring baseline prices for new purchases does not restore every
  subscriber's price. Buyers acquired at the lower price may remain in another
  legacy cohort. Record those cohorts and leave migration for a separate decision.
- Preserve the before/after evidence and unresolved exceptions. Mark each provider
  complete only when fresh active prices, unchanged full-price markets, availability,
  trial settings and documented cohort effects match the preview. Do not claim
  device purchase verification, public availability or the other provider's completion
  from a console save or this documentation change.
