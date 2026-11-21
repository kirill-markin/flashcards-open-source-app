import type { DatabaseExecutor, SqlValue } from "../../../database";
import {
  createUtcDateFromLocalDate,
  type ProgressBestDay,
  type ProgressBestWeek,
  type ProgressInsights,
  type ProgressStudySecondsDay,
} from "../contracts";
import { normalizeNonNegativeIntegerFromQuery } from "./shared";

// Rolling local-day windows ending today.
const recentWindowDayCount = 7;
const timingWindowDayCount = 28;

// Timing reads the gaps between consecutive ratings of one installation. A gap over
// 120 s is a break, so the review after it starts a session and gets the average gap;
// 60–120 s counts as 60 s; under 1 s is a double tap and is dropped. Only client
// installations are timed: agent, AI chat and system replicas stamp reviews on the
// server. Guest history imported on sign-in keeps its client times and the importing
// installation, so it is timed like any other review from that device.
const sessionBreakGapSeconds = 120;
const maximumTimedGapSeconds = 60;
const minimumTimedGapSeconds = 1;
const minimumTimedDueReviewCount = 50;
const minimumTimedDueReviewDayCount = 3;

type LifetimeDayRow = Readonly<{
  review_date: string;
  lifetime_review_count: string | number;
}>;

type TimingDayRow = Readonly<{
  review_date: string;
  timed_seconds: string | number;
  timed_count: string | number;
  session_start_count: string | number;
  due_timed_seconds: string | number;
  due_timed_count: string | number;
  due_session_start_count: string | number;
  due_card_count: string | number;
}>;

type WorkspaceInsightsRow = Readonly<{
  lifetime_days: ReadonlyArray<LifetimeDayRow>;
  cards_met_count: string | number;
  relearned_count: string | number;
  timing_days: ReadonlyArray<TimingDayRow>;
}>;

type TimingDay = Readonly<{
  timedSeconds: number;
  timedCount: number;
  sessionStartCount: number;
  dueTimedSeconds: number;
  dueTimedCount: number;
  dueSessionStartCount: number;
  dueCardCount: number;
}>;

export type ProgressInsightsAccumulator = Readonly<{
  reviewCountsByDate: ReadonlyMap<string, number>;
  cardsMetLast7Days: number;
  relearnedLast7Days: number;
  timingDaysByDate: ReadonlyMap<string, TimingDay>;
}>;

type WorkspaceInsightsRequest = Readonly<{
  workspaceId: string;
  userId: string;
  timeZone: string;
  today: string;
}>;

function shiftLocalDate(value: string, offsetDays: number): string {
  const date = createUtcDateFromLocalDate(value);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function normalizeNonNegativeNumberFromQuery(value: string | number, fieldName: string): number {
  const normalizedValue = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(normalizedValue) || normalizedValue < 0) {
    throw new Error(`Invalid non-negative number returned for ${fieldName}`);
  }

  return normalizedValue;
}

