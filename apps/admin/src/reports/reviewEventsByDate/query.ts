import { buildReviewAnswersCteSql as buildCanonicalReviewAnswersCteSql } from "../../../../backend/src/reviewMetricsSql";
import { runAdminQuery } from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
  ReviewEventsByDateCommunityRow,
  ReviewEventsByDateReport,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import type { AnalyticsFilterState } from "../../filters/analyticsFilters";
import {
  buildAppUiLanguagesFilterSql,
  buildCatalogAttributionFiltersSql,
  buildConnectionCountriesFilterSql,
  buildEventPlatformsFilterSql,
  buildExcludedActorSqlLines,
  buildMinimumEventCountsFilterSql,
  buildUserCohortsFilterSql,
  buildUsersFilterSql,
  isCohortOrPlatformNarrowed,
} from "../../filters/filterSql";
import { escapeSqlStringLiteral } from "../../sql";
import {
  assertIsString,
  assertValidDateRange,
  buildRequestedDateRange,
  toInteger,
} from "../reportValues";

type ReviewEventsByDateCommunityQueryRow = Readonly<{
  report_date: string;
  user_id: string;
  email: string;
  friend_invitation_count: string | number;
  friendship_count: string | number;
}>;

export type ReviewEventsByDateRange = Readonly<{
  from: string;
  to: string;
}>;

type ReviewEventsByDateAvailableRangeQueryRow = Readonly<{
  from_date: string;
  to_date: string;
}>;

function toReviewEventsByDateCommunityQueryRow(
  resultSetRow: Readonly<Record<string, AdminQueryValue>>,
): ReviewEventsByDateCommunityQueryRow {
  return {
    report_date: assertIsString(resultSetRow.report_date ?? null, "Review events report", "report_date"),
    user_id: assertIsString(resultSetRow.user_id ?? null, "Review events report", "user_id"),
    email: assertIsString(resultSetRow.email ?? null, "Review events report", "email"),
    friend_invitation_count: toInteger(resultSetRow.friend_invitation_count ?? null, "Review events report", "friend_invitation_count"),
    friendship_count: toInteger(resultSetRow.friendship_count ?? null, "Review events report", "friendship_count"),
  };
}

function toReviewEventsByDateAvailableRangeQueryRow(
  resultSetRow: Readonly<Record<string, AdminQueryValue>>,
): ReviewEventsByDateAvailableRangeQueryRow {
  return {
    from_date: assertIsString(resultSetRow.from_date ?? null, "Review events report", "from_date"),
    to_date: assertIsString(resultSetRow.to_date ?? null, "Review events report", "to_date"),
  };
}

function assertCommunityRowsInRange(
  rows: ReadonlyArray<ReviewEventsByDateCommunityRow>,
  dates: ReadonlyArray<string>,
): void {
  const dateSet = new Set(dates);
  const seenDateUserKeys = new Set<string>();

  for (const row of rows) {
    if (dateSet.has(row.date) === false) {
      throw new Error(`Community report returned a date outside the requested range: ${row.date}`);
    }

    const dateUserKey = `${row.date}:${row.userId}`;
    if (seenDateUserKeys.has(dateUserKey)) {
      throw new Error(`Community report returned duplicate rows for date and user: ${dateUserKey}`);
    }

    seenDateUserKeys.add(dateUserKey);
  }
}

function buildReviewEventsByDateReport(
  communityResultSet: AdminQueryResultSet,
  executedAtUtc: string,
  from: string,
  to: string,
): ReviewEventsByDateReport {
  const dates = buildRequestedDateRange(from, to, "Review events report");
  const communityRows = communityResultSet.rows
    .map(toReviewEventsByDateCommunityQueryRow)
    .map((row) => ({
      date: row.report_date,
      userId: row.user_id,
      email: row.email,
      friendInvitationCount: toInteger(row.friend_invitation_count, "Review events report", "friend_invitation_count"),
      friendshipCount: toInteger(row.friendship_count, "Review events report", "friendship_count"),
    }))
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }

      return left.userId.localeCompare(right.userId);
    });
  assertCommunityRowsInRange(communityRows, dates);

  return {
    generatedAtUtc: executedAtUtc,
    from,
    to,
    dates,
    communityRows,
  };
}

