import type { DatabaseExecutor } from "../database";
import {
  formatDateAsTimeZoneLocalDate,
  requireIanaTimeZone,
} from "./timeZone";

export type ReviewTimeZoneSource = "client" | "user_settings";

export type ReviewActiveDayWriteInput = Readonly<{
  reviewEventId: string;
  reviewedByUserId: string;
  reviewedAtClient: string;
  reviewedTimeZone: string | null;
  fallbackProgressTimeZone: string | null;
}>;

export type ReviewActiveDayWriteResult = Readonly<{
  reviewedLocalDate: string | null;
  reviewedTimeZone: string | null;
  reviewedTimeZoneSource: ReviewTimeZoneSource | null;
}>;

type SelectedReviewTimeZone = Readonly<{
  timeZone: string;
  source: ReviewTimeZoneSource;
}>;

type UserSettingsTimeZoneRememberRow = Readonly<{
  user_id: string;
  updated: boolean;
}>;

type UserActiveReviewLocalDateRow = Readonly<{
  review_date: string;
}>;

const localDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseReviewedAtClient(value: string, reviewEventId: string): Date {
  const reviewedAtClient = new Date(value);
  if (Number.isNaN(reviewedAtClient.getTime())) {
    throw new Error(`reviewedAtClient must be a valid ISO timestamp for reviewEventId=${reviewEventId}`);
  }

  return reviewedAtClient;
}

function normalizeLocalDateFromQuery(value: string): string {
  if (!localDatePattern.test(value)) {
    throw new Error(`Invalid active review local date returned from database: ${value}`);
  }

  return value;
}

function selectReviewTimeZone(input: ReviewActiveDayWriteInput): SelectedReviewTimeZone | null {
  if (input.reviewedTimeZone !== null) {
    return {
      timeZone: requireIanaTimeZone(input.reviewedTimeZone, "reviewedTimeZone"),
      source: "client",
    };
  }

  if (input.fallbackProgressTimeZone !== null) {
    return {
      timeZone: requireIanaTimeZone(input.fallbackProgressTimeZone, "progressTimeZone"),
      source: "user_settings",
    };
  }

  return null;
}

async function updateReviewEventReviewTimeZoneInExecutor(
  executor: DatabaseExecutor,
  input: ReviewActiveDayWriteInput,
  reviewedLocalDate: string,
  selectedTimeZone: SelectedReviewTimeZone,
): Promise<void> {
  const result = await executor.query(
    [
      "UPDATE content.review_events",
      "SET reviewed_time_zone = $2, reviewed_local_date = $3::date, reviewed_time_zone_source = $4",
      "WHERE review_event_id = $1 AND reviewed_by_user_id = $5",
      "RETURNING review_event_id",
    ].join(" "),
    [
      input.reviewEventId,
      selectedTimeZone.timeZone,
      reviewedLocalDate,
      selectedTimeZone.source,
      input.reviewedByUserId,
    ],
  );

  if (result.rows[0] === undefined) {
    throw new Error(
      `Review event timezone update did not return a row for reviewEventId=${input.reviewEventId}`,
    );
  }
}

async function upsertUserActiveReviewDayInExecutor(
  executor: DatabaseExecutor,
  input: ReviewActiveDayWriteInput,
  reviewedAtClient: Date,
  reviewedLocalDate: string,
  selectedTimeZone: SelectedReviewTimeZone,
): Promise<void> {
  await executor.query(
    [
      "INSERT INTO progress.user_active_review_days",
      "(",
      "reviewed_by_user_id, local_date, review_count, first_reviewed_at_client,",
      "last_reviewed_at_client, time_zone, time_zone_source",
      ")",
      "VALUES ($1, $2::date, 1, $3, $3, $4, $5)",
      "ON CONFLICT (reviewed_by_user_id, local_date) DO UPDATE",
      "SET",
      "review_count = progress.user_active_review_days.review_count + EXCLUDED.review_count,",
      "first_reviewed_at_client = LEAST(progress.user_active_review_days.first_reviewed_at_client, EXCLUDED.first_reviewed_at_client),",
      "last_reviewed_at_client = GREATEST(progress.user_active_review_days.last_reviewed_at_client, EXCLUDED.last_reviewed_at_client),",
      "time_zone = CASE",
      "WHEN EXCLUDED.first_reviewed_at_client < progress.user_active_review_days.first_reviewed_at_client THEN EXCLUDED.time_zone",
      "ELSE progress.user_active_review_days.time_zone",
      "END,",
      "time_zone_source = CASE",
      "WHEN EXCLUDED.first_reviewed_at_client < progress.user_active_review_days.first_reviewed_at_client THEN EXCLUDED.time_zone_source",
      "ELSE progress.user_active_review_days.time_zone_source",
      "END,",
      "updated_at = now()",
    ].join(" "),
    [
      input.reviewedByUserId,
      reviewedLocalDate,
      reviewedAtClient,
      selectedTimeZone.timeZone,
      selectedTimeZone.source,
    ],
  );
}

