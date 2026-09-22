# Admin App

`apps/admin` is the server-protected admin SPA served from `https://admin.<domain>`.

Supported browser entrypoints:

- `http://localhost:3001`
- `https://admin.<domain>`

Each serves `/`, `/analytics`, `/analytics/general`, `/analytics/funnels` and `/analytics/audience`, and renders a not-found page on any other path. The route contract and its per-route loading are in [apps/admin/README.md](../apps/admin/README.md).

## Scope

The dashboard has three top-level analytics sections. `General` contains these three report sections, in page order:

- `daily-active-users`
- `catalog-deck-installs`
- `review-events-by-date`

`Funnels` is separate from General and currently carries `catalog-installation`. Each funnel owns its query, parser, and display so later funnels can be added without changing General or introducing a generic reporting engine; the controls are the one shared filter bar, which offers Funnels only the fields a signed-out visitor can answer.

`Audience` shows the distinct users who opened the app in range by observed connection country, actual event UI language, and platform, with upload country/language pairs and coverage. It shares every filter in General's bar, the `analytics.excluded_actors` exclusion defined under [Backend surface](#backend-surface) and `daily-active-users`' rule that a credential-free `anonymous_client` row is not a person, and a per-user event threshold restricts its cohort rather than only the rows inside it, where the `Cards answered` threshold counts resolved review actors and every grade including `Again`. Its [query](../apps/admin/src/reports/audience/query.ts) and [display](../apps/admin/src/reports/audience/AudienceSection.tsx) define cohort and conservative sample matching; [Audience analytics](analytics-audience.md) defines collection and retention. Sparse samples cannot reconstruct daily presence or historical offline event geography.

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

Every charted surface also drops the actors listed in `analytics.excluded_actors` while their exclusion is active, meaning `restored_at IS NULL`: it is one shared list of actors no human produced, defined with its restore rules in `db/migrations/0140_analytics_excluded_actors.sql`, applied to every event of such an actor that a charted number counts rather than to one chart, and restated in the filter option lists so a value only an excluded actor produced is never offered. The `catalog-installation` funnel applies it on the row's own `actor_id` like every other surface, because the shared visitor identity names somebody from the first site visit; a visitor who never signed in resolves to their own browser id, which no account's exclusion can name, so only the exclusion list itself can reach such a row.

Attribution contract for `daily-active-users`:

- the section answers how many people were in the app on each calendar day, not how many answered a card; an active day is a day carrying that person's `app_opened` event
- identity works exactly as in `review-events-by-date`: grouped by `actor_id`, the same case-folded `org.user_settings` email join, the same `%@example.com` exclusion, and the same treatment of deleted accounts
- rows written by the credential-free collector, meaning `trust_level = 'anonymous_client'`, are dropped: no credential stands behind such a request and its `anonymous_id` is an unverified caller-supplied claim, so it is evidence that an event happened and not evidence that a person exists; that collector accepts `app_opened` like every other client-reportable name, so without the rule a signed-out marketing-site visitor would be a daily active user. `buildTrustedActorRowsFilterSql` owns the rule, and every other derivation that decides a person either applies it as well or cannot be reached by this collector at all; that helper's own comment carries the full list, says which of the two each entry is, and names the one derivation outside the admin package that restates the rule because it cannot import it; [Anonymous client analytics](anonymous-client-analytics.md) states the reading in full
- one row is one (UTC date, actor, platform), so a person active on the phone and the browser on one day is two rows and one active person; every unique-users number is a distinct count of actors and the platform chart is grouped, never stacked or summed
- `agent` stays its own visible series and is an upper bound on human agent use rather than a count of people, because a scheduled MCP client files an active day for its owner on every day it runs; `db/migrations/0121_backfill_synthetic_app_opened_days.sql` states this in full
- history from before the clients emitted the event is reconstructed from durable traces of somebody having been in a client, at roughly 85% coverage of the people who really opened the app on a sampled day, by that same migration and by its replays, the newest being `db/migrations/0126_backfill_app_opened_rollout_gap.sql`; replays keep running after the clients went live, so reconstructed rows also fall on days a client was already reporting
- reconstructed and live rows are deliberately not distinguished anywhere in the UI
- new versus returning is the actor's first trusted `app_opened` day over all history, trusted as the rule above defines it, which is this section's own cohort definition; `review-events-by-date` keeps using the first review day
- every field of the shared filter bar applies, all of them in SQL, so any filter change reloads the section