async function loadWorkspaceInsightsInExecutor(
  executor: DatabaseExecutor,
  request: WorkspaceInsightsRequest,
): Promise<WorkspaceInsightsRow> {
  const queryParams: ReadonlyArray<SqlValue> = [
    request.workspaceId,
    request.userId,
    request.timeZone,
    shiftLocalDate(request.today, 1 - recentWindowDayCount),
    request.today,
    shiftLocalDate(request.today, 1 - timingWindowDayCount),
    sessionBreakGapSeconds,
    maximumTimedGapSeconds,
    minimumTimedGapSeconds,
  ];
  const result = await executor.query<WorkspaceInsightsRow>(
    [
      // Share one scoped scan of the learner's history across the insight aggregates.
      "WITH user_review_events AS MATERIALIZED (",
      "SELECT review_events.card_id, review_events.review_event_id, review_events.replica_id,",
      "review_events.reviewed_at_client, review_events.rating,",
      "COALESCE(review_events.reviewed_local_date,",
      "timezone(COALESCE(review_events.reviewed_time_zone, $3), review_events.reviewed_at_client)::date",
      ") AS review_date",
      "FROM content.review_events AS review_events",
      "WHERE review_events.workspace_id = $1",
      "AND review_events.reviewed_by_user_id = $2",
      "), lifetime_days AS (",
      "SELECT to_char(user_review_events.review_date, 'YYYY-MM-DD') AS review_date,",
      "COUNT(*)::int AS lifetime_review_count",
      "FROM user_review_events",
      "GROUP BY user_review_events.review_date",
      // Cards met count first-ever reviews in the window. Relearned counts passing cards
      // in the window whose previous review day contained an Again.
      "), recent_cards AS (",
      "SELECT DISTINCT user_review_events.card_id",
      "FROM user_review_events",
      // Three days covers the full IANA offset spread when row and request time zones differ.
      "WHERE user_review_events.reviewed_at_client >= (($4::date - 3)::timestamp AT TIME ZONE $3)",
      "AND user_review_events.reviewed_at_client < (($5::date + 3)::timestamp AT TIME ZONE $3)",
      "AND user_review_events.review_date BETWEEN $4::date AND $5::date",
      "), recent_card_days AS (",
      "SELECT",
      "user_review_events.card_id,",
      "user_review_events.review_date,",
      "BOOL_OR(user_review_events.rating = 0) AS had_again,",
      "BOOL_OR(user_review_events.rating > 0) AS had_pass",
      "FROM user_review_events",
      "INNER JOIN recent_cards ON recent_cards.card_id = user_review_events.card_id",
      "GROUP BY user_review_events.card_id, user_review_events.review_date",
      "), sequenced_card_days AS (",
      "SELECT",
      "recent_card_days.card_id,",
      "recent_card_days.review_date,",
      "recent_card_days.had_pass,",
      "LAG(recent_card_days.had_again) OVER (PARTITION BY recent_card_days.card_id ORDER BY recent_card_days.review_date) AS previous_day_had_again,",
      "MIN(recent_card_days.review_date) OVER (PARTITION BY recent_card_days.card_id) AS first_review_date",
      "FROM recent_card_days",
      "), recent_card_counts AS (",
      "SELECT",
      "COUNT(DISTINCT sequenced_card_days.card_id) FILTER (",
      "WHERE sequenced_card_days.first_review_date >= $4::date",
      ")::int AS cards_met_count,",
      "COUNT(DISTINCT sequenced_card_days.card_id) FILTER (",
      "WHERE sequenced_card_days.review_date BETWEEN $4::date AND $5::date",
      "AND sequenced_card_days.had_pass",
      "AND sequenced_card_days.previous_day_had_again",
      ")::int AS relearned_count",
      "FROM sequenced_card_days",
      // Gaps are per installation within this workspace. Repeats on a day count as one due card.
      "), timing_events AS (",
      "SELECT",
      "user_review_events.review_event_id,",
      "user_review_events.card_id,",
      "user_review_events.reviewed_at_client,",
      "workspace_replicas.installation_id,",
      "user_review_events.review_date",
      "FROM user_review_events",
      "INNER JOIN sync.workspace_replicas AS workspace_replicas",
      "ON workspace_replicas.workspace_id = $1",
      "AND workspace_replicas.replica_id = user_review_events.replica_id",
      "WHERE workspace_replicas.actor_kind = 'client_installation'",
      // One extra slack day gives the window's first review its gap.
      "AND user_review_events.reviewed_at_client >= (($6::date - 4)::timestamp AT TIME ZONE $3)",
      "AND user_review_events.reviewed_at_client < (($5::date + 3)::timestamp AT TIME ZONE $3)",
      "), gapped_events AS (",
      "SELECT",
      "timing_events.card_id,",
      "timing_events.reviewed_at_client,",
      "timing_events.review_date,",
      "EXTRACT(EPOCH FROM timing_events.reviewed_at_client - LAG(timing_events.reviewed_at_client) OVER (",
      "PARTITION BY timing_events.installation_id",
      "ORDER BY timing_events.reviewed_at_client, timing_events.review_event_id",
      "))::float8 AS gap_seconds",
      "FROM timing_events",
      "), first_user_reviews AS (",
      "SELECT user_review_events.card_id, MIN(user_review_events.reviewed_at_client) AS first_reviewed_at_client",
      "FROM user_review_events",
      "GROUP BY user_review_events.card_id",
      // Materialize so the earlier-review lookup runs at most once per candidate.
      "), classified_events AS MATERIALIZED (",
      "SELECT",
      "gapped_events.card_id,",
      "gapped_events.review_date,",
      "CASE",
      "WHEN gapped_events.gap_seconds IS NULL OR gapped_events.gap_seconds > $7 THEN 'session_start'",
      "WHEN gapped_events.gap_seconds < $9 THEN 'dropped'",
      "ELSE 'timed'",
      "END AS gap_kind,",
      "LEAST(gapped_events.gap_seconds, $8) AS capped_seconds,",
      // An earlier review by any workspace member makes the card due. Check other history
      // only at the learner's first timestamp, where their own history cannot answer this.
      "CASE WHEN gapped_events.reviewed_at_client > first_user_reviews.first_reviewed_at_client THEN TRUE",
      "ELSE EXISTS (",
      "SELECT 1",
      "FROM content.review_events AS earlier_events",
      "WHERE earlier_events.workspace_id = $1",
      "AND earlier_events.card_id = gapped_events.card_id",
      "AND earlier_events.reviewed_at_client < gapped_events.reviewed_at_client",
      ") END AS is_due_review",
      "FROM gapped_events",
      "INNER JOIN first_user_reviews ON first_user_reviews.card_id = gapped_events.card_id",
      "WHERE gapped_events.review_date BETWEEN $6::date AND $5::date",
      "), timing_days AS (",
      "SELECT",
      "to_char(classified_events.review_date, 'YYYY-MM-DD') AS review_date,",
      "COALESCE(SUM(classified_events.capped_seconds) FILTER (WHERE classified_events.gap_kind = 'timed'), 0)::float8 AS timed_seconds,",
      "COUNT(*) FILTER (WHERE classified_events.gap_kind = 'timed')::int AS timed_count,",
      "COUNT(*) FILTER (WHERE classified_events.gap_kind = 'session_start')::int AS session_start_count,",
      "COALESCE(SUM(classified_events.capped_seconds) FILTER (",
      "WHERE classified_events.gap_kind = 'timed' AND classified_events.is_due_review",
      "), 0)::float8 AS due_timed_seconds,",
      "COUNT(*) FILTER (WHERE classified_events.gap_kind = 'timed' AND classified_events.is_due_review)::int AS due_timed_count,",
      "COUNT(*) FILTER (",
      "WHERE classified_events.gap_kind = 'session_start' AND classified_events.is_due_review",
      ")::int AS due_session_start_count,",
      "COUNT(DISTINCT classified_events.card_id) FILTER (",
      "WHERE classified_events.gap_kind <> 'dropped' AND classified_events.is_due_review",
      ")::int AS due_card_count",
      "FROM classified_events",
      "GROUP BY classified_events.review_date",
      ")",
      "SELECT",
      "COALESCE((SELECT json_agg(lifetime_days) FROM lifetime_days), '[]') AS lifetime_days,",
      "recent_card_counts.cards_met_count, recent_card_counts.relearned_count,",
      "COALESCE((SELECT json_agg(timing_days ORDER BY timing_days.review_date) FROM timing_days), '[]') AS timing_days",
      "FROM recent_card_counts",
    ].join(" "),
    queryParams,
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new Error(`Progress insights returned no row for workspaceId=${request.workspaceId}`);
  }

  return row;
}

