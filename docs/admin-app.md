# Admin App

`apps/admin` is the server-protected admin SPA served from `https://admin.<domain>`.

Supported browser entrypoints:

- `http://localhost:3001`
- `https://admin.<domain>`

## Scope

v1 includes one report only:

- `review-events-by-date`

The admin app is a separate React + TypeScript + Vite package. It does not reuse the web app runtime storage or sync code.

## Authentication and authorization

- Authentication source: the existing Cognito + `auth.<domain>` browser flow.
- Session transport: the existing cross-subdomain browser session cookies.
- Authorization source of truth: `auth.admin_users`.
- Admin grants are keyed by normalized email, not by app `user_id`.

Admin access is checked on every `/v1/admin/*` backend request:

- unauthenticated request: `401`
- signed-in non-admin: `403` with `ADMIN_ACCESS_REQUIRED`
- non-human transport such as `guest` or `api_key`: `403` with `ADMIN_HUMAN_AUTH_REQUIRED`

## Data model

`auth.admin_users` stores:

- `email`
- `granted_at`
- `granted_by`
- `revoked_at`
- `note`
- `source`

Active admin access means `revoked_at IS NULL`.

`auth.admin_users` is the runtime source of truth for active admin access.

`ADMIN_EMAILS` is only the local bootstrap input for local/manual deploy flows. For GitHub Actions deploys, the non-secret CI input is `CDK_ADMIN_EMAILS`, and `scripts/setup-github.sh` creates it only if missing. After bootstrap, edit `CDK_ADMIN_EMAILS` manually in GitHub when changing the deployed bootstrap admin list. Migration/deploy paths:

- upsert active bootstrap grants for listed emails
- revoke removed bootstrap grants only when their current `source` is `bootstrap`
- leave `source='manual'` rows untouched

## Backend surface

The backend exposes:

- `GET /v1/admin/session`
- `POST /v1/admin/reports/query`

The query endpoint accepts:

- `sql`: raw SQL string executed by the backend through `reporting_readonly`

The query payload includes:

- `executedAtUtc`
- `resultSets[]`

Current v1 attribution contract for `review-events-by-date`:

- the report is intended for the current single-effective-learner workspace model
- the default chart range starts on the first calendar day with any `content.review_events.reviewed_at_server` row and ends on today, inclusive, in the report timezone
- dashboard date range filters can narrow that range, and Reset returns to the same first-review-day-through-today default
- `users[]` and `rows[].userId` are derived from the current `sync.workspace_replicas.user_id` label for stacked per-user event volume
- platform charts derive `web` / `android` / `ios` from `content.review_events.replica_id -> sync.workspace_replicas.platform`
- that label is acceptable for today's product shape, but it is not a durable historical review-author field
- do not interpret this report as collaborative per-user analytics unless review authorship is stored immutably on each review event

## Reporting data path

Deployed admin analytics do not query Postgres from the browser.

The path is:

1. browser requests `api.<domain>/v1/admin/...`
2. backend Lambda authenticates the human admin session
3. backend Lambda opens the dedicated reporting pool with `reporting_readonly` and a conservative process-local connection cap
4. admin SPA sends chart-owned SQL to `POST /v1/admin/reports/query`
5. backend Lambda runs the read-only SQL inside the VPC against private RDS and returns tabular JSON result sets

`reporting_readonly` remains read-only and supported in two modes:

- manual/operator analytics through SSH tunneling
- controlled server-side admin analytics from the backend Lambda

## Local development

Install and run:

```bash
npm install --prefix apps/admin
make db-up
make auth-dev
make backend-dev
make admin-dev
```

Reserved local ports:

- web: `http://localhost:3000`
- admin: `http://localhost:3001`
- backend: `http://localhost:8080`
- auth: `http://localhost:8081`

Local allowlists must include both localhost origins for auth redirects and backend CORS.

When the backend runs with `AUTH_MODE=none` and `ALLOW_INSECURE_LOCAL_AUTH=true`, `/v1/admin/*` accepts localhost-only admin requests and attributes them as `local-admin@localhost`. That insecure shortcut is limited to loopback hosts and is not supported on deployed domains.

## Self-hosted deploy

For the first `admin.<domain>` rollout, use this exact order:

1. Set `ADMIN_EMAILS` in root `.env` for the initial bootstrap.
2. Run `bash scripts/cloudflare/setup-admin-domain.sh --domain <domain>` when the admin certificate does not exist yet.
3. Run `bash scripts/setup-github.sh` so GitHub Actions picks up the admin certificate ARN and the initial bootstrap admin list.
4. Deploy normally.
5. Run `bash scripts/cloudflare/setup-dns.sh --stack-name <stack-name> --domain <domain>` after the stack exposes `AdminCustomDomainTarget`.
6. Run `bash scripts/check-public-endpoints.sh --stack-name <stack-name>` after the DNS change.
7. Open `https://admin.<domain>`.
8. Sign in with the existing Cognito email.
9. Confirm that the dashboard loads.

Important rollout note: if `CDK_ADMIN_CERTIFICATE_ARN_US_EAST_1` or `CDK_ADMIN_EMAILS` was added to GitHub after a release workflow had already started, that in-flight workflow does not see the new values. In that case, finish the setup above and then run another deploy or rerun the workflow.

If the environment already exists and the deployed bootstrap admin list changes later, update `CDK_ADMIN_EMAILS` manually in GitHub before deploying.

The supported browser entrypoint is `https://admin.<domain>`.
The admin frontend fails fast on any other non-local hostname. Do not serve the browser entry on a raw CloudFront or other non-admin hostname, and do not treat the raw CloudFront distribution hostname as a supported admin URL.

## Manual smoke checklist

- `https://admin.<domain>` returns `200`
- unauthenticated access redirects to the login flow
- a listed admin email loads the dashboard
- a signed-in non-admin sees the access denied page
- network traces show `POST /v1/admin/reports/query` for dashboard data
- the default date filter starts on the first review-event day and ends on today
- unique-users, stacked-by-user, platform-users, and platform-events charts all render
- narrowing the date filter reloads all charts, and Reset restores the default range
- no persistent email or user list is shown in the dashboard UI; stacked-by-user hover tooltips may reveal the current email and user ID for the hovered segment
- backend logs do not show writes through the reporting path
