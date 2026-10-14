# Admin App

`apps/admin` is the browser admin SPA for `https://admin.<domain>`.

Supported browser entrypoints:

- `http://localhost:3001`
- `https://admin.<domain>`

## Routes

- `/` and `/analytics` - rewritten in place to `/analytics/level-1-metrics`, the landing page
- `/analytics/level-1-metrics` - Level 1 metrics, the first tab
- `/analytics/general` - the General report sections
- `/analytics/funnels` - the funnels, stacked in a fixed order
- `/analytics/audience` - the audience report
- `/analytics/ai-usage` - the Study vs AI report: one scatter panel per equal-length period
- `/users` - the Users list, one row per account or guest, with guests merged into an account hidden by a default filter that can be cleared
- `/users/<id>/<tab>` - one person's page, where `<tab>` is `profile`, `activity`, `chats` or `cards` and `<id>` is either a raw `org.user_settings.user_id` or an analytics `actor_id`; `/users/<id>` opens Profile and is rewritten in place to its path
- `/users/<id>/chats/<sessionId>` - one chat of that person, opened from the Chats tab
- `/events` - the Events list, one row per analytics event, newest first
- `/events/<eventId>` - one analytics event, opened from the Events list or from an analytics row of a user's Activity tab
- any other path - the not-found page, naming the path as typed

[`routing.ts`](src/routing.ts) owns the paths. Every area has its own URL, so a reload or a shared link reopens the same area, and a trailing slash on a known path is normalized in place. The filter selection rides in the query string of that same URL on every analytics area but Level 1 metrics and replaces the current history entry rather than pushing one, so a shared link reopens the same filtered view and Back leaves the area instead of stepping through every filter click. The Users and Events lists keep their sort, column filters and page in their own query string the same way, as does each of the Profile tab's three device lists under its own parameter prefix, while Activity, Cards and the Chats list keep theirs in memory only, and the user page's `← Users` link and the event page's `← Events` link return to their list as it was last left. A deep link into any of these paths depends on the admin CloudFront SPA rewrite in [infra/aws/lib/admin.ts](../../infra/aws/lib/admin.ts).

Every route resolves `GET /v1/admin/session` first, and the not-found page needs nothing more. Level 1 metrics needs none of the analytics loading below: it loads its own available range on every entry and each chart independently on every range change. The Users routes need nothing else from the analytics loading below either: the [list](src/users/UsersPage.tsx) loads its pages and its enum filter options from its [own queries](src/users/usersQuery.ts) exactly as the Events list below does. The [user page](src/users/userPage/UserPage.tsx) loads the profile once per id, because it also feeds the header, and every other tab starts loading the first time it is opened; an opened tab stays mounted while hidden, so coming back to it keeps its rows and table state without a refetch. Activity, Cards, the Chats session list and the Profile tab's three [device lists](src/users/userPage/ProfileDeviceTables.tsx) each load one page per table state and their enum filter options once, exactly as the Events list below does; Cards also loads one card's full text on demand, and opening a chat loads that transcript in one response. Each of these loads fails in place and can be retried, and only a terminal `401`/`403` replaces the page. The Events routes need none of the analytics loading either. The [list](src/events/EventsPage.tsx) loads one page per table state, with sort, filters and paging applied in SQL over the whole history through the shared table's server mode in [`dataTableSql.ts`](src/table/dataTableSql.ts), each row selected as named columns through [`dataTableServerQuery.ts`](src/table/dataTableServerQuery.ts), and a burst of changes coalesced into one reload; its enum filter options come from their [own query](src/events/eventsQuery.ts), loaded once on entry, so the rows never wait for it and its failure only empties those filters. The [event page](src/events/eventPage/EventPage.tsx) loads its one event. Both fail in place with Retry the same way. Beyond the session, every other analytics area loads the shared available range once per page load - the union of the review-events range and the catalog funnel range, so a day that carries data in only one of them is still selectable and simply shows an empty tail - and the three General reports on the first entry into any of them and again on every filter change, including every applied range, preset or reset. Every filter is applied in SQL, so a burst of clicks is coalesced into a single reload shortly after the last one and the loads it superseded are dropped. The filter option lists and the chart colour domains come from their own query, blind to the rest of the selection so that a value a filter just removed from every chart is still offered, and fetched again only when the range changes. Those results stay in memory, so moving between areas does not fetch them again. Audience, Funnels and Study vs AI each additionally fetch their own report on every entry and whenever the live filter selection changes, once the General reload they wait out has settled, with no in-memory reuse. Study vs AI also refetches when either of its own two controls moves, and it queries nothing at all for a range too short to hold one whole period. A failed report load stays inside the report area with a Retry button while the hero and the navigation keep working, and only a terminal `401`/`403` replaces the page. A first load that fails has nothing to show and takes the whole area; a later General reload that fails keeps the numbers it failed to replace, marks every General section stale and raises a sticky failure banner with Retry above the filter panel, stacked over the filter popovers so none of them can cover it. Nothing retries on its own: the banner and the stale mark stand until an attempt the operator starts succeeds.

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

