# Native billing history

The [schema](../db/migrations/0182_provider_native_billing_history.sql) and
[source contracts](../apps/backend/src/billing/history/) retain provider financial
objects independently of [current entitlement state](premium-entitlements.md).
[Apple collection](#apple-collection-and-backfill) runs in the existing hourly store-analytics job. Other source collectors and charts use these same contracts.

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

The opaque `subject_id` links native records to `history_subjects`. Two narrow
triggers copy existing billing ownership and erasure atomically. Deleted subjects
retain the shared analytics/billing pseudonym and deletion time; imports and purchase
restores cannot reattach their history. Unattributed records remain countable without
an inferred owner. There are no account foreign keys. The allowlists omit signed
payloads, tokens, account handles, buyer details, free text and payment methods.
Reporting cannot read subject/scope hashes or pagination checkpoints.

## Apple collection and backfill

[The collector](../apps/backend/src/billing/history/appleImport.ts) uses the existing
Apple IAP signing secret and official SDK 3.1.0 with SignedDataVerifier. Production
and sandbox are separate. Every known original transaction from purchases, existing
notification identity metadata, and native records gets a full V2 transaction-history
read from epoch to the fixed run cutoff, retaining revoked and nonrevoked periods.
Every page commits its native records and revision together; successful subject runs
prove coverage only for that original transaction. All renewal/trial offer, price,
purchase, expiry, revocation and reason fields stay in the financial allowlist.
The latest verified renewal state is retained with its own signing time; Apple does
not provide a historical renewal-state inventory.

The only provider scope key is
`com.flashcards-open-source-app.app:notification-discovery` for each environment.
It requests epoch to the run cutoff, discovers the retained 179 days of notifications
on the first scan, and subsequently overlaps the previous cutoff by 24 hours.
After exhausting notifications and known subjects, its status is `partial` with
`covered_from`/`covered_to` describing only the notification window. This scope
is notification-discovery coverage, never complete merchant transaction coverage.
Apple cannot enumerate purchases with neither a known ID nor a retained notification;
native totals therefore describe observed, partial merchant history. A zero discovery
count proves no transactions in the scanned notification inventory, not zero sales.
Current notification deliveries converge on the same native IDs. Neither the collector
nor historical notification replay calls purchase attachment, entitlement resolution
or billing-fact publication. Erased subjects cannot regain an owner.

One invocation starts at most 120 provider pages per environment and starts no new
page after its two-minute/environment or shared deadline. A provider read has a
30-second outer timeout and uses the existing SDK retry policy. Running attempts
resume their fixed window and private checkpoints next hour. API, verification,
checkpoint and persistence failures remain failed coverage with sanitized codes.
The next invocation starts a replacement attempt with the same window, committed
counts and cursors; failed run rows remain failure evidence. Subject failures retain
their committed revision and completed-page state as private retry obligations while
later discovered subjects continue within the same bounds. After discovery, pending
subjects resume in replacement subject runs; a subject that fails is not retried again
in the same invocation. Any encountered failure still fails the invocation, and the
provider attempt cannot finish while subject retry obligations remain. A long-paused
notification checkpoint may fall outside Apple retention and must fail explicitly,
never prove empty history.

### Invoke after deployment

AWS builds and deployments run through CI only. Wait for the merged commit’s
`AWS/Web Release` success, then identify the existing function from the stack.
Do not create a role, Lambda, analytics report request, or change access state.

```bash
apple_history_function=$(aws cloudformation list-stack-resources \
  --profile flashcards-open-source-app --region eu-central-1 \
  --stack-name FlashcardsOpenSourceApp \
  --query "StackResourceSummaries[?starts_with(LogicalResourceId, 'StoreAnalyticsImportHandler') && ResourceType=='AWS::Lambda::Function'].PhysicalResourceId | [0]" \
  --output text)
test -n "$apple_history_function" && test "$apple_history_function" != None
aws lambda get-function-configuration \
  --profile flashcards-open-source-app --region eu-central-1 \
  --function-name "$apple_history_function" \
  --query '{state:State,lastUpdateStatus:LastUpdateStatus,role:Role,appleSecretConfigured:Environment.Variables.APPLE_IAP_SECRET_ARN!=`null`}'
aws lambda invoke \
  --profile flashcards-open-source-app --region eu-central-1 \
  --function-name "$apple_history_function" --invocation-type RequestResponse \
  --cli-read-timeout 900 --cli-binary-format raw-in-base64-out --payload '{}' \
  /tmp/nibomo-apple-history-result.json
cat /tmp/nibomo-apple-history-result.json
```

Require `State: Active`, `LastUpdateStatus: Successful` and the secret configured,
then verify the existing role’s Secrets Manager read grant privately. Require an
invoke response without `FunctionError` and `ok: true` in the result. A running
summary means the bounded attempt has more work; repeat the same invocation after
it completes, or let the hourly scheduler resume. No mode switch or special backfill
payload exists: the ordinary deterministic job backfills and continually reconciles.

Read fresh records from `/aws/lambda/$apple_history_function` in CloudWatch.
Retain only request ID, environment, status, pages, subject count, record count and
failure code from `billing_history_apple_import_completed` /
`billing_history_apple_environment_failed`. A deployed API timeout or access denial
is a real failure requiring investigation; no source-empty conclusion is valid.

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
