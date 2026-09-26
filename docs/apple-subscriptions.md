# Apple subscriptions

The Apple catalog is prepared independently of public sales. Public clients retain
PremiumComingSoon. Catalog setup neither submits a subscription for review nor releases
an app. Backend ingestion and client purchases follow the
[paid-access contract](premium-entitlements.md); their delivery is separate from this procedure.

[Subscription store metadata](subscription-store-metadata.md) owns product identity and all
42 Apple subscription/group localizations. The store inventory is separate from the full
iOS UI language inventory. [Premium offer](premium-offer.md) owns price, trial, allowance,
and the completed early-user lifetime gift.

## Configure the catalog after merge

1. Wait until the catalog patch has been reviewed, merged into `main`, and passed
   `Repository static checks`. Run from that clean committed checkout with Node 24.
   Do not run this operation from CI or concurrently with edits in App Store Connect.
2. Use the existing [App Store Connect credentials](xcode-cloud-data-access.md#required-local-secrets)
   in the main checkout. The [shared client](../scripts/ios/app-store-connect-client.mts)
   finds them from a worktree. Catalog operations use `APP_STORE_CONNECT_*`, not the
   separate In-App Purchase signing key. Keep private keys and JWTs out of reports.
3. Execute the reviewed source:

   ```bash
   node scripts/ios/configure-apple-subscription.mts --apply
   ```

   The [writer](../scripts/ios/configure-apple-subscription.mts) validates all local text
   inputs first, checks app `6760538964` and bundle `com.flashcards-open-source-app.app`,
   and reads existing groups and products. It accepts only one `Premium` group and one
   matching unsubmitted `premium_monthly` subscription. Missing resources are created;
   existing localized text is updated to the canonical metadata.
4. The operation resolves USA USD 6.99 through Apple's price-point API, obtains regional
   equalizations, and creates missing prices and `FREE_TRIAL` / `ONE_WEEK` offers for all
   storefronts returned by Apple's territories API. Availability covers that same inventory.
   New territories are not enabled automatically. A changed territory inventory stops the
   run for explicit catalog correction, so availability never outruns price and trial setup.
5. Keep the final `apple_subscription_catalog_readback` output as the operational record.
   Replace the pending Apple group/subscription ID cells in
   [the metadata configuration table](subscription-store-metadata.md#app-store-connect)
   with the public IDs from this readback. Do not put user, sandbox-account, or transaction
   data in that file.

The command requires `--apply`; importing the module performs no operation. It creates no
annual or lifetime sale, enables no family sharing, changes no free-user allowance, and
never calls review-submission or promoted-purchase APIs.

## Required readback

A successful run performs fresh API reads and requires all of the following:

- Exactly one `Premium` subscription group and one `premium_monthly` subscription named
  `Premium Monthly`; `ONE_MONTH` duration and family sharing disabled.
- Product state `MISSING_METADATA` or `READY_TO_SUBMIT`, with no submission made.
- Exactly one current non-preserved price per supported storefront, matching Apple's
  equalization of the unique USA USD 6.99 point. Scheduled changes or different prices stop
  the operation.
- Exactly one currently effective `FREE_TRIAL` / `ONE_WEEK` offer, one period, without an
  end date, per supported storefront.
- Availability matching the full supported storefront set and automatic new-territory
  availability disabled.
- Every canonical subscription name, description, and group display name matching in all
  42 locales. Unknown, duplicate, missing, or overlong inputs fail explicitly.

A merged script is not evidence that any Apple product exists. A partial or failed run is
not catalog completion. Product visibility in sandbox is a later operational check; do not
submit for review to make a sandbox lookup work.

## Failures and repeat runs

The writer stops on identity, duration, family-sharing, state, price, trial, or availability
drift and reports the affected resource. Inspect that difference before deciding whether a
separate correction is authorized. It never overwrites commercial drift automatically.

POST requests are not retried. If creation fails or its result is uncertain, the writer reads
the corresponding remote collection and reports observed resource IDs before stopping.
Inspect that readback and the original API error, then rerun with the same reviewed inputs.
Matching resources are reused, so completed steps do not create duplicates. A readback error
also stops the run; inspect Apple before trying again.

For a permission or agreement error, retain the exact HTTP status and Apple's error response
without credentials. Check the account's catalog permissions and active paid agreement. Use
App Store Connect for supported manual correction if API access cannot perform the operation;
do not rotate unrelated credentials. Repeat the required readback after any console changes.

## Apple references

Request bodies follow Apple's
[App Store Connect OpenAPI specification](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip)
and [subscription configuration guide](https://developer.apple.com/documentation/appstoreconnectapi/managing-auto-renewable-subscriptions).
The writer uses the documented v1 subscription availability API alongside the existing v1
client. Apple also documents
[subscription fields and limits](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-information)
and [store localization support](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations).
