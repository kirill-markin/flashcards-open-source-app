# Native billing history

The [schema](../db/migrations/0182_provider_native_billing_history.sql) and
[source contracts](../apps/backend/src/billing/history/) retain provider financial
objects independently of [current entitlement state](premium-entitlements.md).
Google native collection runs in the existing hourly reports job. Other provider collectors
and payment charts have separate source contracts.

## Collector contract

Use the source module's exported Zod schema to validate verified provider responses.
Persistence validates again and strips fields outside the financial allowlist.
Pass a `HistoryObservation` with explicit `environment` and `observedAt`: use
the authoritative read time, or original provider time for webhook snapshots.
Never timestamp an old webhook with its replay time. Apple corrections use
`signedDate`; Google orders use `lastEventTime`; other objects use observation time.
Stale writes return `stale`; identity mismatches throw `BillingHistoryError`.
Every helper requires a caller-owned transaction.

| Module | Write helpers |
| --- | --- |
| [Apple](../apps/backend/src/billing/history/apple.ts) | `persistAppleTransactionInExecutor(executor, transaction, observation)` |
| [Google](../apps/backend/src/billing/history/google.ts) | `persistGoogleOrderInExecutor(executor, purchaseToken, order, observation)`; `persistGoogleSubscriptionObservationInExecutor(executor, purchaseToken, observationId, subscription, observation)` |
| [Stripe](../apps/backend/src/billing/history/stripe.ts) | `persistStripeSubscriptionInExecutor(executor, subscription, observation)`; `persistStripeInvoiceInExecutor(executor, invoice, observation)`; `persistStripePaymentInExecutor(executor, invoiceContext, payment, observation)`; `persistStripeRefundInExecutor(executor, chargeContext, refund, observation)` |

Verify Apple JWS with the existing verifier before writing. Original transaction ID
identifies its history subject; transaction ID and environment identify each period.

Verify Google's package and purchase token against the response through authenticated
Publisher transport. Orders have no environment flag: use verified purchase evidence.
Reuse the RTDN delivery ID on retries. A poll must retain one observation ID per
token/read before page retries. Subscription observations are state, not paid orders.

Stripe payments are native `invoice_payment` objects. Supply the verified parent
invoice for a payment and verified parent charge for a refund. Verify Nibomo catalog
and customer scope through the existing Stripe provider. Exhaust invoice lines and
subscription items before writing; truncated embedded lists are rejected. Customer
IDs are used only for private matching, then removed from JSONB.

