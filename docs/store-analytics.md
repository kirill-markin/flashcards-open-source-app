# Store Analytics Import

[Three independent scheduled Lambdas](../infra/aws/lib/scheduled-jobs/store-analytics-import.ts) collect store reports and [native billing history](billing-history.md). Each has its own run lock, source deadlines, outcome metrics and a freshness alarm on the existing alert topic.

| Hourly UTC minute | Lambda logical ID prefix | Collection | Sentry environment |
| --- | --- | --- | --- |
| 00 | `GoogleBillingDiscoveryHandler` | Verify unknown-environment Google notification tokens, retain subscription observations and classify provider-event metadata | `billing-discovery` |
| 20 | `StoreAnalyticsImportHandler` | Real App Store/Play reports into `store_analytics`, plus production Apple/Stripe/Google history | Existing production configuration |
| 40 | `StoreSandboxImportHandler` | Sandbox Apple/Stripe/Google history | `sandbox` |

Neither financial importer classifies unknown Google tokens. Discovery failures and sandbox failures cannot fail production collection. All three reuse `FlashcardsStoreReportsImportRole`, whose exact name is externally trusted by Google WIF. Sandbox Google order completion uses its verified sandbox inventory without requiring production sales exports; production completion still requires those exports. Checkpoint identities and coverage meanings are shared with [billing history](billing-history.md#reading-the-history).

## App Store

[The importer](../apps/backend/src/storeAnalytics/appleImport.ts) reads every instance of every App Store Connect Analytics report request with a read-only team key; requests are created as in [App Store Analytics Access](app-store-analytics.md), and [the report mapping](../apps/backend/src/storeAnalytics/appleReports.ts) routes each report to its table. While no `ONGOING` request is active every run fails, until an App Store Connect Admin creates one.

## Google Play

[The importer](../apps/backend/src/storeAnalytics/playImport.ts) reads the Play Console reports bucket through keyless federation as a Play Console user allowed to download bulk reports and view financial data ([client](../apps/backend/src/storeAnalytics/googleStorageClient.ts)); the billing identity in [Google Play subscriptions](google-play-subscriptions.md) is separate. [The file mapping](../apps/backend/src/storeAnalytics/playReports.ts) routes each file to its table. [Sales decoding](../apps/backend/src/storeAnalytics/googleSalesReports.ts) keeps only Nibomo rows and allowlisted financial columns in `play_other_report_rows` with `report_name = sales`; those rows discover orders and reconcile native charges, and are not additional payments.

## Freshness

Operational success means every source completed without an error; it does not guarantee complete historical coverage. A single failed run does not alert; the freshness alert reports two consecutive hours without a successful completion, including failed or missing runs and hard crashes.

For each job, read its own log group for `store_analytics_import_completed` with `succeeded=0` or `1`, and its own `RunSucceeded` metric under `FlashcardsOpenSourceApp/StoreAnalyticsImport`, `FlashcardsOpenSourceApp/StoreSandboxImport` or `FlashcardsOpenSourceApp/GoogleBillingDiscovery`. Freshness alarms use the hourly maximum with missing hours filled as zero. Resolve current functions and inspect configuration/results as in [billing history](billing-history.md#invoke-after-deployment). In Sentry, inspect each job's actual environment; sandbox/discovery exception grouping is separate from production even for identical stacks. Historical events retain their original environments.

`store_analytics.import_files` has one row per imported App Store segment or Play file. For App Store, read the latest `processing_date` and `imported_at` per `report_name` and `granularity`; an instance absent from it has not been imported, and Apple deletes instances 35 days after generation. For Google Play, read `file_month`, `report_date_to` and `imported_at` per `report_name`; Google posts each day 3–7 days late.

The ongoing and one-time snapshot Apple requests are read together, so do not create another request when a commerce report has no instances. An empty instance list is unavailable report history, not zero sales.
