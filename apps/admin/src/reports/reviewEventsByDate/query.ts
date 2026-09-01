import {
  reviewEventCohorts,
  reviewEventPlatforms,
  runAdminQuery,
} from "../../adminApi";
import type {
  AdminQueryResultSet,
  AdminQueryValue,
  ReviewEventCohort,
  ReviewEventPlatform,
  ReviewEventsByDateCommunityRow,
  ReviewEventsByDatePlatformActiveUserTotal,
  ReviewEventsByDatePlatformReviewEventTotal,
  ReviewEventsByDateReport,
  ReviewEventsByDateRow,
  ReviewEventsByDateTotal,
  ReviewEventsByDateUniqueUserCohort,
  ReviewEventsByDateUser,
} from "../../adminApi";
import type { AdminAppConfig } from "../../config";
import { escapeSqlStringLiteral } from "../../sql";

type ReviewEventsByDateQueryRow = Readonly<{
  review_date: string;
  user_id: string;
  email: string;
  platform: ReviewEventPlatform;
  review_event_count: string | number;
  user_first_review_date: string;
}>;

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

export type ReviewEventsByDateFilterState = Readonly<{
  selectedUserIds: ReadonlyArray<string>;
  selectedCohorts: ReadonlyArray<ReviewEventCohort>;
  selectedPlatforms: ReadonlyArray<ReviewEventPlatform>;
}>;

type ReviewEventsByDateDefaultRangeQueryRow = Readonly<{
  from_date: string;
  to_date: string;
}>;

type ReviewEventsByDateAggregateFields = Readonly<Pick<
  ReviewEventsByDateReport,
  | "totalReviewEvents"
  | "users"
  | "dateTotals"
  | "dailyUniqueUserCohorts"
  | "platformActiveUserTotals"
  | "platformReviewEventTotals"
>>;

function parseCalendarDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) {
    throw new Error(`Review events report date must use YYYY-MM-DD: ${date}`);
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== monthIndex
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`Review events report date is invalid: ${date}`);
  }

  return parsedDate;
}

function formatCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildRequestedDateRange(from: string, to: string): ReadonlyArray<string> {
  const startDate = parseCalendarDate(from);
  const endDate = parseCalendarDate(to);
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error(`Review events report date range is invalid: ${from} > ${to}`);
  }

  const dates: Array<string> = [];
  const currentDate = new Date(startDate);
  while (currentDate.getTime() <= endDate.getTime()) {
    dates.push(formatCalendarDate(currentDate));
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dates;
}

function assertIsString(value: AdminQueryValue, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`Review events report field "${fieldName}" must be a string.`);
  }

  return value;
}

function toInteger(value: AdminQueryValue, fieldName: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    return Number.parseInt(value, 10);
  }

  throw new Error(`Review events report field "${fieldName}" must be an integer.`);
}

function assertPlatform(value: AdminQueryValue, fieldName: string): ReviewEventPlatform {
  const platform = assertIsString(value, fieldName);
  if (reviewEventPlatforms.includes(platform as ReviewEventPlatform) === false) {
    throw new Error(`Review events report field "${fieldName}" must be a supported platform.`);
  }

  return platform as ReviewEventPlatform;
}

function toReviewEventsByDateQueryRow(resultSetRow: Readonly<Record<string, AdminQueryValue>>): ReviewEventsByDateQueryRow {
  return {
    review_date: assertIsString(resultSetRow.review_date ?? null, "review_date"),
    user_id: assertIsString(resultSetRow.user_id ?? null, "user_id"),
    email: assertIsString(resultSetRow.email ?? null, "email"),
    platform: assertPlatform(resultSetRow.platform ?? null, "platform"),
    review_event_count: toInteger(resultSetRow.review_event_count ?? null, "review_event_count"),
    user_first_review_date: assertIsString(resultSetRow.user_first_review_date ?? null, "user_first_review_date"),
  };
}

