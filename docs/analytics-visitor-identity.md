# Analytics visitor identity

One browser visitor identity for the whole product domain, minted by the backend API because the web
app is a static bundle with no server of its own. The auth origin keeps its own host-only visitor
cookie and is not part of this one.

| Property | Value |
| --- | --- |
| Cookie name | `analytics_visitor` |
| Scope | `Domain=.<base domain>`, `Path=/`, so every host under the product domain reads one visitor |
| Attributes | `Secure`, `SameSite=Lax`, no `HttpOnly`: browser code has to read the id to attach it to events |
| Lifetime | 13 months, extended on every call that returns an id |
| Value | A plain random UUID, unsigned. No secret is involved and the server validates the shape only |
| Sessions | Not carried here. Each client rotates its own session under the shared 30-minute rule |

Minted by: the backend API Lambda only. The one write a browser makes itself is the web app
adopting the `anonymous_id` earlier builds kept in `localStorage`, and it makes it only after this
route has already given that browser an identity on the same call, so what may hold one stays
decided here.

The lifetime above extends only on a call, and the web app calls only when it finds no readable
cookie: it never asks again for a browser that already holds one. So a web visitor id expires 13
months after it was minted, not 13 months after the browser was last seen. The re-stamp exists for
the clients that do ask on every visit.

- [Cookie mint, read and clear](../apps/backend/src/analyticsVisitor/cookie.ts)
- [Consent jurisdictions](../apps/backend/src/analyticsVisitor/consentJurisdiction.ts)
- [`GET`/`POST /v1/analytics/visitor`](../apps/backend/src/routes/analyticsVisitor.ts)
- [Caller country lookup](../apps/backend/src/geolocation/requestCountry.ts) and
  [GeoLite operations](geolite-country.md)
- [Route registration](../infra/aws/lib/gateways/api-gateway.ts)
- [Web client identity, session rotation and the one-time adoption](../apps/web/src/analytics/identity.ts)

## Which origins can obtain it

Every method on the route refuses a request another site could have driven. A request marked
`sec-fetch-site: cross-site` is rejected, and the `Origin` — or the `Referer`, when a navigation
sends no `Origin` — must be on the allowlist the route is built with. That is the check already used
for session requests,
[`enforceAllowedBrowserOrigin`](../apps/backend/src/auth/requestSecurity.ts). CORS alone does not do
this: `cors()` adds response headers and never refuses a request, so the handler runs either way.

Two things the guard stops. A cross-site top-level `GET` navigation is the case `SameSite=Lax` does
let the minted cookie be stored from, so one link or redirect would otherwise plant a 13-month
identity on a visitor who never saw a banner. And `POST` is unauthenticated and has a server-side
effect of its own: a cross-site `{"granted": false}` reaches `clearAnalyticsVisitor`, whose deletion
`Set-Cookie` carries no explicit `SameSite` at all, unlike the explicit `Lax` on the mint.

The allowlist is the one the shared browser CORS middleware in
[`apps/backend/src/server/app.ts`](../apps/backend/src/server/app.ts) already carries: the web app
origin, the admin origin and the two local development origins. The marketing site is deliberately
not on it: it is on a different registrable domain, so it could not share a cookie scoped to the
product base domain even if CORS allowed it. It joins when the product moves onto its domain, and
not before.

The two local origins serve the ordinary local setup, a local web app calling a local backend, which
is same-site and unaffected. A locally-run web app pointed at the **deployed** API is a different
registrable site, so the browser marks the request `sec-fetch-site: cross-site` and the route refuses
it even though CORS preflight succeeds. That is intended, and the session path already behaves the
same way for unsafe methods.

A request carrying neither `Origin` nor `Referer` is refused as well, which is every plain `curl`,
smoke script and integration harness. That is deliberate and has no exemption: this route exists
only to hand a browser a cookie, and a browser names its origin on the cross-origin call the web app
makes. Test it from a browser, or send an allowed `Origin` header with the request: the check reads
the headers, so a non-browser caller that sends one passes it.

## Why there is no signature

The value grants no authority. The analytics ingest route accepts any `anonymousId` a caller sends
without verifying it, so a signature here would protect a value the very next hop takes on trust, and
it would mean handing this function a signing key it has no other use for.

The consequence is stated rather than mitigated: any sibling host under the base domain can overwrite
`analytics_visitor`, and a planted value that is a syntactically valid UUID is accepted as this
browser's id. The UUID shape check is the only thing standing in the way, and nothing available to a
cookie can tell the two writers apart.