Primary provider contracts:
[Apple transaction](https://github.com/apple/app-store-server-library-node/blob/v3.1.0/models/JWSTransactionDecodedPayload.ts),
[Google Orders](https://developers.google.com/android-publisher/api-ref/rest/v3/orders),
[Google subscriptions](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2),
[Stripe InvoicePayment](https://docs.stripe.com/api/invoice-payment/object),
[Stripe refunds](https://docs.stripe.com/api/refunds/object).

## Coverage and checkpoints

[Import helpers](../apps/backend/src/billing/history/imports.ts) use
`billing.history_import_runs`. Begin with `beginHistoryImportInExecutor(executor,
input)` and `HistoryImportInput`: source, environment, scope, and a half-open UTC
window `[requestedFrom, requestedTo)`. Subject scope uses the same provider subject
ID as native records. Provider scope describes the full named inventory; never
label a known-purchase subset as provider-wide coverage.

Commit the start before provider requests. Commit each page's native writes and
`checkpointHistoryImportInExecutor(executor, {runId, recordCount, checkpoint})`
together. The count is absolute and counts distinct objects handled by the attempt;
retrying the same page reuses its count. Resume a running attempt through
`loadLatestHistoryImportInExecutor(executor, input)`. Serialize collectors for the
same scope/window. Keep checkpoints private; they can contain bearer data.

Finish with `completeHistoryImportInExecutor(executor, {runId, status, coveredFrom,
coveredTo})`. `succeeded` covers the entire request; `partial` declares only a
verified continuous subwindow. After a failed page rolls back, call
`failHistoryImportInExecutor(executor, runId, failureCode)` in a fresh transaction
using a sanitized uppercase code. Missing, running and failed coverage is unavailable.
A completed empty scan proves zero only inside its source/scope/window. Retention
limits and inability to enumerate unknown purchases remain explicit partial coverage.

## Deployment and reporting

Wait for `AWS/Web Release` deployment before invoking a collector. Use the existing
[SSM reporting workflow](analytics-db-access.md#manual-local-workflow):

```sql
SELECT source, environment, scope_kind, subject_id, status,
       requested_from, requested_to, covered_from, covered_to, record_count
FROM billing.history_import_runs
ORDER BY started_at DESC;
```

Native keys include environment. Derive payment/period/refund counts in SQL,
filtering production explicitly. Do not sum object families as payments, count
trials/unpaid invoices as charges, or interpret uncollected history as zero.
Apple price is milliunits; Google Money retains units/nanos; Stripe amounts retain
currency minor units.

## Google backfill and verification

[Collector](../apps/backend/src/billing/history/googleImport.ts),
[Publisher transport](../apps/backend/src/billing/history/googleClient.ts), and
[sales decoder](../apps/backend/src/storeAnalytics/googleSalesReports.ts) use the
reports identity in [Store Analytics Import](store-analytics.md#google-play).
Storage requests use `devstorage.read_only`; Publisher requests use
`androidpublisher`. No keys, billing-service-account impersonation, entitlement
replay, acknowledgment, refund, or cancellation are part of collection.

Discovery includes every available sales ZIP generation, retained purchase tokens
and order identifiers, RTDN token/type/time/delivery metadata and retained voided
order identifiers, previously collected orders and successful order identifiers
in subscription observations. Renewal suffixes discover the original root and
every `..0` through the highest observed suffix. Sales orders are processed first:
their native response supplies a token for associated periods even if subscription
lookup has expired. Authenticated package-scoped `orders.get` requires the exact
requested ID/token linkage; H1 removes purchase tokens from financial JSON.
`testPurchase` classifies environments. Retained verified environments or
production sales evidence linked through the returned token establish historical
environment when lookup is unavailable; unknown never defaults to production.
Unclassified retained RTDN tokens are read authoritatively; only their environment
metadata and a native observation are persisted.

| Source | Stable named provider-scope key | Success |
| --- | --- | --- |
| `google_orders` | `nibomo:com.flashcardsopensourceapp.app:discoverable-orders-v1` | Every discovered period fetched and sales inventory complete. Window: epoch through inventory scan time. |
| `google_subscriptions` | `nibomo:com.flashcardsopensourceapp.app:retained-token-snapshots-v1` | Current snapshots of retained tokens and discovered predecessors fetched. Its one-millisecond scan-marker window identifies this poll, never historical state coverage. |

Each source uses that same key in both environments. These are named subsets,
**not complete merchant coverage**. Empty inventories cannot prove zero merchant
trials/payments/refunds. Discovery observations claim no coverage. RTDN metadata
is native event evidence, not a reconstructed subscription response.

Scoped API reads follow a committed import start. Each native write and absolute
count/checkpoint commit together. A deadline leaves the run `running`; the next
hour resumes its private queue and observation IDs. Subsequent scans refresh all
retained orders for refunds/cancellations. Limits are 10,000 inventory records,
20 CSV entries/64 MiB expanded per ZIP, the shared 12-minute budget and bounded
retrying Publisher transport. Exceeding a cap fails explicitly and requires a
narrower slice, never truncated success.

`GOOGLE_HISTORY_TOKEN_EXPIRED` distinguishes 404/410 token unavailability from
transient/auth failures, preserving other snapshots and accessible orders.
`GOOGLE_HISTORY_ORDER_UNAVAILABLE` identifies missing discovered periods after
accessible orders are saved. Affected source runs fail with no covered window.
Report failures still allow retained-token snapshots and accessible known orders
to be collected. Statistics CSV failures do not affect order coverage. Failed or
pending sales ZIPs leave sales inventory incomplete; a report failure before a
final inventory summary leaves completeness unavailable. After accessible orders are saved,
`GOOGLE_HISTORY_SALES_INVENTORY_INCOMPLETE` fails order coverage. A deadline keeps
unfinished sources running without coverage. Report errors still fail the shared
invocation even when native collection succeeds.
Sales exports arrive 3–7 days late and may omit free/unpaid periods. Google has no
API to enumerate unknown subscription tokens; token lookups stop 60 days after
expiration. Unknown free trials, missing periods, erased metadata and old state
responses remain unavailable. Never use an earliest collected paid order alone
as evidence of first payment.

1. Wait for the reviewed patch's exact `AWS/Web Release` deployment. The hourly
   schedule collects automatically. For a deliberate backfill, resolve and invoke
   the existing production Lambda:

   ```bash
   set -euo pipefail
   google_history_function=$(aws cloudformation describe-stack-resources \
     --profile flashcards-open-source-app --region eu-central-1 \
     --stack-name FlashcardsOpenSourceApp \
     --query "StackResources[?ResourceType=='AWS::Lambda::Function' && starts_with(LogicalResourceId, 'StoreAnalyticsImportHandler')].PhysicalResourceId | [0]" \
     --output text)
   test -n "$google_history_function" && test "$google_history_function" != None
   aws lambda invoke --profile flashcards-open-source-app --region eu-central-1 \
     --function-name "$google_history_function" --invocation-type RequestResponse \
     --cli-read-timeout 900 --cli-binary-format raw-in-base64-out --payload '{}' \
     /tmp/google-history-result.json
   cat /tmp/google-history-result.json
   ```

   Require no `FunctionError`. `unfinishedSources` means bounded continuation,
   not covered history; invoke again or await the next hour. This shared job also
   refreshes other configured sources. Inspect its exact log group for
   `google_history_import_completed`, `google_history_source_failed` and
   `google_history_retry`. Never print private checkpoints/tokens/SDK errors.

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

The opaque `subject_id` links native records to `history_subjects`. Two narrow
triggers copy existing billing ownership and erasure atomically. Deleted subjects
retain the shared analytics/billing pseudonym and deletion time; imports and purchase
restores cannot reattach their history. Unattributed records remain countable without
an inferred owner. There are no account foreign keys. The allowlists omit signed
payloads, tokens, account handles, buyer details, free text and payment methods.
Reporting cannot read subject/scope hashes or pagination checkpoints.
