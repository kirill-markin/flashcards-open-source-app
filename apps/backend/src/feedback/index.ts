import {
  transactionWithUserScope,
  type DatabaseExecutor,
} from "../database";
import { HttpError } from "../shared/errors";
import { assertUserHasWorkspaceMembershipInExecutor } from "../workspaces/queries";
import { toIsoString, type TimestampValue } from "../workspaces/shared";

export type FeedbackTrigger = "settings" | "automatic";
export type FeedbackPromptEventType = "automatic_prompt_shown";
export type FeedbackPlatform = "web" | "ios" | "android";

export type FeedbackState = Readonly<{
  lastAutomaticPromptShownAt: string | null;
  lastFeedbackSubmittedAt: string | null;
  nextAutomaticPromptAt: string | null;
}>;

export type FeedbackPromptEventInput = Readonly<{
  feedbackPromptEventId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string | null;
  locale: string;
  timezone: string;
  eventType: FeedbackPromptEventType;
  createdAtClient: string;
}>;

export type FeedbackSubmissionInput = Readonly<{
  feedbackSubmissionId: string;
  workspaceId: string | null;
  installationId: string | null;
  platform: FeedbackPlatform;
  appVersion: string | null;
  locale: string;
  timezone: string;
  trigger: FeedbackTrigger;
  message: string;
  createdAtClient: string;
}>;

type FeedbackStateRow = Readonly<{
  last_automatic_prompt_shown_at: TimestampValue | null;
  last_feedback_submitted_at: TimestampValue | null;
}>;

type IdempotencyRow = Readonly<{
  id: string;
}>;

const feedbackAutomaticPromptCooldownMillis: number = 30 * 24 * 60 * 60 * 1_000;

function toTimestampIso(value: TimestampValue | null): string | null {
  if (value === null) {
    return null;
  }

  return toIsoString(value);
}

function maximumTimestampIso(first: string | null, second: string | null): string | null {
  if (first === null) {
    return second;
  }
  if (second === null) {
    return first;
  }

  return Date.parse(first) >= Date.parse(second) ? first : second;
}

function addCooldown(timestampIso: string | null): string | null {
  if (timestampIso === null) {
    return null;
  }

  return new Date(Date.parse(timestampIso) + feedbackAutomaticPromptCooldownMillis).toISOString();
}

export function deriveFeedbackState(
  lastAutomaticPromptShownAt: string | null,
  lastFeedbackSubmittedAt: string | null,
): FeedbackState {
  return {
    lastAutomaticPromptShownAt,
    lastFeedbackSubmittedAt,
    nextAutomaticPromptAt: addCooldown(
      maximumTimestampIso(lastAutomaticPromptShownAt, lastFeedbackSubmittedAt),
    ),
  };
}

function mapFeedbackState(row: FeedbackStateRow): FeedbackState {
  return deriveFeedbackState(
    toTimestampIso(row.last_automatic_prompt_shown_at),
    toTimestampIso(row.last_feedback_submitted_at),
  );
}

async function loadFeedbackStateInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<FeedbackState> {
  const result = await executor.query<FeedbackStateRow>(
    [
      "SELECT",
      "(",
      "SELECT MAX(recorded_at_server)",
      "FROM support.feedback_prompt_events",
      "WHERE user_id = $1 AND event_type = 'automatic_prompt_shown'",
      ") AS last_automatic_prompt_shown_at,",
      "(",
      "SELECT MAX(submitted_at_server)",
      "FROM support.feedback_submissions",
      "WHERE user_id = $1",
      ") AS last_feedback_submitted_at",
    ].join(" "),
    [userId],
  );

  const row = result.rows[0];
  if (row === undefined) {
    throw new HttpError(500, "Feedback state could not be loaded.", "FEEDBACK_STATE_UNAVAILABLE");
  }

  return mapFeedbackState(row);
}

async function assertWorkspaceAccessIfPresent(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  if (workspaceId === null) {
    return;
  }

  await assertUserHasWorkspaceMembershipInExecutor(executor, userId, workspaceId);
}

