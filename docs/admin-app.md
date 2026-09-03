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

`ADMIN_EMAILS` is only the local bootstrap input for local/manual deploy flows. For GitHub Actions deploys, the non-secret CI input is `CDK_ADMIN_EMAILS`, and `scripts/setup/setup-github.sh` creates it only if missing. After bootstrap, edit `CDK_ADMIN_EMAILS` manually in GitHub when changing the deployed bootstrap admin list. Migration/deploy paths:

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
- every chart reads `analytics.product_events_resolved` and no other product table; the only other relation it touches is `org.user_settings`, joined from `actor_id` for the email the `%@example.com` exclusion needs
- rows are grouped by `actor_id`, never by `user_id`, so a guest and the account that guest became count as one person; `users[]` and `rows[].userId` carry that `actor_id`, which is not always an account id
- deleted accounts still appear once they have analytics history: account deletion anonymizes `analytics.product_events` in place, rewriting the id columns to a per-deletion pseudonym UUID and setting `identity_state = 'anonymized'`, so that history keeps resolving to a stable `actor_id` and surfaces as a `(no email)` actor whose raw UUID is visible in the user filter popup and tooltips; `identity_state` is the handle if they ever need filtering out
- the old dashboard showed nothing for them, but not because of its replica join: the same deletion drops the person's sole-member `org.workspaces` rows and `content.review_events` cascades with them, so the rows that query read were already gone
- an account deleted before it had any analytics history is absent here entirely: there was nothing to anonymize, and the `0120` backfill keeps only reviews whose author still has an `org.user_settings` row, which that deletion removed; do not reconcile a total here against `content.review_events` expecting those reviews, in either table
- the `org.user_settings` join folds the stored side with `pg_catalog.lower`, because `actor_id` is a UUID rendered as canonical lowercase hex while `org.user_settings.user_id` is an unconstrained `TEXT` primary key; comparing as stored would miss an uppercase-hex row and count a test account instead of excluding it
- the default chart range starts on the first calendar day carrying a `review_answered`, `friend_invitation_created`, or `friendship_created` event and ends on today, inclusive, in the report timezone
- dashboard filters can narrow date range, user, new/returning cohort, and platform; all four filters apply to every chart, including the community charts, where a cohort or platform filter keeps community rows only for users that still have review events in range, and the user filter list also offers users with community activity but no review events in range; Reset all returns date range to the same first-activity-day-through-today default and restores all local filters
- platform is read off the event row and never derived; the buckets are `web` / `android` / `ios` / `agent` / `unattributed` and are always split, never summed, so agent-API activity cannot read as a person on the site, though `review_answered` never populates `agent`
- a `review_answered` row carries the platform the backend resolved from the replica that recorded the review, and migration `0122` filled the same value on the reconstructed history, `0123` on the live rows the producer wrote before it could resolve one; a value appears only for a `client_installation` replica on `ios`, `android`, or `web`, while a machine-API, an AI-chat, and a seed/reset replica all leave the column NULL, as does a review whose replica row is gone
- `unattributed` therefore means the row carries no resolved device fact, either because the actor behind it is not a device or because no device could be resolved for it, and not either case alone; it stays its own bucket rather than being guessed at or summed into a device
- a bulk review-history import ensures a replica from the importing request and stores it on every imported review event, so one import files its whole batch under the device that performed the import rather than under the device that originally answered; those rows also land on the import day, because `occurred_at` falls back to the server anchor outside the 30-day window, so a large import shows as a single-platform spike on a single day rather than as a defect
- review dates are `occurred_at`, the client clock kept only inside a 30-day window ending at a server anchor and replaced by that anchor outside the window in either direction; inside the window a day is when the person answered rather than when the answer synced, and a first review day can therefore move earlier than the old dashboard reported it
- outside that window the day is the anchor's, and on the review history import the anchor is that request's own clock, so an offline, imported, or guest-merged history older than 30 days lands on sync day rather than on the days it was answered
- friend invite charts count `friend_invitation_created` per actor per UTC date and stack those counts with the same per-user colors as the review-events chart
- friend connection charts are a running sum of `friendship_created` per actor through the end of each UTC date; the producer emits one event per directed friendship row, so the all-user column is intentionally twice the number of friendship pairs
- that running sum is exact given the events, not against `community.friendships`: the emission is best effort and swallows its own failure, and because the chart is cumulative one dropped write lowers that actor's count on that day and on every day after it permanently, with no repair path; a swallowed emission is the first thing to check when the panel disagrees with `community.friendships`, and a duplicate pair is the second, where `community.friendships` holds more than one row for the same invitation and viewer, those rows derive one `event_id`, and `ON CONFLICT DO NOTHING` collapses them into a single event that `0120` accepts as an undercount and reports through a `RAISE NOTICE`
- a `friendship_created` event names only its own viewer, so a friendship whose other side is an `@example.com` test account is no longer excluded
- do not interpret this report as durable review authorship: `content.review_events.reviewed_by_user_id` is `ON DELETE SET NULL`, and account-deletion anonymization rewrites `analytics.product_events.user_id`, so an actor here is who the events currently resolve to rather than a permanent author record

## Reporting data path

Deployed admin analytics do not query Postgres from the browser.

The path is:

1. browser requests `api.<domain>/v1/admin/...`
2. backend Lambda authenticates the human admin session
3. backend Lambda opens the dedicated reporting pool with `reporting_readonly` and a conservative process-local connection cap
4. admin SPA sends chart-owned SQL to `POST /v1/admin/reports/query`
5. backend Lambda runs the read-only SQL inside the VPC against private RDS and returns tabular JSON result sets

`reporting_readonly` remains read-only and supported in two modes:

- manual/operator analytics through an SSM tunnel
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
3. Run `bash scripts/setup/setup-github.sh` so GitHub Actions picks up the admin certificate ARN and the initial bootstrap admin list.
4. Deploy normally.
5. Run `bash scripts/cloudflare/setup-dns.sh --stack-name <stack-name> --domain <domain>` after the stack exposes `AdminCustomDomainTarget`.
6. Run `bash scripts/checks/check-public-endpoints.sh --stack-name <stack-name>` after the DNS change.
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
- a listed admin email loads the dashboard, where the shared hero and filter row sit above titled report sections, each separated by a divider
- a signed-in non-admin sees the access denied page
- network traces show `POST /v1/admin/reports/query` for dashboard data
- the default date filter starts on the first review, friend invite, or friendship day and ends on today
- date, user, new/returning cohort, and platform filters open as popups from the compact filter row
- the dashboard does not show a persistent email or user list outside the user filter popup
- unique-users, stacked-by-user, platform-users, platform-events, friend-invite-links, and friend-connections charts all render
- narrowing the date filter reloads all charts, and Reset all restores the default range and all local filters
- hover tooltips on the per-user stacked charts (review events, friend invite links, friend connections) may reveal the current email and user ID for the hovered segment, and clicking a segment applies that user filter
- backend logs do not show writes through the reporting path