export async function storeActiveReviewDayForReviewEventInExecutor(
  executor: DatabaseExecutor,
  input: ReviewActiveDayWriteInput,
): Promise<ReviewActiveDayWriteResult> {
  const selectedTimeZone = selectReviewTimeZone(input);
  if (selectedTimeZone === null) {
    return {
      reviewedLocalDate: null,
      reviewedTimeZone: null,
      reviewedTimeZoneSource: null,
    };
  }

  const reviewedAtClient = parseReviewedAtClient(input.reviewedAtClient, input.reviewEventId);
  const reviewedLocalDate = formatDateAsTimeZoneLocalDate(reviewedAtClient, selectedTimeZone.timeZone);

  await updateReviewEventReviewTimeZoneInExecutor(
    executor,
    input,
    reviewedLocalDate,
    selectedTimeZone,
  );
  await upsertUserActiveReviewDayInExecutor(
    executor,
    input,
    reviewedAtClient,
    reviewedLocalDate,
    selectedTimeZone,
  );

  return {
    reviewedLocalDate,
    reviewedTimeZone: selectedTimeZone.timeZone,
    reviewedTimeZoneSource: selectedTimeZone.source,
  };
}

export async function rememberProgressTimeZoneInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  timeZone: string,
): Promise<void> {
  const normalizedTimeZone = requireIanaTimeZone(timeZone, "timeZone");
  const result = await executor.query<UserSettingsTimeZoneRememberRow>(
    [
      "WITH target_user AS (",
      "SELECT user_id, progress_time_zone",
      "FROM org.user_settings",
      "WHERE user_id = $1",
      "), updated_user AS (",
      "UPDATE org.user_settings AS user_settings",
      "SET progress_time_zone = $2",
      "FROM target_user",
      "WHERE user_settings.user_id = target_user.user_id",
      "AND target_user.progress_time_zone IS DISTINCT FROM $2",
      "RETURNING user_settings.user_id",
      ")",
      "SELECT target_user.user_id, (updated_user.user_id IS NOT NULL) AS updated",
      "FROM target_user",
      "LEFT JOIN updated_user ON updated_user.user_id = target_user.user_id",
    ].join(" "),
    [userId, normalizedTimeZone],
  );

  if (result.rows[0] === undefined) {
    throw new Error(`Progress timezone user_settings row was not found for userId=${userId}`);
  }
}

