# Admin App

`apps/admin` is the server-protected admin SPA served from `https://admin.<domain>`.

Supported browser entrypoints:

- `http://localhost:3001`
- `https://admin.<domain>`

## Scope

The dashboard carries three report sections, in page order:

- `daily-active-users`
- `catalog-deck-installs`
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

Attribution contract for `daily-active-users`:

- the section answers how many people were in the app on each calendar day, not how many answered a card; an active day is a day carrying that person's `app_opened` event
- identity works exactly as in `review-events-by-date`: grouped by `actor_id`, the same case-folded `org.user_settings` email join, the same `%@example.com` exclusion, and the same treatment of deleted accounts
- one row is one (UTC date, actor, platform), so a person active on the phone and the browser on one day is two rows and one active person; every unique-users number is a distinct count of actors and the platform chart is grouped, never stacked or summed
- `agent` stays its own visible series and is an upper bound on human agent use rather than a count of people, because a scheduled MCP client files an active day for its owner on every day it runs; `db/migrations/0121_backfill_synthetic_app_opened_days.sql` states this in full
- history from before the clients emitted the event is reconstructed from durable traces of somebody having been in a client, at roughly 85% coverage of the people who really opened the app on a sampled day, by that same migration and by its replays, the newest being `db/migrations/0126_backfill_app_opened_rollout_gap.sql`; replays keep running after the clients went live, so reconstructed rows also fall on days a client was already reporting
- reconstructed and live rows are deliberately not distinguished anywhere in the UI
- new versus returning is the actor's first `app_opened` day over all history, which is this section's own cohort definition; `review-events-by-date` keeps using the first review day
- all four shared filters apply: date range reloads the section server-side, and user, cohort and platform are applied client-side

Attribution contract for `catalog-deck-installs`:

- the section answers how many catalog decks were installed on each calendar day and which decks those were; one install action by one person is one event, from `catalog_deck_installed`
- the event is server-emitted after the install transaction commits and keyed by `(workspace_id, install_id)`, so an idempotent replay of the same install cannot count twice
- everything the section needs is on the event, so no `catalog` or `sync` table is read; the deck dimension is `package_slug` and there are no deck titles or version numbers here
- identity works exactly as in `review-events-by-date`: grouped by `actor_id`, the same case-folded `org.user_settings` email join, and the same `%@example.com` exclusion
- two further exclusions are deliberate: the delisted test fixture, narrowly by `package_slug` `'test'` and never by package status, which would need a `catalog` grant this report does not take; and installs by active admins, joined from `auth.admin_users` on the folded `org.user_settings` email with `revoked_at IS NULL`
- almost every install in production history is an admin install, so a nearly empty chart is the intended default rather than a defect; the `auth.admin_users` column grant it needs is `db/migrations/0125_reporting_readonly_admin_users.sql`, and without it deployed the section fails as HTTP 500 `INTERNAL_ERROR` rather than as a readable permission error
- platform is always `unattributed`: the producer writes NULL on purpose, because the install names no server-stored replica or guest session row and the request headers that do name a platform are a client claim, and `db/migrations/0120_backfill_product_analytics_server_facts.sql` wrote none either; the bucket is still derived with the same CASE as every other report, so picking any device platform empties this section
- new versus returning is not recomputed here: the section reads `daily-active-users`' per-actor first `app_opened` day, so the cohort definition lives in one place
- that lookup only covers actors with an `app_opened` day inside the loaded range, so an installer without one is in neither cohort and is dropped as soon as the cohort filter narrows, rather than being guessed into `new` or `returning`
- all four shared filters apply: date range reloads the section server-side, and user, cohort and platform are applied client-side
- the section carries one chart, installs per UTC day stacked by deck, plus summary tiles

Current v1 attribution contract for `review-events-by-date`:

- the report is intended for the current single-effective-learner workspace model
- every chart reads `analytics.product_events_resolved` and no other product table; the only other relation it touches is `org.user_settings`, joined from `actor_id` for the email the `%@example.com` exclusion needs
- rows are grouped by `actor_id`, never by `user_id`, so a guest and the account that guest became count as one person; `users[]` and `rows[].userId` carry that `actor_id`, which is not always an account id
- deleted accounts still appear once they have analytics history: account deletion anonymizes `analytics.product_events` in place, rewriting the id columns to a per-deletion pseudonym UUID and setting `identity_state = 'anonymized'`, so that history keeps resolving to a stable `actor_id` and surfaces as a `(no email)` actor whose raw UUID is visible in the user filter popup and tooltips; `identity_state` is the handle if they ever need filtering out
- the old dashboard showed nothing for them, but not because of its replica join: the same deletion drops the person's sole-member `org.workspaces` rows and `content.review_events` cascades with them, so the rows that query read were already gone
- an account deleted before it had any analytics history is absent here entirely: there was nothing to anonymize, and the `0120` backfill keeps only reviews whose author still has an `org.user_settings` row, which that deletion removed; do not reconcile a total here against `content.review_events` expecting those reviews, in either table
- the `org.user_settings` join folds the stored side with `pg_catalog.lower`, because `actor_id` is a UUID rendered as canonical lowercase hex while `org.user_settings.user_id` is an unconstrained `TEXT` primary key; comparing as stored would miss an uppercase-hex row and count a test account instead of excluding it
- the default chart range is shared by every section and covers the last 30 days ending today, inclusive, in the report timezone; the picker can narrow it or widen it back over the full history, which starts on the first calendar day carrying an `app_opened`, `review_answered`, `friend_invitation_created`, or `friendship_created` event
- dashboard filters can narrow date range, user, new/returning cohort, and platform; all four filters apply to every chart, including the community charts, where a cohort or platform filter keeps community rows only for users that still have review events in range, and the user filter list also offers users with community activity but no review events in range; Reset all returns date range to the same last-30-days default and restores all local filters
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
- the default date filter covers the last 30 days ending today, and widens back to the first app open, review, friend invite, or friendship day
- date, user, new/returning cohort, and platform filters open as popups from the compact filter row
- the dashboard does not show a persistent email or user list outside the user filter popup
- the daily active users section renders above `Catalog deck installs`, with its new-vs-returning, platform, and stacked-by-user charts and no summary tiles
- `Catalog deck installs` renders between `Daily active users` and `Review activity`, with its summary tiles and its one installs-per-day chart stacked by deck
- the catalog installs chart is empty or nearly empty on production data, because installs of the `test` fixture deck and installs by active admins are excluded on purpose
- selecting any device platform empties the catalog installs section while the other sections keep their data
- hovering a catalog installs segment names the deck slug and shows installs of that deck, all decks on that date, and cards added
- unique-users, stacked-by-user, platform-users, platform-events, friend-invite-links, and friend-connections charts all render
- a person keeps the same colour in the daily active users charts and the review charts
- narrowing the date filter reloads all charts, and Reset all restores the default range and all local filters
- hover tooltips on the per-user stacked charts (daily active users, review events, friend invite links, friend connections) may reveal the current email and user ID for the hovered segment, and clicking a segment applies that user filter
- backend logs do not show writes through the reporting path
