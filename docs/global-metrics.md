# Global Metrics Snapshot

[The public endpoint](../apps/backend/src/routes/globalSnapshot.ts) serves cached daily review aggregates. The web, iOS, and Android apps do not render them yet.

| Request | Contract | Calculation |
| --- | --- | --- |
| `GET /v1/global/snapshot` or `?schemaVersion=2` | [Compatibility v2](../apps/backend/src/globalMetrics/snapshot.ts) | [Persisted reviews](../apps/backend/src/globalMetrics/reporting.ts), server date, current replica owner, client installations on web/android/ios |
| `GET /v1/global/snapshot?schemaVersion=3` | [Canonical v3](../apps/backend/src/globalMetrics/snapshotV3.ts) | [Resolved analytics reviews](../apps/backend/src/globalMetrics/reportingV3.ts), shared with the admin review report |

An invalid or repeated explicit version returns HTTP 400 while visible. Visibility applies to both versions; a hidden endpoint returns HTTP 404.

## Contract and counting

Both versions contain `schemaVersion`, `generatedAtUtc`, `asOfUtc`, `from`, `to`, `totals`, and `days`. `totals` contains `uniqueReviewingUsers` and `reviewEvents`. Each day contains `date`, `uniqueReviewingUsers`, `newReviewingUsers`, `returningReviewingUsers`, and `reviewEvents`. A `reviewEvents` object contains `total` and `byPlatform`.

V2 retains exactly three platform keys: `web`, `android`, `ios`. V3 uses exactly five: `web`, `android`, `ios`, `agent`, `unattributed`. Each review total equals the sum of its platform counts. Platform volumes are not unique-user counts.

The series is ordered and zero-filled from the earliest qualifying UTC day through the day before `asOfUtc`, an exclusive UTC midnight cutoff. Empty history produces one zero day before that cutoff. Day reviewers equal new plus returning reviewers. New means the person's first qualifying review across all history occurred on that day; selecting an admin range or platform never redefines that first day. Totals span all included history, and review totals equal the summed day series. V3 all-time unique reviewers equal the sum of new reviewers across days.

V3 and the [admin review report](../apps/admin/src/reports/reviewEventsByDate/query.ts) compose [one pure SQL calculation](../apps/backend/src/reviewMetricsSql.ts): `review_answered` in `analytics.product_events_resolved`, non-null resolved `actor_id`, UTC `occurred_at` day, platform recorded on the event, and the same actor exclusions. These exclude test addresses, anyone ever granted admin, active excluded actors, and actors with an automated collector verdict. V2 keeps its existing query and identity semantics.

[Admin data semantics](../apps/admin/README.md#where-the-data-comes-from) explain guest identity resolution, anonymized account history, imported reviews, and the producer's timestamp window. Persisted review rows and analytics are not interchangeable: installation automation is intentionally suppressed, deleted accounts can retain anonymized analytics after persisted rows disappear, and historical absent-author reviews may have no analytics row. Best-effort event delivery can also leave a residual gap; alignment does not backfill or repair ingestion.

## Freshness and consumers

Render UTC bucket dates without local-time conversion. Display `generatedAtUtc` as snapshot freshness and `to` as the last complete day. Admin reports are live at their displayed refresh timestamp and visibly mark today's UTC data partial. Public snapshots refresh daily, so late-arriving events, identity changes, and newly applied exclusions can change historical days on the next generation. Comparing the two requires the same cutoff, no narrowed admin filters, and allowance for arrivals after generation.

Consumers opt into v3 explicitly. Existing v2 consumers keep the complete old shape and calculation. The website consumer is maintained in the separate website repository.

## Operator controls and rollout

- Only the exact raw string `true` in `CDK_GLOBAL_METRICS_VISIBLE` exposes either version.
- `GLOBAL_METRICS_VISIBLE` in the root `.env` bootstraps that GitHub variable through `scripts/setup/setup-github.sh` only if the variable is absent. Later visibility changes require updating the GitHub variable and deploying.
- [The existing scheduled job](../infra/aws/lib/scheduled-jobs/global-metrics.ts) generates both versions at 01:00 UTC. [AWS/Web Release](../.github/workflows/aws-web-release.yml) seeds both after deployment through the same generator, including when hidden.
- V2 remains at the configured S3 object key; v3 appends `.v3` to that key. The bucket remains private. Generator and API IAM grants cover both objects.
- [The hourly freshness check](../infra/aws/lambda/global-metrics-snapshot-freshness/index.ts) reads both objects and publishes the older object's age to the existing metric/alarm. A missing object fails the check.
- [The deployed public endpoint smoke](../scripts/checks/check-public-endpoints.sh) checks both contracts, cohort/platform sums, hidden behavior, and invalid version rejection. Deploy only through main CI/CD; seed and complete release checks before switching a consumer to v3.

Deployment details: [Backend and Web Deployment](./backend-web-deployment.md).
