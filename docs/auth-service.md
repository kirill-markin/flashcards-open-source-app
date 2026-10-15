# Auth Service (`apps/auth/`)

Email + OTP authentication via AWS Cognito (passwordless).

- `AUTH_MODE`: `none` (local dev, no auth) or `cognito` (verify JWT from `Authorization: Bearer`)
- Account identity: an account's `user_id` is a surrogate identifier the product owns, and
  `auth.user_identities` maps a Cognito subject to it. The two are not required to be equal, and the
  id is not derived from the subject; the column rule lives in
  `db/migrations/0159_surrogate_user_identity.sql`. Where a mapping row exists, its `user_id` is the
  account id.
  - A new account gets a minted id. An account that already exists keeps the id it has, the subject
    itself included, and is never rewritten onto a new one.
  - An account can have an `org.user_settings` row and no `auth.user_identities` row until something
    binds one. Readers resolve such an account by subject, and provisioning paths adopt it under its
    existing id and bind it rather than mint a second account.
  - An account is created by whichever path first sees the subject, so no path may assume it is the
    first, and every one of them adopts an account that already exists rather than minting a second.
    The first authenticated backend request (`apps/backend/src/auth/ensureUser.ts`) and an agent API
    key or OAuth/MCP connection (`apps/auth/src/server/agent/userWorkspace.ts`) are two such paths;
    a guest upgrade (`apps/backend/src/guestAuth/upgrade/`) is another, and it binds the subject to
    the id the guest session had already minted. A path that mints an id for a subject binds the
    subject to it in the same transaction, and every path that creates or binds takes one advisory
    lock keyed by the subject, so only one of them ever gets to create.
  - This service refuses a subject in `auth.deleted_subjects` with `410 ACCOUNT_DELETED`, the code
    the backend answers it with, before it resolves, adopts, or creates an account for it.
- Guest sessions (`POST /v1/guest-auth/session`) are bound to `ios`, `android`, or `web`. A `web`
  guest session is an analytics credential only, sent as `Authorization: Guest <token>` to
  `POST /v1/analytics/events` alone. It is requested by the browser, lazily on a signed-out
  visitor's first real interaction. This service requests none of its own: its sign-in funnel posts
  to the credential-free collector instead (`Login funnel analytics` below).
  - The route's own ingest contract lives in the source:
    `apps/backend/src/routes/productAnalytics.ts` owns its HTTP surface, accepted transports,
    and the `accepted`/`rejected` envelope; `apps/backend/src/productAnalytics/validation.ts`
    owns batch and per-event validation and the rejection reasons;
    `apps/backend/src/productAnalytics/catalog.ts` owns the frozen event catalog and property
    specs every client mirrors; `apps/backend/src/productAnalytics/writer.ts` owns the
    analytics connection pool and its `429 ANALYTICS_WRITER_BUSY`.
  - `apps/backend/src/guestAuth/webPlatform.ts` is the single gate. Every authenticated route builds
    its context through `loadRequestContextFromRequest`, which refuses a `web` guest platform with
    `403 GUEST_WEB_PLATFORM_UNSUPPORTED` unless the route opts in; analytics ingest is the only
    caller that does. The chat surface repeats the check because it spends AI quota, and the chat
    live stream Lambda applies it on its own auth path.
  - Guest upgrade takes the token from the request body, so it enforces the same rule against the
    loaded session record and answers `403 GUEST_UPGRADE_WEB_PLATFORM_UNSUPPORTED`.
  - Only the literal `web` is refused. A `null` platform is a pre-1.7.0 iOS/Android guest session and
    keeps every guest surface it has today.
  - `POST /v1/guest-auth/session` and `POST /v1/guest-auth/session/delete` stay open to it: they are
    the credential's own lifecycle and authenticate outside the request-context loader.
  - `POST /v1/guest-auth/identity/link` is authenticated as the signed-in account and takes the guest
    token from its body, so it accepts a `web` guest. It links that guest identity to the account for
    analytics and revokes the guest session. An unknown or already-revoked token is a successful
    no-op, and so is a guest session that already belongs to the signed-in account after a bound
    upgrade: that credential is neither linked nor revoked. Like the upgrade routes it does not load a
    request context, so it applies the `410 ACCOUNT_DELETED` gate itself, and it resolves the account
    user id from `auth.user_identities` in its own transaction rather than trusting the id on the
    request.
    - Client ordering obligation: the account's `auth.user_identities` row is written by the first
      request that loads a request context after sign-in, such as `GET /v1/me`. Nothing sequences
      that for you. Await one such call before calling this route; two requests fired in parallel
      right after a first-ever sign-in can let the link reach the database first.
    - Upgrade ordering obligation: never send a guest token here that may still need
      `POST /v1/guest-auth/upgrade/prepare` or `POST /v1/guest-auth/upgrade/complete`. This route
      revokes the guest session, and both upgrade routes refuse a revoked token with
      `401 GUEST_AUTH_INVALID`: `prepare` rejects it outright, and `complete` looks for an
      `auth.guest_upgrade_history` replay row and finds none for a session that was never upgraded.
      No data is lost, because a guest that owns anything is refused below with
      `409 GUEST_IDENTITY_LINK_UPGRADE_REQUIRED` rather than revoked, but that token's upgrade path
      is gone. Run the upgrade flow first, or reserve this route for guest credentials that exist
      only to authenticate analytics.
    - `409 GUEST_IDENTITY_LINK_ACCOUNT_REQUIRED` means exactly that ordering has not happened yet, and
      it is retryable rather than terminal. Keep the guest token, complete a request-context call, and
      call again. Never drop the guest token on this code: that guest's whole analytics tail goes with
      it, permanently.
    - `409 GUEST_IDENTITY_LINK_UPGRADE_REQUIRED` means the guest owns data the upgrade flow transfers
      and must convert through `POST /v1/guest-auth/upgrade/complete`, which writes the same
      `server_derived` link for the same pair. Terminal here; retrying it unchanged never succeeds.
    - `409 GUEST_IDENTITY_LINK_OTHER_ACCOUNT` means the guest token names a user that is already a
      different real account. Terminal: the client is holding a credential that is not its own and
      should discard it rather than retry.
    - `429 ANALYTICS_WRITER_BUSY` is not raised here. It is the analytics pool's refusal, which the
      ingest route above still answers a saturated pool with; this route uses its own transaction.
    - A `5xx` should be retried, with the guest token kept. A connection the database drops or refuses,
      a deadlock, or a saturated pool, which authentication meets before the transaction's budget
      exists, is answered `503 SERVICE_UNAVAILABLE` with `Retry-After: 1`, and a cooling-down Cognito
      JWKS refresh `503 AUTH_VERIFICATION_TEMPORARILY_UNAVAILABLE` with `Retry-After: 10`. A failure at
      commit is `500 DATABASE_COMMIT_OUTCOME_UNKNOWN`, whose write may still have landed; a lock
      timeout, a statement timeout and the 5s transaction budget running out are `500 INTERNAL_ERROR`.
      Neither `500` serves a delay. Retrying is safe: the link and the revoke share one commit, so a
      repeat either redoes a request that stored nothing or meets the already-revoked no-op above.
