# App Store Analytics Access

Use App Store Connect Analytics Reports API for store discovery, downloads,
usage, purchases, and subscriptions. Reuse the main checkout's
[App Store Connect credentials](xcode-cloud-data-access.md#required-local-secrets).

1. Read `GET /v1/apps/{appId}/analyticsReportRequests`. An empty successful
   response means no report requests exist, not that API access failed.
2. For a task that requires enabling report generation, create an `ONGOING`
   request with `POST /v1/analyticsReportRequests`; use `ONE_TIME_SNAPSHOT`
   when historical data is needed. Check existing requests before creating one.
3. List reports at `/v1/analyticsReportRequests/{requestId}/reports`, then
   instances at `/v1/analyticsReports/{reportId}/instances` and segments at
   `/v1/analyticsReportInstances/{instanceId}/segments`. Download every segment.

The first ongoing reports take approximately 24–48 hours. Preserve report
dates separately from processing dates and account for corrections. Usage
reports cover opted-in users; privacy thresholds can suppress small counts.
Do not interpret missing rows as zero or sum daily unique users into monthly
unique users.

Read Apple's [download workflow](https://developer.apple.com/documentation/appstoreconnectapi/downloading-analytics-reports)
and [report definitions](https://developer.apple.com/help/app-store-connect-analytics/overview/analytics-reports-api)
for request schemas, report availability, and privacy limits.
