# Auth Service (`apps/auth/`)

Email + OTP authentication via AWS Cognito (passwordless).

- `AUTH_MODE`: `none` (local dev, no auth) or `cognito` (verify JWT from `Authorization: Bearer`)
- Auth Lambda serves the auth UI/API on `auth.<domain>` and `/v1` execute-api stage paths
- Backend Lambda verifies JWTs with `aws-jwt-verify`
- Key files:
  - `apps/auth/src/app.ts`: shared Hono app factory
  - `apps/auth/src/lambda.ts`: Lambda entry point
  - `apps/auth/src/routes/`: `sendCode`, `verifyCode`, `refreshToken`, `revokeToken`, `loginPage`, `health`
  - `apps/auth/src/server/cognitoAuth.ts`: Cognito API client
  - `apps/backend/src/auth.ts`: JWT verification middleware
  - `apps/backend/src/ensureUser.ts`: auto-provisions `user_settings` and `workspace` on first request
  - `infra/aws/lib/auth.ts`: CDK Cognito User Pool construct
  - `db/migrations/0002_user_settings.sql`: `user_settings` table
