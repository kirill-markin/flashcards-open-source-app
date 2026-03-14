# Deployment

## Local

### Start

```bash
cp .env.example .env
make db-up
npm install --prefix apps/auth
npm install --prefix apps/backend
npm install --prefix apps/web
```

Then run the dev servers in separate terminals:

```bash
make auth-dev
make backend-dev
make web-dev
```

This starts:

1. `postgres` (Docker, port 5432)
2. `migrate` (Docker, runs `scripts/migrate.sh`)
3. `auth` (Node dev server on port 8081)
4. `backend` (Node dev server on port 8080)
5. `web` (Vite dev server on port 3000)

By default `AUTH_MODE=none` — backend accepts local requests as `userId=local`. Set `AUTH_MODE=cognito` and fill in Cognito env vars in `.env` to test real OTP auth and shared-domain cookies locally.

### iOS config

The iOS app reads `API_BASE_URL` and `AUTH_BASE_URL` from `apps/ios/Flashcards/Config/Local.xcconfig`.

Copy `apps/ios/Flashcards/Config/Local.xcconfig.example` if needed and fill your personal hosts there.

Important: Xcode `.xcconfig` treats `//` as a comment, so URL values must be written like this:

```xcconfig
API_BASE_URL = https:/$()/api.example.com/v1
AUTH_BASE_URL = https:/$()/auth.example.com
```

Do not use literal `https://...` inside `.xcconfig`, or Xcode will truncate the value to `https:`.

### Stop

```bash
make db-down
```

## AWS (CDK)

The CDK stack provisions:

- VPC + private subnets
- RDS Postgres
- Cognito User Pool (EMAIL_OTP passwordless auth)
- API Gateway for backend + API Gateway for auth
- two Lambdas (backend + auth)
- S3 bucket + CloudFront distribution for `app.<domain>`
- optional CloudFront redirect distribution for the apex domain
- Session encryption key in Secrets Manager
- CloudWatch alarms + SNS topic
- AWS Backup plan for RDS

### First deploy

```bash
export AWS_PROFILE=flashcards-open-source-app
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
bash scripts/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email alerts@example.com
```

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are optional. When present, the deploy flow writes them to AWS Secrets Manager and stores the resulting secret ARNs in `infra/aws/cdk.context.local.json` so CDK can inject them into the backend Lambda. When absent, infrastructure still deploys and AI chat or transcription requests return stable "not configured" or temporary-unavailable errors until the keys are configured later.

To use custom domains:

`scripts/first-deploy.sh` handles the certificate setup, CDK deploy, web upload, DNS setup, and GitHub Actions configuration. It reads Cloudflare credentials from `scripts/cloudflare/.env` if that file exists.

Public domains after deploy:

- `https://<domain>` — redirects to `https://app.<domain>` when the apex is unused during bootstrap
- `https://app.<domain>` — web app
- `https://api.<domain>/v1` — backend API
- `https://auth.<domain>` — auth UI and auth API

If the apex already points to a real marketing site or any other existing DNS target, bootstrap skips the apex redirect and leaves the domain untouched.

### CI/CD

GitHub Actions deploys on push to `main` using OIDC role from stack outputs.
GitHub stores only the optional AI secret ARNs as repository variables; the actual provider keys stay in AWS Secrets Manager.
