# Analytics visitor identity

One browser visitor identity for the whole product domain, minted only by the backend API because the
web app is a static bundle with no server of its own. The auth origin reads the same cookie and mints
none of its own, so `app.` and `auth.` measure one visitor.

| Property | Value |
| --- | --- |
| Cookie name | `analytics_visitor` |
| Scope | `Domain=.<domain>`, `Path=/`; the domain is resolved per request from the caller's `Host` against the `COOKIE_DOMAIN` candidates ([`cookieDomain.ts`](../apps/backend/src/shared/cookieDomain.ts)) |
| Attributes | `Secure`, `SameSite=Lax`, no `HttpOnly` |
| Value | A plain random UUID, unsigned; the server validates the shape only |
| Lifetime | 13 months, re-stamped on every call that returns an id. The web app calls only when it finds no readable cookie, so a web visitor id expires 13 months after it was minted |
| Sessions | Not carried here; each client rotates its own under the shared 30-minute rule |

- [Cookie mint, read and clear](../apps/backend/src/analyticsVisitor/cookie.ts), including why it is
  unsigned
- [`GET`/`POST /v1/analytics/visitor`](../apps/backend/src/routes/analyticsVisitor.ts), its
  [origin allowlist](../apps/backend/src/server/app.ts) and
  [gateway preflight](../infra/aws/lib/gateways/api-gateway.ts)
- [Consent jurisdictions](../apps/backend/src/analyticsVisitor/consentJurisdiction.ts), the
  [caller country lookup](../apps/backend/src/geolocation/requestCountry.ts) and
  [GeoLite operations](geolite-country.md)
- Web: [identity, session rotation and the browser-side cookie writes](../apps/web/src/analytics/identity.ts),
  [identity resolution](../apps/web/src/analytics/visitorIdentity.ts),
  [consent state](../apps/web/src/analytics/consent.ts) and
  [the gate the delivery runtime applies](../apps/web/src/analytics/deliveryRuntime.ts)
- Auth: [the shared-cookie reader](../apps/auth/src/server/analytics/visitorSession.ts) and
  [sign-in funnel](../apps/auth/src/server/analytics/signInFunnel.ts)
- What an event carrying the id is sent to: [anonymous client analytics](anonymous-client-analytics.md)

## Route contract

- `GET` answers `consentRequired`: must this browser be asked before it may be given an identity. A
  browser already holding the cookie is answered `false`, because the cookie is the record that it
  was allowed one. Otherwise the id is minted only where the caller's country requires no consent,
  and an unresolved country counts as requiring it.
- `POST {"granted": boolean}` is the only call that records a grant. There `consentRequired`
  reports the jurisdiction, not whether the banner is still needed: the grant succeeded exactly when
  the answer carries a `visitorId`. A decline clears the cookie and stores nothing on the server.
- `visitorId` is returned whether or not the browser kept the `Set-Cookie`, so a caller treats the
  identity as present only when it reads the cookie back; otherwise a cookie-blocking browser would
  count as a new visitor on every page load.
- Every method is origin-restricted rather than authenticated: a `sec-fetch-site: cross-site` request
  is refused before the allowlist is consulted, and so is a request with neither `Origin` nor
  `Referer`.

Testing it: plain `curl`, smoke scripts and harnesses get `403` unless they send an allowed `Origin`.
A locally-run web app pointed at the deployed API is cross-site and refused even though the CORS
preflight passes; point it at a local backend instead.

## Consent gate

- Where consent is required, until the browser answers nothing identifying or collected is written
  to the device — the analytics database is not even created — and nothing that names this browser
  leaves it. A refusal keeps that for the browser: it is given no identifier, and nothing analytics
  collects is written to the device
  ([`isAnalyticsDeviceStorageAllowed`](../apps/web/src/analytics/deliveryRuntime.ts)). The one
  exception to the device rule is the product-analytics answer, a necessary setting: an explicit one
  is stored and shared with auth as soon as it is given, and only the default-on value waits for the
  question to settle ([when](../apps/web/src/analytics/productAnalyticsCollection.ts)). The auth
  origin stays inside this gate without a banner of its own, because it mints nothing and reports
  nothing for a browser that holds no cookie.