// The first calendar day the dashboard has anything to show, read from the same event table the
// charts read. Four scalar subqueries rather than one `event_name IN (...)` aggregate: each of them
// is a `MIN` over a single leading key value of `idx_product_events_event_name_occurred_at` (0119),
// which is the shape Postgres can answer as an ordered index scan stopping at the first row. That is
// the intent rather than a guarantee: these read `analytics.product_events_resolved`, so reaching
// the index needs the planner to drop the view's two `LEFT JOIN`s first, and only `EXPLAIN` against
// production settles whether it does. `LEAST` ignores NULLs, so an event name that has never been
// emitted simply does not contribute a candidate.
export function buildReviewEventsByDateAvailableRangeSql(): string {
  return [
    "SELECT",
    "  COALESCE(",
    "    to_char(",
    "      (",
    "        LEAST(",
    "          (",
    "            SELECT MIN(resolved.occurred_at)",
    "            FROM analytics.product_events_resolved AS resolved",
    "            WHERE resolved.event_name = 'review_answered'",
    "          ),",
    "          (",
    "            SELECT MIN(resolved.occurred_at)",
    "            FROM analytics.product_events_resolved AS resolved",
    "            WHERE resolved.event_name = 'friend_invitation_created'",
    "          ),",
    "          (",
    "            SELECT MIN(resolved.occurred_at)",
    "            FROM analytics.product_events_resolved AS resolved",
    "            WHERE resolved.event_name = 'friendship_created'",
    "          ),",
    // `0121` reconstructed this event's history back past the first review, so this is normally the
    // subquery that decides the available range.
    "          (",
    "            SELECT MIN(resolved.occurred_at)",
    "            FROM analytics.product_events_resolved AS resolved",
    "            WHERE resolved.event_name = 'app_opened'",
    "          )",
    "        ) AT TIME ZONE 'UTC'",
    "      )::date,",
    "      'YYYY-MM-DD'",
    "    ),",
    "    to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')",
    "  ) AS from_date,",
    "  to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS to_date",
  ].join("\n");
}

// New on the day this actor first answered a card, returning on every later day: the expression the
// cohort filter is applied to.
const reviewCohortSqlExpression = "CASE WHEN review_answers.review_date = actor_first_review_date.first_review_date THEN 'new' ELSE 'returning' END";

// User selection retains a selected actor's entire history; community rows still need their own filter.
function buildReviewAnswersCteSql(to: string, users: ReadonlyArray<string>): string {
  return buildCanonicalReviewAnswersCteSql(
    `((${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC')`,
    buildUsersFilterSql("resolved.actor_id::text", users),
  );
}

