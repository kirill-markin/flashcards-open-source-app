# Admin App

`apps/admin` is the browser admin SPA for `https://admin.<domain>`.

Supported browser entrypoints:

- `http://localhost:3001`
- `https://admin.<domain>`

## Routes

- `/` - links to the analytics pages
- `/analytics` - links to the three analytics areas
- `/analytics/general` - the General report sections
- `/analytics/funnels` - the catalog installation funnel
- `/analytics/audience` - the audience report
- any other path - the not-found page, naming the path as typed

Every area has its own URL, so a reload or a shared link reopens the same area, and a trailing slash on a known path is normalized in place. The filter selection of General and Audience rides in the query string of that same URL and replaces the current history entry rather than pushing one, so a shared link reopens the same filtered view and Back leaves the area instead of stepping through every filter click. A deep link into any of these paths depends on the admin CloudFront SPA rewrite in [infra/aws/lib/admin.ts](../../infra/aws/lib/admin.ts).

Every route resolves `GET /v1/admin/session` first, and `/`, `/analytics` and the not-found page need nothing more. General and Audience then load the review range once per page load, and the three General reports on the first entry into either area and again on every filter change, including every applied range, preset or reset. Every filter is applied in SQL, so a burst of clicks is coalesced into a single reload shortly after the last one and the loads it superseded are dropped. The user, connection country and app UI language filter options and the chart colour domains come from their own range-scoped query, fetched again only when the range changes. Those results stay in memory, so moving between areas does not fetch them again. Audience additionally fetches its own audience report on every entry and whenever the live filter selection changes, once the General reload it waits out has settled, with no in-memory reuse; Funnels loads only its own funnel data. A failed report load stays inside the report area with a Retry button while the hero, the navigation and Funnels keep working, and only a terminal `401`/`403` replaces the page.

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

The admin app uses the existing Cognito browser session cookies. It does not introduce a separate login system.

## Hosting contract

The admin SPA is supported only on the two entrypoints above. The frontend derives backend and auth hosts from the active browser hostname and fails fast on any other non-local hostname.

Do not host the browser entry on a raw CloudFront or other non-admin hostname, even if you can inject Vite environment variables during the build. Auth redirect allowlists and backend origin checks are intentionally aligned to `localhost` and `admin.<domain>` only.

## Current scope

The General area carries three report sections in page order:

- `daily-active-users`
- `catalog-deck-installs`
- `review-events-by-date`

The dashboard shows ten charts:

- daily unique active users, new vs returning
- daily active users by platform
- daily active users stacked by user
- daily catalog deck installs, stacked by deck
- daily unique users with at least 1 review event, new vs returning
- stacked review events by user
- daily reviewing users by platform
- daily review events by platform
- daily friend invite links created, stacked by user
- existing friend connections at the end of each day, counted per user and stacked by user

The default chart range is shared by every section and covers the last 30 days ending today, inclusive, in the dashboard timezone. The dashboard includes date range filters that can narrow the chart range, widen it back over the full history starting on the first calendar day carrying an `app_opened`, `review_answered`, `friend_invitation_created`, or `friendship_created` event, and reset back to that default.
One shared filter bar sits above the General and Audience sections and offers exactly the fields [the filter model](src/filters/analyticsFilters.ts) declares applicable to the active area, wired so far for date range, user, new/returning cohort, platform, the per-user event thresholds, connection country and app UI language. Every field's popover carries the field's full label, what it counts and how, and the current selection as removable chips; the option fields are multi-selects, the date field opens the two-month UTC range calendar, where the second click applies the range, and the threshold field takes one minimum count per event type, combined so a user must clear every one of them. Connection country and app UI language restrict people rather than rows: a country comes from a retained connection sample, kept for 90 days only, and a language from the UI locale a client wrote on the event, so a person with neither matches no value and is dropped as soon as either field is narrowed. All seven filters apply to every chart, including the friend invite and friend connection charts, which carry per-user community rows. A cohort or platform filter keeps community rows only for users that still have review events in range, and the user filter list also offers users with community activity but no review events in range. User emails and user IDs are shown only inside the user filter popup and chart tooltips, not as a persistent page list.

Its SQL lives in the admin frontend as a chart-owned query and runs through the generic admin reporting endpoint.

### Where the data comes from

