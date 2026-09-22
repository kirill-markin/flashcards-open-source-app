import type pg from "pg";
import { withReportingReadOnlyTransaction } from "../admin/reportingDb";
import {
  buildGlobalMetricsSnapshot,
  createGlobalMetricsSnapshotWindow,
  type GlobalMetricsSnapshot,
  type GlobalMetricsSnapshotDayRow,
  type GlobalMetricsSnapshotHistoricalStartDate,
  type GlobalMetricsSnapshotTotalsRow,
} from "./snapshot";

// The three SQL builders below back the public anonymized endpoint
// (`apps/backend/src/routes/globalSnapshot.ts`) and the scheduled snapshot Lambda
// (`apps/backend/src/entrypoints/scheduledJobs/lambda-global-metrics-snapshot.ts`).
//
// The first two fragment constants below are the canonical encoding of the user-identity
// filters shared by those three queries, and canonical for those three queries only.
// Both rules are restated elsewhere, and every restatement below is live:
//   * `community.refresh_leaderboard_snapshot`, whose current definition is
//     `db/migrations/0071_progress_leaderboard_all_time_participants.sql:52-53` for the
//     actor_kind/platform pair and `:54-57` for the `%@example.com` exclusion
//   * `community.read_current_user_latest_leaderboard_review`, whose only definition is
//     `db/migrations/0061_leaderboard_real_client_activity.sql:120-121` and `:79-82`,
//     carrying both rules again
//   * `apps/backend/src/chat/costPolicy.ts:65`, which carries the `actor_kind` half alone
// The two leaderboard copies live inside shipped migrations, which are immutable, so
// changing either rule for the leaderboard means writing a NEW migration that redefines
// the function - not editing 0071 or 0061. A fourth supported platform or a second test
// email domain that stops at this file and the admin builders leaves leaderboard
// eligibility on the old rule, silently. The admin exclusion added to the email fragment
// below is deliberately not part of those leaderboard copies: an admin stays eligible for
// the leaderboard and is only kept out of the published counters.
//
// The admin dashboard is no longer one of the restatement sites for
// `clientInstallationActivityWhereSqlFragments`. It reads
// `analytics.product_events_resolved` and groups by the `actor_id` that view resolves,
// so it needs no `actor_kind` filter at all. Those two surfaces have deliberately
// diverged: the snapshot counts raw review rows, the dashboard counts resolved actors,
// and their numbers are not expected to agree.
//
// It does still carry the same exclusion rule as the admin dashboard: an `@example.com`
// address, an admin, an actor listed in `analytics.excluded_actors`, or an actor any of
// whose rows the credential-free collector marked automated. That dashboard lives in a
// separate package and cannot import these fragments, so it writes the rule once of its
// own in `buildExcludedActorSqlLines` (`apps/admin/src/filters/filterSql.ts`) and every
// one of its reports and filter option lists reads it from there. The two surfaces
// exclude the same people and must be changed together.
//
// THE AUTOMATED-CLIENT ARM DOES REACH A STORED ACCOUNT, which is why it is restated below
// rather than skipped. The verdict is stamped on an event row of a browser request
// (`db/migrations/0145_anonymous_client_automated_marker.sql`), and such a row carries no
// `user_id` at all - `product_events_anonymous_client_shape` forbids one. But
// `analytics.product_events_resolved` does not stop there: when
// `analytics.identity_links` holds an `authenticated_client` row for that browser's
// `anonymous_id`, the view resolves those marked rows onto the account that later signed
// in, and `actor_id` is then that account's id. A smoke run that browses the site and
// then signs in is exactly that case, and without the restatement below this query would
// go on counting its reviews while the dashboard drops them. The comparison is the one
// `excludedActorWhereSqlFragments` makes: the marked `actor_id`, against the folded
// `workspace_replicas.user_id` this query counts people by.

// WHERE-fragment that restricts review activity to real client-app installations on
// supported user-facing platforms (excludes system actors and the 'system' platform).
const clientInstallationActivityWhereSqlFragments = [
  "  AND workspace_replicas.actor_kind = 'client_installation'",
  "  AND workspace_replicas.platform IN ('web', 'android', 'ios')",
] as const;

