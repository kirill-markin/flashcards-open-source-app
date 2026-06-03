import { queryWithUserScope, transactionWithUserScope, type DatabaseExecutor } from "../database";
import { HttpError } from "../shared/errors";
import {
  feedbackAutomaticPromptCooldownDays,
  type FeedbackEmailNotificationStatus,
  type FeedbackPromptEventInput,
  type FeedbackState,
  type FeedbackSubmissionInput,
  type StoredFeedbackSubmission,
} from "./types";

const millisecondsPerDay = 86_400_000;

type FeedbackStateRow = Readonly<{
  last_automatic_prompt_at: Date | string | null;
  last_submitted_at: Date | string | null;
}>;

type ExistingFeedbackRow = Readonly<{
  id: string;
}>;

type StoredFeedbackSubmissionRow = Readonly<{
  feedback_submission_id: string;
  created_at_server: Date | string;
}>;

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toOptionalIsoString(value: Date | string | null): string | null {
  return value === null ? null : toIsoString(value);
}

function addDaysToIsoTimestamp(value: string, days: number): string {
  const date = new Date(value);
  return new Date(date.getTime() + days * millisecondsPerDay).toISOString();
}

function getLaterIsoTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) {
    return right;
  }

  if (right === null) {
    return left;
  }

  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function toFeedbackState(row: FeedbackStateRow): FeedbackState {
  const lastAutomaticPromptAt = toOptionalIsoString(row.last_automatic_prompt_at);
  const lastSubmittedAt = toOptionalIsoString(row.last_submitted_at);
  const cooldownBaseAt = getLaterIsoTimestamp(lastAutomaticPromptAt, lastSubmittedAt);
  return {
    automaticPromptCooldownDays: feedbackAutomaticPromptCooldownDays,
    lastAutomaticPromptAt,
    lastSubmittedAt,
    nextAutomaticPromptAt: cooldownBaseAt === null
      ? null
      : addDaysToIsoTimestamp(cooldownBaseAt, feedbackAutomaticPromptCooldownDays),
  };
}

async function loadFeedbackStateInExecutor(
  executor: DatabaseExecutor,
  userId: string,
): Promise<FeedbackState> {
  const result = await executor.query<FeedbackStateRow>(
    [
      "SELECT",
      "MAX(feedback_prompt_events.created_at_server)",
      "FILTER (WHERE feedback_prompt_events.event_type = 'automatic_prompt_shown') AS last_automatic_prompt_at,",
      "(",
      "SELECT MAX(feedback_submissions.created_at_server)",
      "FROM support.feedback_submissions AS feedback_submissions",
      "WHERE feedback_submissions.user_id = $1",
      ") AS last_submitted_at",
      "FROM support.feedback_prompt_events AS feedback_prompt_events",
      "WHERE feedback_prompt_events.user_id = $1",
    ].join(" "),
    [userId],
  );

  return toFeedbackState(result.rows[0] ?? {
    last_automatic_prompt_at: null,
    last_submitted_at: null,
  });
}

async function assertWorkspaceAccessInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string | null,
): Promise<void> {
  if (workspaceId === null) {
    return;
  }

  const result = await executor.query<Readonly<{ ok: number }>>(
    [
      "SELECT 1 AS ok",
      "FROM org.workspace_memberships",
      "WHERE user_id = $1",
      "AND workspace_id = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, workspaceId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(
      403,
      "workspaceId must reference a workspace accessible to the authenticated user.",
      "FEEDBACK_WORKSPACE_FORBIDDEN",
    );
  }
}

async function assertInstallationOwnershipInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  installationId: string | null,
): Promise<void> {
  if (installationId === null) {
    return;
  }

  const result = await executor.query<Readonly<{ ok: number }>>(
    [
      "SELECT 1 AS ok",
      "FROM sync.installations",
      "WHERE user_id = $1",
      "AND installation_id = $2",
      "LIMIT 1",
    ].join(" "),
    [userId, installationId],
  );

  if (result.rows.length === 0) {
    throw new HttpError(
      403,
      "installationId must reference an installation owned by the authenticated user.",
      "FEEDBACK_INSTALLATION_FORBIDDEN",
    );
  }
}

async function assertFeedbackReferencesInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  workspaceId: string | null,
  installationId: string | null,
): Promise<void> {
  await assertWorkspaceAccessInExecutor(executor, userId, workspaceId);
  await assertInstallationOwnershipInExecutor(executor, userId, installationId);
}

async function assertExistingPromptEventIsVisibleInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  feedbackPromptEventId: string,
): Promise<void> {
  const existingRow = await loadExistingPromptEventInExecutor(executor, userId, feedbackPromptEventId);
  if (existingRow === null) {
    throw new HttpError(
      409,
      "feedbackPromptEventId is already used by another feedback prompt event.",
      "FEEDBACK_PROMPT_EVENT_ID_CONFLICT",
    );
  }
}

async function loadExistingPromptEventInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  feedbackPromptEventId: string,
): Promise<ExistingFeedbackRow | null> {
  const result = await executor.query<ExistingFeedbackRow>(
    [
      "SELECT feedback_prompt_event_id AS id",
      "FROM support.feedback_prompt_events",
      "WHERE feedback_prompt_event_id = $1",
      "AND user_id = $2",
      "LIMIT 1",
    ].join(" "),
    [feedbackPromptEventId, userId],
  );

  return result.rows[0] ?? null;
}