Every chart reads `analytics.product_events_resolved` and no other product table. It touches two more relations and nothing else: `org.user_settings`, joined from `actor_id` for the email the `%@example.com` exclusion needs, and `auth.admin_users`, read by the installs chart alone to drop installs made by active admins. The dashboard does not join `content.review_events`, `sync.workspace_replicas`, `catalog.packages`, `community.friend_invitations`, or `community.friendships` any more.

- review series: `review_answered`
- catalog deck installs: `catalog_deck_installed`, with the deck named by its `package_slug` property
- friend invite links: `friend_invitation_created`
- friend connections at the end of each day: a running sum of `friendship_created`

The installs chart is nearly empty on production data on purpose: installs of the delisted `test` fixture deck and installs by active admins are both excluded, and almost every real install so far is an admin install. That event carries no platform, so picking any device platform empties that section. See [docs/admin-app.md](../../docs/admin-app.md) for the full attribution contract.

Rows are grouped by `actor_id`, never by `user_id`. The view already collapses a guest and the account that guest became into one person, so the previous `actor_kind` filter and the inline guest-merge reasoning are gone. `actor_id` is not always an account id: a guest who never upgraded stays on the guest user id.

Deleted accounts appear in the numbers once they have analytics history. Account deletion anonymizes rather than erases: it rewrites the event rows to a per-deletion pseudonym UUID and marks them `identity_state = 'anonymized'`, so that history still resolves to a stable `actor_id` and shows as a `(no email)` actor with a raw UUID in the user filter popup and in tooltips. This is intended, since the reviews really happened; `analytics.product_events_resolved.identity_state` is the handle if they ever need filtering out.

The old dashboard showed nothing for them, but that was not its replica join: the same deletion drops the person's sole-member workspace rows and `content.review_events` cascades away with them, so the rows that query read were already gone. The same mechanism means an account deleted before it had any analytics history is absent here entirely - there was nothing to anonymize, and the `0120` backfill kept only reviews whose author still had an `org.user_settings` row, which that deletion also removed. Those reviews are in neither table, so do not go looking for them in `content.review_events` when a total does not reconcile.

The email that the `%@example.com` exclusion needs is not in the events table, so it is joined from `actor_id` to `org.user_settings`. `actor_id` is a UUID and renders as canonical lowercase hex, while `org.user_settings.user_id` is an unconstrained `TEXT` primary key, so that join folds the stored side with `pg_catalog.lower`. Comparing as stored would silently miss an uppercase-hex row, and a test account with no matched email is counted rather than excluded.

Platform is read off the event row and never derived. The buckets are `web`, `android`, `ios`, `agent`, and `unattributed`, and they are always split, never summed: an agent-API client merged into `web` would read as a person using the site. `agent` is an upper bound on human agent use rather than a count of people, because a scheduled or polling machine client files activity on a timer, and `db/migrations/0121_backfill_synthetic_app_opened_days.sql` states this in full. A `review_answered` row carries the platform the backend resolved from the replica that recorded the review, and migration `0122` filled the same value on the reconstructed history, `0123` on the live rows the producer wrote before it could resolve one, so both platform charts colour real device activity. A device value appears for a `client_installation` replica on `ios`, `android`, or `web`, and for an AI-chat review whose chat run was started by a request that named its device; a machine-API replica resolves to `agent`, while any other AI-chat review and a seed/reset replica leave the column NULL, as does a review whose replica row is gone. `unattributed` therefore means the row carries no resolved device fact - either the actor behind it is not a device, or no device could be resolved for it - and it stays its own bucket rather than being guessed at or summed into a device.

One thing to read the two platform charts with: a bulk review-history import ensures a replica from the importing request, and every imported review event stores that replica, so one import files its whole batch under the device that performed the import rather than under the device that originally answered. Those rows already land on the import day, because `occurred_at` falls back to the server anchor outside the 30-day window. A large import therefore shows as a single-platform spike on a single day, and that is the import showing through rather than a defect.

Numbers do not match the pre-rewrite dashboard, and are not meant to. Days shift because `occurred_at` is the client clock kept only inside a 30-day window ending at a server anchor: inside that window it is when the person answered rather than when the answer synced, while outside it in either direction the anchor replaces it, so an offline, imported, or guest-merged history older than 30 days lands on sync day instead. The other differences: the `actor_kind = 'client_installation'` filter is gone, the anonymized history of accounts deleted after they had analytics history is counted rather than dropped, and a friendship with a test account on the far side is no longer excluded because a `friendship_created` event names only its own viewer.
