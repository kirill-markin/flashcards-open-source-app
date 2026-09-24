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

Every one of them carries `package_version_id`, and so does the site's `site_page_viewed` on a deck
page ([marketing site facts](anonymous-client-analytics.md#the-marketing-site-facts)). Entry into the
import screen is `screen_viewed`, and the sign-in steps are the generic `signin_code_requested`,
`signin_succeeded` and `signin_failed` facts; none of those is duplicated here.

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

The admin Funnels area does not read the journey id: its catalog install funnel is keyed on the
shared visitor identity below, and it does not read the four names above either. The General and
Audience catalog click filters still do, through `buildCatalogInstallAttributionSql` in
[`filterSql.ts`](../apps/admin/src/filters/filterSql.ts), which joins a click to a server install on
it; the server install no longer carries it, so that join matches no install made since.

## Reporting

Use `occurred_at`, never the client clock columns, for time ranges. Only
`origin = 'server' AND event_name = 'catalog_deck_installed'` is a completed installation; client
`catalog_deck_install_started` is intent, not success. Acquisition device context comes from
`catalog_install_clicked` (`device_category`, `device_locale`, and `platform = 'web'`), not from the
server fact. Server facts keep `platform` null because the install request headers are not a trusted
replica fact. There is no historical click backfill and no historical conversion claim.

What joins these facts into a flow is `analytics.product_events_resolved.actor_id`, nothing on the
events themselves. A row sent with no account credential carries the
[analytics visitor identity](analytics-visitor-identity.md) as `anonymous_id`, and resolves onto the
account once the web app records an `authenticated_client` identity link for it; the signed-in app's
rows and the server install carry the account already. So the deck page's `site_page_viewed`, the
site click, the import flow's `screen_viewed` rows and the server install resolve onto one identity. The auth origin's sign-in
rows split by when they were written. The `guest_client` rows it delivered until it stopped minting a
guest session were posted on a guest credential whose `user_id` outranks the visitor cookie, and
reach the account only through the `server_derived` link written after `signin_succeeded` inside a
budget a first-ever sign-in usually overruns, so they cannot reliably be joined to the rest. The
`anonymous_client` rows it writes now carry no `user_id` and no `server_derived` link: they resolve
through `first_anonymous_link` on the same shared visitor id as the rows above, so they do join, and
what keeps them out of a report is the trusted-actor rule rather than an unreachable identity.
A sign-in is read instead from the web app's first screen view that the same browser sends with an
account credential. The sequence is assembled at analysis time
from that identity and `occurred_at`. The admin funnel over it counts people, starts at the deck page view and
takes the click as its second step, so its history begins when the site began sending page views;
what it can and cannot claim is [Admin app](admin-app.md). **Only a click sent with the visitor identity joins anything:**
a click body that claims no `anonymousId` is stored under its per-attempt `install_journey_id`, which
matches no later row, and that is every click made before the site and the app shared one
registrable domain.

Three limits bound what any such join can say. `screen_viewed` carries no properties at all, so a
step read from it names no deck version. A browser that refused consent is given no identifier, so
its rows resolve to a NULL actor and belong to no identity at all rather than to a missing one. And a
report wanting the preview moment on the account's side of the flow reads the `catalog_import_confirm`
screen view, which marks the same moment and is reported by the signed-in app with the account's own
credential, while `catalog_install_preview_ready` goes out on the credential-free collector and
reaches the account only through the identity link for its visitor cookie.

Post-install engagement is reportable only on an install whose server `catalog_deck_installed` row
exists, because that is where the install is a fact rather than an intent. `review_answered` carries
no deck or card identity, so those reviews are the person's reviews anywhere in the product and never
deck-level retention; say so wherever they are shown. Whether the installing identity is new is that
actor having no trusted `analytics.product_events_resolved` row at all before the deck page view, read
with no lower bound and over every event name. Trusted is what
[`buildTrustedActorRowsFilterSql`](../apps/admin/src/filters/filterSql.ts) defines and states in
full, and it is load-bearing here: the anchoring page view is itself a credential-free row on the
same identity, so without the rule no installer would ever read as new.

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
