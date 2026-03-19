# AWS Deployment (CDK)

This stack deploys v1 backend infrastructure for `flashcards-open-source-app`.

## What gets created

- VPC with private subnets
- RDS Postgres 18
- Cognito User Pool (Essentials tier, EMAIL_OTP passwordless auth)
- API Gateway (REST API) for backend + API Gateway (REST API) for auth + two Lambdas (backend + auth)
- S3 bucket + CloudFront distribution for the web app
- Secrets Manager — DB credentials (auto-generated), backend/auth DB passwords, session encryption key
- Optional Secrets Manager secrets for AI provider API keys, when configured locally before deploy
- CloudWatch alarms + SNS notifications
- AWS Backup plan for RDS
- GitHub Actions OIDC deployment role

## Required context

Create `infra/aws/cdk.context.local.json` from the example and fill values:

- `region`
- `domainName`
- `alertEmail`
- `githubRepo`
- `apiCertificateArn` (optional, only for custom domain)
- `authCertificateArn` (optional, only for `auth.<domain>`)
- `webCertificateArnUsEast1` (optional, only for `app.<domain>` on CloudFront)
- `apexRedirectCertificateArnUsEast1` (optional, only for apex -> app redirect on CloudFront)
- `sesSenderEmail` (optional, enables SES-backed Cognito email delivery when set)
- `guestAiWeightedMonthlyTokenCap` (optional, guest AI monthly quota; defaults to `0` when omitted)

## Deploy

```bash
cd infra/aws
npm ci
npx cdk bootstrap --region eu-central-1
npx cdk deploy --all --require-approval never
```

Or from the repo root, use the higher-level helper:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
bash scripts/first-deploy.sh --region eu-central-1 --domain flashcards-open-source-app.com --alert-email alerts@example.com
```

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are optional. If you export them before running the helper, `scripts/setup-ai-secrets.sh` stores them in AWS Secrets Manager and records their ARNs in `infra/aws/cdk.context.local.json`. CDK then injects them into the backend Lambda from AWS secrets. If you skip them, the stack still deploys successfully and chat providers remain unconfigured.

Guest AI quota is configured independently from provider secrets. Set `guestAiWeightedMonthlyTokenCap` in `infra/aws/cdk.context.local.json` and run `bash scripts/setup-github.sh` to sync it to the GitHub repo variable `CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP`. During deploy, GitHub writes that value back into `cdk.context.local.json`, and CDK injects it into both backend Lambdas as `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP`. When the value is omitted, the backend defaults it to `0`, which disables guest AI fail-closed.

`scripts/bootstrap.sh` and `scripts/first-deploy.sh` now also:

- run database migrations through the in-VPC migration Lambda
- verify the public API health endpoint before deploying web assets

## Post-deploy

1. **Confirm SNS email** — check `alertEmail` inbox and confirm the subscription.
2. **Session encryption key** — CDK auto-generates a random 64-char hex key in Secrets Manager (`flashcards-open-source-app/session-encryption-key`). It signs OTP session cookies during login. No manual action needed.
3. **Runtime DB role secrets** — CDK now creates separate Secrets Manager entries for `backend_app` and `auth_app` so the API and auth Lambdas do not share one database role.
4. **SES for OTP emails** — Cognito uses its built-in email sender by default when `sesSenderEmail` is not set in CDK context. To switch Cognito OTP delivery to SES, verify your domain in SES, set `sesSenderEmail`, and deploy. The stack will then create an SES configuration set plus CloudWatch event publishing for `send`, `delivery`, `bounce`, `complaint`, and `reject`. See [docs/aws-ses-setup.md](/Users/kirill/_my_local/code-local/personal-workspace/flashcards-open-source-app/docs/aws-ses-setup.md).
5. **Deploy web assets manually if needed** — `bash scripts/deploy-web.sh`.
   Do not use a web-only deploy when the browser API contract changed. Run `bash scripts/check-public-endpoints.sh` after the API/CDK deploy and before publishing web assets.
6. **Run migrations manually if needed** — `bash scripts/migrate-aws.sh`.
7. **Check internal gateway health manually if needed** — `bash scripts/check-api-health.sh`.
8. **Check public custom domains manually if needed** — `bash scripts/check-public-endpoints.sh`.
9. **Configure GitHub Actions** — `bash scripts/setup-github.sh` writes the required vars/secrets for this repo using stack outputs and `cdk.context.local.json`. For AI providers it stores only secret ARNs as GitHub variables; the provider keys themselves stay in AWS Secrets Manager. Guest AI quota is also synced here as the repo variable `CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP`.
10. **Rotate optional AI keys later if needed** — export `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY`, then run `bash scripts/setup-ai-secrets.sh --region <aws-region>` and `bash scripts/setup-github.sh`.
11. **Create review/demo Cognito users manually if demo bypass is enabled** — `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP` only configure the insecure review/demo bypass in the auth Lambda. They do not provision Cognito users. If you enable these variables, every listed demo email must use `@example.com`, and you must create the matching Cognito users by hand and keep their emails and shared password aligned with the deployed env values. We intentionally do not automate this step for review-only insecure accounts.

## Auth flow

1. Mobile app or browser login page calls `POST https://auth.<domain>/api/send-code` with `{ email }`.
2. Auth Lambda calls Cognito `InitiateAuth` (EMAIL_OTP), stores session in HMAC-signed cookie, returns CSRF token.
3. Mobile app or browser login page calls `POST https://auth.<domain>/api/verify-code` with `{ code, csrfToken }`.
4. Auth Lambda calls Cognito `RespondToAuthChallenge`, returns `{ idToken, refreshToken, expiresIn }` in response body.
5. Browser app reuses the shared domain `session` cookie for SSO and loads a session-bound CSRF token from `GET https://api.<domain>/v1/me`.
6. Browser mutating requests to `https://api.<domain>/v1/*` send `X-CSRF-Token`; backend checks exact allowed `Origin` (or `Referer` fallback), rejects explicit `Sec-Fetch-Site: cross-site`, and validates the HMAC-derived token with a dedicated Secrets Manager secret.
7. Mobile app stores tokens locally, sends `Authorization: Bearer <idToken>` on sync requests.
8. Backend Lambda verifies JWT via `aws-jwt-verify`, extracts `sub` as userId.
9. Host-only `__Host-` app cookies are intentionally not used in v1 because `app.<domain>` is served as a static CloudFront/S3 SPA and `api.<domain>` cannot set an `app.<domain>` host-only cookie without adding a proxy or edge layer.
10. `POST https://auth.<domain>/api/refresh-token` — exchange refresh token for new id token.
11. `POST https://auth.<domain>/api/revoke-token` — logout (revoke refresh token).
12. `GET https://auth.<domain>/login?redirect_uri=...` — browser-based login page.

## DNS (Cloudflare)

If custom API domain is enabled (`apiCertificateArn` set), run:

```bash
bash scripts/cloudflare/setup-dns.sh --stack-name FlashcardsOpenSourceApp
```

This creates/updates `api.<domain>`, `auth.<domain>`, and `app.<domain>` CNAME records in Cloudflare from stack outputs when the corresponding certificates are configured. If the stack exposes an apex redirect target and the apex DNS is free, the script also creates the apex CNAME for the redirect distribution. If the apex is already occupied, it prints a skip message and leaves the existing setup untouched.
