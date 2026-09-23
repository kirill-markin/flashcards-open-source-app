# Analytics visitor identity

One browser visitor identity for the whole product domain, minted by the backend API because the web
app is a static bundle with no server of its own. The auth origin reads this same cookie and mints
none of its own.

| Property | Value |
| --- | --- |
| Cookie name | `analytics_visitor` |
| Scope | `Domain=.<domain>`, `Path=/`, so every host under that domain reads one visitor. Which domain is resolved per request from the caller's `Host` against the `COOKIE_DOMAIN` candidates ([`apps/backend/src/shared/cookieDomain.ts`](../apps/backend/src/shared/cookieDomain.ts)) |
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

The allowlist is this route's own, built in
[`apps/backend/src/server/app.ts`](../apps/backend/src/server/app.ts): the list the shared browser
CORS middleware carries — the web app origin, the admin origin and the two local development
origins — plus the marketing site origin, which is on this route and on no other. The site needs an
identity and has no other way to obtain one, and now that the browser hosts are under `nibomo.com` a
cookie scoped there spans the site and the app; widening the shared list instead would have handed
the site every credentialed route in the API. The API Gateway preflight for the path carries the
same extra origin ([`infra/aws/lib/gateways/api-gateway.ts`](../infra/aws/lib/gateways/api-gateway.ts)),
because the browser's `OPTIONS` is answered at the edge and never reaches the route.

Being on that allowlist is necessary and not sufficient. The `sec-fetch-site: cross-site` refusal
above happens before any allowlist is consulted, so the marketing site obtains an identity only
through the API host on its own registrable domain — `api.nibomo.com` for a site on `nibomo.com`.
The same call to the legacy API host is cross-site and answers `403` however the origin is
allowlisted, and no cookie the legacy host could set would be stored on the site's domain anyway.

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

A guest of the iOS or Android app answers on the same two endpoints, and the answer is kept on the
guest session in `auth.guest_sessions.analytics_consent` instead: the transport picks the column, so
each caller reads and writes whichever of the two they own. Upgrading such a guest into an account
copies a recorded answer onto `org.user_settings.analytics_consent`, unless the account already
holds one of its own ([upgrade](../apps/backend/src/guestAuth/upgrade/index.ts)). A signed-out
browser is not part of this: its guest credential is refused on both endpoints
([refusal](../apps/backend/src/guestAuth/webPlatform.ts)), and its answer stays in the cookie above.

The banner is shown only to a browser that has stored no answer of its own, so the banner on a
public catalog, invite or share route produces a first decision and never a change of one; changing
it there is the withdrawal link's job, and that link appears only once the banner's question has
been answered. The reconciliation already carries the first decision: the account holding none
adopts it at the next sign-in.
The banner writes the account directly only where a verified session owner is published on the load
that answered it, which is inside the authenticated app; on the public routes it records the
browser's answer and nothing else.

The web has no guest upgrade path at all: the credential refused above is refused by guest upgrade
too, so no upgrade ever runs for a browser and nothing is copied in either direction. A browser's
answer reaches an account only through the client sync above, on the terms stated there: an account
that already answered keeps its own answer, and an account that has none adopts the browser's. It is
decided there rather than in an upgrade because the browser's own answer is the record that survives
every account boundary, including the one a person crosses by signing in somewhere they never were a
guest.

A caller whose country cannot be resolved is treated as consent-required, so a browser reaching the
API without an API Gateway source address — the local dev server, for instance — is never minted
without an explicit grant. A browser that blocks cookies gets no persistent identity and no
fallback. The mint answer still carries a fresh id each time, because the server cannot see whether
the browser accepted its `Set-Cookie`. A caller that finds the returned id absent from
`document.cookie` afterwards must therefore treat the identity as unavailable rather than count a
new visitor on every page load.

### The analytics off switch is a second, separate decision

Everything above is one decision: whether this browser may carry the shared `analytics_visitor`
identifier. Refusing it is not refusing analytics. The banner's own copy says so, and a refusing
browser keeps reporting — identity-free while signed out, under the account once signed in.