function mapTimingDayRow(row: TimingDayRow): TimingDay {
  const field = (name: string): string => `${row.review_date}.${name}`;
  return {
    timedSeconds: normalizeNonNegativeNumberFromQuery(row.timed_seconds, field("timed_seconds")),
    timedCount: normalizeNonNegativeIntegerFromQuery(row.timed_count, field("timed_count")),
    sessionStartCount: normalizeNonNegativeIntegerFromQuery(row.session_start_count, field("session_start_count")),
    dueTimedSeconds: normalizeNonNegativeNumberFromQuery(row.due_timed_seconds, field("due_timed_seconds")),
    dueTimedCount: normalizeNonNegativeIntegerFromQuery(row.due_timed_count, field("due_timed_count")),
    dueSessionStartCount: normalizeNonNegativeIntegerFromQuery(
      row.due_session_start_count,
      field("due_session_start_count"),
    ),
    dueCardCount: normalizeNonNegativeIntegerFromQuery(row.due_card_count, field("due_card_count")),
  };
}

function addTimingDays(left: TimingDay, right: TimingDay): TimingDay {
  return {
    timedSeconds: left.timedSeconds + right.timedSeconds,
    timedCount: left.timedCount + right.timedCount,
    sessionStartCount: left.sessionStartCount + right.sessionStartCount,
    dueTimedSeconds: left.dueTimedSeconds + right.dueTimedSeconds,
    dueTimedCount: left.dueTimedCount + right.dueTimedCount,
    dueSessionStartCount: left.dueSessionStartCount + right.dueSessionStartCount,
    dueCardCount: left.dueCardCount + right.dueCardCount,
  };
}