Attribution contract for `catalog-deck-installs`:

- the section answers how many catalog decks were installed on each calendar day and which decks those were; one install action by one person is one event, from `catalog_deck_installed`
- the event is server-emitted after the install transaction commits and keyed by `(workspace_id, install_id)`, so an idempotent replay of the same install cannot count twice
- everything the section needs is on the event, so no `catalog` or `sync` table is read; the deck dimension is `package_slug` and there are no deck titles or version numbers here
- identity works exactly as in `review-events-by-date`: grouped by `actor_id`, the same case-folded `org.user_settings` email join, and the same `%@example.com` exclusion
- two further exclusions are deliberate: the delisted test fixture, narrowly by `package_slug` `'test'` and never by package status, which would need a `catalog` grant this report does not take; and installs by active admins, joined from `auth.admin_users` on the folded `org.user_settings` email with `revoked_at IS NULL`
- almost every install in production history is an admin install, so a nearly empty chart is the intended default rather than a defect; the `auth.admin_users` column grant it needs is `db/migrations/0125_reporting_readonly_admin_users.sql`, and without it deployed the section fails as HTTP 500 `INTERNAL_ERROR` rather than as a readable permission error
- platform is always `unattributed`: the producer writes NULL on purpose, because the install names no server-stored replica or guest session row and the request headers that do name a platform are a client claim, and `db/migrations/0120_backfill_product_analytics_server_facts.sql` wrote none either; the bucket is still derived with the same CASE as every other report, so picking any device platform empties this section
- new versus returning is the installer's first trusted `app_opened` day, which is `daily-active-users`' cohort definition rather than one of this section's own, rebuilt as a CTE over the same event so the two sections cannot disagree about which day a person was new on
- that CTE only covers installers with a trusted `app_opened` day inside the selected range, trusted as `buildTrustedActorRowsFilterSql` defines it, so an installer with no such day is in neither cohort and is kept only while both cohorts are selected, rather than being guessed into `new` or `returning`; an installer whose only in-range app opens came from the credential-free collector has no such day either and lands in that same no-cohort branch rather than flipping between `new` and `returning`
- every field of the shared filter bar applies, all of them in SQL, so any filter change reloads the section
- the placement, source, device-category and browser-language fields keep a person through a completed install attributed to one site click, here and on every other General and Audience section: the click resolves to the installer's own `actor_id` and precedes the install by at most the funnel's seven-day window, or, for rows written before the producers dropped it, shares the install's `install_journey_id`. [`buildCatalogInstallAttributionSql`](../apps/admin/src/filters/filterSql.ts) owns which click wins and the exclusions it applies, and the option lists read the same fragment
- the section carries one chart, installs per UTC day stacked by deck, plus summary tiles

Attribution contract for the `catalog-installation` funnel:

- the denominator is one visitor identity and one deck version, anchored at that identity's first `catalog_install_clicked` whose `occurred_at` falls in the selected UTC dates; repeated clicks on the same deck are the same person arriving again and never a second row. There is no historical backfill and no Vercel aggregate is converted into visit history
- every step and every exclusion is joined by `analytics.product_events_resolved.actor_id`. A row the browser sends with no account credential — the site click and the signed-out import screens — resolves through the shared `analytics_visitor` cookie, and onto the account once the web app records an `authenticated_client` identity link for that cookie; the signed-in app's rows carry the account already. That is what carries a person from the site click to the server install. The auth origin's rows are the exception, and the sign-in branch below states what that costs
- **only a site click sent with the shared visitor cookie can reach any later step**, and a reader who does not know that will misread the funnel as a total collapse. A `catalog_install_clicked` body that claims no `anonymousId` is stored under its per-attempt `install_journey_id` (`readAnonymousId` in `apps/backend/src/productAnalytics/anonymousEvent.ts`), which nothing else shares, so on any date whose clicks all arrived that way every step below the site visit reads zero. That is every date before the site and the app shared one registrable domain, and every later date until the click producer, which lives in the separate `flashcards-open-source-app-website` repository, sends the cookie. It is the absence of the identity, not a broken report and not a broken product
- selectable history reaches back to the first client catalog click, which is folded into the shared picker's bounds as a union with the review-events range, so a range with data in only one area is still selectable
- later steps must occur in order with equal timestamps allowed and fall within seven days of the site visit even when that follow-up is after the selected cohort's end date; where the event names a deck they must also keep the visit's `package_version_id`. Repeated milestones do not add another row
- the main path is site visit, import screen, import confirm, install started, installed, then the three engagement steps — one review, twenty reviews, and twenty reviews plus a review on a later UTC day than the install. They are steps of the one funnel rather than a card beside it, nested so no step can exceed the one above it, and null together on a visit with no server install rather than zero, so a missing install is not read as a drop-off inside engagement
- the import-screen, import-confirm, signed-out-gate and confirm-after-sign-in steps are `screen_viewed` rows, which carry no properties at all and therefore name no deck: a visitor who clicked two deck versions in range has those steps satisfied on both rows by the same view. Only install start, install and failures require the row's own `package_version_id`
- import confirm is the `catalog_import_confirm` screen view and deliberately not `catalog_install_preview_ready`, which marks the same moment. The screen view is the account-side fact: the signed-in app reports it with the account's credential, so it meets the install with no identity link, while the preview fact goes out on the credential-free collector and reaches the account only through the web app's link for its visitor cookie. The `catalog` screen behind the import-screen step is a general catalog-browse surface that only the web import route emits today; `query.ts` says what a future browse screen would do to it
- the sign-in branch is the signed-out import gate, signed in on this browser, and the import confirm after it. Signed in on this browser is the first `screen_viewed` after the gate that the same browser, meaning the same `anonymous_id` as the gate row, sent with an account credential (`trust_level = 'authenticated_client'`); it names no deck, so it is that person's sign-in rather than this deck's. The browser equality is what keeps a person who already had an account from counting when they give up at the gate and use the app on another device, where their rows share the actor but not the cookie. It is deliberately not the auth origin's `signin_succeeded`: the auth origin posts on a guest credential whose `user_id` outranks the visitor cookie in `analytics.product_events_resolved`, and those rows reach the account only through the `server_derived` guest-upgrade link written inside a 150 ms budget that a first-ever sign-in usually overruns, so keyed on it the step would miss most of the people the gate is shown to. The auth origin's sign-in screen view and `signin_code_requested` are not steps for the same reason: a person who abandons there stays on a guest id the cohort never contains, so those steps could only count people who went on to succeed. Gate to signed in is the whole drop-off this branch can show. The retired `catalog_install_*` landing and sign-in names are not read at all
- only an `origin = 'server'` `catalog_deck_installed` is success, while `catalog_deck_install_started` remains intent
- the installed deck, placement, source, device category, browser language and client platform fields of the shared bar all apply here in SQL, each read off the anchoring click's own properties, because that is the only row on which a placement, source, device category or browser language exists; the five identity-derived fields are still not offered. The four click dimensions take their option lists from those clicks directly on this area, not through the completed-install bridge General and Audience read, because a click here never had to become an install. The lists cover every day rather than the selected ones, so a value outside the range is still offered and picking it empties the area
- failure totals count distinct visits per observed stage/reason, so they are not inferred abandonments and are not mutually exclusive; the report separately shows import previews and server installs with no site visit in the selected dates, visits whose seven-day window is still maturing, and server installs split by whether the installing identity was first seen at its site visit
- a row whose `actor_id` resolves to NULL is excluded everywhere. That is a browser that refused consent and was given no identifier at all: it is an event belonging to no identity rather than an event missing one, and without that exclusion the whole identity-free remainder would collapse into one phantom visitor that no filter and no exclusion could reject
- new means the installing identity produced no trusted row at all before the site visit, over every event name and read over that identity's whole history, trusted as `buildTrustedActorRowsFilterSql` defines and states it. The shared identity made that predicate matter more rather than less: the anchoring site click is itself a credential-free row resolving onto the same identity, so without the trust rule every installer would have an event at their own first visit and none would ever read as new
- the delisted `test` deck is excluded when an install-start fact by the same identity and deck version identifies it; `@example.com`, active-admin and analytics-exclusion-list identities are excluded on the row's own `actor_id`, with no bridge to an install, so it reaches a person backwards over every row of theirs this report reads, including the ones sent before they signed in
- the two no-visit lines can be narrowed only by the date range, the installed deck and the client platform, because a row with no site click carries none of the click dimensions. A site click before the first selected day counts as no visit on both, exactly as the funnel treats it. Each is a lower bound on what the funnel cannot hold rather than the whole of it: a person whose click in range was dropped by a placement, source, device-category or browser-language selection, or whose step chain is broken, is equally unheld and counted by neither. A server install carries no platform, so selecting any device platform empties its line

