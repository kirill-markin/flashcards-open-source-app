# Global Metrics Snapshot

The platform writes one canonical daily snapshot of product-wide review activity for simple endpoint consumers.
It is intended for websites and future mobile-app endpoint consumers that need aggregate product stats without direct database access or live analytical queries.
It is separate from the admin analytics flow documented in [docs/admin-app.md](./admin-app.md).

`GET /v1/global/snapshot` is the only consumer endpoint for this feature.

- When the effective visibility value is the exact raw string `true`, clients can fetch the snapshot.
- Any other value keeps the endpoint hidden from clients.
- The snapshot pipeline still runs daily and the release flow still seeds the snapshot once after deploy even when the endpoint is hidden.
- When visibility is off, clients do not see global stats through this endpoint.
- The web, iOS, and Android apps do not render these metrics yet.

## Operator Controls

- Set `GLOBAL_METRICS_VISIBLE` in the root `.env` for the local/bootstrap setup surface.
- `bash scripts/setup-github.sh` copies that value into the GitHub variable `CDK_GLOBAL_METRICS_VISIBLE` only when the GitHub variable does not already exist.
- GitHub Actions deploys from `CDK_GLOBAL_METRICS_VISIBLE`. After bootstrap, that GitHub variable is the deploy-time source of truth.
- Only the exact raw string `true` makes `GET /v1/global/snapshot` visible. Any other value keeps it hidden.
- If you change `.env` later and rerun `bash scripts/setup-github.sh`, the script preserves an existing `CDK_GLOBAL_METRICS_VISIBLE` value and does not flip visibility automatically.
- To change visibility after bootstrap, edit `CDK_GLOBAL_METRICS_VISIBLE` in GitHub and redeploy, or delete that GitHub variable before rerunning `bash scripts/setup-github.sh`.

## Snapshot Contract

The JSON contract is:

```json
{
  "schemaVersion": 1,
  "generatedAtUtc": "2026-04-23T01:00:12.345Z",
  "asOfUtc": "2026-04-23T00:00:00.000Z",
  "from": "2026-01-23",
  "to": "2026-04-22",
  "totals": {
    "uniqueReviewingUsers": 8,
    "reviewEvents": {
      "total": 12,
      "byPlatform": {
        "web": 4,
        "android": 5,
        "ios": 3
      }
    }
  },
  "days": [
    {
      "date": "2026-01-23",
      "uniqueReviewingUsers": 2,
      "reviewEvents": {
        "total": 3,
        "byPlatform": {
          "web": 1,
          "android": 1,
          "ios": 1
        }
      }
    }
  ]
}
```

Contract rules:

- `schemaVersion` is currently `1`.
- `generatedAtUtc` is the canonical UTC timestamp when the snapshot was generated.
- `asOfUtc` is the UTC midnight boundary used to cut off included data.
- `from` and `to` are inclusive UTC dates for the `days` array.
- `totals.uniqueReviewingUsers` is a number.
- `totals.reviewEvents.total` is a number and must equal the sum of `totals.reviewEvents.byPlatform`.
- `days` is an ordered, zero-filled 90-item UTC date series from `from` through `to`.
- Each `days[]` entry contains `date`, `uniqueReviewingUsers`, and `reviewEvents`.
- `to` is always the UTC day immediately before `asOfUtc`.
- `from` is always 90 complete UTC days before `asOfUtc`.

## Counting Semantics

The snapshot uses `content.review_events.reviewed_at_server` and UTC calendar days.

- `totals` are cumulative for all matching review activity before `asOfUtc`.
- `days` covers only the trailing 90 complete UTC days from `from` through `to`.
- Missing days are represented as explicit zero-value entries instead of being omitted.
- `reviewEvents.byPlatform` contains `web`, `android`, and `ios`.
- Do not infer per-platform unique user counts from review-event volume.

`uniqueReviewingUsers` is derived from the current `sync.workspace_replicas.user_id` label attached to each joined `review_events.replica_id`.
That means these counts are not immutable historical authorship: if the current replica-to-user label changes later, historical aggregate counts can be attributed to that newer label.

## Consumer Guidance

- Treat the snapshot as a cached daily aggregate, not a live analytics stream.
- Render UTC dates exactly as provided instead of converting bucket labels into local time.
- Do not expect the `totals` counters to equal the sum of the 90-day `days` series.
- Websites can fetch this endpoint when visibility is enabled, and future mobile-app endpoint consumers can do the same once those clients add UI.

Deployment details are documented in [docs/backend-web-deployment.md](./backend-web-deployment.md).