## Consent

On `GET`, `consentRequired` answers "must this browser be asked before it may be given an identity".
A browser that already holds the cookie is answered `false` without a country lookup, because the
cookie is itself the record that it was allowed one.

On `POST` the same field means something narrower: it reports the jurisdiction answer for the
caller's country, not whether this browser still has to be asked. It is computed the same way on
every call and returned unchanged beside a freshly minted id, so a granting EU browser is answered
`{ "consentRequired": true, "visitorId": "..." }` on the grant itself and `false` on the very next
`GET`. A client must not read `true` there as "the banner is still needed": on `POST` the grant
succeeded exactly when the answer carries a `visitorId`.

`GET` never records a grant, only `POST` does. That is defence in depth rather than the defence:
what stops another site from planting an identity on a visitor who never saw a banner, or from
forcing the decline branch and wiping the id of one who did, is the origin check above. A grant
reachable through a safe method would additionally sit one link or redirect away from any page,
which is why it stays on `POST`.

A signed-in person's own answer is kept on the account in `org.user_settings.analytics_consent`,
read on `GET /v1/me` and written on `PATCH /v1/me/preferences`
([route](../apps/backend/src/routes/system/account/accountPreferences.ts)), so it travels with the
person to another browser or device. The cookie stays the per-browser record, and the two are
reconciled at sign-in by the client rather than by either store: the account answer wins where both
exist, and an account that has none adopts the browser's
([web sync](../apps/web/src/analytics/accountConsent.ts)).

That client sync is also what carries a guest's answer through the upgrade to an account. The
upgrade copies no preference columns and deletes the guest row
([upgrade](../apps/backend/src/guestAuth/upgrade/index.ts)), so the account arrives with no decision
and adopts the one the browser is still holding. It is decided there rather than in the upgrade
because the browser's own answer is the record that survives every account boundary, including the
one a person crosses by signing in somewhere they never were a guest.

A caller whose country cannot be resolved is treated as consent-required, so a browser reaching the
API without an API Gateway source address — the local dev server, for instance — is never minted
without an explicit grant. A browser that blocks cookies gets no persistent identity and no
fallback. The mint answer still carries a fresh id each time, because the server cannot see whether
the browser accepted its `Set-Cookie`. A caller that finds the returned id absent from
`document.cookie` afterwards must therefore treat the identity as unavailable rather than count a
new visitor on every page load.

## The banner

Where the answer above comes from, on the web: a strip at the bottom of the app, shown only where
`GET` says this browser has to be asked, with `Allow` and `Decline` one click apart on the same
layer. Until it is answered, nothing is written to the device and nothing that names this browser
leaves it — the events wait in memory rather than in the queue, because obtaining a session id or
appending to the queue is itself a write. One row does go out before the answer, and only one:
`consent_prompt_shown`, which is `identityFree` by construction and carries the surface, the locale
and its date and nothing else. That is the honest reading of the promise on the strip, which says
that nothing is stored on this device and nothing identifying is sent — not that nothing at all is.
A refusal keeps that shape permanently: the
browser is given no identifier at all, and what it reports is rows carrying none
([anonymous client analytics](anonymous-client-analytics.md)).

A signed-in person who refuses is the one case where rows still carry a name, and it is the
account's rather than the browser's: their events go out on their own credential and are stored
under their `user_id`, with no `anonymous_id` and no session id, straight from memory. Nothing is
queued and nothing is written to the device, including the analytics database itself — the queue
owner claim the session layer would make is deferred until this browser is allowed one, and a
refusal that finds no store never opens one.

The stored browser answer shares the `flashcards-analytics-enabled` key with the operator kill
switch rather than sitting beside it, and the switch carries the answer across itself in both
directions: a browser that refused stays refused when an operator turns analytics off and on again,
instead of returning to undecided and becoming askable and mintable in between.

The withdrawal control is in the app's settings in every region, not only where the banner is shown,
because the published privacy policy states withdrawal without a regional qualifier.

- [Consent state, and what it allows](../apps/web/src/analytics/consent.ts)
- [Banner](../apps/web/src/analytics/AnalyticsConsentBanner.tsx) and
  [settings entry](../apps/web/src/screens/settings/AnalyticsSettingsScreen.tsx)
- [The gate the delivery runtime applies](../apps/web/src/analytics/deliveryRuntime.ts)
