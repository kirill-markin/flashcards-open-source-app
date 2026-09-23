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
([web sync](../apps/web/src/analytics/accountAnalyticsPreferences.ts)).

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
and the transport picks the account column or the guest-session one in the same way for both. They
are reconciled with the account on different terms: the consent answer follows the account, while
the off switch crosses in either direction only toward less collection, so an account holding `true`
never re-enables a browser that has turned it off
([web sync](../apps/web/src/analytics/accountAnalyticsPreferences.ts)).

Turning the switch off also stops this browser asking for the shared identifier: the id exists only
to attribute product-analytics rows, so a web client with the switch off mints no new cookie, on any
tick or connectivity change, and asks again only when the switch goes back on. A cookie it already
carries is left alone. A cookie grant given while the switch is off is recorded for the browser and
carried to the account as any other grant is — it is an answer, not a failure — and only its mint
waits for the switch. What is owed is read rather than remembered: a stored `granted`, no visitor
cookie and no identity settled yet is a browser owing that `POST`, so the switch going back on, any
later page load, an `online` event and the periodic tick each reattempt it — the `online` event and
the periodic tick under a minimum spacing, so a failing browser does not ask a route that can pay a
GeoLite download once a minute, while the switch going back on drops that window and a new page load
starts with none — and an attempt that fails is not lost with the page that made it. While a mint is
owed nothing answers it with the plain `GET` instead, not even a tick the spacing is still holding
back: that `GET` settles the identity for a browser the server holds no consent record for, which
would end the owed mint for the rest of the load and degrade a granting browser to the per-tab id.

On the device the off switch takes everything it finds: the stored queue, the owner record naming
the account that claimed it, the events held in memory, and the stored session id. The owner record
is released here and deliberately not on the operator kill switch, which leaves a browser that is
measurable again the moment an operator turns analytics back on, where this one leaves a person who
asked to be measured no more. It matters most on a fresh browser signing into an account that
already holds `false`: the claim that creates the analytics database runs before the account answer
arrives and is legitimate when it does, so without the release such a browser would end the load
holding an analytics store naming an account that opted out.

Turning the switch off stops future collection. It deletes nothing already stored, and nothing
later erases it either: account deletion anonymizes those rows in place
([account deletion](../apps/backend/src/auth/accountDeletion.ts)), as the section below describes.
The backend enforces the switch at ingest —
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

### Neither answer is overwritten by a client reconciling an older one

Both decisions above are stored on an account that several devices read and write, and neither
column carries a timestamp, so two answers that disagree cannot be ordered. A device that read the
account before a withdrawal taken on another device would otherwise carry its older answer back in
silently, on every device the account has — undoing the off switch resumes collection outright,
because ingest reads that column, while undoing a cookie refusal restores the shared identifier and
nothing else, exactly as the two sections above keep them apart.

`PATCH /v1/me/preferences` therefore takes an optional origin beside each of the two values,
`analyticsConsentOrigin` and `productAnalyticsEnabledOrigin`, each `user_action` or
`reconciliation` ([route](../apps/backend/src/routes/system/account/accountPreferences.ts)). A
`reconciliation` is a client carrying over an answer it read somewhere earlier; `user_action` is the
person answering on the client that sends it. Two fields rather than one, because a single PATCH can
carry a person's press on one decision and a reconciled answer on the other, and one shared origin
would have to be wrong about one of them.

On an account, and on the account columns only, a reconciliation cannot loosen a stored refusal: a
stored `analytics_consent = 'declined'` survives a `reconciliation` `granted`, and a stored
`product_analytics_enabled = FALSE` survives a `reconciliation` `TRUE`. Everything else is stored as
sent. A `user_action` always wins, so both switches stay reversible by the control that moved them.
A reconciliation in the restrictive direction is stored too, because under-collection is the
direction to err in against an append-only table. And a column still holding NULL — nobody has
answered on this account — adopts whatever arrives including a reconciled answer, which is the only
way an answer given before signing in ever reaches the account. The route answers with what is
stored after the write, so a client whose value was refused learns the stored one from its own write
rather than from a later read.

Omitting an origin means `user_action`, which is what every client sent before the fields existed,
so a released client keeps exactly the behaviour it was written against.

The guest-session copies of both columns are not guarded
([guest write](../apps/backend/src/guestAuth/store/session.ts)). A guest session row is reachable
only by the credential that owns it, and that credential lives on one device, so there is no second
writer here for the guard to order an answer against. `product_analytics_enabled` is written this
way by the iOS and Android off switches, which fall back to the guest credential when the install
has no account to store the answer on. `analytics_consent` has no client writer on the guest row at
all: it is the cookie question, asked only where there is a cookie banner, and the only guest
credential a browser can hold is a `web` one, which is refused before the route by the default-deny
platform gate ([web guest gate](../apps/backend/src/guestAuth/webPlatform.ts)). That was true on
2026-09-23 and stops being true the day a mobile surface asks the cookie question.