// SQL fragments that exclude users whose known email ends with `@example.com` and users
// who have ever been an admin.
// `joinFragments` and `whereFragments` MUST be spread together into the same query:
// the WHERE fragments reference `user_settings.email`, which is only in scope after
// the JOIN fragment brings `org.user_settings` in.
//
// AN ADMIN IS ANY `auth.admin_users` ROW FOR THAT ADDRESS, revoked or not, so an admin's
// activity never returns to these counters. That table's email is lower/btrim normalized
// by the `admin_users_email_normalized` CHECK in `db/migrations/0045_admin_users.sql`, so
// only the `org.user_settings` side is folded, and `reporting_readonly` reads the column
// through `db/migrations/0125_reporting_readonly_admin_users.sql`. Without that grant
// deployed the snapshot fails outright rather than silently publishing admin activity.
const accountEmailExclusionSqlFragments = {
  joinFragments: [
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON user_settings.user_id = workspace_replicas.user_id",
  ],
  whereFragments: [
    "  AND (",
    "    user_settings.email IS NULL",
    "    OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "  )",
    "  AND NOT EXISTS (",
    "    SELECT 1",
    "    FROM auth.admin_users AS admin_users",
    "    WHERE admin_users.email = LOWER(btrim(user_settings.email))",
    "  )",
  ],
} as const;

// SQL fragments that exclude the actors `analytics.excluded_actors` holds an active
// exclusion for, an exclusion being active while `restored_at IS NULL`. The stored key is
// lower-cased and trimmed, while `workspace_replicas.user_id` is unconstrained TEXT that
// this file otherwise joins and counts raw, so that side is folded before the comparison:
// comparing it raw matches no row and fails silently as a non-exclusion rather than as an
// error. See `db/migrations/0140_analytics_excluded_actors.sql`.
//
// Only the authenticated part of that table can reach these numbers. The stored key is the
// `actor_id` that `analytics.product_events_resolved` reports - the view as
// `db/migrations/0137_audience_context.sql` re-issued it - and that value falls back to a
// client-chosen `anonymous_id`. Nothing constrains that UUID space to be disjoint from
// `workspace_replicas.user_id`, and that fallback is reachable: the credential-free collector
// (`apps/backend/src/productAnalytics/anonymousEvent.ts`, `docs/anonymous-client-analytics.md`)
// stores every row with `user_id` NULL, which `product_events_anonymous_client_shape` requires
// rather than merely permits, so such a row resolves through the anonymous arms of the COALESCE -
// or to `actor_id` NULL outright when its catalog entry is `identityFree` and it carries no
// `anonymous_id` either. `db/migrations/0115_product_analytics_resolved_view.sql` still calls the
// fallback unreachable, but it is the older definition: 0137 replaced it, adding `ui_locale` and
// dropping that inline commentary. Both are immutable, so read 0115 as superseded here and by
// `db/migrations/0143_anonymous_client_identity_free_rows.sql`.
//
// The design rule the asymmetry is meant to express: an actor excluded from the anonymous space
// drops out of the admin reports while leaving these counters alone, so the two surfaces exclude
// overlapping sets rather than the same set. The second half of that rests on today's invariants
// rather than on a guarantee: it holds only while the two id spaces stay disjoint in fact, and an
// `anonymous_id` equal to some `workspace_replicas.user_id` would fold onto it and be matched
// below, excluding an unrelated real account instead of changing nothing. Nothing in the schema
// enforces that disjointness, so the only reachable defense is on the writer that lists an actor.
// The one code writer carries it twice: `excludeSyntheticActors` in
// `apps/backend/src/productAnalytics/syntheticActorDetector.ts` gates its candidates on the
// server-only `review_answered`, which no collector row can produce, and drops
// `trust_level = 'anonymous_client'` besides, so no `anonymous_id` reaches the list. A row written
// into `analytics.excluded_actors` by hand has neither gate.
const excludedActorWhereSqlFragments = [
  "  AND NOT EXISTS (",
  "    SELECT 1",
  "    FROM analytics.excluded_actors AS excluded_actors",
  "    WHERE excluded_actors.actor_id = pg_catalog.lower(pg_catalog.btrim(workspace_replicas.user_id))",
  "      AND excluded_actors.restored_at IS NULL",
  "  )",
] as const;