- A guest session whose user is bound in `auth.user_identities` is that account's.
  `Authorization: Guest` refuses it with `401 GUEST_AUTH_INVALID` 7 days after the binding, a grace
  for draining guest sync between upgrade `prepare` and `complete`; both upgrade routes refuse it at
  once for any subject but the bound one.
- `POST /v1/guest-auth/session` accepts an optional `idempotencyKey`. A retry carrying a key that
  still names a live session rotates that session's secret and returns the same guest user and
  workspace, so a lost response cannot leave one device with two guest identities. Client contract:
  the key must be 32 to 200 lowercase hexadecimal characters, generated from a cryptographic random
  source once per creation attempt and dropped once that attempt succeeds. Anything outside that
  shape is refused with `400 GUEST_SESSION_IDEMPOTENCY_KEY_INVALID`, and an omitted key or an
  explicit JSON `null` both mean no key at all, which keeps today's behaviour of a fresh guest per
  call. The shape check is a floor, not a guarantee: it rejects obviously non-random values such as a
  fixed label or an install id in canonical UUID form, but a hyphen-stripped install id and any other
  32-character lowercase-hex constant pass it. Generating the key randomly per attempt and dropping
  it on success therefore remain client obligations, and they matter: rotation hands whoever presents
  the key a fresh valid token for that guest's user and workspace, so a key that is stable across
  attempts or guessable is a bearer credential for that guest identity.
- Auth Lambda serves the auth UI/API on `auth.<domain>` and `/v1` execute-api stage paths
- Backend Lambda verifies JWTs with `aws-jwt-verify`. Authenticated Cognito requests, browser
  sessions, and refreshed token results also consult the durable
  [principal session fence](../db/migrations/0190_principal_session_invalidation.sql).
  Invalidation covers every Cognito session of that principal, across login methods. It uses signed
  original `auth_time`, never refreshed `iat`; missing original time is accepted only before that
  principal has a fence. A pending signout prevents usable sessions until the existing scheduled
  Auth Lambda completes its leased Cognito step. Fresh login from the next whole second after
  completion remains usable; the completion second is conservatively fenced too.
  Account-scoped Chat Live credentials are conservatively invalidated by any principal of that
  account. API keys and OAuth connections have their own credential lifecycles.
  The deletion endpoint alone accepts a signature-valid tombstoned subject to finish its existing
  Cognito deletion inventory, with the same CSRF and confirmation requirements.