async function assertSubmissionIdempotencyForUser(
  executor: DatabaseExecutor,
  userId: string,
  feedbackSubmissionId: string,
): Promise<void> {
  const result = await executor.query<IdempotencyRow>(
    [
      "SELECT feedback_submission_id AS id",
      "FROM support.feedback_submissions",
      "WHERE user_id = $1 AND feedback_submission_id = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, feedbackSubmissionId],
  );

  if (result.rows[0] === undefined) {
    throw new HttpError(
      409,
      "feedbackSubmissionId is already used by another feedback submission.",
      "FEEDBACK_SUBMISSION_ID_CONFLICT",
    );
  }
}

async function assertPromptEventIdempotencyForUser(
  executor: DatabaseExecutor,
  userId: string,
  feedbackPromptEventId: string,
): Promise<void> {
  const result = await executor.query<IdempotencyRow>(
    [
      "SELECT feedback_prompt_event_id AS id",
      "FROM support.feedback_prompt_events",
      "WHERE user_id = $1 AND feedback_prompt_event_id = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, feedbackPromptEventId],
  );

  if (result.rows[0] === undefined) {
    throw new HttpError(
      409,
      "feedbackPromptEventId is already used by another feedback prompt event.",
      "FEEDBACK_PROMPT_EVENT_ID_CONFLICT",
    );
  }
}

export async function loadFeedbackStateForUser(userId: string): Promise<FeedbackState> {
  return transactionWithUserScope({ userId }, async (executor) => {
    return loadFeedbackStateInExecutor(executor, userId);
  });
}

export async function recordFeedbackPromptEventForUser(
  userId: string,
  input: FeedbackPromptEventInput,
): Promise<FeedbackState> {
  return transactionWithUserScope({ userId }, async (executor) => {
    await assertWorkspaceAccessIfPresent(executor, userId, input.workspaceId);
    const insertResult = await executor.query<IdempotencyRow>(
      [
        "INSERT INTO support.feedback_prompt_events (",
        "feedback_prompt_event_id,",
        "user_id,",
        "workspace_id,",
        "installation_id,",
        "platform,",
        "app_version,",
        "locale,",
        "timezone,",
        "event_type,",
        "created_at_client",
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        "ON CONFLICT (feedback_prompt_event_id) DO NOTHING",
        "RETURNING feedback_prompt_event_id AS id",
      ].join(" "),
      [
        input.feedbackPromptEventId,
        userId,
        input.workspaceId,
        input.installationId,
        input.platform,
        input.appVersion,
        input.locale,
        input.timezone,
        input.eventType,
        input.createdAtClient,
      ],
    );
    if (insertResult.rows[0] === undefined) {
      await assertPromptEventIdempotencyForUser(executor, userId, input.feedbackPromptEventId);
    }

    return loadFeedbackStateInExecutor(executor, userId);
  });
}

export async function submitFeedbackForUser(
  userId: string,
  input: FeedbackSubmissionInput,
): Promise<FeedbackState> {
  return transactionWithUserScope({ userId }, async (executor) => {
    await assertWorkspaceAccessIfPresent(executor, userId, input.workspaceId);
    const insertResult = await executor.query<IdempotencyRow>(
      [
        "INSERT INTO support.feedback_submissions (",
        "feedback_submission_id,",
        "user_id,",
        "workspace_id,",
        "installation_id,",
        "platform,",
        "app_version,",
        "locale,",
        "timezone,",
        "trigger,",
        "message,",
        "created_at_client",
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        "ON CONFLICT (feedback_submission_id) DO NOTHING",
        "RETURNING feedback_submission_id AS id",
      ].join(" "),
      [
        input.feedbackSubmissionId,
        userId,
        input.workspaceId,
        input.installationId,
        input.platform,
        input.appVersion,
        input.locale,
        input.timezone,
        input.trigger,
        input.message,
        input.createdAtClient,
      ],
    );
    if (insertResult.rows[0] === undefined) {
      await assertSubmissionIdempotencyForUser(executor, userId, input.feedbackSubmissionId);
    }

    return loadFeedbackStateInExecutor(executor, userId);
  });
}
