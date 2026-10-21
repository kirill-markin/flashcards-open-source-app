# Store Analytics Import

[A scheduled Lambda](../infra/aws/lib/scheduled-jobs/store-analytics-import.ts) copies App Store and Google Play reports into the `store_analytics` schema ([migration](../db/migrations/0181_store_analytics_schema.sql)) and runs the [Google](billing-history.md#google-backfill-and-verification), [Apple](billing-history.md#apple-collection-and-backfill) and [Stripe](billing-history.md#stripe-inventory-and-backfill) native billing history collectors. [The handler](../apps/backend/src/entrypoints/scheduledJobs/lambda-store-analytics-import.ts) owns the run lock, each source's deadline and how a failed source fails the run.

## App Store

[The importer](../apps/backend/src/storeAnalytics/appleImport.ts) reads every instance of every App Store Connect Analytics report request with a read-only team key; requests are created as in [App Store Analytics Access](app-store-analytics.md), and [the report mapping](../apps/backend/src/storeAnalytics/appleReports.ts) routes each report to its table. While no `ONGOING` request is active every run fails, until an App Store Connect Admin creates one.

## Google Play

[The importer](../apps/backend/src/storeAnalytics/playImport.ts) reads the Play Console reports bucket through keyless federation as a Play Console user allowed to download bulk reports and view financial data ([client](../apps/backend/src/storeAnalytics/googleStorageClient.ts)); the billing identity in [Google Play subscriptions](google-play-subscriptions.md) is separate. [The file mapping](../apps/backend/src/storeAnalytics/playReports.ts) routes each file to its table. [Sales decoding](../apps/backend/src/storeAnalytics/googleSalesReports.ts) keeps only Nibomo rows and allowlisted financial columns in `play_other_report_rows` with `report_name = sales`; those rows discover orders and reconcile native charges, and are not additional payments.

## Freshness

Operational success means every source completed without an error; it does not guarantee complete historical coverage. Import failure alerts recover only after a completed successful run. A separate freshness alert reports two consecutive hours without a successful completion, including missing jobs and hard crashes.

`store_analytics.import_files` has one row per imported App Store segment or Play file. For App Store, read the latest `processing_date` and `imported_at` per `report_name` and `granularity`; an instance absent from it has not been imported, and Apple deletes instances 35 days after generation. For Google Play, read `file_month`, `report_date_to` and `imported_at` per `report_name`; Google posts each day 3–7 days late.

The ongoing and one-time snapshot Apple requests are read together, so do not create another request when a commerce report has no instances. An empty instance list is unavailable report history, not zero sales.
