# Native billing history

The [schema](../db/migrations/0182_provider_native_billing_history.sql) and
[source contracts](../apps/backend/src/billing/history/) retain provider financial
objects independently of [current entitlement state](premium-entitlements.md).
Collectors and charts are separate delivery stages. This schema alone imports no history.

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

Merge this prerequisite and wait for `AWS/Web Release` deployment before running
a collector. There is no backfill command in this stage. Use the existing
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
