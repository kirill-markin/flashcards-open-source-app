# Catalog install funnel

The funnel measures the current marketing-site to web-app catalog import journey. It does not create
guest users, workspaces, or a durable visitor identity. The canonical rows live in
`analytics.product_events`.

## Sources

- Event catalog: [`apps/backend/src/productAnalytics/catalog.ts`](../apps/backend/src/productAnalytics/catalog.ts)
- Collector envelope, route and identity rules: [anonymous client analytics](anonymous-client-analytics.md)
- Server-confirmed install fact: [`apps/backend/src/catalog/distribution/install/index.ts`](../apps/backend/src/catalog/distribution/install/index.ts)
- Database contract: [`db/migrations/0134_catalog_install_journey_analytics.sql`](../db/migrations/0134_catalog_install_journey_analytics.sql)

## Producer contract

Create one UUID `install_journey_id` for each catalog install CTA attempt. Carry it through navigation
as the exact `install_journey_id` query parameter. The existing catalog import route UUID is the
`package_version_id`; do not mint another package identifier.

Send each milestone independently to the
[anonymous client collector](anonymous-client-analytics.md), which owns the envelope, the retry key,
the clock window and the response. Released producers post to
`/v1/analytics/catalog-install-events`, and that path keeps answering. One milestone looks like this:

```json
{
  "eventId": "01994c2a-8b5e-7d21-8c43-dbc6e1185b32",
  "eventName": "catalog_install_landed",
  "clientOccurredAt": "2026-09-13T06:30:00.000Z",
  "clientSentAt": "2026-09-13T06:30:00.000Z",
  "deviceLocale": "en-US",
  "properties": {
    "install_journey_id": "4db7e23e-2ee7-4db9-9b52-75684725f02a",
    "package_version_id": "85e486a9-ce3d-44b7-a667-3895425e8cc4",
    "auth_state": "signed_out"
  }
}
```

Every event of this funnel carries UUID `install_journey_id` and `package_version_id` properties,
which the collector normalizes to lowercase. The remaining exact properties are:

| Event | Additional required properties |
| --- | --- |
| `catalog_install_clicked` | `placement`: `top`, `middle`, `bottom`; `source`: `direct`, `search`, `social`, `referral`, `internal`, `unknown`; `device_category`: `desktop`, `mobile`, `tablet`, `unknown` |
| `catalog_install_landed` | `auth_state`: `signed_in`, `signed_out` |
| `catalog_install_signin_started` | None |
| `catalog_install_signin_code_requested` | None |
| `catalog_install_signin_succeeded` | None |
| `catalog_install_preview_ready` | None |
| `catalog_install_failed` | `stage` and `reason`, from the lists below |
| `catalog_deck_install_started` | `package_slug`, using the catalog slug from the loaded package version |

Failure stages are `landing`, `signin`, `preview`, `preinstall_sync`, `install`, and
`postinstall_sync`. Failure reasons are `invalid_link`, `package_unavailable`,
`workspace_unavailable`, `invalid_code`, `expired_code`, `code_already_used`, `rate_limited`,
`offline`, `timeout`, `network_error`, `unauthorized`, `conflict`, `storage_error`, `contract_error`,
`server_error`, and `cancelled`.

Producers must never send a raw URL, referrer, email, user or workspace identifier, free text, or
identity-link input. Convert acquisition data to the `source` enum before sending it. A telemetry
timeout or rejection must be logged with only the event name, stage/reason when present, response
status/code, and request ID; it must never block or delay navigation, authentication, preview,
synchronization, or installation.

The confirm request to
`POST /v1/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install` accepts the
optional body field `installJourneyId` as a UUID. The web producer forwards the current journey there.
Older confirms without it remain valid. `catalog_deck_installed` remains server-only and keeps its
existing deterministic event ID; it now carries server-known `package_version_id` and carries
`install_journey_id` when the confirm supplied one. Server facts keep `platform` null because the
install request headers are not a trusted replica fact.

## Reporting contract

Use `occurred_at`, never the client clock columns, for time ranges. Join steps by
`event_properties ->> 'install_journey_id'` and verify that
`event_properties ->> 'package_version_id'` agrees across the journey. The anonymous acquisition
rows use the journey UUID as `anonymous_id`; it is an attempt key, not a unique-person measure.

Post-install engagement is reportable only for a journey whose server `catalog_deck_installed` row
exists, because that row is the only place a journey names a person. Measure it on that actor, from
the install's `occurred_at` to the same seven-day bound on the click the rest of the funnel uses, in
UTC days. `review_answered` carries no deck or card identity, so those reviews are the person's
reviews anywhere in the product and never deck-level retention; say so wherever they are shown.
Report a return day only together with a review threshold, so the steps stay nested. Whether the
installing account is new is that actor having no trusted `analytics.product_events_resolved` row at
all before the click, read with no lower bound and over every event name. Trusted is what
[`buildTrustedActorRowsFilterSql`](../apps/admin/src/filters/filterSql.ts) defines and states in
full.

A server `catalog_deck_installed` without `install_journey_id` is a real install that belongs to no
journey, since a confirm may omit `installJourneyId`. It is reportable only as its own count, never
inside a journey denominator.

Only `origin = 'server' AND event_name = 'catalog_deck_installed'` is a completed installation.
Client `catalog_deck_install_started` is intent, not success. Acquisition device context comes from
`catalog_install_clicked` (`device_category`, `device_locale`, and `platform = 'web'`), not from the
server fact. Report counts only events received after this collector and the corresponding producers
were deployed; there is no historical click backfill or historical conversion claim.

## Manual acceptance

1. Generate one UUIDv7 event ID and two UUIDs for a journey and a real published package version.
2. POST a valid `catalog_install_clicked` body from each configured marketing, app, and auth origin.
   Confirm a `200`, `{"accepted":true}`, and an `X-Request-Id` response header.
3. Repeat the identical event ID. Confirm another `200` and exactly one matching
   `analytics.product_events` row.
4. Submit a server-only event name, an extra `email` field, a malformed UUID, a non-language locale,
   a future event time, and a body larger than 8 KiB. Confirm each is rejected and no row is stored.
5. Confirm one catalog install with `installJourneyId`. Verify the product install succeeds even if
   the public collector is unavailable, then verify one server-origin `catalog_deck_installed` row
   with the same `install_journey_id` and the route's `package_version_id`.
6. Confirm a legacy install without `installJourneyId`. Verify it still succeeds and its server fact
   has `package_version_id` with no `install_journey_id`.
7. Query the journey through `reporting_readonly`, ordered by `occurred_at`, and confirm all anonymous
   rows have null `user_id`, `subject_user_id`, `workspace_id`, `guest_session_id`, `session_id`, and
   `auth_transport`.