What one writer does not settle is where that writer got the value. A device can write a value it
merely adopted somewhere else — off an account it has since signed out of, among them — and on
`product_analytics_enabled` republishing such an answer over a stricter stored one resumes ingest
immediately rather than only restoring an identifier. So the rule for this column is about
provenance, not about which client is speaking: a client that reconciles a guest column from a
remembered value rather than a live read has to send an origin here too, and the guard has to move
to the guest path with it.

The guest upgrade cannot revert an account answer on either column: both carries write only where
the account column is still NULL ([upgrade](../apps/backend/src/guestAuth/upgrade/index.ts)).

The web sends both origins, and it is the only client that writes `analytics_consent` at all. Its
one reconciliation — the carry described in the two sections above, and the only write in the client
that is not a person pressing something — names itself `reconciliation` on both fields
([web sync](../apps/web/src/analytics/accountAnalyticsPreferences.ts)). On the collection column
that carry can only ever be an opt-out, which the guard permits anyway; the field is still sent,
because it says who asked rather than what was asked for.

Every other write of either column omits the origin and takes the `user_action` default. On the web
those are the controls a person presses: the analytics settings screen, the consent banner, and the
public panel with its off switch and its withdrawal link. The iOS and Android off switches store the
answer on the device first and owe it to an identity until that identity acknowledges it, so what
they send is an answer a person gave on that device, delivered late rather than reconciled. Neither
mobile client writes `analytics_consent` at all.

Late delivery is where that default stops being free, and this one is a gap rather than a settled
contract. The debt outlives the process and carries no clock, so an owed answer can be retried
against a column another surface has moved in the meantime, in either direction: turn the switch on
on a phone that is offline, turn it off on the web days later, and the phone's retry arrives as
`user_action`, which the guard is required to honor, and ingest resumes on the account. On Android
it is not even a race, because the owed answer is pushed before `/me` is read, so the newer value
cannot be seen first. Closing this is client work and nothing here does it today: a client must name
a retried owed answer `reconciliation`, keeping `user_action` for the press that created the debt.
Until one does, the guard defends `product_analytics_enabled` against a reconciliation that says so
and not against a stale answer that calls itself a press — and this is the column where that means
collection restarts rather than an identifier coming back.

On iOS the identity a debt is owed to can also change without anyone answering again. Adopting a
server answer re-owes a device-given answer to an identity that reported none of its own, and an
identity reset re-owes it to the guest credential
([iOS preference](../apps/ios/Flashcards/Flashcards/Analytics/ProductAnalyticsPreference.swift)), so
an answer given under one account can be delivered to another. Two things bound that. The value is
always one a person gave on this device and never a mirror, because a reported answer is stored only
on the branch where nothing was answered here and that branch arms no debt. And the account it is
redirected onto is one that reported no answer, so the write lands on a NULL column, which adopts
any origin anyway — it bites only if that account was answered between the read and the `PATCH`.

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

Neither stored answer is cleared with it. They are the browser's answers rather than the account's —
a visitor with no account gives them — and discarding them would return a browser that refused to
undecided, askable and re-mintable again, which is the same thing the kill switch is kept from doing
above, and a browser that turned product analytics off to unanswered, which reads as on.

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

Everything on this page is one decision, and it is not the decision to be measured. Whether the
person is measured at all is `productAnalyticsEnabled`, a separate answer on the same two endpoints
with its own switch beside this one, and the two are never read into each other: somebody who
refused the cookie keeps analytics on, exactly as the banner copy told them, and no stored refusal
here is ever migrated into that field
([web decision](../apps/web/src/analytics/productAnalyticsCollection.ts)).

The cookie withdrawal control is the same switch on two surfaces, and it is offered in every region,
not only where the banner is shown, because the published privacy policy states withdrawal without a
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
- [The separate product-analytics decision](../apps/web/src/analytics/productAnalyticsCollection.ts)
  and its [switch](../apps/web/src/analytics/ProductAnalyticsCollectionToggleCard.tsx)
- [Banner](../apps/web/src/analytics/AnalyticsConsentBanner.tsx), the shared cookie
  [withdrawal switch](../apps/web/src/analytics/AnalyticsConsentToggleCard.tsx), its
  [settings surface](../apps/web/src/screens/settings/AnalyticsSettingsScreen.tsx) and its
  [public-route link](../apps/web/src/analytics/PublicAnalyticsConsentLink.tsx)
- [The gate the delivery runtime applies](../apps/web/src/analytics/deliveryRuntime.ts)