The events this reads are in [catalog-install-funnel.md](catalog-install-funnel.md).

Current v1 attribution contract for `review-events-by-date`:

- the report is intended for the current single-effective-learner workspace model
- every chart reads `analytics.product_events_resolved` and no other product table; the relations it always touches are `org.user_settings`, joined from `actor_id` for the email the `%@example.com` exclusion needs, and `analytics.excluded_actors`; the shared filter bar puts two more into that SQL on demand, `auth.admin_users` inside a `catalog_deck_installed` threshold and `analytics.installation_country_observations` inside a country selection
- rows are grouped by `actor_id`, never by `user_id`, so a guest and the account that guest became count as one person; `users[]` and `rows[].userId` carry that `actor_id`, which is not always an account id
- deleted accounts still appear once they have analytics history: account deletion anonymizes `analytics.product_events` in place, rewriting the id columns to a per-deletion pseudonym UUID and setting `identity_state = 'anonymized'`, so that history keeps resolving to a stable `actor_id` and surfaces as a `(no email)` actor whose raw UUID is visible in the user filter popup and tooltips; `identity_state` is the handle if they ever need filtering out
- the old dashboard showed nothing for them, but not because of its replica join: the same deletion drops the person's sole-member `org.workspaces` rows and `content.review_events` cascades with them, so the rows that query read were already gone
- an account deleted before it had any analytics history is absent here entirely: there was nothing to anonymize, and the `0120` backfill keeps only reviews whose author still has an `org.user_settings` row, which that deletion removed; do not reconcile a total here against `content.review_events` expecting those reviews, in either table
- the `org.user_settings` join folds the stored side with `pg_catalog.lower`, because `actor_id` is a UUID rendered as canonical lowercase hex while `org.user_settings.user_id` is an unconstrained `TEXT` primary key; comparing as stored would miss an uppercase-hex row and count a test account instead of excluding it
- the default chart range is shared by every section and covers the last 30 days ending today, inclusive, in the report timezone; the picker can narrow it or widen it back over the full history, which starts on the first calendar day carrying an `app_opened`, `review_answered`, `friend_invitation_created`, or `friendship_created` event
- the fields of the shared filter bar, which [the filter model](../apps/admin/src/filters/analyticsFilters.ts) declares and explains one by one, are all applied in SQL and reach every chart, including the community charts, where a cohort or platform filter keeps community rows only for users that still have review events in range, and the user filter list also offers users with community activity but no review events in range; Reset all returns date range to the same last-30-days default and clears every other filter; the whole selection is carried in the query string, so a reload or a shared link reopens the same filtered view
- platform is read off the event row and never derived; the buckets are `web` / `android` / `ios` / `agent` / `unattributed` and are always split, never summed, so agent-API activity cannot read as a person on the site; `agent` is an upper bound on human agent use rather than a count of people, because a scheduled or polling machine client files activity on a timer, and `db/migrations/0121_backfill_synthetic_app_opened_days.sql` states this in full
- a `review_answered` row carries the platform the backend resolved from the replica that recorded the review, and migration `0122` filled the same value on the reconstructed history, `0123` on the live rows the producer wrote before it could resolve one; a device value appears for a `client_installation` replica on `ios`, `android`, or `web`, and for an AI-chat review whose chat run was started by a request that named its device (`apps/backend/src/productAnalytics/serverFacts/reviewAnswers.ts`); a machine-API replica resolves to `agent`, while any other AI-chat review and a seed/reset replica leave the column NULL, as does a review whose replica row is gone
- `unattributed` therefore means the row carries no resolved device fact, either because the actor behind it is not a device or because no device could be resolved for it, and not either case alone; it stays its own bucket rather than being guessed at or summed into a device
- a bulk review-history import ensures a replica from the importing request and stores it on every imported review event, so one import files its whole batch under the device that performed the import rather than under the device that originally answered; those rows also land on the import day, because `occurred_at` falls back to the server anchor outside the 30-day window, so a large import shows as a single-platform spike on a single day rather than as a defect
- review dates are `occurred_at`, the client clock kept only inside a 30-day window ending at a server anchor and replaced by that anchor outside the window in either direction; inside the window a day is when the person answered rather than when the answer synced, and a first review day can therefore move earlier than the old dashboard reported it
- outside that window the day is the anchor's, and on the review history import the anchor is that request's own clock, so an offline, imported, or guest-merged history older than 30 days lands on sync day rather than on the days it was answered
- friend invite charts count `friend_invitation_created` per actor per UTC date and stack those counts with the same per-user colors as the review-events chart
- friend connection charts are a running sum of `friendship_created` per actor through the end of each UTC date; the producer emits one event per directed friendship row, so the all-user column is intentionally twice the number of friendship pairs
- that running sum is exact given the events, not against `community.friendships`: the emission is best effort and swallows its own failure, and because the chart is cumulative one dropped write lowers that actor's count on that day and on every day after it permanently, with no repair path; a swallowed emission is the first thing to check when the panel disagrees with `community.friendships`, and a duplicate pair is the second, where `community.friendships` holds more than one row for the same invitation and viewer, those rows derive one `event_id`, and `ON CONFLICT DO NOTHING` collapses them into a single event that `0120` accepts as an undercount and reports through a `RAISE NOTICE`
- a `friendship_created` event names only its own viewer, so a friendship whose other side is an `@example.com` test account is no longer excluded
- do not interpret this report as durable review authorship: `content.review_events.reviewed_by_user_id` is `ON DELETE SET NULL`, and account-deletion anonymization rewrites `analytics.product_events.user_id`, so an actor here is who the events currently resolve to rather than a permanent author record

