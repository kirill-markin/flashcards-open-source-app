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

## Card scheduling

- Review scheduling uses FSRS-6 with pinned default weights
- The full scheduler is implemented in backend and iOS and must stay behaviorally identical
- The web app mirrors the scheduler data contract and review flow, but does not contain a third FSRS implementation
- Cards appear in review when they are due: `due_at <= now()`
- Detailed scheduling rules live in [`docs/fsrs-scheduling-logic.md`](docs/fsrs-scheduling-logic.md)

## Clients

- Web app in `apps/web` for cards, decks, review, and AI chat
- iOS app in `apps/ios` with local SQLite, offline-first review flow, and FSRS parity with backend
- Android app later

The discovery response tells agents to ask for the user's email first, and the same email OTP flow covers both signup and login.

## Local run

1. `cp .env.example .env`
2. `make db-up`
3. `npm install --prefix api`
4. `npm install --prefix apps/auth`
5. `npm install --prefix apps/backend`
6. `npm install --prefix apps/web`
7. `make auth-dev`
8. `make backend-dev`
9. `make web-dev`

Local URLs:

- Web: `http://localhost:3000`
- Backend API: `http://localhost:8080/v1`
- Auth: `http://localhost:8081`

## First AWS deploy

Run one script from the repo root:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."

bash scripts/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email you@example.com
```

Both AI provider variables are optional. If they are exported, the deploy flow stores them in AWS Secrets Manager, records the secret ARNs in `infra/aws/cdk.context.local.json`, and configures the backend Lambda from AWS secrets. If they are omitted, the app still deploys successfully and the AI chat and transcription endpoints return stable "not configured" or temporary-unavailable errors until keys are configured later.

This script:

- creates/updates `infra/aws/cdk.context.local.json`
- optionally creates/updates AWS Secrets Manager secrets for `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`
- requests API, auth, web, and apex-redirect ACM certificates if needed
- bootstraps and deploys CDK
- uploads web assets
- configures Cloudflare DNS from local `scripts/cloudflare/.env`
- configures GitHub Actions vars/secrets for this repo

To add or rotate AI provider keys later without a full first deploy:

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
bash scripts/setup-ai-secrets.sh --region eu-central-1
bash scripts/setup-github.sh
```

If the apex domain already points somewhere else, bootstrap leaves it untouched and only manages `app.<domain>`, `api.<domain>`, and `auth.<domain>`.
