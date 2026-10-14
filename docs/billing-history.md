# Native billing history

The [schema](../db/migrations/0182_provider_native_billing_history.sql) and
[source contracts](../apps/backend/src/billing/history/) retain provider financial
objects independently of [current entitlement state](premium-entitlements.md).
Collectors and charts are separate delivery stages.

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

Wait for the collector's `AWS/Web Release` deployment before manual backfill.
Use the existing
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

## Stripe inventory and backfill

The [collector](../apps/backend/src/billing/history/stripeImport.ts) runs in the
existing [hourly importer](store-analytics.md), using the same restricted runtime
keys, verified accounts, catalog and API pin as the HTTP provider. It only reads
Stripe and writes native history; it never reconciles entitlements, creates
customers or Checkout, changes subscriptions, issues refunds or dispatches email.
The secret ARN and importer read grant come from the existing
[`stripeBillingSecretArn` context](stripe-subscriptions.md#receiver-and-runtime-provisioning-procedure).
Missing configuration or provider read permission fails explicitly.

Each environment uses the same provider-scope key for all four sources:
`nibomo:<accountId>:<productId>:<priceId>:global_lists_without_test_clocks`, with
identifiers from the [catalog](../apps/backend/src/billing/stripe/catalog.ts).
`stripe_subscriptions` lists the exact price with `status=all`, including canceled,
ended and deleted-customer subscriptions. `stripe_invoices`, `stripe_payments` and
`stripe_refunds` enumerate global native lists, retaining only objects verified
against the exact Nibomo catalog and authoritative invoice/subscription/charge
parents. Current user mappings and `latest_invoice` never bound discovery.
Invoice lines and subscription items are exhausted before persistence.

The inventory is the provider's currently retrievable objects created in
`[1970-01-01T00:00:00Z, requested_to)`, where `requested_to` is frozen at the start
of a cohort. Production has no test clocks, so a completed scan covers this
catalog's production inventory. Stripe's global subscription/invoice lists omit
[test-clock objects](https://docs.stripe.com/api/subscriptions/list#list_subscriptions-test_clock).
Sandbox `succeeded` means the explicitly named non-test-clock inventory only;
sandbox test-clock coverage remains unknown. It must not be presented as complete
coverage of all sandbox billing. Existing native subject records are preserved.
Deleted provider objects that are no longer retrievable cannot be reconstructed.
An unconfigured Nibomo price or mixed-product invoice/charge fails closed rather
than importing another product's financial data or guessing its allocation.

All four source runs start together and retain the same UTC window. Each commits
at most 20 outer provider objects per page, with a private cursor and an absolute
count of distinct native objects handled in that attempt. Complete runs are skipped
while another source in the cohort remains running. Both environments' cohorts are
recorded before collection, and the oldest cohort runs first, with production
first when their upper bounds match. The next invocation resumes the committed
page; a fresh full scan refreshes changed historical objects after a cohort
completes, but waits behind an older unfinished environment. Replayed pages overwrite the
same native keys. A budget stop leaves `running` coverage unavailable, with no
fabricated covered interval. A failed source stores a sanitized failure code;
the next invocation starts a new attempt. A timed-out invocation resumes its
last committed checkpoint. Direct-charge refunds wait for the same cohort's
complete payment inventory; payment-intent refunds also verify all linked invoice
payments and reject mixed-product funding.

`invoice_payment` status, `amount_paid` and `status_transitions.paid_at` retain
actual payment evidence. A zero-dollar paid trial invoice remains an invoice,
never a paid period inferred from its status. Preserve all native statuses; derive
successful payments, first paid periods, renewals and refunds in SQL. Invoice and
payment IDs deduplicate the provider's overlapping paid webhook types. Collection
uses current API reads and observation times, not old webhook snapshots.

After deployment, an authorized operator can request a backfill with the existing
job's empty payload. This also runs the store-report importers. Resolve the current
physical function name instead of copying a name from an older deployment:

```bash
stripe_history_import_function="$(aws --profile flashcards-open-source-app --region eu-central-1 \
  cloudformation list-stack-resources --stack-name FlashcardsOpenSourceApp \
  --query 'StackResourceSummaries[?ResourceType==`AWS::Lambda::Function` && starts_with(LogicalResourceId, `StoreAnalyticsImportHandler`)].PhysicalResourceId | [0]' \
  --output text)"
test -n "$stripe_history_import_function" && test "$stripe_history_import_function" != None
aws --profile flashcards-open-source-app --region eu-central-1 lambda invoke \
  --function-name "$stripe_history_import_function" --cli-read-timeout 1000 \
  --cli-binary-format raw-in-base64-out --payload '{}' \
  --query '{StatusCode:StatusCode,FunctionError:FunctionError}' \
  /tmp/nibomo-stripe-history-response.json
aws --profile flashcards-open-source-app --region eu-central-1 logs tail \
  "/aws/lambda/$stripe_history_import_function" --since 1h --format short
```

Require `StatusCode=200`, no `FunctionError`, and inspect the response's
`stripe.remaining` and per-source statuses. A successful Lambda invocation with
`remaining=true` has committed progress, not complete source coverage. Wait for the
hourly continuation or repeat the same invocation after the prior one ends.
The log records `stripe_history_environment_import_completed` and
`stripe_history_import_completed` report only sanitized scope/status/count fields.

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

No rows in an aggregate are not evidence of zero. Establish a completed matching
source/window first; report production separately and keep sandbox's test-clock
exclusion explicit. Check retained invoice service periods, original trial dates,
payment `paid_at` and refund parent IDs against actual provider records before
dependent payment reporting goes live. Repeating a completed backfill must retain
the same native keys, update observation times, and leave entitlements, customer
identities and email delivery state unchanged.

The opaque `subject_id` links native records to `history_subjects`. Two narrow
triggers copy existing billing ownership and erasure atomically. Deleted subjects
retain the shared analytics/billing pseudonym and deletion time; imports and purchase
restores cannot reattach their history. Unattributed records remain countable without
an inferred owner. There are no account foreign keys. The allowlists omit signed
payloads, tokens, account handles, buyer details, free text and payment methods.
Reporting cannot read subject/scope hashes or pagination checkpoints.
