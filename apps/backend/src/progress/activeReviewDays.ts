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

function parseReviewedAtClient(value: string, reviewEventId: string): Date {
  const reviewedAtClient = new Date(value);
  if (Number.isNaN(reviewedAtClient.getTime())) {
    throw new Error(`reviewedAtClient must be a valid ISO timestamp for reviewEventId=${reviewEventId}`);
  }

  return reviewedAtClient;
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