function toReviewEventsByDateCommunityQueryRow(
  resultSetRow: Readonly<Record<string, AdminQueryValue>>,
): ReviewEventsByDateCommunityQueryRow {
  return {
    report_date: assertIsString(resultSetRow.report_date ?? null, "report_date"),
    user_id: assertIsString(resultSetRow.user_id ?? null, "user_id"),
    email: assertIsString(resultSetRow.email ?? null, "email"),
    friend_invitation_count: toInteger(resultSetRow.friend_invitation_count ?? null, "friend_invitation_count"),
    friendship_count: toInteger(resultSetRow.friendship_count ?? null, "friendship_count"),
  };
}

function toReviewEventsByDateDefaultRangeQueryRow(
  resultSetRow: Readonly<Record<string, AdminQueryValue>>,
): ReviewEventsByDateDefaultRangeQueryRow {
  return {
    from_date: assertIsString(resultSetRow.from_date ?? null, "from_date"),
    to_date: assertIsString(resultSetRow.to_date ?? null, "to_date"),
  };
}

function assertValidDateRange(range: ReviewEventsByDateRange, fieldName: string): ReviewEventsByDateRange {
  const fromDate = parseCalendarDate(range.from);
  const toDate = parseCalendarDate(range.to);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error(`Review events ${fieldName} date range is invalid: ${range.from} > ${range.to}`);
  }

  return range;
}

function buildReviewEventsByDateUsers(rows: ReadonlyArray<ReviewEventsByDateRow>): ReadonlyArray<ReviewEventsByDateUser> {
  const totalsByUserId = new Map<string, ReviewEventsByDateUser>();

  for (const row of rows) {
    const existingEntry = totalsByUserId.get(row.userId);
    totalsByUserId.set(row.userId, {
      userId: row.userId,
      email: existingEntry?.email ?? row.email,
      totalReviewEvents: (existingEntry?.totalReviewEvents ?? 0) + row.reviewEventCount,
    });
  }

  return Array.from(totalsByUserId.values()).sort((left, right) => {
    if (right.totalReviewEvents !== left.totalReviewEvents) {
      return right.totalReviewEvents - left.totalReviewEvents;
    }

    const leftLabel = left.email === "(no email)" ? left.userId : left.email;
    const rightLabel = right.email === "(no email)" ? right.userId : right.email;
    return leftLabel.localeCompare(rightLabel);
  });
}