// SQL fragments that exclude the actors the credential-free collector judged automated, the
// fourth arm of the rule the comment at the top of this file names. TRUE is the only value
// dropped: NULL means nothing assessed that row - it was stored before
// `db/migrations/0145_anonymous_client_automated_marker.sql` shipped, or on a trust level
// where no `User-Agent` is read - and FALSE is one unverified claim a client makes about
// itself, so neither is evidence either way. The verdict is read on the actor rather than on
// the row, as it is on the dashboard: one marked row removes that person's whole history
// here, so a smoke run that later signs into a real account cannot bring its reviews back.
//
// The folding matches `excludedActorWhereSqlFragments` above and for the same reason:
// `workspace_replicas.user_id` is unconstrained TEXT, while the view's `actor_id` renders
// canonical lowercase hex, so comparing the replica side raw would silently match no row.
// The cast is what that comparison needs on top: `analytics.excluded_actors.actor_id` is
// declared TEXT, but the view's `actor_id` is a `uuid` - every arm of its COALESCE is
// (`db/migrations/0114_product_analytics_storage.sql`) - and Postgres has no `uuid = text`
// operator in either direction, so the fragment below would fail to parse without `::text`.
// Every other reader that compares the view's `actor_id` against a text column casts it the
// same way.
//
// `analytics.product_events_resolved` carries no index qual for `actor_id`, so this is
// deliberately a correlated `NOT EXISTS` that the planner turns into an anti-join over the
// marked rows alone: the outer side here is a real join of `content.review_events` and
// `sync.workspace_replicas` with column statistics behind it, unlike the statistics-free CTE
// scans behind the admin package's funnel cohorts, which is why that package writes the same
// arm as an InitPlan on every one of its call sites instead. `db/migrations/0146_product_events_automated_client_index.sql`
// is what keeps the inner side off a whole-table scan.
const automatedClientActorWhereSqlFragments = [
  "  AND NOT EXISTS (",
  "    SELECT 1",
  "    FROM analytics.product_events_resolved AS automated_events",
  "    WHERE automated_events.automated_client",
  "      AND automated_events.actor_id::text = pg_catalog.lower(pg_catalog.btrim(workspace_replicas.user_id))",
  "  )",
] as const;

type GlobalMetricsSnapshotHistoricalStartDateRow = Readonly<{
  historical_start_date: string | null;
}>;

function buildGlobalMetricsSnapshotHistoricalStartDateSql(): string {
  return [
    "SELECT",
    "  to_char(MIN((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date), 'YYYY-MM-DD') AS historical_start_date",
    "FROM content.review_events AS review_events",
    "INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "  ON workspace_replicas.replica_id = review_events.replica_id",
    ...accountEmailExclusionSqlFragments.joinFragments,
    "WHERE review_events.reviewed_at_server < $1::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...accountEmailExclusionSqlFragments.whereFragments,
    ...excludedActorWhereSqlFragments,
    ...automatedClientActorWhereSqlFragments,
  ].join(" ");
}

function buildGlobalMetricsSnapshotTotalsSql(): string {
  return [
    "SELECT",
    "  COUNT(DISTINCT workspace_replicas.user_id)::int AS unique_reviewing_users,",
    "  COUNT(*)::int AS total_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'web')::int AS web_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'android')::int AS android_review_events,",
    "  COUNT(*) FILTER (WHERE workspace_replicas.platform = 'ios')::int AS ios_review_events",
    "FROM content.review_events AS review_events",
    "INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "  ON workspace_replicas.replica_id = review_events.replica_id",
    ...accountEmailExclusionSqlFragments.joinFragments,
    "WHERE review_events.reviewed_at_server < $1::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...accountEmailExclusionSqlFragments.whereFragments,
    ...excludedActorWhereSqlFragments,
    ...automatedClientActorWhereSqlFragments,
  ].join(" ");
}

function buildGlobalMetricsSnapshotDaysSql(): string {
  return [
    "WITH user_first_review_date AS (",
    "  SELECT",
    "    workspace_replicas.user_id,",
    "    MIN((review_events.reviewed_at_server AT TIME ZONE 'UTC')::date) AS first_review_date",
    "  FROM content.review_events AS review_events",
    "  INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "    ON workspace_replicas.replica_id = review_events.replica_id",
    ...accountEmailExclusionSqlFragments.joinFragments,
    "  WHERE review_events.reviewed_at_server < $2::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...accountEmailExclusionSqlFragments.whereFragments,
    ...excludedActorWhereSqlFragments,
    ...automatedClientActorWhereSqlFragments,
    "  GROUP BY workspace_replicas.user_id",
    "), daily_user_activity AS (",
    "  SELECT",
    "    (review_events.reviewed_at_server AT TIME ZONE 'UTC')::date AS review_date,",
    "    workspace_replicas.user_id,",
    "    user_first_review_date.first_review_date,",
    "    COUNT(*)::int AS review_event_count,",
    "    COUNT(*) FILTER (WHERE workspace_replicas.platform = 'web')::int AS web_review_events,",
    "    COUNT(*) FILTER (WHERE workspace_replicas.platform = 'android')::int AS android_review_events,",
    "    COUNT(*) FILTER (WHERE workspace_replicas.platform = 'ios')::int AS ios_review_events",
    "  FROM content.review_events AS review_events",
    "  INNER JOIN sync.workspace_replicas AS workspace_replicas",
    "    ON workspace_replicas.replica_id = review_events.replica_id",
    ...accountEmailExclusionSqlFragments.joinFragments,
    "  INNER JOIN user_first_review_date",
    "    ON user_first_review_date.user_id = workspace_replicas.user_id",
    "  WHERE review_events.reviewed_at_server >= $1::timestamptz",
    "    AND review_events.reviewed_at_server < $2::timestamptz",
    ...clientInstallationActivityWhereSqlFragments,
    ...accountEmailExclusionSqlFragments.whereFragments,
    ...excludedActorWhereSqlFragments,
    ...automatedClientActorWhereSqlFragments,
    "  GROUP BY (review_events.reviewed_at_server AT TIME ZONE 'UTC')::date, workspace_replicas.user_id, user_first_review_date.first_review_date",
    ")",
    "SELECT",
    "  to_char(daily_user_activity.review_date, 'YYYY-MM-DD') AS review_date,",
    "  COUNT(*)::int AS unique_reviewing_users,",
    "  COUNT(*) FILTER (WHERE daily_user_activity.first_review_date = daily_user_activity.review_date)::int AS new_reviewing_users,",
    "  COUNT(*) FILTER (WHERE daily_user_activity.first_review_date < daily_user_activity.review_date)::int AS returning_reviewing_users,",
    "  SUM(daily_user_activity.review_event_count)::int AS total_review_events,",
    "  SUM(daily_user_activity.web_review_events)::int AS web_review_events,",
    "  SUM(daily_user_activity.android_review_events)::int AS android_review_events,",
    "  SUM(daily_user_activity.ios_review_events)::int AS ios_review_events",
    "FROM daily_user_activity",
    "GROUP BY daily_user_activity.review_date",
    "ORDER BY review_date ASC",
  ].join(" ");
}

