# AWS Deployment (CDK)

This stack deploys v1 backend infrastructure for `flashcards-open-source-app`.

## What gets created

- VPC with private subnets
- RDS Postgres 18
- Cognito User Pool (Essentials tier, EMAIL_OTP passwordless auth)
- API Gateway (REST API) for backend + API Gateway (REST API) for auth + two Lambdas (backend + auth)
- S3 bucket + CloudFront distribution for the web app
- Secrets Manager — DB credentials (auto-generated), app DB password, session encryption key
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

## Deploy

```bash
cd infra/aws
npm ci
npx cdk bootstrap --region eu-central-1
npx cdk deploy --all --require-approval never
```

Or from the repo root, use the higher-level helper:

```bash
bash scripts/first-deploy.sh --region eu-central-1 --domain flashcards-open-source-app.com --alert-email alerts@example.com
```

`scripts/bootstrap.sh` and `scripts/first-deploy.sh` now also:

- run database migrations through the in-VPC migration Lambda
- verify the public API health endpoint before deploying web assets

## Post-deploy

1. **Confirm SNS email** — check `alertEmail` inbox and confirm the subscription.
2. **Session encryption key** — CDK auto-generates a random 64-char hex key in Secrets Manager (`flashcards-open-source-app/session-encryption-key`). It signs OTP session cookies during login. No manual action needed.
3. **SES for OTP emails** — Cognito uses its built-in email sender by default (~50 emails/day). To remove the limit, verify your domain in SES and update `infra/aws/lib/auth.ts` with `UserPoolEmail.withSES(...)`.
4. **Deploy web assets manually if needed** — `bash scripts/deploy-web.sh`.
5. **Run migrations manually if needed** — `bash scripts/migrate-aws.sh`.
6. **Check internal gateway health manually if needed** — `bash scripts/check-api-health.sh`.
7. **Check public custom domains manually if needed** — `bash scripts/check-public-endpoints.sh`.
8. **Configure GitHub Actions** — `bash scripts/setup-github.sh` writes the required vars/secrets for this repo using stack outputs and `cdk.context.local.json`.

## Auth flow

1. Mobile app or browser login page calls `POST https://auth.<domain>/api/send-code` with `{ email }`.
2. Auth Lambda calls Cognito `InitiateAuth` (EMAIL_OTP), stores session in HMAC-signed cookie, returns CSRF token.
3. Mobile app or browser login page calls `POST https://auth.<domain>/api/verify-code` with `{ code, csrfToken }`.
4. Auth Lambda calls Cognito `RespondToAuthChallenge`, returns `{ idToken, refreshToken, expiresIn }` in response body.
5. Mobile app stores tokens locally, sends `Authorization: Bearer <idToken>` on sync requests.
6. Backend Lambda verifies JWT via `aws-jwt-verify`, extracts `sub` as userId.
7. `POST https://auth.<domain>/api/refresh-token` — exchange refresh token for new id token.
8. `POST https://auth.<domain>/api/revoke-token` — logout (revoke refresh token).
9. `GET https://auth.<domain>/login?redirect_uri=...` — browser-based login page.

## DNS (Cloudflare)

If custom API domain is enabled (`apiCertificateArn` set), run:

```bash
bash scripts/cloudflare/setup-dns.sh --stack-name FlashcardsOpenSourceApp
```

This creates/updates `api.<domain>`, `auth.<domain>`, and `app.<domain>` CNAME records in Cloudflare from stack outputs when the corresponding certificates are configured.