- Key files:
  - `apps/auth/src/app.ts`: shared Hono app factory
  - `apps/auth/src/lambda.ts`: Lambda entry point
  - `apps/auth/src/routes/agent/`: terminal/agent auth route entrypoints
  - `apps/auth/src/routes/browser/`: browser OTP/session route entrypoints
  - `apps/auth/src/routes/`: shared `health` and `robots` route entrypoints
  - `apps/auth/src/server/cognito/cognitoAuth.ts`: Cognito API client
  - `apps/backend/src/auth/index.ts`: JWT verification middleware
  - `apps/backend/src/auth/ensureUser.ts`: auto-provisions `user_settings` and `workspace` on first request
  - `infra/aws/lib/auth.ts`: CDK Cognito User Pool construct
  - `db/migrations/0002_user_settings.sql`: `user_settings` table

The native provider session bridge is implemented in
[`nativeProofBridge.ts`](../apps/auth/src/server/social/nativeProofBridge.ts),
with [Cognito triggers](../apps/auth/src/triggers/nativeProof.ts) and
[atomic grants](../db/migrations/0184_cognito_native_proof_grants.sql).
Only server code that freshly verified a provider proof may call the bridge after registering its
principal. Native login routes compose [attempts and completion](../apps/auth/src/routes/social/)
with the existing bridge. Metadata registration and session issuance create no product
rows, so native guest prepare/complete must still precede generic account provisioning.
The [private cloud gate](../scripts/checks/check-native-proof-bridge.sh) runs automatically in the AWS
deployment job before release success. It uses the existing configured review account and tests the
Cognito/database boundary, not Apple/Google proof validation or email delivery.

## Provider proof setup

The [provider modules](../apps/auth/src/server/social/) verify proofs and exchange codes for native
Apple and Google sign-in. [Configuration](../apps/auth/src/server/social/config.ts)
requires each provider JSON and Secrets Manager ARN together; omitted providers remain unavailable.
Use the four `CDK_GOOGLE_SIGN_IN_CONFIG`, `CDK_GOOGLE_SIGN_IN_SECRET_ARN`,
`CDK_APPLE_SIGN_IN_CONFIG`, `CDK_APPLE_SIGN_IN_SECRET_ARN` GitHub variables. CI maps them through
`CDK_CONTEXT_*` to `googleSignInConfig`, `googleSignInSecretArn`, `appleSignInConfig`,
`appleSignInSecretArn`; the auth Lambda receives the same names without `CDK_`.
The [.env example](../.env.example) and source types define JSON fields and secret contracts.
Only auth receives permission to read these existing secrets; no provider secrets enter browser config.

