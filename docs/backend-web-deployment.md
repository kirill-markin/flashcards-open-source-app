# Backend and Web Deployment

## Local start

```bash
cp .env.example .env
make db-up
npm install --prefix apps/auth
npm install --prefix apps/backend
npm install --prefix apps/web
```

Run the dev servers in separate terminals:

```bash
make auth-dev
make backend-dev
make web-dev
```

This starts:

1. `postgres` on port `5432`
2. `migrate` via `scripts/migrate.sh`
3. `auth` on port `8081`
4. `backend` on port `8080`
5. `web` on port `3000`

By default `AUTH_MODE=none`, so backend accepts local requests as `userId=local`. Set `AUTH_MODE=cognito` and fill the Cognito values in `.env` to test the real OTP flow locally.

Stop local services with:

```bash
make db-down
```

## First AWS deploy

```bash
export AWS_PROFILE=flashcards-open-source-app
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
bash scripts/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email alerts@example.com
```

`OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are optional. When present, the deploy flow writes them to AWS Secrets Manager, stores the resulting secret ARNs in `infra/aws/cdk.context.local.json`, and injects them into the backend Lambda. When absent, infrastructure still deploys and AI features return stable not-configured or temporary-unavailable errors.

The first deploy flow:

- creates or updates `infra/aws/cdk.context.local.json`
- optionally creates or updates AI provider secrets
- requests ACM certificates for API, auth, web, and apex redirect
- bootstraps and deploys CDK
- uploads web assets
- configures Cloudflare DNS from `scripts/cloudflare/.env` when present
- configures GitHub Actions vars and secrets for the repo

Public domains after deploy:

- `https://<domain>`
- `https://app.<domain>`
- `https://api.<domain>/v1`
- `https://auth.<domain>`

If the apex domain already points to an existing site, bootstrap leaves it untouched and manages only `app.<domain>`, `api.<domain>`, and `auth.<domain>`.

## Later AI key updates

```bash
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
bash scripts/setup-ai-secrets.sh --region eu-central-1
bash scripts/setup-github.sh
```

## CI/CD

GitHub Actions deploys on push to `main` using the stack OIDC role. GitHub stores only optional AI secret ARNs as repository variables; the actual provider keys stay in AWS Secrets Manager.
