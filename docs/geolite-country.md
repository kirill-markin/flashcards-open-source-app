# Private GeoLite Country operations

This product includes GeoLite data created by MaxMind, available from <https://www.maxmind.com>.

The daily refresh and the release gate also publish `GeoLite2-ASN.mmdb` beside `GeoLite2-Country.mmdb` in the same bucket, with the same validation. The credential-free collector reads it through the [ASN reader](../apps/backend/src/geolocation/asn.ts) to store a network ASN on every row that carries a country, and the authenticated analytics ingest to store one on every app event row.

Implementation: [reader](../apps/backend/src/geolocation/country.ts), [freshness validation](../apps/backend/src/geolocation/database.ts), [private bucket](../infra/aws/lib/geolite-country.ts), [download script](../scripts/geolite/refresh-country.sh), [release gate](../scripts/geolite/ensure-country.sh), [daily workflow](../.github/workflows/geolite-country-refresh.yml), [country ingestion and retention](analytics-audience.md). Freshness follows [MaxMind's update requirements](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/#automate-database-downloads-and-updates).

Every ingestion path treats a broken or expired database as an error and never as an unknown country or network; only an address the database cannot place stays unknown.

## Release and daily refresh

1. Merge to `main` after `Repository static checks` passes; PR checks need no MaxMind credentials or database.
2. In `AWS/Web Release`, confirm `Ensure fresh private GeoLite Country database` succeeded and read its structured `fresh` result per database with the actual publication and build dates: the [gate](../scripts/geolite/ensure-country.sh) reuses fresh published objects, refreshes both from MaxMind when either is stale or absent, and fails the release on anything else, including `AccessDenied`: inspect IAM before rerunning the release.
3. Confirm the next scheduled `GeoLite Country Refresh` succeeds. Its restricted role is derived from the deployment-role ARN, so there is no GitHub secret to add.

## Failed refresh or expired data

Every GeoLite [alarm](../infra/aws/lib/monitoring.ts), Country and ASN, routes here, and each description states its impact; the two `DatabaseStale` alarms fire while lookups still work and are the ones that leave time to act.

1. Open the failing refresh job and inspect its download, validation or upload error. Fix the existing GitHub MaxMind secrets when authentication fails.
2. Run `GeoLite Country Refresh` on `main` with GitHub Actions **Run workflow**. A failed download or validation never overwrites the published object.
3. Confirm the published build date in the job log is current. Running Lambda instances pick up the new object within the reader's one-hour reload.

## Production check

After ingestion is connected, send an authenticated installation update through the real API, confirm the country in the reporting database, and repeat with IPv6. Confirm an unlocated address stays unknown and that no raw address enters persisted analytics or logs. Database-unavailable checks belong in an isolated CI environment, never by deleting the production object.