The General area carries four report sections in page order:

- `daily-active-users`
- `review-events-by-date`
- `catalog-deck-installs`
- `social-connections`

The dashboard shows eight charts:

- daily unique active users, plain totals by default, with a `Break down by` switch for new vs returning, platform, OS, and device type; the last three stack one segment per value under a marker at the day's unique total, which a stack can exceed because one person can be active on several devices in a day
- daily catalog deck installs, stacked by deck
- daily unique users with at least 1 review event, new vs returning
- stacked review events by user
- daily reviewing users by platform
- daily review events by platform
- daily friend invite links created, as plain daily totals
- existing friend connections at the end of each day, counted per user and drawn as plain daily totals

The default chart range is shared by every section outside Level 1 metrics and covers the last 30 days ending today, inclusive, in the dashboard timezone. The dashboard includes date range filters that can narrow the chart range, widen it back over the full history starting on the earlier of the first calendar day carrying an `app_opened`, `review_answered`, `friend_invitation_created`, or `friendship_created` event and the first day carrying a catalog install click, and reset back to that default.
One shared filter bar sits above the sections of every analytics area and offers exactly the fields [the filter model](src/filters/analyticsFilters.ts) declares applicable to the active area. Study vs AI offers the date range alone, because a hosted AI chat message carries no platform, cohort, catalog click or locale of its own and narrowing only the review half of a person would move their dot rather than remove it. Funnels does not render the five identity-derived fields at all, because a row there is a browser visitor identity whose first steps happen before sign-in; the catalog fields and the platform field apply there by the anchoring click's own properties rather than through a completed install. Every field's popover carries the field's full label, what it counts and how, and the current selection as removable chips; the option fields are multi-selects, the date field opens the two-month UTC range calendar, where the second click applies the range, and the threshold field takes one minimum count per event type, combined so a user must clear every one of them. The connection country and app interface language fields restrict people rather than rows: a country comes from a retained connection sample, kept for 90 days only, and a language from the UI locale a client wrote on the event, so a person with neither matches no value and is dropped as soon as either field is narrowed. The four catalog click fields restrict people the same way, through a completed install attributed to one site click by the shared visitor identity or, on older rows, by the install journey id, as [`buildCatalogInstallAttributionSql`](src/filters/filterSql.ts) defines. Every field the bar offers applies to every chart of the user-scoped areas, including the friend invite and friend connection charts, which carry per-user community rows; on Funnels the funnel itself reads every field the area offers, but its two no-visit diagnostics can only read the date range, the deck and the platform, so narrowing a click dimension leaves those lines wider than the funnel above them by design, which the section says on screen. A cohort or platform filter keeps community rows only for users that still have review events in range, and the user filter list also offers users with community activity but no review events in range. On the analytics areas user emails and user IDs are shown only inside the user filter popup and chart tooltips, not as a persistent page list; the Users list is where people are listed. A plain click on a segment of a stacked-by-user chart applies that user filter, while a ⌘/Ctrl-click or a middle click on it, or on a Study vs AI dot, opens that person's user page in a new tab, as the tooltip says; every user filter option carries an `Open` link to the same page. [`chartPrimitives.ts`](src/charts/chartPrimitives.ts) owns the new-tab gesture.

Its SQL lives in the admin frontend as a chart-owned query and runs through the generic admin reporting endpoint.

### Where the data comes from