// Per-actor community activity for the admin "Review events by date" report.
// One row per (report date, actor) with at least one non-zero count; the client fills the remaining
// dates.
//
// Both series now come from `analytics.product_events_resolved`, grouped by `actor_id`, under the
// shared exclusion rule, through `buildExcludedActorSqlLines`. The email join folds the stored side
// with `pg_catalog.lower` because `actor_id` renders canonical lowercase hex while
// `org.user_settings.user_id` is an unconstrained TEXT key, so an unfolded join would miss an
// uppercase-hex row.
//
// `friendship_count` is a RUNNING SUM of `friendship_created`, which replaces the old
// `requested_dates x real_friendships` cross join - the one genuinely non-scaling part of the
// previous dashboard, since it multiplied every requested day by every friendship row. Its scale is
// now days x actors-with-friendships instead of days x friendship-rows. `GREATEST` folds every
// pre-range event onto the first requested day, so the window function starts from the correct
// opening balance in the same single pass.
//
// The running sum is exact GIVEN THE EVENTS: the producer emits one `friendship_created` per
// directed `community.friendships` row (both the inviter's and the accepter's), the backend has no
// delete path for a friendship, and nothing else writes that event - so the sum of a person's events
// through the end of a day is that person's friendship count at the end of that day, which is what
// the chart means. It is NOT exact against `community.friendships` itself, because the emission is
// best effort and swallows its own failure
// (`apps/backend/src/productAnalytics/serverFacts/serverEvents.ts:202-210`, and
// `apps/backend/src/community/analytics.ts:78-81` for this event specifically). Because the chart is
// a cumulative sum, one dropped write is a permanent step-down: that actor's count is one lower on
// that day and on every day after it, with no repair path. The old query read
// `community.friendships` directly and was immune to this. When this panel disagrees with
// `community.friendships`, a swallowed emission is the first thing to check and a duplicate pair is
// the second: `community.friendships` holding more than one row for the same invitation and viewer
// derives one `event_id` for them all, `ON CONFLICT DO NOTHING` keeps a single event, and `0120`
// accepts that undercount deliberately (`0120:436-443`) and counts the affected pairs in the
// `RAISE NOTICE` at `0120:552-554`.
//
// ONE DELTA THAT CANNOT BE REPRODUCED, and it is a real loss rather than a rounding difference: the
// old query dropped a friendship when EITHER side had an `@example.com` email, by joining
// `community.friendships` twice. A `friendship_created` event names only its own viewer - the
// catalog gives it no properties, and the other side's id is nowhere on the row - so only the actor
// can be excluded here. A real person befriending a test account now keeps that friend in their
// count.
export function buildReviewEventsByDateCommunitySql(filters: AnalyticsFilterState): string {
  const dateRange = assertValidDateRange(filters.dateRange, "Review events community report");
  const from = dateRange.from;
  const to = dateRange.to;
  const userSelectionSql = buildUsersFilterSql("community_user_dates.actor_id", filters.users);
  // A threshold, a connection country, an app UI language and a catalog attribution are properties of
  // the person and not of the row, unlike the cohort and the platform below, so they restrict these
  // rows directly instead of through the review actors.
  const minimumEventCountSelectionSql = buildMinimumEventCountsFilterSql(
    "community_user_dates.actor_id",
    filters.minimumEventCounts,
    dateRange,
  );
  const countrySelectionSql = buildConnectionCountriesFilterSql(
    "community_user_dates.actor_id",
    filters.connectionCountries,
    dateRange,
  );
  const catalogAttributionSelectionSql = buildCatalogAttributionFiltersSql(
    "community_user_dates.actor_id",
    filters,
  );
  const appUiLanguageSelectionSql = buildAppUiLanguagesFilterSql(
    "community_user_dates.actor_id",
    filters.appUiLanguages,
    dateRange,
  );
  // A community row carries no cohort and no platform of its own: the invite and the friendship say
  // nothing about a device, and neither is the activity either cohort is defined on. So a narrowed
  // cohort or platform selection cannot be applied to these rows directly, and they fall back to the
  // actors that still have review events in range under the same selection - the rule the client-side
  // filter applied before this moved into SQL. While both selections span every value, these rows are
  // not restricted to review actors at all, and the person-level fields above still apply to them.
  const isRestrictedToFilteredReviewActors = isCohortOrPlatformNarrowed(filters);

  return [
    ...(isRestrictedToFilteredReviewActors ? [
      `WITH ${buildReviewAnswersCteSql(to, filters.users)},`,
      "filtered_review_actors AS (",
      "  SELECT DISTINCT review_answers.actor_id",
      "  FROM review_answers",
      "  INNER JOIN actor_first_review_date",
      "    ON actor_first_review_date.actor_id = review_answers.actor_id",
      `  WHERE review_answers.review_date >= ${escapeSqlStringLiteral(from)}::date`,
      `    AND review_answers.review_date <= ${escapeSqlStringLiteral(to)}::date`,
      `    AND ${buildUserCohortsFilterSql(reviewCohortSqlExpression, filters.userCohorts)}`,
      `    AND ${buildEventPlatformsFilterSql("review_answers.platform", filters.eventPlatforms)}`,
      "),",
      "requested_dates AS (",
    ] : ["WITH requested_dates AS ("]),
    "  SELECT generate_series(",
    `    ${escapeSqlStringLiteral(from)}::date,`,
    `    ${escapeSqlStringLiteral(to)}::date,`,
    "    INTERVAL '1 day'",
    "  )::date AS report_date",
    "),",
    // One pass over both event names, bounded above only because the friendship running sum needs
    // every event that predates the range. Referenced twice below, so Postgres materializes it and
    // the events table is read once.
    "community_events AS (",
    "  SELECT",
    "    resolved.event_name,",
    "    resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS event_date",
    "  FROM analytics.product_events_resolved AS resolved",
    "  WHERE resolved.event_name IN ('friend_invitation_created', 'friendship_created')",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    ...buildExcludedActorSqlLines("resolved.actor_id::text"),
    "),",
    "daily_friend_invitations AS (",
    "  SELECT",
    "    community_events.actor_id,",
    "    community_events.event_date AS created_date,",
    "    COUNT(*)::int AS friend_invitation_count",
    "  FROM community_events",
    "  WHERE community_events.event_name = 'friend_invitation_created'",
    `    AND community_events.event_date >= ${escapeSqlStringLiteral(from)}::date`,
    "  GROUP BY community_events.actor_id, community_events.event_date",
    "),",
    // Every friendship created before the range is folded onto the first requested day, so the
    // running sum below opens on the correct balance without a second scan for it.
    "friendship_actor_days AS (",
    "  SELECT",
    "    community_events.actor_id,",
    `    GREATEST(community_events.event_date, ${escapeSqlStringLiteral(from)}::date) AS report_date,`,
    "    COUNT(*)::int AS created_count",
    "  FROM community_events",
    "  WHERE community_events.event_name = 'friendship_created'",
    "  GROUP BY",
    "    community_events.actor_id,",
    `    GREATEST(community_events.event_date, ${escapeSqlStringLiteral(from)}::date)`,
    "),",
    "friendship_actors AS (",
    "  SELECT DISTINCT friendship_actor_days.actor_id",
    "  FROM friendship_actor_days",
    "),",
    "daily_friendships AS (",
    "  SELECT",
    "    running_friendships.report_date,",
    "    running_friendships.actor_id,",
    "    running_friendships.friendship_count",
    "  FROM (",
    "    SELECT",
    "      requested_dates.report_date,",
    "      friendship_actors.actor_id,",
    "      CAST(",
    "        SUM(COALESCE(friendship_actor_days.created_count, 0)) OVER (",
    "          PARTITION BY friendship_actors.actor_id",
    "          ORDER BY requested_dates.report_date",
    "        ) AS INTEGER",
    "      ) AS friendship_count",
    "    FROM requested_dates",
    "    CROSS JOIN friendship_actors",
    "    LEFT JOIN friendship_actor_days",
    "      ON friendship_actor_days.actor_id = friendship_actors.actor_id",
    "      AND friendship_actor_days.report_date = requested_dates.report_date",
    "  ) AS running_friendships",
    "  WHERE running_friendships.friendship_count > 0",
    "),",
    "community_user_dates AS (",
    "  SELECT",
    "    daily_friend_invitations.created_date AS report_date,",
    "    daily_friend_invitations.actor_id",
    "  FROM daily_friend_invitations",
    "  UNION",
    "  SELECT",
    "    daily_friendships.report_date,",
    "    daily_friendships.actor_id",
    "  FROM daily_friendships",
    ")",
    "SELECT",
    "  to_char(community_user_dates.report_date, 'YYYY-MM-DD') AS report_date,",
    "  community_user_dates.actor_id AS user_id,",
    "  COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)') AS email,",
    "  COALESCE(daily_friend_invitations.friend_invitation_count, 0)::int AS friend_invitation_count,",
    "  COALESCE(daily_friendships.friendship_count, 0)::int AS friendship_count",
    "FROM community_user_dates",
    "LEFT JOIN org.user_settings AS user_settings",
    "  ON pg_catalog.lower(user_settings.user_id) = community_user_dates.actor_id",
    "LEFT JOIN daily_friend_invitations",
    "  ON daily_friend_invitations.actor_id = community_user_dates.actor_id",
    "  AND daily_friend_invitations.created_date = community_user_dates.report_date",
    "LEFT JOIN daily_friendships",
    "  ON daily_friendships.actor_id = community_user_dates.actor_id",
    "  AND daily_friendships.report_date = community_user_dates.report_date",
    `WHERE ${userSelectionSql}`,
    `  AND ${minimumEventCountSelectionSql}`,
    `  AND ${countrySelectionSql}`,
    `  AND ${appUiLanguageSelectionSql}`,
    `  AND ${catalogAttributionSelectionSql}`,
    ...(isRestrictedToFilteredReviewActors ? [
      "  AND community_user_dates.actor_id IN (SELECT actor_id FROM filtered_review_actors)",
    ] : []),
    "ORDER BY",
    "  community_user_dates.report_date ASC,",
    "  community_user_dates.actor_id ASC",
  ].join("\n");
}