The second decision is the product-analytics off switch,
`org.user_settings.product_analytics_enabled` and `auth.guest_sessions.product_analytics_enabled`
([migration](../db/migrations/0149_product_analytics_off_switch.sql)). It is on unless a person
explicitly turns it off, because the basis is legitimate interest rather than consent, so NULL —
every row until someone answers — reads as on, and nothing prompts for it. It covers
client-reported product analytics only: error and crash reporting and the server-derived facts in
[`serverFacts/`](../apps/backend/src/productAnalytics/serverFacts/) are outside it.

The two are stored apart and neither is derived from the other, so a person who already refused the
cookie keeps analytics on. Both are read on `GET /v1/me` and written on `PATCH /v1/me/preferences`,
and the transport picks the account column or the guest-session one in the same way for both.

Turning the switch off stops future collection. It deletes nothing: `analytics.product_events` is
append-only, and account deletion stays the erasure path. The backend enforces it at ingest —
[`POST /v1/analytics/events`](../apps/backend/src/routes/productAnalytics.ts) drops an opted-out
credential's batch and still answers `200`, so a client released before the switch existed retires
its queue instead of redelivering. The credential-free collector cannot enforce it and does not try;
see [anonymous client analytics](anonymous-client-analytics.md).

On Android the switch is Settings → Product analytics
([route](../apps/android/feature/settings/src/main/java/com/flashcardsopensourceapp/feature/settings/privacy/ProductAnalyticsRoute.kt)).
The client stores the answer on the device first, so an offline device and a cold start that
precedes any sync both honor it, and delivers it to the account or the guest session on the next
account refresh that finds a credential
([repository](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/account/LocalCloudAccountRepository.kt)).

## Account deletion

The identity survives a logout by design and does not survive the deletion of the account it was
measured alongside. The browser expires the cookie at the moment the server confirms the deletion,
so the next page load finds none, asks the mint route again and continues as a new anonymous
visitor.

Nothing on the server clears it at that moment. `POST /v1/me/delete` answers a bearer caller as
readily as a session one, so an iOS, Android or agent API deletion has no browser on the other end
for a cookie header to reach. The web flow does pass through the auth origin's `/logout-local`
afterwards, which is on this domain and already clears two cookie families of its own, and this one
is deliberately not among them: reaching that route is a navigation the IndexedDB open-recovery
guard can abort the deletion cleanup before, and a browser left stuck on that abort is exactly the
one that must already be rid of the identifier.

So the clear is paired with the confirmation instead, at the two places a browser learns the account
is gone — the deletion it submitted
([gate](../apps/web/src/accountDeletion/AccountDeletionRecoveryGate.tsx)), and the `ACCOUNT_DELETED`
raised by the next `getSession()` after a deletion it dispatched but never saw answered
([lifecycle](../apps/web/src/appData/session/lifecycle/useWorkspaceLifecycle.ts)). Both run
synchronously, before the guard check that follows, so an abort cannot skip either. The load
returning from the logout redirect clears nothing: it has already minted the fresh id this browser
is meant to continue under, and expiring that one would leave the rest of the load reporting under a
per-tab id no later load can see.

The guarantee is therefore per-browser, not per-person: a deletion started on another device cannot
expire this browser's cookie, and no mechanism here claims otherwise. Such a browser keeps its id
until the cookie expires or the person clears it — neither clear above is within its reach, because the
`ACCOUNT_DELETED` it meets has no deletion of its own behind it, and a later sign-in to a different
account is an account switch, which the identity survives like every other boundary.

The stored consent answer is deliberately not cleared with it. It is the browser's answer rather
than the account's — a visitor with no account gives it — and discarding it would return a browser
that refused to undecided, askable and re-mintable again, which is the same thing the kill switch is
kept from doing above.

Already-collected rows are not this cookie's concern: the deletion anonymizes the history attributed
to the person's user ids in the same transaction it removes the account
([account deletion](../apps/backend/src/auth/accountDeletion.ts)). Events reported while signed out
carry none of those ids, so the rewrite — keyed on the user id — never reaches them, and they keep
the `anonymous_id` they were written with whether or not a link to the account was ever recorded for
it. Where one was, the deletion removes the link row, so nothing resolves that `anonymous_id` back to
the account afterwards. What the clear decides is only the identifier this browser reports under from
then on.

## The banner

