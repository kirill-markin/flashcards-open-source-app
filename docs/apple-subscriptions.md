# Apple subscriptions

The Apple catalog is prepared independently of public sales. Public clients retain
PremiumComingSoon. Catalog setup neither submits a subscription for review nor releases
an app. Backend ingestion and client purchases follow the
[paid-access contract](premium-entitlements.md); their delivery is separate from this procedure.

[Subscription store metadata](subscription-store-metadata.md) owns product identity and all
42 Apple subscription/group localizations. The store inventory is separate from the full
iOS UI language inventory. [Premium offer](premium-offer.md) owns price, trial, allowance,
and the completed early-user lifetime gift.

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

## Initial-price console fallback

The existing product's initial price was configured in App Store Connect after the
initial-price API returned HTTP 409. Its 175 territories and 42 store locales are configured;
the subscription remains unsubmitted in `MISSING_METADATA`.

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

## Sandbox purchase acceptance

Run these steps after the iOS patch is merged and its required static gate is green,
using a separately authorized TestFlight build and a real Apple sandbox account. Local
StoreKit configuration transactions are insufficient. Static CI does not compile Swift
or prove StoreKit acceptance; do not mark this procedure complete without the real build.
Do not dispatch Xcode Cloud or submit the app/product for review as part of this procedure.

1. Open Settings → Tests → **Premium sandbox purchase**. The shared sheet must show the
   App Store's localized price and billing period, a trial only when Apple reports
   eligibility, automatic renewal terms, Privacy Policy, Apple's Standard EULA, and a
   top-right Close control. Test an eligible and an ineligible sandbox account. An
   App Store production installation must not permit buying through this test entry:
   the purchase service verifies the signed AppTransaction environment again.
2. As a fresh iOS guest without a lifetime gift, complete the premium_monthly trial.
   Require server attachment before finishing the transaction and a sync-confirmed
   premium rank of 20 before dismissing the sheet. It must return to Settings → Tests
   once, without moving tabs or recreating the navigation stack. Closing, swiping away,
   or cancelling Apple's purchase dialog must preserve the originating screen.
3. Open the ordinary offer preview, an accent-color premium gate, and the AI quota
   sheet. They must still show the coming-soon content. The own-OpenAI-key alternative
   belongs only to the AI quota sheet. A paid or lifetime quota refusal must not offer
   an upgrade to the same allowance. Preserve the AI draft and transcript after close,
   cancellation, or a newly confirmed entitlement; no close or access callback may
   automatically send another billable turn. A pending accent selection may continue
   once only after its request receives confirmed access for the same account.
4. In the sandbox sheet and Settings → Subscription, use **Restore purchases** and
   **Manage subscription**. Check immediate progress, retryable failures, and return to
   the source screen. Restore repeatedly without duplicate purchases. Restore into a
   second authenticated test account and confirm ownership follows the deliberate
   restore after both accounts sync. An ordinary foreground reconciliation must not
   transfer another account's purchase. After buying as A and restoring as B, return to
   A and replay current, unfinished, and renewal/update transactions; B must retain
   ownership after both accounts sync. Repeat passive replay alongside an explicit
   Restore: the explicit operation must still reach the server and determine ownership.
5. Exercise a pending purchase and background/foreground transitions. After approval,
   the one transaction listener must attach, sync, and complete any still-open request
   once. Replace the app identity while a purchase or restore is in flight; old results
   and errors must not publish into the replacement account or complete its new sheet.
   Link a purchasing guest to an account and verify billing and access follow the
   existing guest-link lifecycle. On iPad, open two windows and confirm they share one
   transaction listener and processing operation; closing either window must not stop
   the other window's subscription runtime. Each sheet must return to its own screen.
6. Allow a sandbox renewal, disable auto-renew, then observe expiry. Cancellation keeps
   access until the paid-through date. Exercise a sandbox refund/revocation, then sync
   and confirm access ends. Repeat using a lifetime holder: effective rank 30 must
   survive purchase, expiry, and revocation. Settings must still show the verified
   active Apple purchase and its current period end while lifetime is effective.
   On the existing account deletion confirmation, verify the active-Apple warning
   states that deleting the account does not cancel its subscription.
7. Interrupt connectivity after Apple's purchase completes and before attachment is
   acknowledged. Reconnect and use Restore/retry; an unsuccessful attachment must not
   finish the transaction. Launch and foreground in airplane mode with and without an
   Apple purchase: ordinary offline study must remain usable without a technical-error
   sheet. Subscription Settings and the sandbox offer must expose reconciliation
   failures, with Restore/retry available when connectivity returns.
   Also exercise an empty product lookup and recovery through
   Retry. Failure details must remain visible, with no optimistic access grant.
8. Check long text, enlarged Dynamic Type, and an RTL language. All new UI strings must
   come from the full 49 non-English app resource set; the 42 store metadata locales
   are separate. Read only necessary billing metadata to confirm sandbox environment,
   stable purchase identity, processed notifications, and expected entitlement. Keep
   test identities and transaction IDs private. Reports exclude sandbox from production
   revenue. Record build, device, language, outcome, and sanitized failure evidence.

Public sales, the free-account allowance, the catalog, and the completed lifetime gift
remain unchanged. The StoreKit service, presenter, root sheet, and Settings controls linked
above are the implementation; this procedure is the manual acceptance contract.

## Apple references

Request bodies follow Apple's
[App Store Connect OpenAPI specification](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip)
and [subscription configuration guide](https://developer.apple.com/documentation/appstoreconnectapi/managing-auto-renewable-subscriptions).
The writer uses the documented v1 subscription availability API alongside the existing v1
client. Apple also documents
[subscription fields and limits](https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/auto-renewable-subscription-information)
and [store localization support](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-localizations).
