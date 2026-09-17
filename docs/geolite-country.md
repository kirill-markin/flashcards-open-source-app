# Private GeoLite Country operations

This product includes GeoLite data created by MaxMind, available from <https://www.maxmind.com>.

Implementation: [reader](../apps/backend/src/geolocation/country.ts), [freshness validation](../apps/backend/src/geolocation/database.ts), [private bucket](../infra/aws/lib/geolite-country.ts), [download script](../scripts/geolite/refresh-country.sh), [daily workflow](../.github/workflows/geolite-country-refresh.yml). Country ingestion is not enabled by these resources.

## Initial rollout

1. Merge this additive prerequisite to `main` after `Repository static checks` passes. Fork PR checks require no MaxMind credentials or database.
2. Let `AWS/Web Release` deploy the bucket, Lambda configuration and IAM roles through CDK. After migration verification and verified restoration of the reconciliation schedules, it seeds the private object using the existing `MAXMIND_ACCOUNT_ID` and `MAXMIND_LICENSE_KEY` repository secrets. No operator needs to download or upload a database.
3. Confirm `Refresh private GeoLite Country database` succeeded in the release log. Only then deploy the separate country-ingestion integration. The existing backend API Lambda receives the read permission and environment; other functions do not.
4. Confirm the next scheduled `GeoLite Country Refresh` succeeds. It runs daily at 05:17 UTC, using its own concurrency group and the restricted refresh role. Its ARN is derived from the existing deployment-role ARN; there is no new GitHub secret to configure.

## Failed refresh or expired data

1. Open the failing refresh job and inspect its download, validation or upload error. Credential values and visitor IPs must never be logged. Fix the existing GitHub MaxMind secrets when authentication fails.
2. Run `GeoLite Country Refresh` on `main` with GitHub Actions **Run workflow**. A successful job validates the new MMDB before atomically replacing the S3 object. A failed download or validation does not overwrite it.
3. Confirm the published build date in the job log is current. Active Lambda instances reload at the next lookup after their one-hour cache expires. Broken storage or expired data raises an error; it must not be converted to an unknown-country result by ingestion.

The bucket blocks public access, requires TLS, uses SSE-S3 encryption and has no version history. Replacements remove the superseded object immediately; seven-day lifecycle expiry removes abandoned objects when updates stop. CI temporary files are removed on exit and never uploaded as artifacts or caches. Lambda deletes its temporary MMDB immediately after opening it and retains only the reader in memory. Freshness uses the database build date, never S3 upload time. The 30-day maximum is enforced on every lookup, including warm instances. See [MaxMind update requirements](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/#automate-database-downloads-and-updates).

For an end-to-end production check after ingestion is connected, send an authenticated installation update through the real API, confirm the country in the reporting database, and repeat with IPv6. Confirm lookup of an unlocated address remains unknown and that no raw address enters persisted analytics or logs. Database-unavailable checks belong in an isolated CI environment, never by deleting the production object.