Where the answer above comes from, on the web: a strip at the bottom of the app, shown only where
`GET` says this browser has to be asked, with `Allow` and `Decline` one click apart on the same
layer. Until it is answered, nothing is written to the device and nothing that names this browser
leaves it — the events wait in memory rather than in the queue, because obtaining a session id or
appending to the queue is itself a write. One row does go out before the answer, and only one:
`consent_prompt_shown`, which is `identityFree` by construction and carries the locale and its date
and nothing else — not even the surface it was shown on. The promise on the strip covers this origin
only: it says that this app stores nothing on this device and sends nothing identifying — not that
nothing at all is sent.
A refusal keeps that shape permanently: the
browser is given no identifier at all, and what it reports is rows carrying none
([anonymous client analytics](anonymous-client-analytics.md)).

The auth origin is inside this gate without a banner of its own, because it mints nothing. Its
server-side sign-in funnel reports under this cookie and reports nothing at all for a browser that
holds none, so a browser this gate withheld an identity from stays unmeasured there too
([sign-in funnel](../apps/auth/src/server/analytics/signInFunnel.ts)). The one cookie it writes is
the host-only `__Host-analytics_guest`, a guest credential it sets only for a browser that already
holds this id; a leftover one is read by nothing that reports and is deleted by the next sign-in or
sign-out.

A signed-in person who refuses is the one case where rows still carry a name, and it is the
account's rather than the browser's: their events go out on their own credential and are stored
under their `user_id`, with no `anonymous_id` and no session id, straight from memory. Nothing is
queued and nothing is written to the device, including the analytics database itself — the queue
owner claim the session layer would make is deferred until this browser is allowed one, and a
refusal that finds no store never opens one.

"Finds no store" is the load-bearing part, and it is not the same as "cannot see one". Firefox
implements no `IDBFactory.databases()`, so on it the question has no answer, and the two readings
part company: a browser that was never allowed an identity is left alone, because opening the store
is what creates it and that browser was promised nothing would be written to it; a browser that was
allowed one — it granted, or it holds the visitor cookie — is opened and emptied, because leaving a
previous load's identity-bearing queue on disk through a withdrawal keeps exactly what the person
just asked to be rid of. Creating an empty database on such a browser is the smaller cost of the
two.

The stored browser answer shares the `flashcards-analytics-enabled` key with the operator kill
switch rather than sitting beside it, and the switch carries the answer across itself in both
directions: a browser that refused stays refused when an operator turns analytics off and on again,
instead of returning to undecided and becoming askable and mintable in between.

The withdrawal control is the same switch on two surfaces, and it is offered in every region, not
only where the banner is shown, because the published privacy policy states withdrawal without a
regional qualifier. A signed-in person has it on the settings screen at `/settings/analytics`, which
is the route the privacy policy names ("in the web app settings"). The public catalog, invite and
share routes carry it as a link in the corner, so a visitor who answered the banner there and has no
account takes the answer back where it was given rather than by clearing browser storage.

The public surface is a link rendering the switch in place, not a second route onto the settings
screen. `/settings/analytics` is served by `AuthenticatedApp`, so a signed-out visitor opening it is
redirected to the auth origin, and a route declared above `AuthenticatedApp` to fix that would win
for everyone and take the settings screen away from the signed-in person it already serves.

The public link carries the answer to the account on the same terms as the banner does from the same
position above the app data provider: it reads the verified owner from the analytics runtime, which
is module-level state outliving the session layer, so a person who signed in and then reached a
public route writes both records there. Without that write an account holding `granted` would undo
the withdrawal at the next verified session. A visitor who never signed in publishes no owner, and
the browser's own decision is the whole write.

Consent is not retroactive either way. What a browser collected while a refusal stood is discarded
when it later grants, rather than adopted into the queue and stamped with the visitor id the grant
has just minted.

- [Consent state, and what it allows](../apps/web/src/analytics/consent.ts)
- [Banner](../apps/web/src/analytics/AnalyticsConsentBanner.tsx), the shared
  [withdrawal switch](../apps/web/src/analytics/AnalyticsConsentToggleCard.tsx), its
  [settings surface](../apps/web/src/screens/settings/AnalyticsSettingsScreen.tsx) and its
  [public-route link](../apps/web/src/analytics/PublicAnalyticsConsentLink.tsx)
- [The gate the delivery runtime applies](../apps/web/src/analytics/deliveryRuntime.ts)