async function loadGlobalMetricsSnapshotTotalsRowInExecutor(
  executor: pg.PoolClient,
  asOfUtc: string,
): Promise<GlobalMetricsSnapshotTotalsRow> {
  const result = await executor.query<GlobalMetricsSnapshotTotalsRow>(
    buildGlobalMetricsSnapshotTotalsSql(),
    [asOfUtc],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Global metrics totals query returned no rows.");
  }

  return row;
}

async function loadGlobalMetricsSnapshotHistoricalStartDateInExecutor(
  executor: pg.PoolClient,
  asOfUtc: string,
): Promise<GlobalMetricsSnapshotHistoricalStartDate> {
  const result = await executor.query<GlobalMetricsSnapshotHistoricalStartDateRow>(
    buildGlobalMetricsSnapshotHistoricalStartDateSql(),
    [asOfUtc],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error("Global metrics historical start date query returned no rows.");
  }

  return row.historical_start_date;
}

async function loadGlobalMetricsSnapshotDayRowsInExecutor(
  executor: pg.PoolClient,
  rangeStartUtc: string,
  rangeEndUtc: string,
): Promise<ReadonlyArray<GlobalMetricsSnapshotDayRow>> {
  const result = await executor.query<GlobalMetricsSnapshotDayRow>(
    buildGlobalMetricsSnapshotDaysSql(),
    [rangeStartUtc, rangeEndUtc],
  );

  return result.rows;
}

type GenerateGlobalMetricsSnapshotDependencies = Readonly<{
  withReportingReadOnlyTransactionFn: typeof withReportingReadOnlyTransaction;
  now: () => Date;
}>;

export async function generateGlobalMetricsSnapshotWithDependencies(
  dependencies: GenerateGlobalMetricsSnapshotDependencies,
): Promise<GlobalMetricsSnapshot> {
  const now = dependencies.now();
  const provisionalWindow = createGlobalMetricsSnapshotWindow({
    now,
    historicalStartDate: null,
  });

  return dependencies.withReportingReadOnlyTransactionFn(async (client) => {
    const historicalStartDate = await loadGlobalMetricsSnapshotHistoricalStartDateInExecutor(
      client,
      provisionalWindow.asOfUtc,
    );
    const window = createGlobalMetricsSnapshotWindow({
      now,
      historicalStartDate,
    });
    const totalsRow = await loadGlobalMetricsSnapshotTotalsRowInExecutor(
      client,
      window.asOfUtc,
    );
    const dayRows = await loadGlobalMetricsSnapshotDayRowsInExecutor(
      client,
      window.rangeStartUtc,
      window.rangeEndUtc,
    );

    return buildGlobalMetricsSnapshot({
      window,
      totalsRow,
      dayRows,
    });
  });
}

export async function generateGlobalMetricsSnapshot(): Promise<GlobalMetricsSnapshot> {
  return generateGlobalMetricsSnapshotWithDependencies({
    withReportingReadOnlyTransactionFn: withReportingReadOnlyTransaction,
    now: () => new Date(),
  });
}
