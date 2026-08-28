# Auth Service (`apps/auth/`)

Email + OTP authentication via AWS Cognito (passwordless).

- `AUTH_MODE`: `none` (local dev, no auth) or `cognito` (verify JWT from `Authorization: Bearer`)
- Guest sessions (`POST /v1/guest-auth/session`) are bound to `ios`, `android`, or `web`. A `web`
  guest session is an analytics credential only: the browser requests one lazily on a signed-out
  visitor's first real interaction and sends it as `Authorization: Guest <token>` to
  `POST /v1/analytics/events` alone.
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
