# Global Metrics Snapshot

[The public endpoint](../apps/backend/src/routes/globalSnapshot.ts) serves cached daily review aggregates. The web, iOS, and Android apps do not render them yet; the website consumer lives in the separate website repository.

| Request | Contract | Calculation |
| --- | --- | --- |
| `GET /v1/global/snapshot` or `?schemaVersion=2` | [Compatibility v2](../apps/backend/src/globalMetrics/snapshot.ts) | [Persisted reviews](../apps/backend/src/globalMetrics/reporting.ts) |
| `GET /v1/global/snapshot?schemaVersion=3` | [Canonical v3](../apps/backend/src/globalMetrics/snapshotV3.ts) | [Resolved analytics reviews](../apps/backend/src/globalMetrics/reportingV3.ts) |

Consumers opt into v3 explicitly, and v2 keeps its complete old shape and calculation for the consumers already reading it. V3 counts reviews with the [shared review SQL](../apps/backend/src/reviewMetricsSql.ts), including the [shared exclusion rule](admin-app.md#who-counts-as-a-person); [Reading the numbers](admin-app.md#reading-the-numbers) applies to it.

Persisted reviews and analytics are not interchangeable: installation automation is suppressed in analytics, deleted accounts keep anonymized analytics after their persisted rows disappear, historical absent-author reviews may have no analytics row, and best-effort event delivery can leave a gap nothing backfills.

## Freshness and consumers

Render UTC bucket dates without local-time conversion, `generatedAtUtc` as snapshot freshness and `to` as the last complete day. The snapshot regenerates daily, so late events, identity changes and new exclusions can change historical days on the next generation. Comparing it with the admin report needs the same cutoff, no narrowed admin filters, and allowance for arrivals after generation.

## Operator controls

- The GitHub variable `CDK_GLOBAL_METRICS_VISIBLE` exposes both versions ([check](../apps/backend/src/globalMetrics/storage.ts)). `scripts/setup/setup-github.sh` creates it from `GLOBAL_METRICS_VISIBLE` in root `.env` only when absent, so later changes are made in GitHub, followed by a deploy.
- [The scheduled job](../infra/aws/lib/scheduled-jobs/global-metrics.ts) generates both versions daily, and [AWS/Web Release](../.github/workflows/aws-web-release.yml) seeds both after every deployment, hidden or not. [The freshness check](../infra/aws/lambda/global-metrics-snapshot-freshness/index.ts) alarms on the older object.
- [The deployed endpoint smoke](../scripts/checks/check-public-endpoints.sh) checks both contracts. Seed and complete the release checks before switching a consumer to v3.

Deployment details: [Backend and Web Deployment](./backend-web-deployment.md).