export function createEmptyProgressInsightsAccumulator(): ProgressInsightsAccumulator {
  return {
    reviewCountsByDate: new Map(),
    cardsMetLast7Days: 0,
    relearnedLast7Days: 0,
    timingDaysByDate: new Map(),
  };
}

/** Adds one workspace's insight facts; call it inside that workspace's RLS scope. */
export async function accumulateWorkspaceProgressInsightsInExecutor(
  executor: DatabaseExecutor,
  accumulator: ProgressInsightsAccumulator,
  request: WorkspaceInsightsRequest,
): Promise<ProgressInsightsAccumulator> {
  const workspaceInsights = await loadWorkspaceInsightsInExecutor(executor, request);

  const reviewCountsByDate = new Map(accumulator.reviewCountsByDate);
  for (const row of workspaceInsights.lifetime_days) {
    const reviewCount = normalizeNonNegativeIntegerFromQuery(
      row.lifetime_review_count,
      `${row.review_date}.lifetime_review_count`,
    );
    reviewCountsByDate.set(row.review_date, (reviewCountsByDate.get(row.review_date) ?? 0) + reviewCount);
  }

  const timingDaysByDate = new Map(accumulator.timingDaysByDate);
  for (const row of workspaceInsights.timing_days) {
    const timingDay = mapTimingDayRow(row);
    const existingTimingDay = timingDaysByDate.get(row.review_date);
    timingDaysByDate.set(
      row.review_date,
      existingTimingDay === undefined ? timingDay : addTimingDays(existingTimingDay, timingDay),
    );
  }

  return {
    reviewCountsByDate,
    cardsMetLast7Days: accumulator.cardsMetLast7Days
      + normalizeNonNegativeIntegerFromQuery(workspaceInsights.cards_met_count, "cards_met_count"),
    relearnedLast7Days: accumulator.relearnedLast7Days
      + normalizeNonNegativeIntegerFromQuery(workspaceInsights.relearned_count, "relearned_count"),
    timingDaysByDate,
  };
}

function findBestDayBeforeToday(
  reviewCountsByDate: ReadonlyMap<string, number>,
  today: string,
): ProgressBestDay | null {
  let bestDay: ProgressBestDay | null = null;
  const sortedDates = [...reviewCountsByDate.keys()].sort();
  for (const date of sortedDates) {
    const reviewCount = reviewCountsByDate.get(date) ?? 0;
    if (date < today && reviewCount > 0 && (bestDay === null || reviewCount > bestDay.reviewCount)) {
      bestDay = { date, reviewCount };
    }
  }

  return bestDay;
}