function buildReviewEventsByDateTotals(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDateTotal> {
  const totalsByDate = new Map<string, number>();

  for (const row of rows) {
    totalsByDate.set(row.date, (totalsByDate.get(row.date) ?? 0) + row.reviewEventCount);
  }

  return dates.map((date) => ({
    date,
    totalReviewEvents: totalsByDate.get(date) ?? 0,
  }));
}

function buildPlatformActiveUserTotals(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDatePlatformActiveUserTotal> {
  const countsByDatePlatform = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.date}:${row.platform}`;
    countsByDatePlatform.set(key, (countsByDatePlatform.get(key) ?? 0) + 1);
  }

  return dates.flatMap((date) => reviewEventPlatforms.map((platform) => ({
    date,
    platform,
    activeUserCount: countsByDatePlatform.get(`${date}:${platform}`) ?? 0,
  })));
}

function buildPlatformReviewEventTotals(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDatePlatformReviewEventTotal> {
  const countsByDatePlatform = new Map<string, number>();

  for (const row of rows) {
    const key = `${row.date}:${row.platform}`;
    countsByDatePlatform.set(key, (countsByDatePlatform.get(key) ?? 0) + row.reviewEventCount);
  }

  return dates.flatMap((date) => reviewEventPlatforms.map((platform) => ({
    date,
    platform,
    reviewEventCount: countsByDatePlatform.get(`${date}:${platform}`) ?? 0,
  })));
}

function buildDailyUniqueUserCohorts(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReadonlyArray<ReviewEventsByDateUniqueUserCohort> {
  const newUsersByDate = new Map<string, Set<string>>();
  const returningUsersByDate = new Map<string, Set<string>>();

  for (const row of rows) {
    const isNew = row.firstReviewDate === row.date;
    const usersByDate = isNew ? newUsersByDate : returningUsersByDate;
    const users = usersByDate.get(row.date) ?? new Set<string>();
    users.add(row.userId);
    usersByDate.set(row.date, users);
  }

  return dates.map((date) => ({
    date,
    newReviewingUsers: newUsersByDate.get(date)?.size ?? 0,
    returningReviewingUsers: returningUsersByDate.get(date)?.size ?? 0,
  }));
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

function buildCommunityOnlyUsers(
  communityRows: ReadonlyArray<ReviewEventsByDateCommunityRow>,
  reviewUsers: ReadonlyArray<ReviewEventsByDateUser>,
): ReadonlyArray<ReviewEventsByDateUser> {
  const reviewUserIds = new Set(reviewUsers.map((user) => user.userId));
  const usersByUserId = new Map<string, ReviewEventsByDateUser>();

  for (const row of communityRows) {
    if (reviewUserIds.has(row.userId) || usersByUserId.has(row.userId)) {
      continue;
    }

    usersByUserId.set(row.userId, {
      userId: row.userId,
      email: row.email,
      totalReviewEvents: 0,
    });
  }

  return Array.from(usersByUserId.values()).sort((left, right) => {
    const leftLabel = left.email === "(no email)" ? left.userId : left.email;
    const rightLabel = right.email === "(no email)" ? right.userId : right.email;
    return leftLabel.localeCompare(rightLabel);
  });
}

function buildReviewEventsByDateAggregateFields(
  rows: ReadonlyArray<ReviewEventsByDateRow>,
  dates: ReadonlyArray<string>,
): ReviewEventsByDateAggregateFields {
  return {
    totalReviewEvents: rows.reduce((sum, row) => sum + row.reviewEventCount, 0),
    users: buildReviewEventsByDateUsers(rows),
    dateTotals: buildReviewEventsByDateTotals(rows, dates),
    dailyUniqueUserCohorts: buildDailyUniqueUserCohorts(rows, dates),
    platformActiveUserTotals: buildPlatformActiveUserTotals(rows, dates),
    platformReviewEventTotals: buildPlatformReviewEventTotals(rows, dates),
  };
}

function buildReviewEventsByDateReport(
  resultSet: AdminQueryResultSet,
  communityResultSet: AdminQueryResultSet,
  executedAtUtc: string,
  from: string,
  to: string,
): ReviewEventsByDateReport {
  const rows = resultSet.rows
    .map(toReviewEventsByDateQueryRow)
    .map((row) => ({
      date: row.review_date,
      userId: row.user_id,
      email: row.email,
      platform: row.platform,
      reviewEventCount: toInteger(row.review_event_count, "review_event_count"),
      firstReviewDate: row.user_first_review_date,
    }))
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date.localeCompare(right.date);
      }

      if (right.reviewEventCount !== left.reviewEventCount) {
        return right.reviewEventCount - left.reviewEventCount;
      }

      if (left.userId !== right.userId) {
        return left.userId.localeCompare(right.userId);
      }

      return left.platform.localeCompare(right.platform);
    });

  const dates = buildRequestedDateRange(from, to);
  const aggregateFields = buildReviewEventsByDateAggregateFields(rows, dates);
  const communityRows = communityResultSet.rows
    .map(toReviewEventsByDateCommunityQueryRow)
    .map((row) => ({
      date: row.report_date,
      userId: row.user_id,
      email: row.email,
      friendInvitationCount: toInteger(row.friend_invitation_count, "friend_invitation_count"),
      friendshipCount: toInteger(row.friendship_count, "friendship_count"),
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
    ...aggregateFields,
    communityOnlyUsers: buildCommunityOnlyUsers(communityRows, aggregateFields.users),
    rows,
    communityRows,
  };
}

function getReviewEventsByDateRowCohort(row: ReviewEventsByDateRow): ReviewEventCohort {
  return row.firstReviewDate === row.date ? "new" : "returning";
}

function isUnfilteredReviewEventsByDateReport(filters: ReviewEventsByDateFilterState): boolean {
  return filters.selectedUserIds.length === 0
    && filters.selectedCohorts.length === reviewEventCohorts.length
    && filters.selectedPlatforms.length === reviewEventPlatforms.length;
}

function hasRestrictedReviewEventFilters(filters: ReviewEventsByDateFilterState): boolean {
  return filters.selectedCohorts.length !== reviewEventCohorts.length
    || filters.selectedPlatforms.length !== reviewEventPlatforms.length;
}

function shouldIncludeCommunityRow(
  row: ReviewEventsByDateCommunityRow,
  selectedUserIdSet: ReadonlySet<string>,
  filteredReviewUserIdSet: ReadonlySet<string>,
  isRestrictedToFilteredReviewUsers: boolean,
): boolean {
  if (selectedUserIdSet.size > 0 && selectedUserIdSet.has(row.userId) === false) {
    return false;
  }

  return isRestrictedToFilteredReviewUsers === false || filteredReviewUserIdSet.has(row.userId);
}

function shouldIncludeReviewEventsByDateRow(
  row: ReviewEventsByDateRow,
  selectedUserIdSet: ReadonlySet<string>,
  selectedCohortSet: ReadonlySet<ReviewEventCohort>,
  selectedPlatformSet: ReadonlySet<ReviewEventPlatform>,
): boolean {
  if (selectedUserIdSet.size > 0 && selectedUserIdSet.has(row.userId) === false) {
    return false;
  }

  if (selectedCohortSet.has(getReviewEventsByDateRowCohort(row)) === false) {
    return false;
  }

  return selectedPlatformSet.has(row.platform);
}

export function filterReviewEventsByDateReport(
  report: ReviewEventsByDateReport,
  filters: ReviewEventsByDateFilterState,
): ReviewEventsByDateReport {
  if (isUnfilteredReviewEventsByDateReport(filters)) {
    return report;
  }

  const selectedUserIdSet = new Set(filters.selectedUserIds);
  const selectedCohortSet = new Set(filters.selectedCohorts);
  const selectedPlatformSet = new Set(filters.selectedPlatforms);
  const rows = report.rows.filter((row) => shouldIncludeReviewEventsByDateRow(
    row,
    selectedUserIdSet,
    selectedCohortSet,
    selectedPlatformSet,
  ));
  const filteredReviewUserIdSet = new Set(rows.map((row) => row.userId));
  const isRestrictedToFilteredReviewUsers = hasRestrictedReviewEventFilters(filters);
  const communityRows = report.communityRows.filter((row) => shouldIncludeCommunityRow(
    row,
    selectedUserIdSet,
    filteredReviewUserIdSet,
    isRestrictedToFilteredReviewUsers,
  ));
  const dates = buildRequestedDateRange(report.from, report.to);
  const aggregateFields = buildReviewEventsByDateAggregateFields(rows, dates);

  return {
    ...report,
    rows,
    communityRows,
    ...aggregateFields,
  };
}

// The first calendar day the dashboard has anything to show, read from the same event table the
// charts read. Three scalar subqueries rather than one `event_name IN (...)` aggregate: each of them
// is a `MIN` over a single leading key value of `idx_product_events_event_name_occurred_at` (0119),
// which is the shape Postgres can answer as an ordered index scan stopping at the first row. That is
// the intent rather than a guarantee: these read `analytics.product_events_resolved`, so reaching
// the index needs the planner to drop the view's two `LEFT JOIN`s first, and only `EXPLAIN` against
// production settles whether it does. `LEAST` ignores NULLs, so an event name that has never been
// emitted simply does not contribute a candidate.
export function buildReviewEventsByDateDefaultRangeSql(): string {
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

// Per-actor breakdown for the admin "Review events by date" report (charts + tooltips).
//
// ONE SOURCE. This reads `analytics.product_events_resolved` and nothing else in the product
// schemas except the identity join below. It no longer joins `content.review_events` to
// `sync.workspace_replicas`, and it no longer restates the client-installation identity rules that
// `apps/backend/src/globalMetrics/reporting.ts` encodes for the public snapshot. Those two surfaces
// have deliberately diverged: the snapshot still counts raw review rows, this dashboard counts
// resolved actors, and the numbers are expected to differ.
//
// GROUP BY actor_id, NEVER BY user_id. `actor_id` already collapses a guest and the account that
// guest became into one person (`db/migrations/0115_product_analytics_resolved_view.sql`), and
// `0120` wrote the historical guest links, so pre-live history resolves through the same machinery.
// That single rule is what removes the `actor_kind = 'client_installation'` filter, the guest-merge
// reasoning and the duplicated cohort CTE at once.
//
// ONE IDENTITY RULE IS NOT IN THE EVENTS TABLE. An event row carries no email, so the
// `%@example.com` exclusion has to bring its own, joined from `actor_id` to `org.user_settings`. The
// same rule is encoded canonically as `exampleComEmailExclusionSqlFragments` in
// `apps/backend/src/globalMetrics/reporting.ts`; this package cannot import from there, so it is
// restated inline here and again in `buildReviewEventsByDateCommunitySql`. If the exclusion changes
// - a second test domain, a different match - update both files.
//
// THAT JOIN FOLDS THE STORED SIDE, and has to. `resolved.actor_id` is UUID, so `::text` always
// renders canonical lowercase hex, while `org.user_settings.user_id` is an unconstrained TEXT
// primary key (`db/migrations/0001_initial_schema.sql:26-27`) that may hold either hex case.
// Compared as stored, an uppercase-hex row would simply miss, the email would come back NULL, the
// row would pass `user_settings.email IS NULL`, and a test account would be counted in every chart
// while displaying as `(no email)`. `0120_backfill_product_analytics_server_facts.sql:445-460`
// settles this same question for the same reason and folds both sides of its live-account guard.
// Folding rather than `::uuid` is equally deliberate: `0001_initial_schema.sql:152` seeds this table
// with the id `'local'` for `AUTH_MODE=none`, and a cast would abort the whole statement and take
// the dashboard down. The cost is the primary-key index on this join, which is cheap here because
// `org.user_settings` is one narrow row per account: the planner hashes it once and probes that hash
// per event, rather than scanning it per event. Two rows could fold together only if two accounts
// held ids differing in hex case alone, which `0120` already treats as one identity; if that ever
// happened the two builders would fail differently, because here the duplicate fold silently doubles
// `COUNT(*)` and that actor's per-day totals, while in `buildReviewEventsByDateCommunitySql` the
// final `org.user_settings` join fans the deduped `community_user_dates` rows back out and
// `assertCommunityRowsInRange` throws `Community report returned duplicate rows for date and user`,
// taking the whole dashboard red rather than reporting a wrong number.
//
// An actor with no row there - a guest who never upgraded, an unresolved anonymous id - keeps a NULL
// email and is included, exactly as before.
//
// DELETED ACCOUNTS STILL APPEAR ONCE THEY HAVE ANALYTICS HISTORY, which is a visible change from the
// old dashboard. Account deletion anonymizes rather than erases:
// `apps/backend/src/auth/accountDeletion.ts:177-195` rewrites `user_id` and `subject_user_id` to a
// per-deletion pseudonym UUID and sets `identity_state = 'anonymized'`. Those rows keep resolving to
// a stable non-NULL `actor_id`, so a departed person's review history stays in the totals as a
// `(no email)` actor whose raw pseudonym UUID shows in the user filter popup and in tooltips. The
// old dashboard showed nothing for them, but not because of its `sync.workspace_replicas` join: the
// same deletion had already removed the rows that query read, since
// `accountDeletion.ts:254` deletes the person's sole-member `org.workspaces` rows and
// `content.review_events.workspace_id` is `ON DELETE CASCADE` (`0001_initial_schema.sql:68`).
//
// The reverse case is the one to hold onto when reconciling a total: an account deleted BEFORE it
// had analytics history is absent here entirely. There was nothing to anonymize, and `0120` could
// not reconstruct it either, because `accountDeletion.ts:264` also deletes the `org.user_settings`
// row and the backfill keeps only reviews whose author still has one (`0120:669-674`, stated
// outright at `0120:606-611`). Do not look for those reviews in `content.review_events` either -
// they went with the workspace.
//
// Keeping the anonymized history is intended - the reviews really happened - and `identity_state` on
// `analytics.product_events_resolved` is the handle if they ever need filtering out.
//
// PLATFORM IS READ OFF THE ROW AND NEVER DERIVED. The producer derives it once per drain from the
// replica that recorded the review (`apps/backend/src/productAnalytics/serverFacts/reviewAnswers.ts`), and
// migration `0122` filled the same value on the history `0120` reconstructed, `0123` on the live
// rows the producer wrote before it could resolve one. That derivation reads
// `sync.workspace_replicas.platform` only together with `actor_kind` on the same row, so a value
// appears only for a `client_installation` replica on 'ios', 'android' or 'web': an
// `agent_connection` replica stores 'web' for the machine API, an `ai_chat` replica stores a
// hard-coded 'web' that describes no device, and seed/reset replicas store 'system'. Each of those,
// and a review whose replica row is gone or whose resolution failed, stays NULL and lands in the
// `unattributed` bucket, which means no resolved device fact - either the actor behind the row is
// not a device or no device could be resolved for it - rather than either case alone. A machine-API
// review lands there rather than under `agent`, because this event reports the device a person
// answered a card on and a replica that is not a client installation resolves to NULL rather than to
// a fourth value.
export function buildReviewEventsByDateSql(from: string, to: string): string {
  assertValidDateRange({ from, to }, "report");

  return [
    // Bounded above only. The cohort split needs each actor's first review day over all of history,
    // and the range filter is applied once, below, against the same materialized rows. The predicate
    // is on the raw `occurred_at` column rather than on its UTC date so
    // `idx_product_events_event_name_occurred_at` stays usable as an (event_name, occurred_at) range
    // scan.
    "WITH review_answers AS (",
    "  SELECT",
    "    resolved.actor_id::text AS actor_id,",
    "    (resolved.occurred_at AT TIME ZONE 'UTC')::date AS review_date,",
    "    CASE",
    "      WHEN resolved.platform IN ('web', 'android', 'ios', 'agent') THEN resolved.platform",
    "      ELSE 'unattributed'",
    "    END AS platform,",
    "    COALESCE(NULLIF(btrim(user_settings.email), ''), '(no email)') AS email",
    "  FROM analytics.product_events_resolved AS resolved",
    "  LEFT JOIN org.user_settings AS user_settings",
    "    ON pg_catalog.lower(user_settings.user_id) = resolved.actor_id::text",
    "  WHERE resolved.event_name = 'review_answered'",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND (",
    "      user_settings.email IS NULL",
    "      OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "    )",
    "),",
    // `occurred_at` is the client clock, kept only inside a 30-day window that ends at a server
    // anchor and replaced by that anchor outside the window in EITHER direction - too far in the
    // future and too far in the past alike (`resolveReviewAnsweredOccurredAt`,
    // `apps/backend/src/productAnalytics/serverFacts/reviewAnswers.ts:189-204`, against
    // `productAnalyticsMaxEventAgeMs` at `validation.ts:24`; `0120:645-650` applies the identical
    // rule as `INTERVAL '720 hours'`, and that backfill produced almost all of the history below).
    // Inside the window this is the day the person answered rather than the day the answer synced,
    // so a first review day can move earlier than the old dashboard reported it. Outside it the day
    // is the anchor's, and on the review history import the anchor is that request's own clock, so
    // an offline, imported or guest-merged history older than 30 days collapses onto sync day
    // instead of onto the days it was answered - which is the opposite of the in-window shift and
    // worth knowing before reading an early spike as real.
    "actor_first_review_date AS (",
    "  SELECT",
    "    review_answers.actor_id,",
    "    MIN(review_answers.review_date) AS first_review_date",
    "  FROM review_answers",
    "  GROUP BY review_answers.actor_id",
    ")",
    "SELECT",
    "  to_char(review_answers.review_date, 'YYYY-MM-DD') AS review_date,",
    // Emitted under the name the SPA row shape already uses. The value is the resolved actor.
    "  review_answers.actor_id AS user_id,",
    "  review_answers.email,",
    "  review_answers.platform,",
    "  COUNT(*)::int AS review_event_count,",
    "  to_char(actor_first_review_date.first_review_date, 'YYYY-MM-DD') AS user_first_review_date",
    "FROM review_answers",
    "INNER JOIN actor_first_review_date",
    "  ON actor_first_review_date.actor_id = review_answers.actor_id",
    `WHERE review_answers.review_date >= ${escapeSqlStringLiteral(from)}::date`,
    `  AND review_answers.review_date <= ${escapeSqlStringLiteral(to)}::date`,
    "GROUP BY",
    "  review_answers.review_date,",
    "  review_answers.actor_id,",
    "  review_answers.email,",
    "  review_answers.platform,",
    "  actor_first_review_date.first_review_date",
    "ORDER BY",
    "  review_answers.review_date ASC,",
    "  review_event_count DESC,",
    "  review_answers.actor_id ASC,",
    "  review_answers.platform ASC",
  ].join("\n");
}

// Per-actor community activity for the admin "Review events by date" report.
// One row per (report date, actor) with at least one non-zero count; the client fills the remaining
// dates.
//
// Both series now come from `analytics.product_events_resolved`, grouped by `actor_id`, with the
// same case-folded `org.user_settings` email join described on `buildReviewEventsByDateSql`, and the
// same restatement of the `%@example.com` exclusion that lives canonically in
// `apps/backend/src/globalMetrics/reporting.ts`.
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
export function buildReviewEventsByDateCommunitySql(from: string, to: string): string {
  assertValidDateRange({ from, to }, "community report");

  return [
    "WITH requested_dates AS (",
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
    "  LEFT JOIN org.user_settings AS user_settings",
    "    ON pg_catalog.lower(user_settings.user_id) = resolved.actor_id::text",
    "  WHERE resolved.event_name IN ('friend_invitation_created', 'friendship_created')",
    "    AND resolved.occurred_at < (",
    `      (${escapeSqlStringLiteral(to)}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'UTC'`,
    "    )",
    "    AND (",
    "      user_settings.email IS NULL",
    "      OR LOWER(btrim(user_settings.email)) NOT LIKE '%@example.com'",
    "    )",
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
    "ORDER BY",
    "  community_user_dates.report_date ASC,",
    "  community_user_dates.actor_id ASC",
  ].join("\n");
}

export async function loadReviewEventsByDateDefaultRange(
  config: AdminAppConfig,
): Promise<ReviewEventsByDateRange> {
  const response = await runAdminQuery(config, buildReviewEventsByDateDefaultRangeSql());
  if (response.resultSets.length !== 1) {
    throw new Error("Review events default range query must return exactly one result set.");
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error("Review events default range query result set is missing.");
  }

  if (resultSet.rows.length !== 1) {
    throw new Error(`Review events default range query must return exactly one row. Got ${resultSet.rows.length}.`);
  }

  const row = resultSet.rows[0];
  if (row === undefined) {
    throw new Error("Review events default range query row is missing.");
  }

  const rangeRow = toReviewEventsByDateDefaultRangeQueryRow(row);
  return assertValidDateRange({
    from: rangeRow.from_date,
    to: rangeRow.to_date,
  }, "default");
}

export async function loadReviewEventsByDateReport(
  config: AdminAppConfig,
  from: string,
  to: string,
): Promise<ReviewEventsByDateReport> {
  const response = await runAdminQuery(config, [
    buildReviewEventsByDateSql(from, to),
    buildReviewEventsByDateCommunitySql(from, to),
  ].join(";\n"));
  if (response.resultSets.length !== 2) {
    throw new Error(`Review events report must return exactly two result sets. Got ${response.resultSets.length}.`);
  }

  const resultSet = response.resultSets[0];
  if (resultSet === undefined) {
    throw new Error("Review events report result set is missing.");
  }

  const communityResultSet = response.resultSets[1];
  if (communityResultSet === undefined) {
    throw new Error("Review events community report result set is missing.");
  }

  return buildReviewEventsByDateReport(resultSet, communityResultSet, response.executedAtUtc, from, to);
}
