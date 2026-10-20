# Anonymous client analytics collector

The credential-free collector for client-reported product analytics. It exists so a signed-out
browser can be measured from its first page view, before any account, guest session or workspace
exists, and so the consent decision itself is reportable before a visitor may be given an identity
at all. Authenticated clients keep batching through `POST /v1/analytics/events`.

- [Route](../apps/backend/src/routes/anonymousAnalytics.ts), owning the paths, the origin check,
  the stored country and why the off switch is not enforced here, and its
  [CORS allowlist](../apps/backend/src/server/app.ts)
- [Event contract](../apps/backend/src/productAnalytics/anonymousEvent.ts), owning the body and the
  identity on the row, and the [event catalog](../apps/backend/src/productAnalytics/catalog.ts) it
  derives every per-event rule from, `identityFree` included
- [Storage contract](../db/migrations/0143_anonymous_client_identity_free_rows.sql), the
  [daily visitor hash](../db/migrations/0144_anonymous_client_daily_visitor_hash.sql) with its
  [current exclusion list](../db/migrations/0156_site_consent_daily_visitor_hash_exclusion.sql) and
  [code](../apps/backend/src/productAnalytics/dailyVisitorHash.ts), the
  [stored country](../db/migrations/0158_anonymous_event_country.sql), the
  [network and browser-version facts](../db/migrations/0224_anonymous_event_network_and_browser_facts.sql)
  with their [parser](../apps/backend/src/productAnalytics/browserVersion.ts), and the
  [automated client marker](../db/migrations/0145_anonymous_client_automated_marker.sql) with its
  [code](../apps/backend/src/productAnalytics/automatedClient.ts)
- [Route registration](../infra/aws/lib/gateways/api-gateway.ts)
- The identity a producer sends: [analytics visitor identity](analytics-visitor-identity.md)
- The facts the catalog install flow reports: [catalog install facts](catalog-install-funnel.md)

## Calling it

Post one event per request to `POST /v1/analytics/anonymous-events` with `credentials: "omit"`;
released web and auth builds still post to `POST /v1/analytics/catalog-install-events`, the same
handler. The collector is origin-restricted rather than authenticated and allows cross-site
requests, so `curl`, smoke scripts and integration harnesses get
`403 ANONYMOUS_ANALYTICS_ORIGIN_NOT_ALLOWED` unless they name an allowed origin in `Origin`, or in
the URL of a `Referer` when they send no `Origin`.

A server-side producer reporting on a browser's behalf forwards that browser's own `User-Agent`
verbatim, because the collector judges `automated_client` from it and keeps nothing to recompute the
verdict; the auth origin's sign-in funnel is that producer
([client](../apps/auth/src/server/analytics/client.ts)).

## Reading these rows

- Every row carries `trust_level = 'anonymous_client'`. Which reads may count people out of these
  rows, and why, is the comment on `buildTrustedActorRowsFilterSql` in
  [`filterSql.ts`](../apps/admin/src/filters/filterSql.ts); which reads judge `automated_client` on
  the row rather than on the actor is the comment on `buildNonAutomatedClientRowsFilterSql` beside
  it.
- A row with no identity resolves to `actor_id` NULL in `analytics.product_events_resolved`: an
  event that belongs to no actor, never a person.
- Every row carries the `country` derived at ingest from the request's address, except an
  `identityFree` event and the auth origin's sign-in rows, which never carry one, and a request whose
  address cannot be placed, which stores NULL. The same rows carry `network_asn`,
  `user_agent_chrome_major` and `client_hint_chromium_major`, each NULL when its source cannot
  supply it.
- A report that excludes automated traffic excludes `automated_client IS TRUE`, never `IS FALSE`.

## Identity-free events

A catalog entry that declares `identityFree` may never be stored beside any identity, on every
ingest: the authenticated ingest refuses it as `invalid_event`, and this collector refuses a claimed
`anonymousId` with `400 ANONYMOUS_ANALYTICS_IDENTITY_NOT_ALLOWED`. The consent prompt and refusal on
both surfaces, and the site's collection switch, are identity-free; the grants are not, and no
consent decision ever carries a `daily_visitor_hash`.

The web producer therefore never queues an identity-free event: it sends one directly in the shape
[`toIdentityFreeAnalyticsWireEvent`](../apps/web/src/analytics/wire.ts) builds. A browser that
refused the identifier keeps reporting through this collector while signed out, and under its
account credential once signed in, carrying no `anonymousId` either way; on the public catalog
import, invite and share routes, where no session layer mounts, its in-memory events go out here
instead ([the branch that reads this](../apps/web/src/analytics/deliveryRuntime.ts)).

The product-analytics off switch is a different decision, enforced on the authenticated batch route
and by the client, never on this collector.

## Manual acceptance

1. Post a valid `consent_prompt_shown` from each configured origin and confirm `200`,
   `{"accepted":true}` and an `X-Request-Id` response header.
2. Repeat the identical `eventId` and confirm exactly one stored row.
3. Post the same event with an `anonymousId` and confirm `400`
   `ANONYMOUS_ANALYTICS_IDENTITY_NOT_ALLOWED` and no stored row.
4. Post `consent_granted` with an `anonymousId` and confirm the stored row carries it.
5. Post a server-only event name, an unknown field, a malformed UUID, a non-UUIDv7 `eventId`, a
   future event time and a body over 8 KiB, and confirm each is refused with no row stored.
6. Post `consent_prompt_shown` to `POST /v1/analytics/events` with a credential and confirm it is
   rejected as `invalid_event` with no row stored.
7. Post a valid body with no `Origin` and no `Referer`, then the same body with a disallowed
   `Origin`, and confirm each is refused with `403 ANONYMOUS_ANALYTICS_ORIGIN_NOT_ALLOWED` and no
   stored row. Post one with `Cookie: session=%` and an allowed `Origin` and confirm it is accepted:
   the route reads no credential. Post one with no `Origin` at all and a `Referer` whose URL is on an
   allowed origin, and confirm it is accepted: the `Referer` stands in for a missing `Origin` here as
   it does on the visitor route.
8. Post to either path with a trailing slash and confirm the `404` names that same path back.
9. Post a released catalog install body to `/v1/analytics/catalog-install-events` and confirm it is
   still accepted and still stores its journey UUID as `anonymous_id`.
10. Read the rows through `reporting_readonly` and confirm every one has null `user_id`,
    `subject_user_id`, `workspace_id`, `guest_session_id`, `session_id` and `auth_transport`.
11. Open the admin dashboard and confirm the Level 1 `Who opened the app` chart and `Audience` are
    unchanged by every row just written, including any `app_opened` posted to this collector.
12. Post three valid events, each with its own fresh `eventId` — step 2 stores only one row per id —
    one with a `HeadlessChrome` `User-Agent`, one with an ordinary Chrome one and one with no
    `User-Agent` header at all, and confirm the stored rows carry `automated_client` TRUE, FALSE and
    TRUE.
13. Post a fourth, with its own fresh `eventId`, with the Chrome `User-Agent` of a Cubot handset —
    `Mozilla/5.0 (Linux; Android 13; CUBOT NOTE 30) ... Chrome/120.0.0.0 Mobile Safari/537.36` — and
    confirm it stores FALSE: the `bot` marker must not fire on a device model.
