# Admin App

`apps/admin` is the internal admin SPA on `https://admin.<domain>`: product analytics plus raw inspection of people and events. It is a separate React + TypeScript + Vite package that reuses none of the web app's storage or sync code. Running and changing it: [apps/admin/README.md](../apps/admin/README.md).

## Areas

Each area's contract lives beside the code that computes it:

- `Level 1 metrics`, the landing page: one chart per stage of the user funnel, from `Who saw us` to `Who paid us` ([area](../apps/admin/src/reports/levelOneMetrics/LevelOneMetricsArea.tsx)); payment collection is [native billing history](billing-history.md).
- `General`: [catalog deck installs and social connections](../apps/admin/src/dashboard/AdminDashboard.tsx), each section's query under `src/reports/` stating what it counts; social connections' is `buildReviewEventsByDateCommunitySql` in [`reviewEventsByDate/query.ts`](../apps/admin/src/reports/reviewEventsByDate/query.ts).
- `Funnels`: [`funnelSections.ts`](../apps/admin/src/reports/funnels/funnelSections.ts) holds the order, the rule every funnel follows and why the audience modes default as they do; each funnel's query holds its steps. The deck funnel's contract is its [query](../apps/admin/src/reports/catalogInstallFunnel/query.ts), and its events are in [catalog-install-funnel.md](catalog-install-funnel.md).
- `Audience`: [query](../apps/admin/src/reports/audience/query.ts); collection and retention are in [Audience analytics](analytics-audience.md).
- `Study vs AI`: how study and AI chat use shift together over time ([query](../apps/admin/src/reports/aiUsageCohorts/query.ts), [periods](../apps/admin/src/reports/aiUsageCohorts/reportModel.ts)).
- `Users` and `Events`: raw inspection at every trust level, where people the exclusion rule drops are listed, dimmed, with the reason ([`usersQuery.ts`](../apps/admin/src/users/usersQuery.ts), [`profileQuery.ts`](../apps/admin/src/users/userPage/profileQuery.ts), [`eventsQuery.ts`](../apps/admin/src/events/eventsQuery.ts)). The user page deliberately shows chat transcripts and card text, not only counts; [analytics-db-access.md](analytics-db-access.md) names the grants and the privacy-policy disclosure.

## Authentication and authorization

- Admins sign in through the existing Cognito + `auth.<domain>` flow; the cross-subdomain session cookies carry the session. There is no separate login.
- `auth.admin_users` is the source of truth, keyed by normalized email rather than `user_id`; a grant is active while `revoked_at IS NULL`.
- [`authz.ts`](../apps/backend/src/admin/authz.ts) checks every `/v1/admin/*` request: the session and report routes this app calls accept only a human session, while `/v1/admin/catalog/*` also accepts an API key whose owner's profile email holds an active grant; [`adminApi.ts`](../apps/admin/src/adminApi.ts) answers a `401` with one silent session refresh, and `handleTerminalAdminError` in [`App.tsx`](../apps/admin/src/App.tsx) sends a `401` that remains to login and a `403 ADMIN_ACCESS_REQUIRED` to the access-denied page.
- Bootstrap grants come from `ADMIN_EMAILS` in root `.env` for local and manual deploys, and from the GitHub variable `CDK_ADMIN_EMAILS` for CI deploys; `scripts/setup/setup-github.sh` creates that variable only when missing, so later changes are made in GitHub by hand. Every deploy syncs them as `source = 'bootstrap'` rows and never touches `source = 'manual'` grants ([`migrationRunner.ts`](../apps/backend/src/database/migrationRunner.ts), [`migrate.sh`](../scripts/deploy/migrate.sh)).

## Reporting data path

The browser never queries Postgres. Each chart or page sends its own SQL to `POST /v1/admin/reports/query`, so a report needs no backend route; the backend Lambda authenticates the admin session and runs that SQL read-only as `reporting_readonly` through a small dedicated pool inside the VPC ([`query.ts`](../apps/backend/src/admin/query.ts), [`reportingDb.ts`](../apps/backend/src/admin/reportingDb.ts)). Operators use the same role through an SSM tunnel ([analytics-db-access.md](analytics-db-access.md)).

