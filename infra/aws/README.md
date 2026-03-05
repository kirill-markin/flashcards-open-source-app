# AWS Deployment (CDK)

This stack deploys v1 backend infrastructure for `flashcards-open-source-app`.

## What gets created

- VPC with private subnets
- RDS Postgres 18
- Cognito User Pool (Essentials tier, EMAIL_OTP passwordless auth)
- API Gateway (REST API) + two Lambdas (backend + auth)
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

## Deploy

```bash
cd infra/aws
npm ci
npx cdk bootstrap --region eu-central-1
npx cdk deploy --all --require-approval never
```

## Post-deploy

1. **Confirm SNS email** — check `alertEmail` inbox and confirm the subscription.
2. **Session encryption key** — CDK auto-generates a random 64-char hex key in Secrets Manager (`flashcards-open-source-app/session-encryption-key`). It signs OTP session cookies during login. No manual action needed.
3. **SES for OTP emails** — Cognito uses its built-in email sender by default (~50 emails/day). To remove the limit, verify your domain in SES and update `infra/aws/lib/auth.ts` with `UserPoolEmail.withSES(...)`.

## Auth flow

1. Mobile app calls `POST /v1/auth/api/send-code` with `{ email }`.
2. Auth Lambda calls Cognito `InitiateAuth` (EMAIL_OTP), stores session in HMAC-signed cookie, returns CSRF token.
3. Mobile app calls `POST /v1/auth/api/verify-code` with `{ code, csrfToken }`.
4. Auth Lambda calls Cognito `RespondToAuthChallenge`, returns `{ idToken, refreshToken, expiresIn }` in response body.
5. Mobile app stores tokens locally, sends `Authorization: Bearer <idToken>` on sync requests.
6. Backend Lambda verifies JWT via `aws-jwt-verify`, extracts `sub` as userId.
7. `POST /v1/auth/api/refresh-token` — exchange refresh token for new id token.
8. `POST /v1/auth/api/revoke-token` — logout (revoke refresh token).
9. `GET /v1/auth/login?redirect_uri=...` — browser-based login page (for web clients if needed).

## DNS (Cloudflare)

If custom API domain is enabled (`apiCertificateArn` set), run:

```bash
bash scripts/cloudflare/setup-dns.sh --stack-name FlashcardsOpenSourceApp
```

This creates/updates `api.<domain>` CNAME in Cloudflare from stack outputs.