export async function loadReviewEventsByDateAvailableRange(
  config: AdminAppConfig,
  signal: AbortSignal,
): Promise<ReviewEventsByDateRange> {
  const response = await runAdminQuery(config, buildReviewEventsByDateAvailableRangeSql(), signal);
  if (response.resultSets.length !== 1) {
    throw new Error("Review events available range query must return exactly one result set.");
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error("Review events available range query result set is missing.");
  }

  if (resultSet.rows.length !== 1) {
    throw new Error(`Review events available range query must return exactly one row. Got ${resultSet.rows.length}.`);
  }

  const row = resultSet.rows[0];
  if (row === undefined) {
    throw new Error("Review events available range query row is missing.");
  }

  const rangeRow = toReviewEventsByDateAvailableRangeQueryRow(row);
  return assertValidDateRange({
    from: rangeRow.from_date,
    to: rangeRow.to_date,
  }, "Review events available");
}

export async function loadReviewEventsByDateReport(
  config: AdminAppConfig,
  filters: AnalyticsFilterState,
  signal: AbortSignal,
): Promise<ReviewEventsByDateReport> {
  const response = await runAdminQuery(config, buildReviewEventsByDateCommunitySql(filters), signal);
  if (response.resultSets.length !== 1) {
    throw new Error(`Review events community report must return exactly one result set. Got ${response.resultSets.length}.`);
  }

  const communityResultSet = response.resultSets[0];
  if (communityResultSet === undefined) {
    throw new Error("Review events community report result set is missing.");
  }

  return buildReviewEventsByDateReport(
    communityResultSet,
    response.executedAtUtc,
    filters.dateRange.from,
    filters.dateRange.to,
  );
}