async function findExistingSubmissionInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  feedbackSubmissionId: string,
): Promise<StoredFeedbackSubmissionRow | null> {
  const result = await executor.query<StoredFeedbackSubmissionRow>(
    [
      "SELECT feedback_submission_id, created_at_server",
      "FROM support.feedback_submissions",
      "WHERE feedback_submission_id = $1",
      "AND user_id = $2",
      "LIMIT 1",
    ].join(" "),
    [feedbackSubmissionId, userId],
  );

  return result.rows[0] ?? null;
}

async function loadExistingSubmissionInExecutor(
  executor: DatabaseExecutor,
  userId: string,
  feedbackSubmissionId: string,
): Promise<StoredFeedbackSubmissionRow> {
  const row = await findExistingSubmissionInExecutor(executor, userId, feedbackSubmissionId);
  if (row === null) {
    throw new HttpError(
      409,
      "feedbackSubmissionId is already used by another feedback submission.",
      "FEEDBACK_SUBMISSION_ID_CONFLICT",
    );
  }

  return row;
}

export async function loadFeedbackStateForUser(userId: string): Promise<FeedbackState> {
  const result = await queryWithUserScope<FeedbackStateRow>(
    { userId },
    [
      "SELECT",
      "MAX(feedback_prompt_events.created_at_server)",
      "FILTER (WHERE feedback_prompt_events.event_type = 'automatic_prompt_shown') AS last_automatic_prompt_at,",
      "(",
      "SELECT MAX(feedback_submissions.created_at_server)",
      "FROM support.feedback_submissions AS feedback_submissions",
      "WHERE feedback_submissions.user_id = $1",
      ") AS last_submitted_at",
      "FROM support.feedback_prompt_events AS feedback_prompt_events",
      "WHERE feedback_prompt_events.user_id = $1",
    ].join(" "),
    [userId],
  );

  return toFeedbackState(result.rows[0] ?? {
    last_automatic_prompt_at: null,
    last_submitted_at: null,
  });
}

export async function recordFeedbackPromptEventForUser(
  userId: string,
  input: FeedbackPromptEventInput,
): Promise<FeedbackState> {
  return transactionWithUserScope({ userId }, async (executor) => {
    const existingRow = await loadExistingPromptEventInExecutor(executor, userId, input.feedbackPromptEventId);
    if (existingRow !== null) {
      return loadFeedbackStateInExecutor(executor, userId);
    }

    await assertFeedbackReferencesInExecutor(executor, userId, input.workspaceId, input.installationId);

    const insertResult = await executor.query<ExistingFeedbackRow>(
      [
        "INSERT INTO support.feedback_prompt_events (",
        "feedback_prompt_event_id, user_id, workspace_id, installation_id, platform,",
        "app_version, locale, timezone, event_type, created_at_client",
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

    if (insertResult.rows.length === 0) {
      await assertExistingPromptEventIsVisibleInExecutor(executor, userId, input.feedbackPromptEventId);
    }

    return loadFeedbackStateInExecutor(executor, userId);
  });
}

export async function storeFeedbackSubmissionForUser(
  userId: string,
  email: string | null,
  input: FeedbackSubmissionInput,
): Promise<StoredFeedbackSubmission> {
  return transactionWithUserScope({ userId }, async (executor) => {
    const existingRow = await findExistingSubmissionInExecutor(executor, userId, input.feedbackSubmissionId);
    if (existingRow !== null) {
      return {
        feedbackSubmissionId: existingRow.feedback_submission_id,
        createdAtServer: toIsoString(existingRow.created_at_server),
        emailNotificationRequired: false,
      };
    }

    await assertFeedbackReferencesInExecutor(executor, userId, input.workspaceId, input.installationId);

    const insertResult = await executor.query<StoredFeedbackSubmissionRow>(
      [
        "INSERT INTO support.feedback_submissions (",
        "feedback_submission_id, user_id, email, workspace_id, installation_id, platform,",
        "app_version, locale, timezone, trigger, message, created_at_client",
        ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
        "ON CONFLICT (feedback_submission_id) DO NOTHING",
        "RETURNING feedback_submission_id, created_at_server",
      ].join(" "),
      [
        input.feedbackSubmissionId,
        userId,
        email,
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

    const insertedRow = insertResult.rows[0];
    if (insertedRow !== undefined) {
      return {
        feedbackSubmissionId: insertedRow.feedback_submission_id,
        createdAtServer: toIsoString(insertedRow.created_at_server),
        emailNotificationRequired: true,
      };
    }

    const conflictExistingRow = await loadExistingSubmissionInExecutor(executor, userId, input.feedbackSubmissionId);
    return {
      feedbackSubmissionId: conflictExistingRow.feedback_submission_id,
      createdAtServer: toIsoString(conflictExistingRow.created_at_server),
      emailNotificationRequired: false,
    };
  });
}

export async function updateFeedbackSubmissionEmailStatus(
  userId: string,
  feedbackSubmissionId: string,
  status: FeedbackEmailNotificationStatus,
  errorMessage: string | null,
): Promise<void> {
  await transactionWithUserScope({ userId }, async (executor) => {
    const result = await executor.query<Readonly<{ feedback_submission_id: string }>>(
      [
        "UPDATE support.feedback_submissions",
        "SET email_notification_status = $2,",
        "email_notification_error = $3",
        "WHERE feedback_submission_id = $1",
        "AND user_id = $4",
        "RETURNING feedback_submission_id",
      ].join(" "),
      [feedbackSubmissionId, status, errorMessage, userId],
    );

    if (result.rows.length !== 1) {
      throw new Error(`Failed to update feedback submission email status for submission ${feedbackSubmissionId}`);
    }
  });
}
