# Native billing history

The [schema](../db/migrations/0182_provider_native_billing_history.sql) retains provider financial
objects independently of [current entitlement state](premium-entitlements.md).
[Google collection](#google-backfill-and-verification),
[Apple collection](#apple-collection-and-backfill) and [Stripe collection](#stripe-inventory-and-backfill)
run in separate production and sandbox hourly jobs; a third job classifies unknown-environment Google tokens. [Store Analytics Import](store-analytics.md) owns the runtime boundaries and schedule. Other source collectors and charts use these same contracts.

The [source modules](../apps/backend/src/billing/history/) are the collector contract: each one's
schema and write helper states what a caller must verify first, and
[`imports.ts`](../apps/backend/src/billing/history/imports.ts) states what an import run proves.
Primary provider contracts:
[Apple transaction](https://github.com/apple/app-store-server-library-node/blob/v3.1.0/models/JWSTransactionDecodedPayload.ts),
[Google Orders](https://developers.google.com/android-publisher/api-ref/rest/v3/orders),
[Google subscriptions](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2),
[Stripe InvoicePayment](https://docs.stripe.com/api/invoice-payment/object),
[Stripe refunds](https://docs.stripe.com/api/refunds/object).

## Reading the history

Inspect coverage in `billing.history_import_runs` before counting native objects: missing, running
and failed coverage is unavailable, and no rows are not evidence of zero.
Native keys include environment. Derive payment/period/refund counts in SQL,
filtering production explicitly. Do not sum object families as payments, count
trials/unpaid invoices as charges, or interpret uncollected history as zero.
Apple price is milliunits; Google Money retains units/nanos; Stripe amounts retain
currency minor units.

## Invoke after deployment

Select the production, sandbox or Google discovery job from the [schedule table](store-analytics.md), and inspect each independently. Only production refreshes store reports.
AWS builds and deployments run through CI only: wait for the merged commit's `AWS/Web Release`
success, then resolve the current function from the stack instead of copying an older name. Do not
create a role, Lambda, analytics report request, or change access state. No mode switch or special
backfill payload exists: the ordinary job backfills and continually reconciles.

```bash
set -euo pipefail
history_logical_id=StoreAnalyticsImportHandler
history_function=$(aws cloudformation list-stack-resources \
  --profile flashcards-open-source-app --region eu-central-1 \
  --stack-name FlashcardsOpenSourceApp \
  --query "StackResourceSummaries[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId, '${history_logical_id}')].PhysicalResourceId | [0]" \
  --output json | python3 -c 'import json, sys; name = json.load(sys.stdin); sys.exit("Store analytics Lambda lookup returned no function") if not isinstance(name, str) or not name else print(name)')
test -n "$history_function"
aws lambda get-function-configuration \
  --profile flashcards-open-source-app --region eu-central-1 \
  --function-name "$history_function" \
  --query '{state:State,lastUpdateStatus:LastUpdateStatus,role:Role,sentryEnvironment:Environment.Variables.SENTRY_ENVIRONMENT,appleSecretConfigured:Environment.Variables.APPLE_IAP_SECRET_ARN!=`null`}'
aws lambda invoke --profile flashcards-open-source-app --region eu-central-1 \
  --function-name "$history_function" --invocation-type RequestResponse \
  --cli-read-timeout 1000 --cli-binary-format raw-in-base64-out --payload '{}' \
  /tmp/nibomo-billing-history-result.json
cat /tmp/nibomo-billing-history-result.json
```

Repeat with `history_logical_id=StoreSandboxImportHandler` and `GoogleBillingDiscoveryHandler`.
Require `State: Active`, `LastUpdateStatus: Successful`, the matching Sentry environment, no
`FunctionError` and `ok: true`; verify the shared role and Secrets Manager grants privately. Production and sandbox require the Apple secret; discovery does not. A running
source, `unfinishedSources` or `stripe.remaining=true` is committed progress, not covered history:
repeat that job's invocation after the previous one ends, or let the next hour resume it. Discovery's `tokensRemaining` likewise identifies unfinished classification. Read fresh
records in `/aws/lambda/$history_function` for the provider events named below. Never print
private checkpoints, tokens, signed payloads or SDK errors. A deployed API timeout or access denial
is a real failure requiring investigation; no source-empty conclusion is valid.

## Google backfill and verification

[Collector](../apps/backend/src/billing/history/googleImport.ts),
[Publisher transport](../apps/backend/src/billing/history/googleClient.ts), and
[sales decoder](../apps/backend/src/storeAnalytics/googleSalesReports.ts) use the
reports identity in [Store Analytics Import](store-analytics.md#google-play).
Storage requests use `devstorage.read_only`; Publisher requests use
`androidpublisher`. No keys, billing-service-account impersonation, entitlement
replay, acknowledgment, refund, or cancellation are part of collection.

The collector's two provider scopes are named subsets, **not complete merchant coverage**: empty inventories cannot prove zero merchant
trials/payments/refunds.
Sales exports arrive 3–7 days late and may omit free/unpaid periods. Google has no
API to enumerate unknown subscription tokens; token lookups stop 60 days after
expiration. Unknown free trials, missing periods, erased metadata and old state
responses remain unavailable. Never use an earliest collected paid order alone
as evidence of first payment.

1. [Invoke the job](#invoke-after-deployment) and inspect `google_history_import_completed`,
   `google_history_source_failed` and `google_history_retry`.

2. Diagnose actual 401/403 responses before altering permissions. Check Android
   Publisher API enablement and the **existing**
   `nibomo-store-reports@flashcards-open-source-app.iam.gserviceaccount.com`
   invitation. Keep its bulk financial report access and restrict Publisher access
   to Nibomo, with **View financial data / Purchases API** and the read access
   required for order/subscription data. Read back reports WIF trust and the
   impersonation binding to `FlashcardsStoreReportsImportRole`. Do not grant
   project-wide roles, create keys or broaden billing WIF. Verify a real permitted
   API read in this deployed job; GCS access alone proves no Publisher permission.

3. Use the [read-only SSM workflow](analytics-db-access.md#manual-local-workflow)
   to inspect coverage, generations, exact provider periods and timestamps:

   ```sql
   SELECT source, environment, scope_kind, status, requested_from, requested_to,
          covered_from, covered_to, record_count, failure_code
   FROM billing.history_import_runs WHERE provider = 'google'
   ORDER BY started_at DESC;

   SELECT source_ref, file_month, row_count, imported_at
   FROM store_analytics.import_files
   WHERE store = 'google_play' AND report_name = 'sales'
   ORDER BY file_month, source_ref;

   SELECT orders.environment, orders.subject_id, orders.order_id,
          orders.created_at_provider, orders.last_event_at, orders.state,
          orders.native_fields->'total' AS total,
          orders.native_fields->'orderHistory' AS events,
          item->'subscriptionDetails' AS service_period_and_phase
   FROM billing.google_orders AS orders
   CROSS JOIN LATERAL jsonb_array_elements(orders.native_fields->'lineItems') AS item
   ORDER BY orders.environment, orders.subject_id, orders.created_at_provider, orders.order_id;

   SELECT environment, subject_id, observed_at_provider,
          native_fields->>'startTime' AS original_start_time,
          native_fields->'lineItems' AS line_items
   FROM billing.google_subscription_observations
   ORDER BY environment, subject_id, observed_at_provider;
   ```

4. For both known production subscriptions, verify the original root, every
   renewal suffix through the latest successful order, and their common
   `subject_id`. Read actual dates rather than presuming October 7/14. The free
   period requires `subscriptionDetails.offerPhaseDetails.freeTrialDetails`
   (or legacy `offerPhase = FREE_TRIAL`) and native service-period bounds.
   Zero price alone is not trial evidence. Native `startTime` plus a retained
   `trial_started` fact can corroborate original trial signup when that period
   is unavailable; never fabricate an Order or infer trial from a catalog offer.

5. A paid order requires its actual `orderHistory.processedEvent.eventTime`
   and positive native Money in buyer currency, with state/refund history retained.
   The earliest positive processed charge in the **fully verified original-root
   through latest chain** is first payment; later positive charges are renewals.
   Service-period start/end describe the funded period. Suffix labels, current
   entitlement, observation time, catalog price or earliest collected charge do
   not prove first payment. Reconcile native IDs/times/statuses against sanitized
   sales `Order Charged Timestamp` rows. Missing root/intermediate periods leave
   classification unavailable while accessible charges remain countable.
   Re-invoke and confirm `(environment, order_id)` counts remain stable while
   observations legitimately grow; verify later refunds update the same order
   with provider event times. Keep sandbox separate.

## Stripe inventory and backfill

The [collector](../apps/backend/src/billing/history/stripeImport.ts) runs in the
[environment-specific hourly importers](store-analytics.md) with the HTTP provider's restricted runtime keys,
verified accounts, catalog and API pin; the importer's secret grant comes from the
[`stripeBillingSecretArn` context](stripe-subscriptions.md#receiver-and-runtime-provisioning-procedure).
It only reads Stripe and writes native history.

A completed production scan covers this catalog's production inventory. Stripe's global
subscription/invoice lists omit
[test-clock objects](https://docs.stripe.com/api/subscriptions/list#list_subscriptions-test_clock),
so sandbox `succeeded` covers only the named non-test-clock inventory and must not be presented as
complete sandbox billing. Deleted provider objects that are no longer retrievable cannot be
reconstructed.

`invoice_payment` status, `amount_paid` and `status_transitions.paid_at` retain
actual payment evidence. A zero-dollar paid trial invoice remains an invoice,
never a paid period inferred from its status. Preserve all native statuses; derive
successful payments, first paid periods, renewals and refunds in SQL.

[Invoke the job](#invoke-after-deployment). The log records `stripe_history_environment_import_completed`
and `stripe_history_import_completed` with only sanitized scope/status/count fields.

For `stripe_history_import_failed`, inspect `stage` and `validationCause` alongside
the source and failure code. A page failure rolls back its native writes and checkpoint together, so zero committed records alone
does not identify the failed stage. Use the deployed diagnostic before changing a schema.

Through reporting SQL, inspect coverage before counting native objects:

```sql
SELECT environment, source, run_id, status, requested_from, requested_to,
       covered_from, covered_to, record_count, failure_code
FROM billing.history_import_runs
WHERE provider = 'stripe' AND scope_kind = 'provider'
ORDER BY started_at DESC, source;

SELECT environment, count(*) AS native_subscriptions
FROM billing.stripe_subscriptions GROUP BY environment;
SELECT environment, count(*) AS native_invoices
FROM billing.stripe_invoices GROUP BY environment;
SELECT environment, count(*) AS native_payments,
       count(*) FILTER (WHERE status = 'paid'
         AND (native_fields->>'amount_paid')::bigint > 0
         AND native_fields->'status_transitions'->>'paid_at' IS NOT NULL) AS positive_paid_payments
FROM billing.stripe_payments GROUP BY environment;
SELECT environment, count(*) AS native_refunds
FROM billing.stripe_refunds GROUP BY environment;
```

Establish a completed matching source/window first; report production separately and keep sandbox's test-clock
exclusion explicit. Check retained invoice service periods, original trial dates,
payment `paid_at` and refund parent IDs against actual provider records before
dependent payment reporting goes live. Repeating a completed backfill must retain
the same native keys, update observation times, and leave entitlements, customer
identities and email delivery state unchanged.

## Apple collection and backfill

[The collector](../apps/backend/src/billing/history/appleImport.ts) reads the full transaction
history of every known original transaction and discovers others from Apple's notification history,
which Apple retains for 180 days in production and 30 days in sandbox. The notification-discovery
scope is therefore always `partial`, never complete merchant coverage: Apple cannot enumerate
purchases with neither a known ID nor a retained notification, and a zero discovery count proves no
transactions in the scanned notification inventory, not zero sales. Apple provides no historical
renewal-state inventory, so only the latest verified renewal state is retained. Neither the collector
nor historical notification replay calls purchase attachment, entitlement resolution or billing-fact
publication.

[Invoke the job](#invoke-after-deployment) and retain only request ID, environment, status, pages,
subject count, record count and failure code from `billing_history_apple_import_completed` /
`billing_history_apple_environment_failed`.

Use [reporting access](analytics-db-access.md#manual-local-workflow) for these
sanitized readbacks, never checkpoints, subject hashes, signed JWS or account tokens:

```sql
SELECT environment, scope_kind, status, requested_from, requested_to,
       covered_from, covered_to, record_count, failure_code
FROM billing.history_import_runs
WHERE source = 'apple_transactions'
ORDER BY started_at DESC
LIMIT 100;

SELECT environment, count(*) AS transactions,
       min(purchased_at) AS first_purchase, max(purchased_at) AS last_purchase,
       count(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked_transactions,
       count(*) FILTER (WHERE native_fields->>'offerDiscountType' = 'FREE_TRIAL') AS trial_transactions,
       count(*) FILTER (WHERE native_fields ? 'renewalInfo') AS with_renewal_state
FROM billing.apple_transactions
GROUP BY environment;
```

The primary API contracts are Apple’s
[transaction history](https://developer.apple.com/documentation/appstoreserverapi/get-transaction-history)
and [notification history](https://developer.apple.com/documentation/appstoreserverapi/get-notification-history).
Store report generation and replacement remain in [store analytics](store-analytics.md);
existing ongoing and historical requests are reused without duplicate sums.
