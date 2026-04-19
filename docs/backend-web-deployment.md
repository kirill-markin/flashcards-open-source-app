# Backend and Web Deployment

## Local start

```bash
cp .env.example .env
make db-up
npm install --prefix apps/auth
npm install --prefix apps/backend
npm install --prefix apps/web
npm install --prefix apps/admin
```

Run the dev servers in separate terminals:

```bash
make auth-dev
make backend-dev
make web-dev
make admin-dev
```

This starts:

1. `postgres` on port `5432`
2. `migrate` via `scripts/migrate.sh`
3. `auth` on port `8081`
4. `backend` on port `8080`
5. `web` on port `3000`
6. `admin` on port `3001`

By default `AUTH_MODE=none`, so backend accepts local requests as `userId=local`. Set `AUTH_MODE=cognito` and fill the Cognito values in `.env` to test the real OTP flow locally.

Set `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP=400000` in local `.env` if you want guest AI enabled locally. When this variable is missing or empty, backend defaults it to `0`, so guest AI fails closed with the existing limit-reached response.

Stop local services with:

```bash
make db-down
```

## Local browser smoke with auth

The full local web smoke is intentionally separate from the deployed post-release smoke.

Use it only against the local stack:

1. keep root `.env` in `AUTH_MODE=cognito`
2. set `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`, `COGNITO_REGION`, and `SESSION_ENCRYPTION_KEY`
3. set `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP` for the local review/demo account
4. start `make db-up`
5. start `make auth-dev`
6. start `make backend-dev`
7. run `npm run test:e2e:local --prefix apps/web`

`test:e2e:local` talks only to:

- local web on `http://localhost:3000`
- local backend on `http://localhost:8080`
- local auth on `http://localhost:8081`

Playwright builds and serves the local web preview automatically, but it does not start backend or auth for you. The preflight step fails immediately if local auth or backend is missing or if the local smoke points at any deployed origin.

This split is deliberate:

- local smoke validates the current branch without relying on production auth redirect allowlists
- CI/CD post-deploy smoke still validates the deployed production path after release

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
- requests the ACM certificate for `admin.<domain>` when needed
- assembles `infra/aws/cdk.context.local.json` as the local CDK input
- bootstraps and deploys CDK
- uploads web and admin assets
- configures Cloudflare DNS when requested
- populates missing deploy config in GitHub Actions variables without overwriting existing values

Public domains after deploy:

- `https://<domain>`
- `https://app.<domain>`
- `https://admin.<domain>`
- `https://api.<domain>/v1`
- `https://auth.<domain>`

If the apex domain already points to an existing site, bootstrap leaves it untouched and manages only `app.<domain>`, `admin.<domain>`, `api.<domain>`, and `auth.<domain>`.

For the admin app, the supported browser entrypoints are `http://localhost:3001` and `https://admin.<domain>`. Treat `admin.<domain>` as the only supported deployed browser entrypoint.
For the first admin-domain rollout, treat `bash scripts/cloudflare/setup-admin-domain.sh --domain <domain>`, `bash scripts/setup-github.sh`, a deploy, and then `bash scripts/cloudflare/setup-dns.sh --stack-name <stack-name> --domain <domain>` as one complete setup sequence. If the GitHub variables were created after a workflow had already started, run another deploy or rerun the workflow after the variables exist.

## Later secret updates

```bash
bash scripts/setup-resend-secret.sh --region eu-central-1
bash scripts/setup-ai-secrets.sh --region eu-central-1
bash scripts/setup-auth-secrets.sh --region eu-central-1
bash scripts/setup-github.sh
```

Run only the secret setup scripts you actually need. `setup-github.sh` rediscovers the current AWS ARNs and fills in any missing matching GitHub variables afterward, leaving existing values untouched.
This bootstrap-only rule also applies to `CDK_ADMIN_EMAILS`: after the first setup, change that GitHub variable manually when you need to change the deployed bootstrap admin list.

## Optional review/demo auth

`DEMO_EMAIL_DOSTIP` enables insecure instant sign-in only for listed review/demo emails in the `example.com` domain. `DEMO_PASSWORD_DOSTIP` stores the shared review/demo password. Keep both values as explicit deploy config and store the shared password in AWS Secrets Manager for deployed environments.

If review/demo access is enabled, create the matching `@example.com` Cognito users manually and keep their emails and shared password aligned with the deployed allowlist and demo password secret. The intended setup flow is:

1. keep `DEMO_EMAIL_DOSTIP` and `DEMO_PASSWORD_DOSTIP` in the local root `.env`
2. run `bash scripts/setup-auth-secrets.sh --region <aws-region>`
3. run `bash scripts/setup-github.sh`

We intentionally keep Cognito user creation manual instead of adding an automated provisioning script for these insecure review-only accounts.

## CI/CD

GitHub Actions uses one dedicated `AWS/Web Release` workflow on push to `main`. The repository stores:

- GitHub variables for all non-secret deploy config, including certificate ARNs and secret ARNs
- `CDK_ADMIN_EMAILS` as the GitHub-managed deploy input for bootstrap admin grants
- one GitHub secret for `AWS_DEPLOY_ROLE_ARN`

The release workflow assembles its own `cdk.context.local.json` inside the job from GitHub deploy config.
Root `.env` is not the live CI source of truth after bootstrap. If `CDK_ADMIN_EMAILS` must change for deployed environments, edit it manually in GitHub before the next release.

For AWS-backed changes, the main-branch order is:

1. detect whether AWS-related paths changed
2. run the pre-deploy build/test checks inside `AWS/Web Release`, including the auth route tests
3. deploy backend, auth, infra, web, and admin hosting to production
4. publish `apps/web` and `apps/admin` assets after CDK deploy
5. run the deployed API/custom-domain checks after the full release is in place
6. run the native Playwright live smoke in `apps/web/e2e/live-smoke.spec.ts`
7. run the external agent API smoke in `scripts/check-agent-api-smoke.sh`
8. finish green only if the post-deploy checks pass
9. finish red if a post-deploy smoke fails, without rolling production back

Manual `workflow_dispatch` runs use the same embedded pre-deploy checks before the release starts.

This repository does not try to prove backend and web correctness with exhaustive test coverage before deploy. The highest-confidence automated signals are the real Playwright web smoke and the real agent API smoke that run against the deployed environment closest to production, and any additional non-smoke tests should stay targeted to important module boundaries or contracts.

Cross-client live smoke references:

- Web: `apps/web/e2e/live-smoke.spec.ts`
- iOS: `apps/ios/Flashcards/FlashcardsUITests/LiveSmoke*Tests.swift`
- Android: `apps/android/app/src/androidTest/java/com/flashcardsopensourceapp/app/livesmoke/LiveSmokeTest.kt`

After pushing to `main`, watch `AWS/Web Release` until the release either finishes green or fails clearly after deploy. This pipeline is intentionally fix-forward only: a failed post-deploy smoke leaves the deployed AWS/Web release in place, marks that run failed, and the next push must still be allowed to deploy.

The workflow does not perform an automated production admin login smoke in v1. Use the manual checklist in [docs/admin-app.md](./admin-app.md) after deploy.

Guest AI quota is configured separately:

- local dev uses `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` from root `.env`
- GitHub Actions stores `CDK_GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP` as a repo variable
- CDK injects it into both backend Lambdas as `GUEST_AI_WEIGHTED_MONTHLY_TOKEN_CAP`

If the GitHub variable is unset, the deployed backend receives `0` and guest AI stays disabled fail-closed.
