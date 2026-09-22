# Anonymous client analytics collector

The credential-free collector for client-reported product analytics. It exists so a signed-out
browser can be measured from its first page view, before any account, guest session or workspace
exists, and so the consent decision itself is reportable before a visitor may be given an identity
at all. Authenticated clients keep batching through `POST /v1/analytics/events`.

- [Route](../apps/backend/src/routes/anonymousAnalytics.ts) and
  [CORS allowlist](../apps/backend/src/server/app.ts)
- [Event contract](../apps/backend/src/productAnalytics/anonymousEvent.ts) and the
  [event catalog](../apps/backend/src/productAnalytics/catalog.ts) it derives from
- [Storage contract](../db/migrations/0143_anonymous_client_identity_free_rows.sql)
- [Route registration](../infra/aws/lib/gateways/api-gateway.ts)
- The identity a producer sends: [analytics visitor identity](analytics-visitor-identity.md)
- The facts the catalog install flow reports: [catalog install facts](catalog-install-funnel.md)

## Paths

`POST /v1/analytics/anonymous-events` is the path to use. `POST /v1/analytics/catalog-install-events`
is the same handler under the name it carried while it accepted only the catalog install funnel;
released web and auth builds still post there and are answered identically. Neither path accepts a
trailing slash, and neither reads or sets a credential: send `credentials: "omit"`.

The collector is origin-restricted rather than authenticated, so the origin is the whole of what
bounds who may write to it. A request whose origin is not on the allowlist is refused with
`403 ANONYMOUS_ANALYTICS_ORIGIN_NOT_ALLOWED`, and so is one that names no origin at all: the origin
is read from `Origin`, or from `Referer` when a navigation sends none, by the same
[helper](../apps/backend/src/auth/requestSecurity.ts) the analytics visitor route and session CSRF
use. That helper throws its own refusals uncoded, and the route relabels them with the same code, so
every rejection it answers with is one CloudWatch and the producers can name. Only those two headers
are read: the route touches no cookie, so a malformed one cannot fail a request here. `curl`, smoke
scripts and integration harnesses therefore get a `403` unless they name an allowed origin, in
`Origin` or, when they send no `Origin` at all, in the URL of a `Referer`: a non-browser caller
sending only an allowed `Referer` is accepted, exactly as it is on the visitor route. The allowlist
is the marketing site, the web app, the auth origin and the three local development origins.

Unlike the visitor route, cross-site requests are allowed: a marketing site that does not share the
API's registrable domain still posts to the API host, so this collector is cross-site by design. The
reference deployment no longer needs that allowance for its own site, which is on the API's domain,
but a self-hosted site on a separate domain does.

## Body

One event per request, `Content-Type: application/json`, at most 8 KiB, strict: an unknown field
rejects the request rather than being dropped. Everything but the event itself is optional, so a
producer that knows nothing of a field simply omits it.

```json
{
  "eventId": "01994c2a-8b5e-7d21-8c43-dbc6e1185b32",
  "eventName": "consent_granted",
  "clientOccurredAt": "2026-09-13T06:30:00.000Z",
  "clientSentAt": "2026-09-13T06:30:00.000Z",
  "anonymousId": "9d1f6f4a-1f5e-44a1-9f3b-0a2f2b0f6f61",
  "uiLocale": "en",
  "deviceLocale": "en-US",
  "properties": {}
}
```

`eventId` is a UUIDv7 and is the retry key: a repeated id is answered `{"accepted":true}` and stores
nothing new. Both timestamps are UTC ISO strings, `clientOccurredAt` cannot be later than
`clientSentAt`, and a queued event can be at most 30 days old. `deviceLocale` and `uiLocale` are
language tags of at most 64 characters. `screen` is a value of the catalog's surface enum, required
exactly for the events whose catalog entry requires one and omitted, as above, by an event that has
no surface: the consent banner is answered before a visitor is anywhere in the product.

`platform` is always stored as `web` and is never a claim the body can make. There is no field for a
session, an app version, a country or an experiment assignment: those belong to an authenticated
installation, which this route by definition does not have.

## Accepted event names

Every catalog entry that is not `serverOnly`, read from the catalog itself rather than from a second
list beside it, as is every other per-event rule the route applies. A name that is server-derived,
retired or unknown is refused with `400`, and so is any property outside the selected event's own
allowlist. That allowlist is what bounds the shape of what can be written on an unauthenticated
route, so it is never relaxed per event; what bounds who may write is the origin check above, and
what bounds how the rows may be read is the trust rule below.

## Identity on the row