- Refusing the identifier is not refusing analytics. What a refusing browser reports, and the
  identity-free `consent_prompt_shown` the banner sends before any answer, is in
  [identity-free events](anonymous-client-analytics.md#identity-free-events).
- The route keeps no record of a refusal, and `GET` mints wherever consent is not required. A
  refusal therefore holds only through the stored answers, which is why the browser's answers
  survive a logout, a local data clear and an account deletion
  ([`browserSessionRecovery.ts`](../apps/web/src/appData/session/browserSessionRecovery.ts)).
- The published privacy policy promises withdrawal "in the web app settings" with no regional
  qualifier. The one [switch](../apps/web/src/analytics/AnalyticsConsentToggleCard.tsx) is therefore
  offered in every region: at `/settings/analytics`
  ([screen](../apps/web/src/screens/settings/AnalyticsSettingsScreen.tsx)) for a signed-in person,
  and as a [corner link](../apps/web/src/analytics/PublicAnalyticsConsentLink.tsx) on the public
  catalog, invite and share routes. The [banner](../apps/web/src/analytics/AnalyticsConsentBanner.tsx)
  asks on both.

## Two separate decisions

The cookie consent decides only whether this browser may carry `analytics_visitor`. The
product-analytics off switch decides whether the person is measured at all; it is on unless turned
off, because the basis is legitimate interest. Neither is ever derived from the other, so a person
who refused the cookie keeps analytics on
([column contracts](../db/migrations/0149_product_analytics_off_switch.sql)).

| | Cookie consent | Off switch |
| --- | --- | --- |
| Account | `org.user_settings.analytics_consent` | `org.user_settings.product_analytics_enabled` |
| Guest session | `auth.guest_sessions.analytics_consent`, which no client writes | `auth.guest_sessions.product_analytics_enabled`, written by the iOS and Android off switches |
| Signed-out browser | Browser storage only; the web guest credential is refused on both endpoints ([gate](../apps/backend/src/guestAuth/webPlatform.ts)) | Browser storage and the shared collection cookie below |
| Clients that write it | Web only: no mobile surface asks the cookie question | Web, iOS and Android |

Both are read on `GET /v1/me` and written on `PATCH /v1/me/preferences`, where the transport picks
the account or the guest-session column
([route](../apps/backend/src/routes/system/account/accountPreferences.ts)). A guest upgrade copies a
recorded answer only onto an account column still holding NULL
([upgrade](../apps/backend/src/guestAuth/upgrade/index.ts)). Where the off switch is enforced:
[anonymous client analytics](anonymous-client-analytics.md#identity-free-events).

### Write origin

Each analytics field on that `PATCH` carries its own origin, the same rule on every client:
`user_action` for the press being handled now, the default when omitted, and `reconciliation` for any
later delivery of an answer the client is carrying, however recent or often retried. On the account
columns a `reconciliation` never loosens a stored refusal; the route owns that rule and why the guest
columns are unguarded. Each client's reconciliation:

- Web: the account answer wins where both exist, an account holding none adopts the browser's, and
  the off switch crosses in either direction only toward less collection
  ([`accountAnalyticsPreferences.ts`](../apps/web/src/analytics/accountAnalyticsPreferences.ts))
- iOS: the answer given on the device wins on the device
  ([`ProductAnalyticsPreference.swift`](../apps/ios/Flashcards/Flashcards/Analytics/ProductAnalyticsPreference.swift),
  [delivery](../apps/ios/Flashcards/Flashcards/Cloud/Store/Account/FlashcardsStore+AccountPreferences.swift))
- Android: the same rule
  ([repository](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/repository/cloudsync/account/LocalCloudAccountRepository.kt),
  [store](../apps/android/data/local/src/main/java/com/flashcardsopensourceapp/data/local/cloud/CloudAccountPreferencesStore.kt))

### Shared collection cookie

The web app shares its effective off-switch answer with the auth origin in the non-identifying
`product_analytics_collection` cookie: `1` for on, `0` for off, with the visitor cookie's domain,
`Path=/`, `SameSite=Lax` and lifetime, `Secure` on HTTPS. Only the web writes it
([writer](../apps/web/src/analytics/sharedCollectionPreference.ts),
[when](../apps/web/src/analytics/productAnalyticsCollection.ts)). Auth reports only when it reads `1`
and holds a shared visitor id, so a missing or invalid value and a direct auth-first visit are
unmeasured. The web login URL also carries `analytics_collection=off` while collection is off, which
the login page forwards as `X-Product-Analytics-Enabled: 0`; that header can only deny collection
([login URL](../apps/web/src/api/authUrls.ts),
[auth check](../apps/auth/src/server/analytics/visitorSession.ts)).

## Account deletion

The identity survives a logout and an account switch, and ends in this browser when the browser
confirms the deletion of the account it was measured alongside, so the next load continues as a new
visitor. The server never clears the cookie, because `POST /v1/me/delete` also serves bearer callers
with no browser behind them. The browser expires it at the two places it learns the account is gone
([gate](../apps/web/src/accountDeletion/AccountDeletionRecoveryGate.tsx),
[lifecycle](../apps/web/src/appData/session/lifecycle/useWorkspaceLifecycle.ts)). The guarantee is
per browser: a deletion started on another device cannot reach this browser's cookie. Rows already
collected are anonymized by the deletion itself
([account deletion](../apps/backend/src/auth/accountDeletion.ts)).
