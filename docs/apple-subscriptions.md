# Apple subscriptions

Catalog and review-material preparation do not submit a subscription or release an app.
The ordinary iOS purchase offer follows the [paid-access contract](premium-entitlements.md).
Build dispatch, App Review submission, publication, and global free-account limit activation
remain separate authorization gates.

[Subscription store metadata](subscription-store-metadata.md) owns product identity and all
42 Apple subscription/group localizations. The store inventory is separate from the full
iOS UI language inventory. [Premium offer](premium-offer.md) owns price, trial, allowance,
and the completed early-user lifetime gift. The
[canonical English App Review notes](subscription-store-metadata.md#canonical-english-app-review-notes)
are the only source for the subscription's reviewer text.

## Backend sources

- [HTTP routes](../apps/backend/src/routes/appleBilling.ts) and
  [mounts](../apps/backend/src/server/app.ts).
- [Provider service](../apps/backend/src/billing/apple/service.ts),
  [Apple verification](../apps/backend/src/billing/apple/provider.ts), and
  [secret configuration](../apps/backend/src/billing/apple/config.ts).
- [Gateway and Lambda permissions](../infra/aws/lib/gateways/api-gateway.ts),
  [CI context mapping](../scripts/generate/write-ci-cdk-context.py), and
  [release workflow](../.github/workflows/aws-web-release.yml).
- [StoreKit service](../apps/ios/Flashcards/Flashcards/Premium/AppleSubscriptionService.swift)
  and [native transport](../apps/ios/Flashcards/Flashcards/Cloud/Sync/CloudSyncTransport+AppleBilling.swift).

## Transaction intent

`POST /v1/billing/apple/transactions` accepts optional `intent: "passive" | "explicit"`
alongside `signedTransaction`. Omitted intent retains explicit attachment for existing
clients. Unknown values, including `null`, return HTTP 400 before any billing service action.
Both modes require the same human authentication and verified Apple transaction JWS.

Purchase and Restore use explicit attachment: the last presenting account receives the
purchase. Automatic foreground, current-entitlement, unfinished-transaction, and transaction
update replay use passive reconciliation. It refreshes Apple's state under the existing
original-transaction lock, preserving any attached server owner. Only an unowned purchase
can be attributed by its verified `appAccountToken`.

The existing `{"attached":true}` response acknowledges successful processing in both modes;
it does not confirm that the caller owns the purchase. Sync supplies the caller's entitlement.

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
   Confirm the public IDs match
   [the metadata configuration table](subscription-store-metadata.md#app-store-connect).
   Keep user, sandbox-account, and transaction data out of that file.

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

## Initial-price console fallback

If Apple's initial subscription-price POST returns HTTP 409, first read the product's
prices again. For a product still without its first price, open App Store Connect →
app `6760538964` → Subscriptions → Premium group `22415526` → subscription `6816418042`.
Set the initial USA price to USD 6.99 and apply Apple's equalized prices to all supported
territories. Save without submitting for review. Rerun the catalog writer from the reviewed
checkout for API readback and remaining trial/localization configuration. If any existing
price differs, stop for an explicit commercial correction instead of overwriting it.

## Deploy and verify HTTP access

1. Preserve the existing Secrets Manager secret
   `flashcards-open-source-app/apple-in-app-purchase` in `eu-central-1`. Its JSON contains
   `privateKey`, `keyId`, and `issuerId`. `CDK_APPLE_IAP_SECRET_ARN` is already configured
   as a GitHub repository variable; verify its ARN privately without printing the secret.
   Do not create another key, secret, group, or subscription. The catalog uses separate
   App Store Connect credentials.
2. Require green `Repository static checks`, merge the reviewed patch to `main`, then wait
   for `AWS/Web Release` deployment and all selected smokes under [release gates](release-gates.md).
   Both context-generation steps must receive `CDK_CONTEXT_APPLE_IAP_SECRET_ARN`. Read back
   the HTTP Lambda's `APPLE_IAP_SECRET_ARN` and read grant; workers must have neither.
   No local AWS build or deploy is part of this procedure.
3. With an ordinary mobile guest credential, call
   `GET https://api.flashcards-open-source-app.com/v1/billing/apple/account` twice. Require
   HTTP 200 and the same UUID `appAccountToken`. Repeat with a linked account; each identity
   must receive its own token. Keep authorization headers and returned tokens private.
4. Without a credential, account and transaction requests must fail authentication.
   A valid machine `ApiKey` must be refused. Session-cookie transaction POSTs must still
   require the allowed browser origin and matching CSRF token. Guest/Bearer transport must
   work without browser headers. An invalid transaction object must return 400, an object
   over 262,144 bytes 413, and a forged JWS a non-success response without changing access.
5. POST `{"signedPayload":"invalid"}` to `/v1/billing/apple/notifications` with no
   cookie, Authorization, Origin, or CSRF headers. Require a non-success Apple error rather
   than an account-authentication error. Valid signed delivery is verified below. Record
   only status, error code, request ID, deployment SHA, and UTC time in shared evidence.
   The backend also mounts the legacy unversioned paths for its existing ingress shape.

## Configure and verify Notification V2

1. After the deployment is healthy, open App Store Connect → app `6760538964` → App
   Information → App Store Server Notifications. Set **both Production and Sandbox** URLs
   to `https://api.flashcards-open-source-app.com/v1/billing/apple/notifications`, select
   **Version 2**, and save. Read both fields back. Follow Apple's
   [URL configuration procedure](https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/enter-server-urls-for-app-store-server-notifications).
2. In a trusted operator session with the backend's pinned dependencies and AWS profile
   `flashcards-open-source-app`, retrieve that existing secret into process memory using
   `SecretsManagerClient` / `GetSecretValueCommand`; parse it with `parseAppleSigningSecret`.
   Never print the AWS response, key, JWT, signed payload, or full Apple response.
3. For each of `Environment.SANDBOX` and `Environment.PRODUCTION`, construct the official
   `AppStoreServerAPIClient(privateKey, keyId, issuerId, appleBundleId, environment)`.
   Call `requestTestNotification()` once and retain its `testNotificationToken` privately.
   No purchase is needed for `TEST`. Check delivery using
   `getTestNotificationStatus(testNotificationToken)` on that same client. If pending,
   repeat the status read at 10-second intervals for up to two minutes; stop and investigate
   if there is still no successful attempt. Do not repeatedly request new notifications.
4. Require a `sendAttempts` entry whose `sendAttemptResult` is `SUCCESS`. Keep only
   environment, `attemptDate`, and `sendAttemptResult` from the
   [SDK response](https://github.com/apple/app-store-server-library-node/blob/v3.1.0/models/CheckTestNotificationResponse.ts)
   in shared evidence. The response also contains a sensitive `signedPayload`; keep it in
   memory only. For duplicate-delivery verification, POST that exact payload twice to the
   notification URL without browser credentials and require HTTP 200 both times.
5. For database readback, use the existing `backend_app` role: `reporting_readonly`
   intentionally cannot read `billing.provider_events`, even when payload columns are
   omitted. With AWS profile `flashcards-open-source-app` in `eu-central-1`, read the current
   `FlashcardsOpenSourceApp` stack outputs `AnalyticsSsmInstanceId`, `DbEndpoint`, and
   `BackendDbSecretArn` using `cloudformation describe-stacks`. Open the
   [SSM port-forward](analytics-db-access.md#operator-path-ssm-port-forwarding) to that
   endpoint; do not reuse an old instance ID. Retrieve `BackendDbSecretArn` with
   `SecretsManagerClient` / `GetSecretValueCommand` into process memory and use its
   `username` (`backend_app`) and `password` to connect to database `flashcards` at
   `127.0.0.1:15432` with TLS (`sslmode=require`). This requires operator IAM access to
   that secret as well as the documented SSM permissions. Do not print credentials or put
   them in command arguments. The analytics access helper retrieves the reporting secret
   and must not be used for this connection. Keep the reporting-role restrictions unchanged.
6. On that connection, run only the following explicit read-only transaction, replacing
   the UUID placeholders with the notification UUIDs from the verified signed payloads:

   ```sql
   BEGIN READ ONLY;
   SELECT event_id, event_type, environment, received_at, processed_at,
          processing_error IS NULL AS processing_succeeded
   FROM billing.provider_events
   WHERE provider = 'apple' AND event_type = 'TEST'
     AND event_id IN ('<sandbox-notification-uuid>', '<production-notification-uuid>');
   ROLLBACK;
   ```

   Require one row per notification UUID, the matching environment, non-null `processed_at`,
   and `processing_succeeded = true`. Select neither `payload` nor `payload_raw`.
   Close the database connection and terminate the tunnel with `aws ssm terminate-session`
   using the session ID and the same AWS profile/region, including after a failed readback.
   Inspect failures in the exact backend Lambda log group using request IDs and sanitized
   codes. A failed delivery or persistence operation must remain non-success so Apple can
   retry. Record no success until the Apple delivery result and database readback agree.

## Ordinary iOS purchase acceptance

Run these steps after the iOS offer and these materials are merged to `main` with green
`Repository static checks`, using a separately authorized TestFlight build and a real
Apple sandbox account. Local StoreKit configuration transactions are insufficient.
Static CI does not compile Swift or prove StoreKit acceptance. Record unrun checks as
pending. This procedure does not authorize Xcode Cloud dispatch or app/product submission.

1. As a free user, open Settings → Subscription and its Premium offer, then independently
   Settings → General → Accent Color and select a premium color. Both must open the same
   ordinary purchase sheet with Apple's localized price and billing period, a trial only
   when Apple reports eligibility, automatic renewal terms, Privacy Policy, Apple's
   Standard EULA, and a top-right Close control. Check an eligible and an ineligible
   sandbox account. Purchase must not depend on Settings → Tests or a sandbox-only entry.
2. As a fresh iOS guest without a lifetime gift, fetch the account token and complete
   the premium_monthly trial with that `appAccountToken`. Submit the verified StoreKit
   transaction JWS to `POST /v1/billing/apple/transactions` as
   `{"signedTransaction":"<private JWS>","intent":"explicit"}`. Require HTTP 200 with `{"attached":true}`
   before finishing the transaction and a sync-confirmed premium rank of 20 with
   Apple's actual trial state before dismissing the sheet. It must return to its source
   once, without moving tabs or recreating the navigation stack. Closing, swiping away,
   or cancelling Apple's purchase dialog must preserve the originating screen.
3. Trigger the free-user AI quota sheet; it must expose the same ordinary purchase flow.
   The own-OpenAI-key alternative belongs only to the AI quota sheet, and using a key
   must not unlock accent colors. A paid or lifetime quota refusal must not offer
   an upgrade to the same allowance. Preserve the AI draft and transcript after close,
   cancellation, or a newly confirmed entitlement; no close or access callback may
   automatically send another billable turn. A pending accent selection may continue
   once only after its request receives confirmed access for the same account.
4. In the ordinary offer and Settings → Subscription, use **Restore purchases** and
   **Manage subscription**. Check immediate progress, retryable failures, and return to
   the source screen. Retry the same transaction and restore repeatedly without duplicate
   purchases. Restore into a second authenticated test account B with `intent: "explicit"`
   and confirm ownership follows the deliberate restore after both accounts sync. An
   ordinary foreground reconciliation must not transfer another account's purchase.
   After buying as A and restoring as B, return to A and replay current, unfinished, and
   renewal/update transactions with `intent: "passive"`; B must retain ownership even
   though the verified transaction still carries A's original account token. Sync both
   accounts: A loses subscription access and B retains it, subject to any separate
   purchases or lifetime grants. Explicit Restore on A must move ownership back to A.
   Repeat passive replay alongside an explicit Restore: the explicit operation must
   still reach the server and determine ownership.
5. Exercise a pending purchase and background/foreground transitions. After approval,
   the one transaction listener must attach, sync, and complete any still-open request
   once. Replace the app identity while a purchase or restore is in flight; old results
   and errors must not publish into the replacement account or complete its new sheet.
   Link a purchasing guest to an account and verify billing and access follow the
   existing guest-link lifecycle. On iPad, open two windows and confirm they share one
   transaction listener and processing operation; closing either window must not stop
   the other window's subscription runtime. Each sheet must return to its own screen.
6. Allow a sandbox renewal, disable auto-renew, then observe expiry. The signed notification
   must update the stored sandbox purchase and the next sync's entitlement. Cancellation
   keeps access until the paid-through date. Exercise a sandbox refund/revocation, then sync
   and confirm access ends. Repeat using a lifetime holder: effective rank 30 must
   survive purchase, expiry, and revocation. Settings must still show the verified
   active Apple purchase and its current period end while lifetime is effective.
   On the existing account deletion confirmation, verify the active-Apple warning
   states that deleting the account does not cancel its subscription.
7. Interrupt connectivity after Apple's purchase completes and before attachment is
   acknowledged. Reconnect and use Restore/retry; an unsuccessful attachment must not
   finish the transaction. If the backend reports 5xx, preserve the pending transaction
   and retry. Launch and foreground in airplane mode with and without an
   Apple purchase: ordinary offline study must remain usable without a technical-error
   sheet. Subscription Settings and the ordinary offer must expose reconciliation
   failures, with Restore/retry available when connectivity returns.
   Also exercise an empty product lookup and recovery through
   Retry. Failure details must remain visible, with no optimistic access grant.
8. Check long text, enlarged Dynamic Type, and an RTL language. All new UI strings must
   come from the full 49 non-English app resource set; the 42 store metadata locales
   are separate. Read only necessary billing metadata to confirm sandbox environment,
   stable purchase identity, processed notifications, and expected entitlement. Keep
   test identities and transaction IDs private. Reports exclude sandbox from production
   revenue. Record build, device, language, outcome, and sanitized failure evidence.

Do not activate global free-account limits to manufacture a quota test. If the selected
account cannot reach an allowance refusal under the authorized configuration, record that
check as pending. This procedure neither changes the catalog nor grants new lifetime gifts.

## Prepare App Review materials

Use the existing [App Store Connect client and credentials](xcode-cloud-data-access.md#required-local-secrets)
from the reviewed checkout. The catalog covers 175 territories and 42 store locales.
Read fresh product, screenshot, and app-version state before writing. An empty review note,
missing screenshot, or `MISSING_METADATA` product state is an open preparation gap;
this checklist is not evidence that those gaps have been closed.

1. Capture a screenshot of the real compiled offer from Settings → Subscription in the
   accepted build, using a free guest without a lifetime gift. Wait for the real StoreKit
   product and price to load. Show the offer and purchase control clearly; keep account
   details and Apple's payment confirmation out of the image. Use a PNG or JPEG meeting
   Apple's [review screenshot requirements](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information).
   Save build, device, locale, and capture time with the operational evidence. Until this
   image exists, leave screenshot preparation pending. Do not substitute a mockup,
   coming-soon screen, marketing composite, or a locally fabricated StoreKit price.
2. Read `GET /v1/subscriptions/6816418042` and confirm `productId: premium_monthly`.
   Extract only the fenced text from the
   [canonical notes](subscription-store-metadata.md#canonical-english-app-review-notes),
   confirm it still matches the compiled offer and is at most 4000 characters, and JSON
   encode it as `reviewNote`. Send `PATCH /v1/subscriptions/6816418042` with
   `data.type: subscriptions`, `data.id: 6816418042` (a string), and
   `data.attributes.reviewNote` containing that exact text. Send no other attributes.
   Read the subscription again and require an exact text match; a PATCH response alone
   is insufficient. Keep account credentials and unperformed testing claims out of notes.
3. Read `GET /v1/subscriptions/6816418042/appStoreReviewScreenshot` before reserving an
   asset. Reuse a matching completed asset. If an existing asset differs or an earlier
   upload is incomplete, inspect its ID and state before replacing or resuming it; do
   not blindly repeat creation after an uncertain response. Reserve a missing screenshot
   with `POST /v1/subscriptionAppStoreReviewScreenshots`: `data.type` is
   `subscriptionAppStoreReviewScreenshots`; `data.attributes` contains the actual
   `fileName` and integer byte `fileSize`; `data.relationships.subscription.data` is
   `{"type":"subscriptions","id":"6816418042"}`. Retain the returned screenshot ID.
4. Follow every returned `uploadOperations` entry: send exactly the file bytes identified
   by `offset` and `length` to its `url`, using its `method` and `requestHeaders`. Do not
   send the App Store Connect bearer token to upload URLs or log their signed query
   strings. After all parts succeed, `PATCH /v1/subscriptionAppStoreReviewScreenshots/{id}`
   with `data.type: subscriptionAppStoreReviewScreenshots`, that string `data.id`, and
   `data.attributes: {"uploaded":true,"sourceFileChecksum":"<whole-file MD5>"}`.
   This follows Apple's [asset upload procedure](https://developer.apple.com/documentation/appstoreconnectapi/uploading-assets-to-app-store-connect).
5. Read `GET /v1/subscriptionAppStoreReviewScreenshots/{id}` every 10 seconds for up to
   two minutes, requiring `assetDeliveryState.state: COMPLETE`; `UPLOAD_COMPLETE` alone
   is not completion.
   If it fails or remains pending, retain sanitized errors and stop without claiming
   readiness. Read the subscription's screenshot relationship again to confirm the
   same ID; verify filename, byte size, checksum, and the processed image in App Store
   Connect. If API access cannot complete the upload, use the subscription's App Review
   Information screenshot field in the console, then perform the same API readbacks.
   This review-only image is separate from the optional 1024-pixel promotional image;
   subscription promotion is outside this procedure.
6. Read `GET /v1/subscriptions/6816418042` again and require `state: READY_TO_SUBMIT`.
   Recheck notes and screenshot plus the [catalog readback](#required-readback). If Apple
   still reports `MISSING_METADATA`, inspect the remaining fields in App Store Connect
   rather than treating a successful upload as product readiness. In Business, verify
   the Paid Apps Agreement is active and banking and required tax information are
   complete; record blockers without accepting agreements or changing financial details.
   Verify the app listing's Terms of Use and Privacy Policy using the canonical
   [app metadata and upload procedure](app-store-connect-metadata.md); subscription
   review notes do not replace those public listing fields.
7. During authorized preparation, create or select the editable new iOS version for the
   intended build using the [release runbook](release/README.md). Keep the
   version/build, manual acceptance results, screenshot ID, notes and catalog readbacks,
   and agreement/banking/tax readiness in the pending submission checklist. Apple's
   [first-subscription procedure](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-in-app-purchase/)
   requires this first subscription, its unapproved group, and the new iOS app version
   in the same submission. When submission is separately authorized, add the version,
   Premium group, and subscription to the same draft submission and verify all three
   before Submit for Review. Metadata preparation stops before Add for Review,
   Submit for Review, or publication; `READY_TO_SUBMIT` is not approval or evidence of
   a production purchase.

## Apple references

Request bodies follow Apple's
[App Store Connect OpenAPI specification](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip)
and [subscription configuration guide](https://developer.apple.com/documentation/appstoreconnectapi/managing-auto-renewable-subscriptions).
The writer uses the documented v1 subscription availability API alongside the existing v1
client. Apple also documents
[subscription fields and limits](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-information)
and [store localization support](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations).