`anonymousId` is the shared browser visitor id, and the route verifies nothing about it beyond the
UUID shape — see [why there is no signature](analytics-visitor-identity.md#why-there-is-no-signature).
A producer that sends none leaves `analytics.product_events.anonymous_id` empty. Every current
producer sends it, the catalog install events included. Released catalog install clients are where an
empty column still comes from: they send none and carry a per-attempt journey UUID that lands in it
instead.

The catalog is the single source of truth for what an event requires, and the route does not
override it: every catalog install event declares `install_journey_id` `optional`, so a body omitting
it is accepted rather than refused. That is intended — no producer mints a journey id any more — and
a per-event override on the route would be a second contract beside the catalog.

A row with no identity at all resolves to `actor_id` NULL in `analytics.product_events_resolved`. It
is an event that belongs to no actor, not an event that is missing one, and a query that counts
actors must exclude it rather than treat NULL as a person.

## How these rows are counted

Every row this collector writes carries `trust_level = 'anonymous_client'`, and **a report that
counts people excludes that trust level**. The reading is that an unverified anonymous claim is
evidence an event happened and is not evidence a person exists: no credential stands behind the
request, and `anonymous_id`, which `actor_id` falls back to, is a caller-supplied UUID this route
verifies nothing about beyond its shape.

`daily-active-users` and `Audience` apply it through
[`buildTrustedActorRowsFilterSql`](../apps/admin/src/filters/filterSql.ts), which is where any
further report must take it from; both are documented in [Admin app](admin-app.md). Every other
actor-level derivation over the same view either applies it as well or cannot be reached by this
collector at all, because every event it reads is server-derived or because it carries a trust
predicate of its own. The helper's own comment carries the full list and says which of the two each
entry is, and a remediation is scoped from there rather than from this page. Without the rule, the
collector accepting `app_opened` like every other client-reportable name would make an ordinary
signed-out marketing-site visitor a daily active user, on an append-only table that cannot be
corrected afterwards.

Funnels and event counts over these rows are unaffected: the rule is about counting actors, not about
counting events.

## Identity-free events

A catalog entry may declare `identityFree`, meaning the event may never be stored beside any
identity: no user, subject user, guest session, workspace, session or anonymous id. It is a property
of the event rather than of the route, so it holds on every ingest and for every future producer. The
authenticated ingest refuses such an event outright as `invalid_event`, because every row it writes
is stamped with the caller's identity; this collector refuses a claimed `anonymousId` with
`400 ANONYMOUS_ANALYTICS_IDENTITY_NOT_ALLOWED`; and the writer's catalog assertion is the backstop
for a producer that builds a row directly.

The refusal is not a silent strip: `analytics.product_events` is append-only, so the row could never
be repaired afterwards, and a producer told nothing would believe it had reported something it had
not. A per-request random id in place of the visitor id is not an escape either: it is an identifier
again.

An `identityFree` entry may not declare a property this collector promotes into an identity column,
and the catalog type refuses the combination at compile time rather than at run time. The claimed-id
refusal above does not cover it: nothing is claimed, so the promoted property would reach the
writer's assertion instead and be refused there as a `500` no request could avoid.

## The consent facts

`consent_prompt_shown`, `consent_granted` and `consent_declined` carry no properties and no `screen`:
the name is the whole fact, and the row's own date and locale carry the rest.

`consent_prompt_shown` and `consent_declined` are `identityFree`. An identifier stored beside "this
visitor was asked" or "this visitor refused" is the processing the refusal withholds.

That is why the web producer never queues those two. Every queued event is stamped with the shared
visitor id on its way out, so the only shape either of them can leave in is the direct, unstored one
[`toIdentityFreeAnalyticsWireEvent`](../apps/web/src/analytics/wire.ts) builds. A signed-out browser
that refused keeps reporting through this collector afterwards, and its ordinary events carry no
`anonymousId` either, because there is no longer one to carry. A signed-in one reports on its own
credential instead — those events are the account's — and they carry no `anonymousId` there either
([visitor identity](analytics-visitor-identity.md)). With one exception: a refused browser holds what
it collects in memory rather than in the queue, and on the public routes rendered above
`AuthenticatedApp` — the catalog import, the friend invite, the share page — no session layer ever
mounts, so no credential can become sendable and waiting for one would drop everything with the
document. Those events go out on this collector instead, identity-free like the rest of it.

That exception depends on a fact about those screens rather than on a rule: every link out of them
is a full-document `<a href>`, so no client-side navigation reaches `AuthenticatedApp` within one
document. A react-router `<Link>` from one of them into the app would make "no credential can ever
become sendable" false, and a flush taken there would spend a signed-in refused person's events on
this collector where waiting would have shipped them under their account
([the branch that reads this](../apps/web/src/analytics/deliveryRuntime.ts)).

`consent_granted` may carry the id the grant produced, and so may every other event.

## The marketing site facts

`site_page_viewed` and `site_app_entry_clicked` are what the marketing site reports about its own
pages: a page was viewed, and a link into the web app or an app store was clicked. Their properties
are in the [event catalog](../apps/backend/src/productAnalytics/catalog.ts). Neither is
`identityFree`: like `catalog_install_clicked`, each carries the shared visitor id only once the
visitor has consented, and none before.

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
11. Open the admin dashboard and confirm `daily-active-users` and `Audience` are unchanged by every
    row just written, including any `app_opened` posted to this collector.
