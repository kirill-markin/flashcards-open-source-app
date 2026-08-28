# Auth Service (`apps/auth/`)

Email + OTP authentication via AWS Cognito (passwordless).

- `AUTH_MODE`: `none` (local dev, no auth) or `cognito` (verify JWT from `Authorization: Bearer`)
- Guest sessions (`POST /v1/guest-auth/session`) are bound to `ios`, `android`, or `web`. A `web`
  guest session is an analytics credential only: the browser requests one lazily on a signed-out
  visitor's first real interaction and sends it as `Authorization: Guest <token>` to
  `POST /v1/analytics/events` alone.
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
      and must convert through `POST /v1/guest-auth/upgrade/complete` instead. Terminal for this
      route; retrying it unchanged never succeeds.
    - `409 GUEST_IDENTITY_LINK_OTHER_ACCOUNT` means the guest token names a user that is already a
      different real account. Terminal: the client is holding a credential that is not its own and
      should discard it rather than retry.
    - `429 ANALYTICS_WRITER_BUSY` means the analytics connection pool was saturated: its cap refused
      the write before a connection was requested, or acquiring a connection timed out. It is raised
      before the link statement runs, so nothing was written — no identity link row and no revoke —
      and the guest session stays live with its token still usable. Retryable with nothing to
      repair: keep the guest token, wait the delay, and call again. The body is the ordinary
      `error`/`requestId`/`code` envelope; the delay travels only in the `Retry-After` response
      header, always `1` second on this route.
    - A `5xx` must be retried, with the guest token kept. The identity link commits on the analytics
      pool and the revoke commits with the request transaction, so a failure between them can leave
      the link written and the guest session still live. The retry is safe — it conflicts on the
      same guest and account pair, stores nothing new, and completes the revoke — and it is not
      optional: a guest session left live can later be bound to a *different* account, and the
      orphan link would then attribute that account's whole pre-account analytics tail to this one
      permanently.
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
- Backend Lambda verifies JWTs with `aws-jwt-verify`
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