// Best rolling 7 local days that ended before today.
function findBestWeekBeforeToday(
  reviewCountsByDate: ReadonlyMap<string, number>,
  today: string,
): ProgressBestWeek | null {
  const firstDate = [...reviewCountsByDate.keys()].filter((date) => date < today).sort()[0];
  if (firstDate === undefined) {
    return null;
  }

  const yesterday = shiftLocalDate(today, -1);
  let bestWeek: ProgressBestWeek | null = null;
  let rollingCount = 0;
  for (let date = firstDate; date <= yesterday; date = shiftLocalDate(date, 1)) {
    rollingCount += reviewCountsByDate.get(date) ?? 0;
    rollingCount -= reviewCountsByDate.get(shiftLocalDate(date, -recentWindowDayCount)) ?? 0;
    if (rollingCount > 0 && (bestWeek === null || rollingCount > bestWeek.reviewCount)) {
      bestWeek = { endDate: date, reviewCount: rollingCount };
    }
  }

  return bestWeek;
}

type ProgressTiming = Readonly<{
  secondsPerDueCard: number | null;
  studySecondsByDay: ReadonlyArray<ProgressStudySecondsDay> | null;
}>;

function createProgressTiming(timingDaysByDate: ReadonlyMap<string, TimingDay>, today: string): ProgressTiming {
  const timingDays = [...timingDaysByDate.values()];
  const timedCount = timingDays.reduce((total, day) => total + day.timedCount, 0);
  const dueTimedCount = timingDays.reduce((total, day) => total + day.dueTimedCount, 0);
  const dueTimedDayCount = timingDays.filter((day) => day.dueTimedCount > 0).length;
  if (
    timedCount === 0
    || dueTimedCount < minimumTimedDueReviewCount
    || dueTimedDayCount < minimumTimedDueReviewDayCount
  ) {
    return { secondsPerDueCard: null, studySecondsByDay: null };
  }

  const averageGapSeconds = timingDays.reduce((total, day) => total + day.timedSeconds, 0) / timedCount;
  const dueSeconds = timingDays.reduce(
    (total, day) => total + day.dueTimedSeconds + day.dueSessionStartCount * averageGapSeconds,
    0,
  );
  const dueCardCount = timingDays.reduce((total, day) => total + day.dueCardCount, 0);
  const studySecondsByDay = Array.from({ length: recentWindowDayCount }, (_, index) => {
    const date = shiftLocalDate(today, index + 1 - recentWindowDayCount);
    const day = timingDaysByDate.get(date);
    return {
      date,
      seconds: day === undefined ? 0 : Math.round(day.timedSeconds + day.sessionStartCount * averageGapSeconds),
    };
  });

  return {
    secondsPerDueCard: dueCardCount === 0 ? null : Math.round((dueSeconds / dueCardCount) * 10) / 10,
    studySecondsByDay,
  };
}

export function createProgressInsights(accumulator: ProgressInsightsAccumulator, today: string): ProgressInsights {
  const timing = createProgressTiming(accumulator.timingDaysByDate, today);
  return {
    totalReviews: [...accumulator.reviewCountsByDate.values()].reduce((total, count) => total + count, 0),
    bestDayBeforeToday: findBestDayBeforeToday(accumulator.reviewCountsByDate, today),
    bestWeekBeforeToday: findBestWeekBeforeToday(accumulator.reviewCountsByDate, today),
    cardsMetLast7Days: accumulator.cardsMetLast7Days,
    relearnedLast7Days: accumulator.relearnedLast7Days,
    secondsPerDueCard: timing.secondsPerDueCard,
    studySecondsByDay: timing.studySecondsByDay,
  };
}
