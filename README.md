# flashcards-open-source-app

Open-source offline-first flashcards app.

## Status

This repository is under active development and not production-ready yet.

## v1 Architecture

- Cloudflare -> API Gateway -> Lambda backend -> Postgres
- app.<domain> -> CloudFront -> S3 web app
- auth.<domain> -> API Gateway -> Lambda auth service -> Cognito
- <domain> -> redirect to app.<domain> when the apex is free during bootstrap
- Email OTP auth via Cognito (passwordless) — auth is a separate public service, backend verifies JWT
- No background worker for scheduling in v1
- Card scheduling is compute-on-write in API (on review submit)
- Card queue is filter-on-read (`due_at <= now()`)

## Planned clients

- Minimal web MVP for first launch
- iOS app in Swift (next)
- Android app later

## Local run

1. `cp .env.example .env`
2. `make db-up`
3. `npm install --prefix apps/auth`
4. `npm install --prefix apps/backend`
5. `npm install --prefix apps/web`
6. `make auth-dev`
7. `make backend-dev`
8. `make web-dev`

Local URLs:

- Web: `http://localhost:3000`
- Backend API: `http://localhost:8080/v1`
- Auth: `http://localhost:8081`

## First AWS deploy

Run one script from the repo root:

```bash
bash scripts/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email you@example.com
```

This script:

- creates/updates `infra/aws/cdk.context.local.json`
- requests API, auth, web, and apex-redirect ACM certificates if needed
- bootstraps and deploys CDK
- uploads web assets
- configures Cloudflare DNS from local `scripts/cloudflare/.env`
- configures GitHub Actions vars/secrets for this repo

If the apex domain already points somewhere else, bootstrap leaves it untouched and only manages `app.<domain>`, `api.<domain>`, and `auth.<domain>`.