export async function materializeMissingActiveReviewDaysForUserInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string,
  timeZone: string,
): Promise<void> {
  const normalizedTimeZone = requireIanaTimeZone(timeZone, "timeZone");
  await executor.query(
    [
      "WITH target_review_events AS (",
      "SELECT",
      "review_events.review_event_id,",
      "review_events.reviewed_by_user_id,",
      "review_events.reviewed_at_client,",
      "review_events.reviewed_local_date,",
      "timezone($2, review_events.reviewed_at_client)::date AS fallback_local_date,",
      "COALESCE(review_events.reviewed_time_zone, $2) AS event_time_zone,",
      "COALESCE(review_events.reviewed_time_zone_source, 'user_settings') AS event_time_zone_source",
      "FROM content.review_events AS review_events",
      "LEFT JOIN progress.user_active_review_days AS active_days",
      "ON active_days.reviewed_by_user_id = review_events.reviewed_by_user_id",
      "AND active_days.local_date = COALESCE(",
      "review_events.reviewed_local_date,",
      "timezone($2, review_events.reviewed_at_client)::date",
      ")",
      "WHERE review_events.reviewed_by_user_id = $1",
      "AND review_events.workspace_id = $3",
      "AND (",
      "review_events.reviewed_local_date IS NULL",
      "OR active_days.local_date IS NULL",
      ")",
      "), updated_review_events AS (",
      "UPDATE content.review_events AS review_events",
      "SET reviewed_time_zone = $2,",
      "reviewed_local_date = target_review_events.fallback_local_date,",
      "reviewed_time_zone_source = 'user_settings'",
      "FROM target_review_events",
      "WHERE review_events.review_event_id = target_review_events.review_event_id",
      "AND target_review_events.reviewed_local_date IS NULL",
      "RETURNING review_events.review_event_id",
      "), active_day_rows AS (",
      "SELECT",
      "target_review_events.reviewed_by_user_id,",
      "COALESCE(target_review_events.reviewed_local_date, target_review_events.fallback_local_date) AS local_date,",
      "COUNT(*)::int AS review_count,",
      "MIN(target_review_events.reviewed_at_client) AS first_reviewed_at_client,",
      "MAX(target_review_events.reviewed_at_client) AS last_reviewed_at_client,",
      "(ARRAY_AGG(",
      "CASE",
      "WHEN target_review_events.reviewed_local_date IS NULL THEN $2",
      "ELSE target_review_events.event_time_zone",
      "END",
      "ORDER BY target_review_events.reviewed_at_client ASC, target_review_events.review_event_id ASC",
      "))[1] AS time_zone,",
      "(ARRAY_AGG(",
      "CASE",
      "WHEN target_review_events.reviewed_local_date IS NULL THEN 'user_settings'",
      "ELSE target_review_events.event_time_zone_source",
      "END",
      "ORDER BY target_review_events.reviewed_at_client ASC, target_review_events.review_event_id ASC",
      "))[1] AS time_zone_source",
      "FROM target_review_events",
      "GROUP BY",
      "target_review_events.reviewed_by_user_id,",
      "COALESCE(target_review_events.reviewed_local_date, target_review_events.fallback_local_date)",
      ")",
      "INSERT INTO progress.user_active_review_days",
      "(",
      "reviewed_by_user_id, local_date, review_count, first_reviewed_at_client,",
      "last_reviewed_at_client, time_zone, time_zone_source",
      ")",
      "SELECT",
      "active_day_rows.reviewed_by_user_id,",
      "active_day_rows.local_date,",
      "active_day_rows.review_count,",
      "active_day_rows.first_reviewed_at_client,",
      "active_day_rows.last_reviewed_at_client,",
      "active_day_rows.time_zone,",
      "active_day_rows.time_zone_source",
      "FROM active_day_rows",
      "ON CONFLICT (reviewed_by_user_id, local_date) DO UPDATE",
      "SET",
      "review_count = progress.user_active_review_days.review_count + EXCLUDED.review_count,",
      "first_reviewed_at_client = LEAST(progress.user_active_review_days.first_reviewed_at_client, EXCLUDED.first_reviewed_at_client),",
      "last_reviewed_at_client = GREATEST(progress.user_active_review_days.last_reviewed_at_client, EXCLUDED.last_reviewed_at_client),",
      "time_zone = CASE",
      "WHEN EXCLUDED.first_reviewed_at_client < progress.user_active_review_days.first_reviewed_at_client THEN EXCLUDED.time_zone",
      "ELSE progress.user_active_review_days.time_zone",
      "END,",
      "time_zone_source = CASE",
      "WHEN EXCLUDED.first_reviewed_at_client < progress.user_active_review_days.first_reviewed_at_client THEN EXCLUDED.time_zone_source",
      "ELSE progress.user_active_review_days.time_zone_source",
      "END,",
      "updated_at = now()",
    ].join(" "),
    [userId, normalizedTimeZone, workspaceId],
  );
}

export async function loadUserActiveReviewLocalDatesInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<ReadonlyArray<string>> {
  const result = await executor.query<UserActiveReviewLocalDateRow>(
    [
      // Active review days are intentionally user-wide for personal Progress.
      "SELECT to_char(active_days.local_date, 'YYYY-MM-DD') AS review_date",
      "FROM progress.user_active_review_days AS active_days",
      "WHERE active_days.reviewed_by_user_id = $1",
      "ORDER BY active_days.local_date ASC",
    ].join(" "),
    [userId],
  );

  return result.rows.map((row) => normalizeLocalDateFromQuery(row.review_date));
}
