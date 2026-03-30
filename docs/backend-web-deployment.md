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

Set `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP=400000` in local `.env` if you want guest AI enabled locally. When this variable is missing or empty, backend defaults it to `0`, so guest AI fails closed with the existing limit-reached response.

Stop local services with:

```bash
make db-down
```

## First AWS deploy

Keep the operator config in root `.env`. The important deploy-time values are:

- `AWS_REGION`
- `DOMAIN_NAME`
- `ALERT_EMAIL`
- `GITHUB_REPO`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `RESEND_API_KEY`
- `RESEND_ADMIN_API_KEY`
- optional `OPENAI_API_KEY`
- optional `DEMO_EMAIL_DOSTIP`
- optional `DEMO_PASSWORD_DOSTIP`

Then run:

```bash
bash scripts/first-deploy.sh \
  --region eu-central-1 \
  --domain flashcards-open-source-app.com \
  --alert-email alerts@example.com
```

The first deploy flow:

- stores required runtime secrets in AWS Secrets Manager
- stores optional AI and demo auth secrets in AWS Secrets Manager when configured
- requests ACM certificates for API, auth, web, and apex redirect when needed
- assembles `infra/aws/cdk.context.local.json` as the local CDK input
- bootstraps and deploys CDK
- uploads web assets
- configures Cloudflare DNS when requested
- syncs deploy config to GitHub Actions variables

Public domains after deploy:

- `https://<domain>`
- `https://app.<domain>`
- `https://api.<domain>/v1`
- `https://auth.<domain>`

If the apex domain already points to an existing site, bootstrap leaves it untouched and manages only `app.<domain>`, `api.<domain>`, and `auth.<domain>`.

## Later secret updates

```bash
bash scripts/setup-resend-secret.sh --region eu-central-1
bash scripts/setup-ai-secrets.sh --region eu-central-1
bash scripts/setup-auth-secrets.sh --region eu-central-1
bash scripts/setup-github.sh
```

Run only the secret setup scripts you actually need. `setup-github.sh` rediscovers the current AWS ARNs and syncs the matching GitHub variables afterward.

## CI/CD

GitHub Actions uses one dedicated `AWS/Web Release` workflow on push to `main`. The repository stores:

- GitHub variables for all non-secret deploy config, including certificate ARNs and secret ARNs
- one GitHub secret for `AWS_DEPLOY_ROLE_ARN`

The release workflow assembles its own `cdk.context.local.json` inside the job from GitHub deploy config.

For AWS-backed changes, the main-branch order is:

1. detect whether AWS-related paths changed
2. run the pre-deploy API/auth/backend/web/infra checks inside `AWS/Web Release`
3. deploy backend, auth, infra, and web to production
4. run the native Playwright live smoke in `apps/web/e2e/live-smoke.spec.ts`
5. keep the new AWS release only if the smoke passes
6. roll the whole AWS runtime back to the previous retained AWS SHA if the smoke fails and the release did not include DB migrations
7. fail loudly and require fix-forward when the smoke fails after DB migrations

Manual `workflow_dispatch` runs use the same embedded pre-deploy checks before the release starts.

This repository does not try to prove backend and web correctness with exhaustive test coverage before deploy. The highest-confidence automated signal is the real Playwright live smoke that runs against the deployed environment closest to production, and any additional non-smoke tests should stay targeted to important module boundaries or contracts.

After pushing to `main`, watch `AWS/Web Release` until the release either retains the AWS runtime, reverts it, or fails clearly. A failed AWS release with DB migrations is intentionally a fix-forward path; the next push must still be allowed to deploy.

Cross-client live smoke references:

- Web: `apps/web/e2e/live-smoke.spec.ts`
- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmokeUITests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/LiveSmokeTest.kt`

Guest AI quota is configured separately:

- local dev uses `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` from root `.env`
- GitHub Actions stores `CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` as a repo variable
- CDK injects it into both backend Lambdas as `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP`

If the GitHub variable is unset, the deployed backend receives `0` and guest AI stays disabled fail-closed.