Attribution contract for `card_created` and `deck_created`, which no admin report charts; these rows exist only in `analytics.product_events`, and this is for reading them there:

- no exclusion reaches this path: a direct `analytics.product_events` read is the raw table rather than the resolved view, so nothing drops `%@example.com` addresses, active admins, or the actors listed in `analytics.excluded_actors`, and the table carries `user_id` rather than the `actor_id` that list is keyed on; a count taken here has to read `analytics.product_events_resolved` and then restate all three exclusions itself: the `%@example.com` exclusion and the active-admin exclusion exactly as the reports write them, because the resolved view drops neither, plus `NOT EXISTS (SELECT 1 FROM analytics.excluded_actors AS excluded WHERE excluded.actor_id = resolved.actor_id::text AND excluded.restored_at IS NULL)` against the resolved rows. That last one has to be the anti-join and the cast as written: joining the active rows instead returns precisely the excluded actors, the inverse count and silently, and the view's `actor_id` is a UUID while the list's is TEXT, so the comparison exists only on `actor_id::text`
- both resolve their platform from the same replica columns as `review_answered`: a device value appears only for a `client_installation` replica on `ios`, `android`, or `web` and a machine-API replica resolves to `agent`, while an AI-chat replica, a replica the scoped read did not reach, and a resolution the drain could not make all leave the column NULL
- that resolution exists only from the day the producer shipped it, and every earlier row of these two events carries NULL permanently: no table ever recorded who created a row, because `content.cards.last_modified_by_replica_id` holds the last writer that every review rewrites and `sync.hot_changes` is year-partitioned hot state rather than durable history, so these two events got nothing of the kind `0122` and `0123` gave `review_answered`; the cut-over day is the first `card_created` row carrying a non-NULL platform, and NULL before it is missing attribution rather than an absence of created cards

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
9. Confirm that `https://admin.<domain>/analytics/general` loads.

Important rollout note: if `CDK_ADMIN_CERTIFICATE_ARN_US_EAST_1` or `CDK_ADMIN_EMAILS` was added to GitHub after a release workflow had already started, that in-flight workflow does not see the new values. In that case, finish the setup above and then run another deploy or rerun the workflow.

If the environment already exists and the deployed bootstrap admin list changes later, update `CDK_ADMIN_EMAILS` manually in GitHub before deploying.

The supported browser entrypoint is `https://admin.<domain>`.
The admin frontend fails fast on any other non-local hostname. Do not serve the browser entry on a raw CloudFront or other non-admin hostname, and do not treat the raw CloudFront distribution hostname as a supported admin URL.

## Manual smoke checklist