## Who counts as a person

- One exclusion rule, [`buildExcludedActorSqlLines`](../apps/backend/src/reviewMetricsSql.ts), drops test accounts, admins, listed exclusions, actors with an automated collector verdict, guests on an automation install, anyone on a [test-distribution install](analytics-audience.md#test-distribution-installations), anyone with a sandbox `entitlement_changed` fact, probable Android test bursts and the probable scraper fleet from every usage chart and filter option list; the public v3 snapshot shares it, and [compatibility v2](global-metrics.md) keeps its own. `Who paid us` is the exception: a production sale counts whoever made it.
- The people counts of General, Audience and Level 1 drop the credential-free collector's rows; the site and deck funnels and the `Who saw us` `Web` series count the visitor identities those rows carry, on purpose ([`buildTrustedActorRowsFilterSql`](../apps/admin/src/filters/filterSql.ts) lists every reader, [Anonymous client analytics](anonymous-client-analytics.md)).
- Ad-hoc SQL over `analytics.product_events` or `analytics.product_events_resolved` gets none of this; read the resolved view and compose `buildExcludedActorSqlLines` on `actor_id::text`.

## Reading the numbers

- A person is an `actor_id` of `analytics.product_events_resolved`, so a guest and the account it became are one person, and an `actor_id` is not always an account id.
- [Account deletion](../apps/backend/src/auth/accountDeletion.ts) anonymizes analytics rows onto a per-deletion pseudonym, so a deleted person's history keeps counting as a `(no email)` actor whose raw UUID the user filter and tooltips show; `identity_state = 'anonymized'` is the handle for filtering it out. An account deleted before it had analytics history is absent everywhere, and an actor is who the events resolve to now, not a durable review author, so do not reconcile totals against `content.review_events`.
- Review days are `occurred_at`: the client clock inside a 30-day window ending at a server anchor, the anchor outside it ([`reviewAnswers.ts`](../apps/backend/src/productAnalytics/serverFacts/reviewAnswers.ts)). Offline, imported or guest-merged history older than 30 days therefore lands on its sync day, and a bulk review-history import shows as a one-day spike on the importing device's platform ([`reviewHistory.ts`](../apps/backend/src/sync/replication/reviewHistory.ts)).
- `card_created` and `deck_created`, which no admin chart reads, carry a platform only from the day their producer began resolving it; NULL before that is missing attribution, permanently, because no table kept the creating replica.

## Self-hosted deploy

For the first `admin.<domain>` rollout, use this exact order:

1. Set `ADMIN_EMAILS` in root `.env` for the initial bootstrap.
2. Run `bash scripts/cloudflare/setup-admin-domain.sh --domain <domain>` when the admin certificate does not exist yet.
3. Run `bash scripts/setup/setup-github.sh` so GitHub Actions picks up the admin certificate ARN and the initial bootstrap admin list.
4. Deploy normally.
5. Run `bash scripts/cloudflare/setup-dns.sh --stack-name <stack-name> --domain <domain>` after the stack exposes `AdminCustomDomainTarget`.
6. Run `bash scripts/checks/check-public-endpoints.sh --stack-name <stack-name>` after the DNS change.
7. Open `https://admin.<domain>`, sign in with the existing Cognito email, and confirm that `https://admin.<domain>/analytics/general` loads.

A release workflow that started before `CDK_ADMIN_CERTIFICATE_ARN_US_EAST_1` or `CDK_ADMIN_EMAILS` existed in GitHub does not see them: finish the setup, then deploy again or rerun it. Serve the app only on the hosts its [hosting contract](../apps/admin/README.md#hosting-contract) allows.

## Manual smoke checklist

Run it locally with `make local-admin` on `http://localhost:3001` before merge; the `200`, login-redirect and non-admin checks apply only to the deployed host. A look at production after deploy is an optional final check. Each group links the code that defines the expected result.

### Access ([`authz.ts`](../apps/backend/src/admin/authz.ts), [`routing.ts`](../apps/admin/src/routing.ts))

- `https://admin.<domain>` returns `200`; signed out, it redirects to login; a signed-in non-admin sees the access-denied page.
- As an admin, open `/`: it lands on `/analytics/level-1-metrics`, and Back does not return to `/`.
- Network traces show `POST /v1/admin/reports/query` for every chart; backend logs show no writes through the reporting path.

### Level 1 metrics ([area](../apps/admin/src/reports/levelOneMetrics/LevelOneMetricsArea.tsx), [periods](../apps/admin/src/reports/levelOneMetrics/reportPeriod.ts))

- The five charts appear in funnel order on the last 60 days, and in one column on a narrow viewport.
- Switch `Group by` through Days, Weeks and Months: every chart regroups, edge buckets name only the selected days, the bucket holding today is in progress, and a people count in a week or month is less than or equal to the sum of its Days bars.
- On the `Who opened the app` Details page, every breakdown bar sums to the chart's bar for the same bucket, and both the `Level 1 metrics` tab and `← Level 1 metrics` return with the same range and `Group by`.
- `Who saw us` `Details` opens a picker of `Web`, `App Store` and `Google Play` beside an inactive `MCP`; each opens a page with only that series' chart and its own breakdowns, every breakdown bar sums to that chart's bar for the same bucket (on `Web`, only above the `Engaged visitors` heading, where a by-page chart's bar sums to its type's visitors in `Web visitors by landing page type`, inside Other when that type is outside the chart's top five), and both its back link and the `Level 1 metrics` tab keep the range and `Group by`.
- On the `Who saw us` `Web` page, every `Engaged visitors` bar is less than or equal to the visitor chart's bar for the same bucket. Under the `Engaged visitors` heading after every other chart, every engaged breakdown bar sums to the `Engaged visitors` bar for the same bucket, and each engaged by-page bar sums to its type's visitors in `Engaged visitors by landing page type`, inside Other when that type is outside the chart's top five.
- On the same page, every `Engaged share of Web visitors` point is between 0% and 100% and equals the `Engaged visitors` bar ÷ the visitor chart's bar for the same bucket; the dashed 2026-10-19 marker shows when the range includes that day, under every `Group by`.
- In each `Engaged share by …` table under the `Engaged visitors` heading, Engaged is less than or equal to Web on every row, and the `Total` row's Web and Engaged equal the visitor chart's and the `Engaged visitors` bars summed over the range.
- Hover and keyboard-focus a bucket on every chart, and open every data table. On `Who saw us`, the tooltip lists every series with each store's state; recent store segments are faded as not final, and a store bucket past that store's newest delivered day reads `Not arrived yet` rather than `No data`. On a `Who saw us` dataset page the tooltip has no `Total`, and the App Store page marks its chart and breakdown bars the same way.
- Change the selection around one complete day: nobody already counted turns new in `Who opened the app` or `Who studied`.
- Select early retained history and today alone: days before coverage are unavailable rather than zero, and today is in progress.
- On `Who came back`, recent cohorts are unavailable, an older cohort still counts returns after the selection end, an empty matured cohort has no rate, and one with no returns shows 0% with exact counts.
- An upgraded guest counts once per bucket, and AI chat alone does not count in `Who studied`.
- On `Who paid us` ([SQL](../apps/admin/src/reports/whoPaidUs/paymentHistorySql.ts), [section](../apps/admin/src/reports/whoPaidUs/WhoPaidUsSection.tsx)), through the [read-only SSM workflow](analytics-db-access.md#manual-local-workflow), reconcile each bar's tooltip and its Details page's provider breakdown against [native order, transaction, payment and import-run rows](billing-history.md) and the payment query in the browser's request, using provider UTC times; check Google free-root and first-positive `..0` chains, refunded charges, and Stripe invoices with several payments.
- Select today alone on `Who paid us`: known payments stay visible in progress, a failed Google inventory shows its sanitized failure in the Details page's `Payment import status`, missing Apple history is unavailable, and Stripe proves zero only for fully covered days. Sales by an admin, an excluded actor or an erased account count; sandbox and gifts do not.
- `All time` reaches the earliest native financial event even when it predates every other history.
- Change the range while loading, or retry a failed chart: the other charts and the date controls keep working.

### General and the shared filters ([dashboard](../apps/admin/src/dashboard/AdminDashboard.tsx), [filter model](../apps/admin/src/filters/analyticsFilters.ts))

- `/analytics/general` shows its two sections in order, each chart rendering.
- `Catalog deck installs` is empty or nearly empty on production ([why](../apps/admin/src/reports/catalogInstalls/query.ts)); selecting any device platform empties only that section, and hovering a segment names the deck slug.
- The default range is the one [`buildDefaultReportRange`](../apps/admin/src/reports/reportValues.ts) returns, and the picker widens back to the earliest selectable day; over days only the deck funnel carries, General shows an empty tail.
- Every filter popup names what it filters and how; the date popup's second click applies the range; a threshold such as `1.5` stays named as not applied.
- A burst of filter clicks shows `Updating` at once, keeps the controls live and ends in one reload; `Reset all` restores the default range and clears every other filter.
- Pick one connection country and one app interface language: every chart and the Audience denominator narrow, and both survive a reload.
- A filter that empties a chart removes no user or deck from the options and changes nobody's colour.
- Copy the URL after a few filter clicks and open it in a new tab: the same selection and numbers reopen.
- On the analytics areas, emails appear only in the user filter popup and tooltips. A ⌘/Ctrl-click or middle click on a `Study vs AI` dot or a user option's `Open` link opens the user page in a new tab, and a plain click opens it in the same tab.

### Funnels ([`funnelSections.ts`](../apps/admin/src/reports/funnels/funnelSections.ts))

- `Funnels` is the second tab; its funnels appear in `funnelSections` order as chart-only cards in two columns, one on a narrow viewport, under a shared bar of date range, `Compare with`, client platform, connection country and app interface language, and each card's `Details` button is disabled.
- The audience switch changes every funnel at once, and `Reset all` leaves it.
- Pick a `Compare with` range: every card draws A and B side by side, the key names both with their dates, hovering a bar gives that range's own shares, an empty or maturing range is named in a note, and the comparison survives a reload and clears with `Clear comparison` or `Reset all`.
- On `Blog article to platform choice` ([query](../apps/admin/src/reports/blogFunnels/platformChoiceQuery.ts)), after an article and the home page, hovering a store badge until its QR code shows counts at `Platform hovered or clicked` but not at `Platform clicked`, and a web app click counts at both.
- On `Deck page to install` ([query](../apps/admin/src/reports/catalogInstallFunnel/query.ts)), only a server install is success.
- A deck page view near the range end stays maturing until its seven-day window closes, and a follow-up after the cohort end still counts.

### Audience ([query](../apps/admin/src/reports/audience/query.ts), [section](../apps/admin/src/reports/audience/AudienceSection.tsx))

- Set `Cards answered` to 1: the denominator drops to the people who also answered a card.
- Apply a user, platform and new/returning filter: the denominator and distributions reload, and General keeps its charts when you switch back.
- For one identified retained sample batch, compare its installation, platform and server-received timestamp with the observation endpoint; its country/language pairs come from that batch only.
- Select a range with no retained samples, one older than 90 days, and an empty cohort: coverage is unknown, the unavailable-history notice shows, and nothing invents a historical country.
- A person with several countries or languages counts once in the denominator and in several buckets; known plus unknown coverage equals the denominator.
- Agent-only activity stays labelled separately with unknown geography, and an older client without an event UI locale stays unknown.

### Users and Events ([Users](../apps/admin/src/users/UsersPage.tsx), [user page](../apps/admin/src/users/userPage/UserPage.tsx), [Events](../apps/admin/src/events/EventsPage.tsx))

- `Users` opens newest first without waiting for its filter options; a column filter, a sort and Next each reload from the server and survive a reload; a row's ID or email opens that person's page.
- The four tabs switch without reloading one already opened; a chat opens on its own URL that Back leaves, and `← Users` returns to the list as it was left.
- On a user page, a filter, sort or Next on Activity, Cards, the Chats list or a device list reloads only that table; a Cards text filter matches past the cut preview; a device list reopens as left after a reload; the Users access columns match the profile's `Current access`.
- `Events` opens newest first by `occurred_at`; filters, sort and Next reload from the server and survive a reload; an event ID opens its page, whose user IDs open user pages, and `← Events` returns as left; an event name in a user's Activity tab opens the same event page.
