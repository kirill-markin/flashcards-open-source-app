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
bash scripts/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email alerts@example.com
```

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
