# AWS Deployment (CDK)

This stack deploys v1 backend infrastructure for `flashcards-open-source-app`.

## What gets created

- VPC with private subnets
- RDS Postgres 18
- Cognito User Pool (Essentials tier, EMAIL_OTP passwordless auth)
- API Gateway (REST API) for backend + API Gateway (REST API) for auth + backend/auth/worker/email Lambdas
- S3 bucket + CloudFront distribution for the web app
- Secrets Manager — DB credentials (auto-generated), backend/auth DB passwords, session encryption key
- Optional Secrets Manager secrets for Resend, the review/demo auth password, AI provider API keys, and Langfuse telemetry keys
- CloudWatch alarms + SNS notifications
- AWS Backup plan for RDS
- GitHub Actions OIDC deployment role

## Deploy config model

Deploy-time config is split across three places:

- Root `.env` is the local operator input for scripts.
- AWS Secrets Manager is the source of truth for deployed runtime secrets.
- GitHub repository variables are the source of truth for non-secret deploy config used by CI/CD.

Local CDK commands assemble `infra/aws/cdk.context.local.json` immediately before invoking CDK, and GitHub Actions assembles the same context inside the workflow job.

## Local operator config

Keep these values in root `.env` before running setup or deploy scripts:

- `AWS_REGION`
- `DOMAIN_NAME`
- `ALERT_EMAIL`
- `GITHUB_REPO`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `RESEND_API_KEY`
- `RESEND_ADMIN_API_KEY`
- `OPENAI_API_KEY` when needed
- `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and optionally `LANGFUSE_BASE_URL` when Langfuse tracing is enabled
- `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP` when review/demo bypass is enabled
- `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` when you want deployed guest AI enabled

Certificate ARNs and secret ARNs are discovered from AWS. They are not meant to be typed into local context by hand.

## Deploy

Preferred flow from the repo root:

```bash
bash scripts/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email alerts@example.com
```

That flow:

- creates or updates the required AWS Secrets Manager secrets from root `.env`
- stores optional AI and demo auth secrets when configured
- requests ACM certificates for API, auth, web, and apex redirect when needed
- generates `infra/aws/cdk.context.local.json` for the local CDK invocation
- bootstraps and deploys CDK
- uploads web assets
- optionally configures Cloudflare DNS
- syncs deploy config into GitHub Actions variables

You can still run CDK manually from `infra/aws`; the local helper scripts assemble the CDK context file before the CDK step.

## Secret setup helpers

- `bash scripts/setup-resend-secret.sh --region <aws-region>`
  Stores `RESEND_API_KEY` in AWS Secrets Manager and derives `no-reply@mail.<domain>` from `DOMAIN_NAME`.
- `bash scripts/setup-ai-secrets.sh --region <aws-region>`
  Stores optional AI provider keys and Langfuse keys in AWS Secrets Manager.
- `bash scripts/setup-auth-secrets.sh --region <aws-region>`
  Stores the shared insecure review/demo password in AWS Secrets Manager when `DEMO_PASSWORD_DOSTIP` is set.

These scripts do not write back into repo config files. They only update AWS state.

## GitHub Actions config

Run:

```bash
bash scripts/setup-github.sh
```

This script:

- reads operator config from root `.env`
- discovers AWS secret ARNs and ACM certificate ARNs
- writes non-secret deploy config to GitHub repository variables
- writes only `AWS_DEPLOY_ROLE_ARN` as a GitHub secret
- deletes old GitHub secrets that are no longer used for demo auth or certificate ARNs

The deploy workflow assembles its own `cdk.context.local.json` from those GitHub variables inside CI.

This AWS sync does not manage the Android Google Cloud and Firebase Test Lab repository variables. Android CI/CD uses its own setup flow and helper script:

- docs: [`docs/android-ci-cd.md`](../../docs/android-ci-cd.md)
- sync command: `bash scripts/setup-github-android.sh`

## Langfuse tracing

The modern backend-owned AI surfaces can export Langfuse traces:

- persisted `/chat` worker runs use trace name `chat_turn`
- `/chat/transcriptions` uses trace name `chat_transcription`

Required deploy inputs when Langfuse is enabled:

- AWS secret `flashcards-open-source-app/langfuse-public-key`
- AWS secret `flashcards-open-source-app/langfuse-secret-key`
- optional GitHub variable `CDK_LANGFUSE_BASE_URL`

The helper flow is:

1. Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and optionally `LANGFUSE_BASE_URL` in root `.env`.
2. Run `bash scripts/setup-ai-secrets.sh --region <aws-region>`.
3. Run `bash scripts/setup-github.sh`.
4. Deploy as usual.
5. Verify traces in Langfuse using [`docs/langfuse-operations.md`](../../docs/langfuse-operations.md).

## Review/demo accounts

`DEMO_EMAIL_DOSTIP` configures the insecure review/demo allowlist in the auth Lambda, and the deployed auth Lambda reads the shared password from the AWS secret `flashcards-open-source-app/demo-password-dostip`.

These settings do not provision Cognito users. If review/demo bypass is enabled:

- every listed email must use `@example.com`
- the matching Cognito users must be created manually
- the Cognito user passwords must match the shared demo password stored in Secrets Manager

Validate deployed state with:

```bash
bash scripts/check-demo-cognito-users.sh --stack-name FlashcardsOpenSourceApp --region eu-central-1
```

## Post-deploy

1. Confirm the SNS subscription in the `ALERT_EMAIL` inbox.
2. Configure Resend DNS with `bash scripts/setup-resend-domain.sh --domain <base-domain> --subdomain mail`.
3. Configure Cloudflare public DNS with `bash scripts/cloudflare/setup-dns.sh --stack-name FlashcardsOpenSourceApp --domain <base-domain>`.
4. Sync GitHub Actions config with `bash scripts/setup-github.sh`.
5. Run `bash scripts/check-public-endpoints.sh --stack-name FlashcardsOpenSourceApp` after DNS changes.

## Auth flow

1. Mobile app or browser login page calls `POST https://auth.<domain>/api/send-code` with `{ email }`.
2. Auth Lambda calls Cognito `InitiateAuth` (EMAIL_OTP), stores session in HMAC-signed cookie, returns CSRF token.
3. Cognito invokes the custom email sender Lambda, which decrypts the Cognito code and delivers it through Resend from `no-reply@mail.<domain>`.
4. Mobile app or browser login page calls `POST https://auth.<domain>/api/verify-code` with `{ code, csrfToken }`.
5. Auth Lambda calls Cognito `RespondToAuthChallenge`, returns `{ idToken, refreshToken, expiresIn }` in response body.
6. Browser app reuses the shared domain `session` cookie for SSO and loads a session-bound CSRF token from `GET https://api.<domain>/v1/me`.
7. Browser mutating requests to `https://api.<domain>/v1/*` send `X-CSRF-Token`; backend checks exact allowed `Origin` (or `Referer` fallback), rejects explicit `Sec-Fetch-Site: cross-site`, and validates the HMAC-derived token with a dedicated Secrets Manager secret.
8. Mobile app stores tokens locally, sends `Authorization: Bearer <idToken>` on sync requests.
9. Backend Lambda verifies JWT via `aws-jwt-verify`, extracts `sub` as userId.
10. Host-only `__Host-` app cookies are intentionally not used in v1 because `app.<domain>` is served as a static CloudFront/S3 SPA and `api.<domain>` cannot set an `app.<domain>` host-only cookie without adding a proxy or edge layer.
11. `POST https://auth.<domain>/api/refresh-token` exchanges refresh token for a new id token.
12. `POST https://auth.<domain>/api/revoke-token` revokes the refresh token.
13. `GET https://auth.<domain>/login?redirect_uri=...` serves the browser login page.