- `https://admin.<domain>` returns `200`
- unauthenticated access redirects to the login flow
- a listed admin email loads `https://admin.<domain>/analytics/general`, where the shared hero and filter row sit above titled report sections, each separated by a divider
- General still contains every existing chart; Funnels opens separately with Catalog installation under the same shared filter bar, which drops the five identity-derived fields there
- Audience opens as a sibling and the shared filters remain visible
- the Audience cohort is the distinct resolved actors with an `app_opened` event in range, excluding active admins, example.com accounts, actors on the analytics exclusion list and rows the credential-free collector wrote, and counting merged guests only once
- set `Cards answered` to 1 in the threshold filter; the Audience denominator drops to the people who also answered a card, including Again reviews
- apply a user, platform, and new/returning filter in Audience; confirm the denominator and distributions reload, and General keeps its charts when switching back
- for an identified retained sample batch, compare its exact installation/platform/server-received timestamp with the observation endpoint; confirm upload-country/UI-language pairs come from that same batch and no independently observed languages are cross-joined
- select a range with no retained matching samples, an older-than-90-days range, and an empty cohort; confirm unknown country coverage, the unavailable-history notice, and zero/— states without invented historical country
- confirm users with multiple countries or languages count once in the cohort but in multiple distribution buckets; known plus unknown coverage equals the denominator, while overlapping distribution buckets need not sum to it
- select agent-only activity and confirm it stays separately labeled with unknown human geography; older clients without event UI locale must stay unknown, even when device locale exists
- a signed-in non-admin sees the access denied page
- network traces show `POST /v1/admin/reports/query` for dashboard data
- the default date filter covers the last 30 days ending today, and widens back to the first app open, review, friend invite, or friendship day
- pick one connection country and one app interface language in General; confirm every chart and the Audience denominator narrow to the people carrying that country sample and that locale, that the two popups say in plain words that country history is kept for 90 days only and that a person with no retained sample or no recorded locale matches nothing, and that both selections survive a reload through the URL
- every field the shared filter row offers opens as a popup naming in full what it filters and how that value is counted; the date popup opens a two-month UTC calendar whose second click applies the range, and the threshold popup takes one count per event type, all of which a user must clear; a count it cannot hold, such as `1.5`, stays in its input and is named as not applied, leaving the chips and the button showing the threshold that is
- copying the URL after a few filter clicks and opening it in a new tab reopens the same selection and the same numbers
- the dashboard does not show a persistent email or user list outside the user filter popup
- the daily active users section renders above `Catalog deck installs`, with its new-vs-returning, platform, and stacked-by-user charts and no summary tiles
- `Catalog deck installs` renders between `Daily active users` and `Review activity`, with its summary tiles and its one installs-per-day chart stacked by deck
- the catalog installs chart is empty or nearly empty on production data, because installs of the `test` fixture deck and installs by active admins are excluded on purpose
- selecting any device platform empties the catalog installs section while the other sections keep their data
- hovering a catalog installs segment names the deck slug and shows installs of that deck, all decks on that date, and cards added
- unique-users, stacked-by-user, platform-users, platform-events, friend-invite-links, and friend-connections charts all render
- a person keeps the same colour in the daily active users charts and the review charts
- every filter change reloads all charts from the server, coalescing a burst of clicks into one reload, and Reset all restores the default range and clears every other filter
- a filter click shows `Updating` at once and leaves every selection control live, so a second click during a reload supersedes the first; only Reset all is disabled while a reload runs
- the user, connection country and app UI language filter lists and the chart colour domains come from their own range-scoped query, so a filter that empties a chart never removes a user or a deck from the options or changes anyone's colour
- hover tooltips on the per-user stacked charts (daily active users, review events, friend invite links, friend connections) may reveal the current email and user ID for the hovered segment, and clicking a segment applies that user filter
- backend logs do not show writes through the reporting path
- the catalog installation funnel treats only a matching server install as success, allows signed-in users to bypass authentication, counts the signed-out branch only from the gate to a signed-in screen on the same browser, and shows `—` or an explicit empty state instead of NaN or invented history
- the shared date picker can reach the first catalog click even when it predates General's first selectable event, and General simply shows an empty tail over the days only the funnel carries
- a click near the range end remains marked as maturing until its seven-day window closes, while a matching follow-up after the cohort end still counts
