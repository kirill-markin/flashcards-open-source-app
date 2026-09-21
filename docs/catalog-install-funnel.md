# Catalog install facts

What the marketing-site to web-app catalog import flow records. These are independent facts: nothing
is minted at write time to hold one report together, and any funnel over them is a query assembled at
analysis time. No guest user, workspace, or durable visitor identity is created here. The canonical
rows live in `analytics.product_events`.

## Sources

- Event catalog: [`apps/backend/src/productAnalytics/catalog.ts`](../apps/backend/src/productAnalytics/catalog.ts)
- Collector envelope, route and identity rules: [anonymous client analytics](anonymous-client-analytics.md)
- Browser identity every client fact carries: [analytics visitor identity](analytics-visitor-identity.md)
- Web producer: [`catalogInstall.ts`](../apps/web/src/analytics/catalogInstall.ts)
- Server-confirmed install fact: [`apps/backend/src/catalog/distribution/install/index.ts`](../apps/backend/src/catalog/distribution/install/index.ts)
- Database contract: [`db/migrations/0134_catalog_install_journey_analytics.sql`](../db/migrations/0134_catalog_install_journey_analytics.sql)

## The facts

| Event | Origin | What it records | Additional properties |
| --- | --- | --- | --- |
| `catalog_install_clicked` | marketing site | a catalog install CTA was clicked | `placement`, `source`, `device_category` |
| `catalog_install_preview_ready` | web app | the install preview loaded for a signed-in person | none |
| `catalog_install_failed` | web app | the flow failed at a named point | `stage`, `reason` |
| `catalog_deck_install_started` | web app | install intent, through the general collector | `package_slug` |
| `catalog_deck_installed` | server | the installation completed | `package_slug`, `card_count` |

Every one of them carries `package_version_id`. Entry into the import screen is `screen_viewed`, and
the sign-in steps are the generic `signin_code_requested`, `signin_succeeded` and `signin_failed`
facts; none of those is duplicated here.

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

## `install_journey_id` is historical

`install_journey_id` was a UUID minted per install attempt and carried through navigation so one
report could join across the two domains. Nothing mints or forwards it any more: the web app does not
create it, the auth login page does not read it, and the server install fact does not carry it.

Two things survive, both for compatibility with clients already in the wild:

- The collector still accepts the property on every catalog install event, and still stores it as
  `anonymous_id` when the body claims no `anonymousId`.
- `POST /v1/workspaces/{workspaceId}/catalog/package-versions/{packageVersionId}/install` still
  accepts the optional `installJourneyId` body field, and ignores it.

It also still accepts `catalog_install_landed`, `catalog_install_signin_started`,
`catalog_install_signin_code_requested` and `catalog_install_signin_succeeded`, which no producer
sends any more.

Rows written before this change carry the journey id, and the admin catalog install funnel reads
them. Its reach ends where the last journey-carrying client does.

## Reporting

Use `occurred_at`, never the client clock columns, for time ranges. Only
`origin = 'server' AND event_name = 'catalog_deck_installed'` is a completed installation; client
`catalog_deck_install_started` is intent, not success. Acquisition device context comes from
`catalog_install_clicked` (`device_category`, `device_locale`, and `platform = 'web'`), not from the
server fact. Server facts keep `platform` null because the install request headers are not a trusted
replica fact. There is no historical click backfill and no historical conversion claim.

Post-install engagement is reportable only on an install whose server `catalog_deck_installed` row
exists, because that row is the only place this flow names a person. `review_answered` carries no
deck or card identity, so those reviews are the person's reviews anywhere in the product and never
deck-level retention; say so wherever they are shown. Whether the installing account is new is that
actor having no trusted `analytics.product_events_resolved` row at all before the install, read with
no lower bound and over every event name. Trusted is what
[`buildTrustedActorRowsFilterSql`](../apps/admin/src/filters/filterSql.ts) defines and states in
full.

## Manual acceptance

1. Generate one UUIDv7 event ID and a real published package version.
2. POST a valid `catalog_install_clicked` body from each configured marketing, app, and auth origin.
   Confirm a `200`, `{"accepted":true}`, and an `X-Request-Id` response header.
3. Repeat the identical event ID. Confirm another `200` and exactly one matching
   `analytics.product_events` row.
4. Submit a server-only event name, an extra `email` field, a malformed UUID, a non-language locale,
   a future event time, and a body larger than 8 KiB. Confirm each is rejected and no row is stored.
5. POST `catalog_install_landed` and each `catalog_install_signin_*` name with an
   `install_journey_id`, as a released client does. Confirm each is accepted and stored.
6. Confirm one catalog install with `installJourneyId` and one without. Verify both succeed, and that
   each writes one server-origin `catalog_deck_installed` row carrying the route's
   `package_version_id` and no `install_journey_id`.
7. Query the events through `reporting_readonly`, ordered by `occurred_at`, and confirm all anonymous
   rows have null `user_id`, `subject_user_id`, `workspace_id`, `guest_session_id`, `session_id`, and
   `auth_transport`.