Every chart but Study vs AI and the four Level 1 metrics charts reads `analytics.product_events_resolved` and no other product table; Study vs AI reads it for the review half of each dot and `ai.chat_items` and `ai.chat_sessions` for the chat half, Who used us and Who came back read the same review and native chat tables with a user-message activity contract, Who saw us adds three `store_analytics` tables, and Who paid us reads native `billing` history, as [Level 1 metrics](#level-1-metrics) says. It also reads `org.user_settings`, `auth.admin_users`, `auth.user_identities`, `analytics.installation_country_observations`, `analytics.identity_links`, `analytics.excluded_actors`, `sync.installations` and `analytics.probable_android_burst_actors` for actor exclusions, identity resolution and country selections. Every usage chart and option list composes [the shared actor exclusions](../backend/src/reviewMetricsSql.ts), including [reversible probable Android test-burst classification](../../docs/analytics-audience.md). [Admin data semantics](../../docs/admin-app.md) describe raw inspection and the reporting contract. These charts join none of `content.review_events`, `sync.workspace_replicas`, `catalog.packages`, `community.friend_invitations`, or `community.friendships`; the Users area reads several of them, as [docs/admin-app.md](../../docs/admin-app.md) states.

- review series: `review_answered`
- catalog deck installs: `catalog_deck_installed`, with the deck named by its `package_slug` property
- friend invite links: `friend_invitation_created`
- friend connections at the end of each day: a running sum of `friendship_created`

The installs chart is nearly empty on production data on purpose: installs of the delisted `test` fixture deck are excluded, as is every install by an actor the one exclusion rule drops, anyone who has ever held an admin grant included, and almost every real install so far is an admin install. That event carries no platform, so picking any device platform empties that section. See [docs/admin-app.md](../../docs/admin-app.md) for the full attribution contract.

Rows are grouped by `actor_id`, never by `user_id`. The view already collapses a guest and the account that guest became into one person, so the previous `actor_kind` filter and the inline guest-merge reasoning are gone. `actor_id` is not always an account id: a guest who never upgraded stays on the guest user id.

Deleted accounts appear in the numbers once they have analytics history. Account deletion anonymizes rather than erases: it rewrites the event rows to a per-deletion pseudonym UUID and marks them `identity_state = 'anonymized'`, so that history still resolves to a stable `actor_id` and shows as a `(no email)` actor with a raw UUID in the user filter popup and in tooltips. This is intended, since the reviews really happened; `analytics.product_events_resolved.identity_state` is the handle if they ever need filtering out.

The old dashboard showed nothing for them, but that was not its replica join: the same deletion drops the person's sole-member workspace rows and `content.review_events` cascades away with them, so the rows that query read were already gone. The same mechanism means an account deleted before it had any analytics history is absent here entirely - there was nothing to anonymize, and the `0120` backfill kept only reviews whose author still had an `org.user_settings` row, which that deletion also removed. Those reviews are in neither table, so do not go looking for them in `content.review_events` when a total does not reconcile.

The email that the `%@example.com` and `%+test%` exclusion needs is not in the events table, so it is joined from `actor_id` to `org.user_settings`. `actor_id` is a UUID and renders as canonical lowercase hex, while `org.user_settings.user_id` is an unconstrained `TEXT` primary key, so that join folds the stored side with `pg_catalog.lower`. Comparing as stored would silently miss an uppercase-hex row, and a test account with no matched email is counted rather than excluded.

Platform is read off the event row and never derived. The buckets are `web`, `android`, `ios`, `agent`, and `unattributed`, and they are always split, never summed: an agent-API client merged into `web` would read as a person using the site. `agent` is an upper bound on human agent use rather than a count of people, because a scheduled or polling machine client files activity on a timer, and `db/migrations/0121_backfill_synthetic_app_opened_days.sql` states this in full. A `review_answered` row carries the platform the backend resolved from the replica that recorded the review, and migration `0122` filled the same value on the reconstructed history, `0123` on the live rows the producer wrote before it could resolve one, so both platform charts colour real device activity. A device value appears for a `client_installation` replica on `ios`, `android`, or `web`, and for an AI-chat review whose chat run was started by a request that named its device; a machine-API replica resolves to `agent`, while any other AI-chat review and a seed/reset replica leave the column NULL, as does a review whose replica row is gone. `unattributed` therefore means the row carries no resolved device fact - either the actor behind it is not a device, or no device could be resolved for it - and it stays its own bucket rather than being guessed at or summed into a device.

One thing to read the two platform charts with: a bulk review-history import ensures a replica from the importing request, and every imported review event stores that replica, so one import files its whole batch under the device that performed the import rather than under the device that originally answered. Those rows already land on the import day, because `occurred_at` falls back to the server anchor outside the 30-day window. A large import therefore shows as a single-platform spike on a single day, and that is the import showing through rather than a defect.

Numbers do not match the pre-rewrite dashboard, and are not meant to. Days shift because `occurred_at` is the client clock kept only inside a 30-day window ending at a server anchor: inside that window it is when the person answered rather than when the answer synced, while outside it in either direction the anchor replaces it, so an offline, imported, or guest-merged history older than 30 days lands on sync day instead. The other differences: the `actor_kind = 'client_installation'` filter is gone, the anonymized history of accounts deleted after they had analytics history is counted rather than dropped, and a friendship with a test account on the far side is no longer excluded because a `friendship_created` event names only its own viewer.

### Level 1 metrics

`/analytics/level-1-metrics` is the first tab. It spans the full page width in a two-column grid that collapses to one column on narrow screens, with `Who saw us` at the upper left, `Who used us` at the upper right, `Who came back` at the lower left and `Who paid us` at the lower right. [The area](src/reports/levelOneMetrics/LevelOneMetricsArea.tsx) owns the date selection; each section owns its loading, errors and retry.

Its only filter is the date range, in the shared filter bar with the same presets but over a selection of its own: it opens on the last 60 days, is kept in memory rather than in the URL, and neither reads nor changes the range of the other areas. Its [available-range query](src/reports/levelOneMetrics/query.ts) includes website, store, trusted review, user-authored hosted AI and native payment-event history through today, independently of the other analytics pages.

`Who saw us` stacks approximate daily unique visitors per UTC day, one colour per surface:

- `Web` - the marketing site's `site_page_viewed`: distinct identified actors by the day of `occurred_at`, through the shared actor exclusion rule, plus distinct cookieless visitors by the day of `server_received_at`, keyed as the funnels' `all` mode keys them
- `App Store` - the daily standard product page views: `unique_counts` from `store_analytics.apple_discovery_engagement` plus `counts` from `store_analytics.apple_web_preview_engagement`, the browser views of the apps.apple.com page, which Apple reports without a unique count
- `Google Play` - `store_listing_visitors` from `store_analytics.play_store_performance_country`

The store values are sums over the stores' breakdown rows and the surfaces overlap, so one person can be counted more than once. A day with no row for a source has no bar for it and reads `No data` in the tooltip, which is absence rather than zero. A dashed line marks today minus three days, and store numbers after it are not final.

`Who used us` stacks daily rolling seven-day unique meaningful users, partitioned into new (first-ever recorded use inside that window) and returning (first use before it). `Who came back` plots W1 and W4 weekly first-use cohort retention, with returned/base integer counts in the tooltip and accessible table. Their [shared activity SQL](src/reports/levelOneMetrics/meaningfulActivitySql.ts) reads trusted `review_answered` facts and native `ai.chat_items.role = 'user'` rows, including attachment-only messages without reading payloads. It resolves chat guests through the same server-derived identity link as the resolved event view, applies the shared actor exclusions once per person and deduplicates actor/day activity. Assistant, tool, background and polling activity alone do not qualify.

The [usage query](src/reports/whoUsedUs/query.ts) retains the six pre-range days and unbounded first-use history. The [retention query](src/reports/whoCameBack/query.ts) groups selected first-use dates into Monday–Sunday UTC weeks; edge weeks contain only the selected days. W1 means any return on days 7–13 and W4 days 28–34 after each person's first day. Both rates require the entire cohort week's window to have matured; returns can occur after the selection end and are observed through yesterday, the latest complete UTC day.

Coverage starts at the earliest retained meaningful source record, before actor exclusions. Empty history, rolling windows reaching before that day, incomplete today, uncovered cohort weeks and immature retention windows are unavailable. A covered window with no qualifying users is a measured zero; an empty cohort has no rate. Charts read all retained history but cannot reconstruct deleted chats or reviews never recorded in analytics, so first use is the first use in that history. Later offline review syncs can revise past days. Each new chart offers keyboard-focus tooltips and a table of its exact values.

`Who paid us` stacks three daily integer event counts: trial starts, first successful positive paid periods and subsequent successful paid periods. The [thin SQL contract](src/reports/whoPaidUs/paymentHistorySql.ts) derives these from native production history, with [daily coverage and parsing](src/reports/whoPaidUs/query.ts). The tooltip gives each series' recorded aggregate and Apple/Google/Stripe breakdown, plus a recorded total including paid periods whose first/recurring classification is unavailable. These are subscription lifecycle events, not unique people, revenue or historical active-paying customers. Refunds do not erase charges; grants and sandbox never enter the query. No actor or entitlement join applies: unattributed, erased or analytics-excluded purchasers still contribute real sales.

- Apple: explicit `FREE_TRIAL` and zero native price start trials at `purchased_at`; positive-price transactions count paid periods. Family-shared copies are excluded. First/recurring classification requires the original transaction and a successful full per-subject history scan, with no earlier unknown-price period. Later positive transactions remain recurring even with native `transactionReason = PURCHASE`; the tooltip/table names that native repurchase subset.
- Google: a native free-trial phase and zero Money start a trial at the service-period start. Positive Money plus `orderHistory.processedEvent.eventTime` proves a charge, including later-refunded orders. Omitted Money units/nanos are protobuf zero, while an absent Money object is unknown. Original root and every suffix through the paid order must be retained with known charge evidence before chronological first/recurring classification. The first positive charge after a free root is first payment even when its order ID ends `..0`. Current subscription observations and offer identity do not reconstruct past trials.
- Stripe: retained native `trial_start` starts a trial; positive paid `invoice_payment` objects deduplicate to one paid period per invoice, dated at the earliest actual positive `paid_at`. Classification requires the subscription and successful full production subscriptions/invoices/payments inventories. Chronology within that subscription determines first/recurring, independently of `billing_reason`. A new Google root or Stripe subscription begins a new subscription history on reactivation; it is not a new globally unique customer.

Apple's retained notification discovery and Google's discoverable-order scope are partial merchant inventories even on a successful scan. Failed/missing/running inventory is unavailable; verified recorded events are still visible and labeled partial. An absent count remains unavailable rather than zero. Only complete Stripe production catalog scans covering the whole UTC day can prove a zero. A paid period without original chronology appears as unclassified and remains in the recorded total. Source status, sanitized failure code, request cutoff, completion time and covered window accompany the chart. Today remains visible and in progress; even a finished scan cannot finalize an unfinished UTC day. Collection limits and operator commands live in [native billing history](../../docs/billing-history.md); deployed verification is in [the admin checklist](../../docs/admin-app.md#manual-smoke-checklist).

### Study vs AI

`/analytics/ai-usage` draws one scatter panel per equal-length period, oldest first, with one dot per person. Horizontal is that person's reviews per week and vertical is their characters of chat text per week, both over that person's own exposure inside the period rather than over the whole period, so somebody who arrived halfway through is not read as idle. Its [query](src/reports/aiUsageCohorts/query.ts), [period arithmetic](src/reports/aiUsageCohorts/reportModel.ts) and [panels](src/reports/aiUsageCohorts/AiUsagePanels.tsx) own the contract; the panel itself is the shared [log scatter primitive](src/charts/logScatterPanels.ts).

Periods are anchored at the recent end of the selected range, so the most recent one is always whole and the leftover days fall off the old end rather than forming a short panel that would read as a collapse. A person is in a period when they have any review or any chat message inside it, and is dropped from a period they had fewer than seven days of exposure in, counted from their first ever review or chat message: a weekly rate over two days is an extrapolation rather than a measurement. Past twelve panels the oldest are not drawn and the section says how many were left out.

Every panel shares one pair of logarithmic scales, derived once over every panel's dots, because panels drawn to their own extents cannot be compared. Exact zeros cannot sit on a log axis and are not dropped either - the people who never reviewed are usually most of a panel - so each axis carries a `0` strip at its low edge behind a dashed rule, with the dots inside it jittered by a seed taken from the person, so a redraw never moves them. The vertical median is over everybody in the panel; the horizontal one is over the people who reviewed at all, because the true median review rate has been zero in every period so far.

The area's two controls are its own rather than the shared bar's: period length is 1, 2 or 4 weeks with no free-form entry, and the audience is everyone, registered or guests, decided by the person's state now through the same rule the funnels' `signed-in` mode reads. Both ride in the URL under `period-weeks` and `ai-audience`, omitted while they hold their default.

Characters are the `text` parts of a chat message - what the person typed plus what the model wrote back - and never attachments, file uploads, tool calls or reasoning summaries. They come from `ai.chat_items.content_char_count` and `role`, so the query never touches `payload`. Chat rows key on the raw user id rather than on `actor_id`, so the query folds that id through the same `analytics.identity_links` lookup the resolved-events view uses; without it an upgraded guest would appear as two people, one holding their chat and the other their reviews.