Before enabling login, register both auth host families with each provider at
`/api/social/google/callback` and `/api/social/apple/callback`. Follow
[Google iOS server setup](https://developers.google.com/identity/sign-in/ios/start-integrating),
[Android Credential Manager setup](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation),
and [Apple web registration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/).
The server attempt must own client type, nonce and callback; never trust client-supplied replacements.
Google native requests use the web/server client ID as audience and registered native client as
`azp` ([Google hybrid claims](https://developers.google.com/identity/openid-connect/openid-connect)).
Google uses the raw attempt nonce; every Apple client sends `appleRequestNonce(rawNonce)` as its
request nonce. [Apple nonce](https://developer.apple.com/documentation/signinwithapplejs/clientconfigi/nonce)
is echoed unchanged; SHA-256 lowercase hexadecimal is this service's chosen cross-client convention.

[Apple credentials](../apps/auth/src/server/social/appleCredential.ts) are encrypted with a
purpose-separated key derived from the existing session secret and bound to provider subject/client.
Persist the returned credential after binding the proved identity, before issuing a product session.
[Credential storage](../db/migrations/0185_apple_revocation_credentials.sql) survives principal erasure:
the lifecycle caller must durably arrange revocation, retry failures, and remove only successfully
revoked ciphertext. Retain the session secret until stored credentials have been re-encrypted for rotation.
Configured transports are described by `GET /api/auth-methods?client=<client>` on both auth hosts.
Provider registration alone does not establish actual authentication, revocation or relay delivery;
those require real configured-provider acceptance.

Browser entrypoints are `GET /api/social/google/start?redirect_uri=<intended-url>` and
`GET /api/social/apple/start?redirect_uri=<intended-url>`. The destination must use a configured product
origin or this auth host's `/authorize` consent page. Both permanent auth hosts keep their own exact
HTTPS callback, secure host-only cookie keyed by its state and one-use ledger claim. Mailbox continuation
rotates that cookie key, so late callbacks cannot clear another attempt or phase. Google uses server-held
PKCE; Apple's form POST returns a protected same-origin form continuation at `/api/social/apple/continue`
before claiming proof or reporting facts with the current visitor and collection cookies. Callback fields
stay in POST bodies, never URLs; consent is never snapshotted. Successful web sign-in sets the existing
browser cookies and redirects.
If mailbox proof is required, the callback returns `verification_required`, its `csrfToken` and the
continuation endpoint. From that auth origin, POST JSON to `/api/social/browser/complete` with the cookie,
`csrfToken`, `action: mailbox_send` and `email`; then `action: mailbox_verify` and the actual received
`code`. Success sets cookies and returns `{ok, redirectUri, signInHint}` without tokens in the body.
The shared login UI consumes this API separately.

Android Apple starts at `/api/social/apple/start?client=android&codeChallenge=<S256-app-challenge>`.
The app keeps its verifier; the browser receives only its public challenge. The callback returns to the
fixed `com.nibomo.app:/auth/social/apple` URI with a fragment containing `status` and either `completion`
or `attempt`; a bound provider denial returns `status=denied` with the attempt. The app uses
`/api/social/complete` with its verifier for mailbox continuation and one-use
token redemption. The server transport does not establish support in installed Android clients; their
Custom Tabs flow, receiver and verifier lifecycle are separate client work. Native transports consume
no browser session cookies and still require guest upgrade before generic product provisioning.

For relay delivery, register exact header From and envelope MAIL FROM sources and configure
aligned DKIM/SPF under [Apple's relay procedure](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/).
The production sender is `no-reply@mail.nibomo.com`, DKIM domain `mail.nibomo.com`, envelope domain
`send.mail.nibomo.com`; the existing Resend delivery path remains responsible for OTP.
Accept both `privaterelay.appleid.com` and `private.icloud.com`
([Apple relay domain update](https://developer.apple.com/news/?id=1ptvdtcm)).

## Login funnel analytics

`apps/auth` measures the web sign-in funnel itself, server-side, from its own route handlers. The
login page runs no analytics script and posts no event; all it contributes is the `?screen=signin`
query on the sign-in `fetch` calls it already makes (`apps/auth/src/templates/login.ts`). The events
go one per request to the credential-free collector `POST /v1/analytics/anonymous-events`
([anonymous client analytics](anonymous-client-analytics.md)), never to the `analytics` schema
directly: the `auth_app` role has no grants there and must not be given any. That route reads no
credential and authorizes the caller by `Origin` alone, which is why this service sends its
configured public auth origin explicitly on a call no browser makes.

- The steps, and the branch that observes each:
  - `screen_viewed` with `screen = signin`: `POST /api/refresh-session`
    (`apps/auth/src/routes/browser/refreshSession.ts`) on an absent `refresh` cookie — a first visit,
    a sign-out and an expired cookie alike — and on a rejected refresh token. A non-terminal refresh
    failure is rethrown as a `500` and reports nothing, so this page-view denominator is a floor.
  - `signin_code_requested`: a `POST /api/send-code` that accepted the request
    (`apps/auth/src/routes/browser/sendCode.ts`).
  - `signin_succeeded` and `signin_failed` with a `reason`: `verifyCode.ts` beside it, plus the
    demo-account and refusal branches of `sendCode.ts`.
  - Abandonment is the absence of the next step for an actor, not an event.
  - Every step requires the marker, shared visitor id and collection preference:
    [analytics visitor and collection contract](analytics-visitor-identity.md#the-analytics-off-switch-is-a-second-separate-decision).
  - The producer — catalog mirror, cookie module, transport, report budgets, and the marker check
    that keeps non-funnel callers of these shared routes out — is `apps/auth/src/server/analytics/`.
- Identity: the product domain's shared `anonymous_id`, read from the `analytics_visitor` cookie and
  never written here ([analytics visitor identity](analytics-visitor-identity.md)), and nothing else.
  This origin mints no identity of its own and writes no analytics cookie; the host-only
  `__Host-analytics_guest` it used to write is now only deleted, from the browsers that still carry
  one (`apps/auth/src/server/analytics/visitorSession.ts`).
- The join: none is made here. These rows carry no `user_id`, so
  `analytics.product_events_resolved` resolves them through `first_anonymous_link` to whichever
  account the browser's shared visitor id is linked to, which the web app on the product domain is
  what links. They land at `trust_level = 'anonymous_client'`, which the admin app's trusted-actor
  filter excludes, so a report built over them must except that explicitly.
- Mandatory on every call: the browser's own `User-Agent`, forwarded verbatim. The collector stamps
  `automated_client` from that header and from nothing else, counts a missing one as automated, and
  stores no `User-Agent` beside the row to recompute from — so a report that dropped automated
  traffic would silently lose the whole funnel, permanently. A request that carries no `User-Agent`
  is not reported at all (`readBrowserUserAgent` in `signInFunnel.ts`).
- The accepted limitation: a browser holding no shared visitor id produces no funnel rows at all, and
  nothing here offers it one — a first-ever touch that is the sign-in page goes unmeasured.
- Reports of facts observed by one callback or verification run concurrently within the shared 150 ms
  request budget, with their observed timestamps; delivery remains best-effort.
- Deliberately not measured: the OAuth consent page at `GET /authorize`, and `app_version`.
- Querying these rows: the caveats an analyst needs are in `docs/analytics-db-access.md`.

## MCP identity

The OAuth authorization server also provides OpenID Connect discovery and
UserInfo for enterprise workspace domain restrictions. The implementation lives
in [OAuth routes](../apps/auth/src/routes/oauth/) and
[grant storage and signing](../apps/auth/src/server/oauth/). The signing key is
managed by [the auth infrastructure](../infra/aws/lib/gateways/auth-gateway.ts).

The deployed [OIDC smoke](../scripts/checks/check-oidc-smoke.mjs) runs in the MCP
post-deploy check with the configured synthetic review account. It exercises real
PKCE grants, signing, UserInfo, refresh and scope isolation. Synthetic accounts
always report an unverified email; verify the enterprise-domain flow separately
with a real mailbox. Each run registers a client labelled `OIDC smoke <run-id>`;
its review-account connection remains until explicitly revoked in the database,
because there is no OAuth connection-management HTTP API.

## Apple lifecycle

[Durable lifecycle](../apps/auth/src/server/social/appleLifecycle.ts) stages encrypted Apple tokens
before unlink or account erasure and drains one leased step per minute through the existing auth
Lambda. [Schema](../db/migrations/0187_apple_provider_lifecycle.sql) fences completion, retains failed
jobs with capped backoff, and prevents credential replacement until cleanup finishes. Refresh-session
revocation has its own completion receipt, so Apple retries do not repeatedly sign out email recovery
sessions. A crash between Cognito success and its database receipt can repeat that step; existing
Cognito account-deletion jobs remain request-driven. The principal session fence above rejects
already-issued JWTs and holds sign-in while that durable signout outcome remains pending.

[Signed notifications](../apps/auth/src/server/social/appleNotifications.ts) verify Apple signatures,
issuer, configured audiences and event claims before lifecycle effects. The public endpoint is
`POST /api/social/apple/notifications`, registered on `auth.nibomo.com`. Its JSON body is exactly
`{payload: string}`, bounded to 24 KiB before parsing, with per-source rate limits. It acknowledges only
after commit; exact signed replays return success and conflicting replay payloads are rejected.
Persistence failures return retryable 5xx responses. No provider claims or unsigned internal calls may
substitute for verification. Apple publishes
[claim/event examples](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts),
with [delivery observations](https://developer.apple.com/forums/thread/655485) for JSON-string events
and millisecond timestamps; its Sign in with Apple docs specify no retry schedule guarantee.

Relay notifications retain only hashed delivery-policy addresses and ordered event times. The shared
app-owned OTP initiation checks this policy and returns a clear error while forwarding is disabled;
verified recovery aliases remain enrolled. Direct public Cognito requests are outside that check.
Provider account deletion disables the Apple method and known relay delivery without deleting the
independent Nibomo account or its other recovery methods.

After deployment, inspect the auth Lambda CloudWatch group for `action=apple_revocation_drain`, its
Lambda request ID and `claimed/completed/failed` counts. The fixed native EventBridge event must
reference `flashcards-apple-revocation-drain`; HTTP envelopes cannot dispatch the privileged mode.
Inspect nonzero failure summaries and retained job error codes; successful scheduling or schema
checks do not prove real Apple login, token revocation, or private-relay OTP receipt.
