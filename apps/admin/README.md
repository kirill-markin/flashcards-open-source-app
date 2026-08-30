# Admin App

`apps/admin` is the browser admin SPA for `https://admin.<domain>`.

Supported browser entrypoints:

- `http://localhost:3001`
- `https://admin.<domain>`

## Local development

Install dependencies:

```bash
npm install --prefix apps/admin
```

Start the local stack in separate terminals:

```bash
make db-up
make auth-dev
make backend-dev
make admin-dev
```

Local defaults:

- admin app: `http://localhost:3001`
- backend: `http://localhost:8080/v1`
- auth: `http://localhost:8081`

The local backend and auth allowlists must include both `http://localhost:3000` and `http://localhost:3001`.

## Auth flow

- The app calls `GET /v1/admin/session` on load.
- `401` first attempts the existing `auth.<domain>/api/refresh-session` silent recovery flow, then redirects to login only if recovery fails.
- `403` renders the admin access denied state.
- `200` loads dashboard data through `POST /v1/admin/reports/query`.

The admin app uses the existing Cognito browser session cookies. It does not introduce a separate login system.

## Hosting contract

The admin SPA is supported only on the two entrypoints above. The frontend derives backend and auth hosts from the active browser hostname and fails fast on any other non-local hostname.

Do not host the browser entry on a raw CloudFront or other non-admin hostname, even if you can inject Vite environment variables during the build. Auth redirect allowlists and backend origin checks are intentionally aligned to `localhost` and `admin.<domain>` only.

## Current scope

v1 includes one dashboard page only:

- `review-events-by-date`

The dashboard shows six charts:

- daily unique users
- stacked review events by user
- daily active users by platform
- daily review events by platform
- daily friend invite links created, stacked by user
- existing friend connections at the end of each day, counted per user and stacked by user

The default chart range starts on the first calendar day carrying a `review_answered`, `friend_invitation_created`, or `friendship_created` event and ends on today, inclusive, in the dashboard timezone. The dashboard includes date range filters that can narrow the chart range and reset back to that default.
The filter panel keeps date, user, new/returning cohort, and platform filters in one compact row. All four filters apply to every chart, including the friend invite and friend connection charts, which carry per-user community rows. A cohort or platform filter keeps community rows only for users that still have review events in range, and the user filter list also offers users with community activity but no review events in range. User emails and user IDs are shown only inside the user filter popup and chart tooltips, not as a persistent page list.

Its SQL lives in the admin frontend as a chart-owned query and runs through the generic admin reporting endpoint.

### Where the data comes from

Every chart reads `analytics.product_events_resolved` and no other product table; the only other relation it touches is `org.user_settings`, joined from `actor_id` for the email the `%@example.com` exclusion needs. The dashboard does not join `content.review_events`, `sync.workspace_replicas`, `community.friend_invitations`, or `community.friendships` any more.

- review series: `review_answered`
- friend invite links: `friend_invitation_created`
- friend connections at the end of each day: a running sum of `friendship_created`

Rows are grouped by `actor_id`, never by `user_id`. The view already collapses a guest and the account that guest became into one person, so the previous `actor_kind` filter and the inline guest-merge reasoning are gone. `actor_id` is not always an account id: a guest who never upgraded stays on the guest user id.

Deleted accounts appear in the numbers once they have analytics history. Account deletion anonymizes rather than erases: it rewrites the event rows to a per-deletion pseudonym UUID and marks them `identity_state = 'anonymized'`, so that history still resolves to a stable `actor_id` and shows as a `(no email)` actor with a raw UUID in the user filter popup and in tooltips. This is intended, since the reviews really happened; `analytics.product_events_resolved.identity_state` is the handle if they ever need filtering out.

The old dashboard showed nothing for them, but that was not its replica join: the same deletion drops the person's sole-member workspace rows and `content.review_events` cascades away with them, so the rows that query read were already gone. The same mechanism means an account deleted before it had any analytics history is absent here entirely - there was nothing to anonymize, and the `0120` backfill kept only reviews whose author still had an `org.user_settings` row, which that deletion also removed. Those reviews are in neither table, so do not go looking for them in `content.review_events` when a total does not reconcile.

The email that the `%@example.com` exclusion needs is not in the events table, so it is joined from `actor_id` to `org.user_settings`. `actor_id` is a UUID and renders as canonical lowercase hex, while `org.user_settings.user_id` is an unconstrained `TEXT` primary key, so that join folds the stored side with `pg_catalog.lower`. Comparing as stored would silently miss an uppercase-hex row, and a test account with no matched email is counted rather than excluded.

Platform is read off the event row and never derived. The buckets are `web`, `android`, `ios`, `agent`, and `unattributed`, and they are always split, never summed: an agent-API client merged into `web` would read as a person using the site. A `review_answered` row carries the platform the backend resolved from the replica that recorded the review, and migration `0122` filled the same value on the reconstructed history, so both platform charts colour real device activity. A value appears only for a `client_installation` replica on `ios`, `android`, or `web`; a machine-API, an AI-chat, and a seed/reset replica all leave the column NULL, as does a review whose replica row is gone. `unattributed` therefore means the row carries no resolved device fact - either the actor behind it is not a device, or no device could be resolved for it - and it stays its own bucket rather than being guessed at or summed into a device.

One thing to read the two platform charts with: a bulk review-history import ensures a replica from the importing request, and every imported review event stores that replica, so one import files its whole batch under the device that performed the import rather than under the device that originally answered. Those rows already land on the import day, because `occurred_at` falls back to the server anchor outside the 30-day window. A large import therefore shows as a single-platform spike on a single day, and that is the import showing through rather than a defect.

Numbers do not match the pre-rewrite dashboard, and are not meant to. Days shift because `occurred_at` is the client clock kept only inside a 30-day window ending at a server anchor: inside that window it is when the person answered rather than when the answer synced, while outside it in either direction the anchor replaces it, so an offline, imported, or guest-merged history older than 30 days lands on sync day instead. The other differences: the `actor_kind = 'client_installation'` filter is gone, the anonymized history of accounts deleted after they had analytics history is counted rather than dropped, and a friendship with a test account on the far side is no longer excluded because a `friendship_created` event names only its own viewer.
