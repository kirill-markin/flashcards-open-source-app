# Auth Service (`apps/auth/`)

Email OTP and Apple/Google authentication via the existing AWS Cognito service.

Human-run acceptance: [browser](browser-sign-in-hints.md#manual-browser-acceptance),
[iOS/iPadOS/Duo and Catalyst](native-apple-sign-in.md), and
[Android](../apps/android/docs/native-sign-in-acceptance.md). These procedures distinguish source
and cloud checks from actual provider, signed-device, mailbox and lifecycle results.

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
- Legacy guest sessions (`POST /v1/guest-auth/session`) are bound to `ios`, `android`, or `web`. A `web`
  guest session is an analytics credential only, sent as `Authorization: Guest <token>` to
  `POST /v1/analytics/events` alone. It is requested by the browser, lazily on a signed-out
  visitor's first real interaction. This service requests none of its own: its sign-in funnel posts
  to the credential-free collector instead (`Login facts` below).
  - The ingest contract is in the [route](../apps/backend/src/routes/productAnalytics.ts) and
    [`productAnalytics/`](../apps/backend/src/productAnalytics/catalog.ts).
  - Every other guest surface refuses a `web` guest with `403 GUEST_WEB_PLATFORM_UNSUPPORTED`, and
    guest upgrade with `403 GUEST_UPGRADE_WEB_PLATFORM_UNSUPPORTED`
    ([the gate](../apps/backend/src/guestAuth/webPlatform.ts)).
  - Only the literal `web` is refused. A `null` platform is a pre-1.7.0 iOS/Android guest session and
    keeps every guest surface it has today.
  - `POST /v1/guest-auth/session` and `POST /v1/guest-auth/session/delete` stay open to it: they are
    the credential's own lifecycle and authenticate outside the request-context loader.
  - `POST /v1/guest-auth/identity/link` is authenticated as the signed-in account and takes the guest
    token from its body, so it accepts a `web` guest. It links that guest identity to the account for
    analytics and revokes the guest session. An unknown or already-revoked token is a successful
    no-op, and so is a guest session that already belongs to the signed-in account after a bound
    upgrade: that credential is neither linked nor revoked. A deleted account gets
    `410 ACCOUNT_DELETED` ([route](../apps/backend/src/guestAuth/identityLink/index.ts)).
    - Client ordering obligation: when sign-in creates only metadata, the first request that loads
      a request context, such as `GET /v1/me`, writes the account's identity mapping.
      Await one such call before calling this route; two parallel requests after a first sign-in
      can let the link reach the database before that binding exists.
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
## Browser guest credentials

The browser-only lifecycle is separate from the legacy guest routes above.
Migration [0218](../db/migrations/0218_browser_guest_sessions.sql) adds server-owned
session purpose: existing and legacy-created sessions stay `legacy`;
only the browser creation entrypoint mints `browser_product`, constrained to `web`.
Neither a client purpose/platform field nor `Authorization: Guest` can promote a legacy credential.
Product APIs admit only browser-product cookie guests; legacy web tokens stay analytics-only.
Browser guests can study and sync without signing in, including with product analytics off.
Nibomo-funded chat, dictation and images follow the [browser trial policy](premium-offer.md#browser-guest-ai-trial);
their own OpenAI key follows the existing own-key rules. Stripe and account-only operations still require linking an account.
Browser-product identities follow native guest retention and are excluded from the analytics-only reaper.

Use credentialed requests to the same API host throughout the lifecycle.
The API stores only the random token's hash and sends the token only as
`__Host-nibomo_guest`: Secure, HttpOnly, Path=/, SameSite=Lax, no Domain, rolling
180-day Max-Age renewed by a successful probe or reuse. This is no recovery guarantee.

- `GET /v1/guest-auth/browser/session` never provisions an identity. Its response is
  `{registeredSession: {present, csrfToken}, guestSession: {...}}`.
  `registeredSession` verifies the registered cookie without `/me` or profile creation,
  so it can run before conversion binds a new principal.
  An expired/invalid registered cookie fails authentication; refresh or sign in again,
  then repeat the probe. It never falls through to guest creation.
- `guestSession.status` is `absent`, `invalid`, `revoked`, `active`, or `pending_upgrade`.
  All states carry `csrfToken` (null only without a guest cookie) and
  `cookieRoundTripVerified`. Live active/pending states also carry `sessionId`, `userId`,
  `workspaceId` (nullable), `purpose: browser_product`, and `platform: web`.
  Pending means the credential's owner has become an account; it remains available
  for conversion and cannot authenticate ordinary guest requests. A removed source
  with token-hash-matched conversion history also reports pending, with its original
  session/user ids, null workspace/purpose/platform, and `replayOnly: true`;
  it permits only authenticated completion replay.
  A missing row without history is `invalid`.
- `POST /v1/guest-auth/browser/session` reuses an active cookie before considering
  creation. With no cookie or registered session, creation requires JSON
  `{idempotencyKey, hasLocalOwnership: false}`. The key uses the legacy per-attempt
  random-key protocol below and must be kept through response loss, then discarded
  after successful cookie verification. Client-supplied purpose is ignored.
  The response has the same envelope as the probe; fresh issuance sets
  `cookieRoundTripVerified: false`. Await a probe reporting `active` and true
  before persisting the new guest ownership or using it as a credential.
  Local owner/workspace ids must match the resumed ids before hydrating or replacing data.
- A present invalid/revoked cookie, or missing cookie with `hasLocalOwnership: true`,
  refuses creation with `409 GUEST_BROWSER_RECOVERY_REQUIRED`. Preserve local data.
  A registered session or pending upgrade refuses it with
  `409 GUEST_BROWSER_UPGRADE_REQUIRED`; complete conversion instead.
  A User-Agent that declares a crawler refuses creation, never resumption, with
  `403 GUEST_BROWSER_CRAWLER_REFUSED`; headless browsers and scripts are not refused.
- `POST /v1/guest-auth/browser/session/forget` returns `{ok: true}` and revokes only
  the guest credential, then expires its cookie. Missing/unknown/already-revoked
  credentials are safe to forget. It never deletes a workspace or a linked account.
  Keep the cookie until conversion completion and destination hydration are durable.

Every browser lifecycle call requires an allowed Origin/Referer and refuses
cross-site Fetch Metadata. Unsafe creation/forget calls require the guest cookie's
`X-CSRF-Token` when that cookie exists, otherwise the registered cookie's CSRF
when present. Conversion uses the registered CSRF as described below.
The probe supplies both independently; browser lifecycle routes refuse Authorization headers.
All lifecycle responses are `no-store`. Ordinary auth prefers registered authentication,
then guest auth, and records trusted guest purpose and source independently of transport `guest`.
Initial creation has a separate aggregate API Gateway throttle (1 request/second, burst 5);
it is not a per-person anti-farming boundary.

## Browser guest conversion

Before leaving for authentication, sync every guest write, drain the guest outbox,
and freeze guest mutations through conversion. After sign-in, probe the browser
session, then prepare before any normal account `/me` call can provision a profile.
Both conversion POSTs use the registered cookie's `X-CSRF-Token` from
`registeredSession.csrfToken`, allowed Origin/Referer, and cookies on the same API host;
Authorization headers and JSON `guestToken` are refused.

- `POST /v1/guest-auth/browser/upgrade/prepare` takes
  `{guestWorkspaceSyncedAndOutboxDrained: true}`, returning
  `{mode: bound | merge_required}`. A new principal binds to the guest's account id;
  an existing account needs an explicit merge choice. A committed merge's retry
  returns `merge_required` so the client can replay completion.
- `POST /v1/guest-auth/browser/upgrade/complete` takes
  `{selection, guestWorkspaceSyncedAndOutboxDrained, supportsDroppedEntities}`.
  Selection is `{type: existing, workspaceId}` or `{type: create_new, name?}`;
  both capability fields are required booleans. Fresh completion requires a true
  drain assertion. The response is `{workspace, droppedEntities?}`, using the
  existing native transfer and dropped-entity contract, including media ids.
- Keep the authenticated account and selection saved across retries. Completion
  can replay after source cleanup; it checks the destination account and refuses
  a different saved selection. It never re-merges or creates another workspace.
  Replay still requires dropped-entity support when the stored result contains drops.
- The guest cookie survives prepare, completion, and response loss. Only after
  completion is durably recorded and the destination hydrated, explicitly call
  `/guest-auth/browser/session/forget` with the guest CSRF from the probe.
  Forget retires only that credential. Cancelled sign-in preserves guest data;
  pending local writes after return require recovering guest ownership before retrying.

## Shared session contracts

- A guest session whose user is bound in `auth.user_identities` is that account's.
  `Authorization: Guest` refuses it with `401 GUEST_AUTH_INVALID` 7 days after the binding, a grace
  for draining guest sync between upgrade `prepare` and `complete`; both upgrade routes refuse it at
  once for any subject but the bound one.
- `POST /v1/guest-auth/session` accepts an optional `idempotencyKey`. A retry carrying a key that
  still names a live session rotates that session's secret and returns the same guest user and
  workspace, so a lost response cannot leave one device with two guest identities. Client contract:
  generate the key from a cryptographic random source once per creation attempt and drop it once
  that attempt succeeds, because a stable or guessable key is a bearer credential for that guest
  identity. The server checks only its shape (`400 GUEST_SESSION_IDEMPOTENCY_KEY_INVALID`), and an
  omitted key or an explicit JSON `null` means a fresh guest per call
  ([`guestAuth.ts`](../apps/backend/src/routes/guestAuth.ts)).
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
  - `db/migrations/0001_initial_schema.sql`: `org.user_settings` table

The native provider session bridge is implemented in
[`nativeProofBridge.ts`](../apps/auth/src/server/social/nativeProofBridge.ts),
with [Cognito triggers](../apps/auth/src/triggers/nativeProof.ts) and
[atomic grants](../db/migrations/0184_cognito_native_proof_grants.sql).
Only server code that freshly verified a provider proof may call the bridge after registering its
principal. Native login routes compose [attempts and completion](../apps/auth/src/routes/social/)
with the existing bridge. Ordinary first provider enrollment creates only auth metadata.
A returning, already-bound Apple principal may receive a profile-only account while enrolling its newly shared real Email login;
[the claimed composition](../db/migrations/0208_provider_email_reconciliation.sql) selects an existing
Email owner first and creates no workspace or demo. Native guest prepare/complete still precedes
generic provisioning and uses the existing `merge_required` transfer when this profile exists.
The [private cloud gate](../scripts/checks/check-native-proof-bridge.sh) runs automatically in the AWS
deployment job before release success. It uses the existing configured review account and tests the
Cognito/database boundary, not Apple/Google proof validation or email delivery.

## Provider proof setup

The [provider modules](../apps/auth/src/server/social/) verify proofs and exchange codes for native
Apple and Google sign-in. [Configuration](../apps/auth/src/server/social/config.ts)
requires each provider JSON and Secrets Manager ARN together; omitted providers remain unavailable.
Use the four `CDK_GOOGLE_SIGN_IN_CONFIG`, `CDK_GOOGLE_SIGN_IN_SECRET_ARN`,
`CDK_APPLE_SIGN_IN_CONFIG`, `CDK_APPLE_SIGN_IN_SECRET_ARN` GitHub variables.
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
token redemption. Installed Android Custom Tabs, receiver and verifier lifecycle acceptance follows
the [native procedure](../apps/android/docs/native-sign-in-acceptance.md). Native transports consume
no browser session cookies and still require guest upgrade before generic product provisioning.

For relay delivery, register exact header From and envelope MAIL FROM sources and configure
aligned DKIM/SPF under [Apple's relay procedure](https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/).
The production sender is `no-reply@mail.nibomo.com`, DKIM domain `mail.nibomo.com`, envelope domain
`send.mail.nibomo.com`; the existing Resend delivery path remains responsible for OTP.
Accept both `privaterelay.appleid.com` and `private.icloud.com`
([Apple relay domain update](https://developer.apple.com/news/?id=1ptvdtcm)).

## Login facts

[Auth producers](../apps/auth/src/server/analytics/signInFunnel.ts) and the
[UI fact route](../apps/auth/src/routes/browser/authFact.ts) reuse the
[shared visitor and collection contract](analytics-visitor-identity.md). Their bounded catalog is
[defined in source](../apps/auth/src/server/analytics/catalog.ts), mirroring the
[backend inventory](../apps/backend/src/productAnalytics/catalog.ts); request and provider
outcomes remain server-observed. [Browser acceptance](browser-sign-in-hints.md#manual-browser-acceptance)
covers the auth UI and the web account-ready boundary. Querying caveats remain in
[analytics database access](analytics-db-access.md).

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
before unlink or account erasure. Verified revocation notifications and committed method unlinks
asynchronously wake the existing auth Lambda; its bounded drain alternates session and provider work
when execution time permits. The minute schedule retains durable recovery.
[Schema](../db/migrations/0187_apple_provider_lifecycle.sql) fences completion, retains failed jobs
with capped backoff, and prevents credential replacement until cleanup finishes. Refresh-session
revocation has its own completion receipt, so Apple retries do not repeatedly sign out email recovery
sessions. A crash between Cognito success and its database receipt can repeat that step; existing
Cognito account-deletion jobs remain request-driven. The principal session fence above rejects
already-issued JWTs and holds sign-in while that durable signout outcome remains pending.

[Signed notifications](../apps/auth/src/server/social/appleNotifications.ts) verify Apple signatures,
issuer, configured audiences and event claims before lifecycle effects. The public endpoint is
`POST /api/social/apple/notifications`, registered on `auth.nibomo.com`. Its JSON body is exactly
`{payload: string}`, bounded to 24 KiB before parsing, with per-source rate limits. It acknowledges only
after commit; applied revocations also await wake acceptance. Exact signed revocation replays retry
the wake, and conflicting replay payloads are rejected. Persistence and wake failures return retryable
5xx responses. No provider claims or unsigned internal calls may substitute for verification. Apple publishes
[claim/event examples](https://developer.apple.com/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts),
with [delivery observations](https://developer.apple.com/forums/thread/655485) for JSON-string events
and millisecond timestamps; its Sign in with Apple docs specify no retry schedule guarantee.

Relay notifications retain only hashed delivery-policy addresses and ordered event times. The shared
app-owned OTP initiation checks this policy and returns a clear error while forwarding is disabled;
verified recovery aliases remain enrolled. Direct public Cognito requests are outside that check.
Provider account deletion disables the Apple method and known relay delivery without deleting the
independent Nibomo account or its other recovery methods.

After deployment, inspect the auth Lambda CloudWatch group for `action=apple_revocation_drain`, its
Lambda request ID and `claimed/completed/failed` counts. Inspect `action=apple_revocation_wake` for
accepted wakes and explicit dispatch failures. The fixed native EventBridge event must reference
`flashcards-apple-revocation-drain`; the fixed direct-invoke wake accepts no job or identity fields.
HTTP envelopes cannot dispatch either privileged mode.
Inspect nonzero failure summaries and retained job error codes; successful scheduling or schema
checks do not prove real Apple login, token revocation, or private-relay OTP receipt.

## Account sign-in methods

Browser-local presentation metadata and manual bridge acceptance are described in
[Browser sign-in hints](browser-sign-in-hints.md).

The authenticated transport contract is defined in [public request/result types](../apps/auth/src/server/social/publicContract.ts),
[configured endpoints](../apps/auth/src/server/social/publicMethods.ts), and [session/CSRF adapters](../apps/auth/src/routes/social/accountTransport.ts).
[Provider mutations](../apps/auth/src/server/social/accountMethods.ts) and [current-email reauthentication](../apps/auth/src/server/social/currentEmailReauth.ts)
share the existing attempt ledger. [Cloud consumers](../apps/auth/src/integration/accountMethodsGate.ts) exercise signed demo-session refusals and reachable transport guards on both auth hosts;
non-demo management success, browser CSRF bootstrap, actual provider proof, mailbox delivery, and native SDK acceptance require the release acceptance flows.

The [recovery-email projection](../apps/auth/src/server/social/accountMethods.ts) and the
[browser Settings procedure](browser-sign-in-hints.md#manual-settings-acceptance) cover read-only
proved recovery addresses and the current-account management boundary.
