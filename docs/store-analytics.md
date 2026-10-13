# Store Analytics Import

[A scheduled Lambda](../infra/aws/lib/scheduled-jobs/store-analytics-import.ts) copies store reports into the `store_analytics` schema ([migration](../db/migrations/0181_store_analytics_schema.sql)). It runs hourly at minute 20 UTC as the IAM role `FlashcardsStoreReportsImportRole`; [the handler](../apps/backend/src/entrypoints/scheduledJobs/lambda-store-analytics-import.ts) logs one `store_analytics_apple_import_completed` record per run.

## App Store

- Source: every instance (daily, weekly, monthly) of every report in every App Store Connect Analytics report request for the app, read with the team key in Secrets Manager `flashcards-open-source-app/app-store-connect-reports`. The key can only read; requests are created as described in [App Store Analytics Access](app-store-analytics.md).
- Tables: [the report mapping](../apps/backend/src/storeAnalytics/appleReports.ts) routes each report family to its table and every other report to `apple_other_report_rows`. Columns are matched by header name.
- Replacement: [the importer](../apps/backend/src/storeAnalytics/appleImport.ts) keeps, per report name, granularity, detail level and report date, only the rows of the newest processing date. An equal processing date replaces the earlier copy, so the ongoing and snapshot requests never double a date.
- Retries: a failed instance is reported to Sentry and retried by the next run. A run stops starting instances after 12 minutes and the next run continues. Runs are serialized by a session advisory lock: a run that cannot take it within 10 seconds fails and alerts like any other failed run. The run fails while no `ONGOING` request is active; an App Store Connect Admin must then create one.

## Freshness

`store_analytics.import_files` has one row per imported segment. Read the latest `processing_date` and `imported_at` per `report_name` and `granularity` there; an instance absent from it has not been imported. Apple deletes instances 35 days after generation.
