import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
  type WorkspaceDatabaseScope,
} from "../../database";
import { ChatRunRowNotFoundError, ChatSessionRowNotFoundError } from "../errors";
import {
  type ChatRuntimeModelId,
  type ChatRuntimeReasoningEffort,
} from "../config";
import type { ChatCostPolicyMode } from "../costPolicy";
import type { ChatComposerSuggestionsLocale } from "../composerSuggestions";
import type { ChatSessionRunState } from "../store";
import type { ChatSessionRow } from "../store/repository";
import type { ContentPart } from "../types";
import type { ChatRunClaimToken, ChatRunStatus } from "./types";

export type ChatRunRow = Readonly<{
  run_id: string;
  session_id: string;
  assistant_item_id: string;
  status: ChatRunStatus;
  request_id: string;
  model_id: string;
  reasoning_effort: string;
  ai_cost_mode: ChatCostPolicyMode;
  chat_turns_last_7d: number;
  good_review_days_last_7d: number;
  timezone: string;
  ui_locale: ChatComposerSuggestionsLocale | null;
  turn_input: ReadonlyArray<ContentPart>;
  worker_claimed_at: string | null;
  worker_heartbeat_at: string | null;
  cancel_requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_error_message: string | null;
  initiating_auth_is_signed_in: boolean;
  live_attach_client_id: string | null;
  // BIGINT, which node-postgres hands back as a string.
  live_attach_seq: string;
}>;

export type ChatLiveAttachOwnershipRow = Readonly<{
  live_attach_seq: string;
}>;

export type ChatRunClaimRow = Readonly<{
  run_id: string;
  session_id: string;
  status: ChatRunStatus;
  worker_claimed_at: string | null;
  cancel_requested_at: string | null;
}>;

export type InsertChatRunParams = Readonly<{
  sessionId: string;
  assistantItemId: string;
  requestId: string;
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
  timezone: string;
  uiLocale: ChatComposerSuggestionsLocale | null;
  turnInput: ReadonlyArray<ContentPart>;
  initiatingAuthIsSignedIn: boolean;
}>;

export type UpdateChatRunPolicySnapshotParams = Readonly<{
  runId: string;
  modelId: ChatRuntimeModelId;
  reasoningEffort: ChatRuntimeReasoningEffort;
  aiCostMode: ChatCostPolicyMode;
  chatTurnsLast7d: number;
  goodReviewDaysLast7d: number;
}>;

export type UpdateChatRunStatusParams = Readonly<{
  runId: string;
  status: ChatRunStatus;
  workerHeartbeatAt: Date | null;
  cancelRequestedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastErrorMessage: string | null;
}>;

type CreateChatRunStatusUpdateFromRowParams = Readonly<{
  status: ChatRunStatus;
  workerHeartbeatAt?: Date | null;
  cancelRequestedAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  lastErrorMessage: string | null;
}>;

const CHAT_RUN_COLUMNS_SQL = `
    run_id,
    session_id,
    assistant_item_id,
    status,
    request_id,
    model_id,
    reasoning_effort,
    ai_cost_mode,
    chat_turns_last_7d,
    good_review_days_last_7d,
    timezone,
    ui_locale,
    turn_input,
    worker_claimed_at::text AS worker_claimed_at,
    worker_heartbeat_at,
    cancel_requested_at,
    started_at,
    finished_at,
    last_error_message,
    initiating_auth_is_signed_in,
    live_attach_client_id,
    live_attach_seq
`;

const SELECT_CHAT_RUN_SQL = `
  SELECT
${CHAT_RUN_COLUMNS_SQL}
  FROM ai.chat_runs
  WHERE run_id = $1
`;

const SELECT_CHAT_RUN_FOR_UPDATE_SQL = `
  SELECT
${CHAT_RUN_COLUMNS_SQL}
  FROM ai.chat_runs
  WHERE run_id = $1
  FOR UPDATE
`;

const SELECT_CHAT_RUN_CLAIM_FOR_UPDATE_SQL = `
  SELECT
    run_id,
    session_id,
    status,
    worker_claimed_at::text AS worker_claimed_at,
    cancel_requested_at
  FROM ai.chat_runs
  WHERE run_id = $1
  FOR UPDATE
`;

const INSERT_CHAT_RUN_SQL = `
  INSERT INTO ai.chat_runs (
    session_id,
    assistant_item_id,
    status,
    request_id,
    model_id,
    reasoning_effort,
    timezone,
    ui_locale,
    turn_input,
    initiating_auth_is_signed_in,
    updated_at
  )
  VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7, $8::jsonb, $9, now())
  RETURNING
${CHAT_RUN_COLUMNS_SQL}
`;

const UPDATE_CHAT_RUN_STATUS_SQL = `
  UPDATE ai.chat_runs
  SET status = $2,
      worker_heartbeat_at = $3,
      cancel_requested_at = $4,
      started_at = $5,
      finished_at = $6,
      last_error_message = $7,
      updated_at = now()
  WHERE run_id = $1
  RETURNING
${CHAT_RUN_COLUMNS_SQL}
`;

const CLAIM_CHAT_RUN_SQL = `
  UPDATE ai.chat_runs
  SET status = 'running',
      worker_claimed_at = statement_timestamp(),
      worker_heartbeat_at = statement_timestamp(),
      started_at = COALESCE(started_at, statement_timestamp()),
      finished_at = NULL,
      last_error_message = NULL,
      updated_at = now()
  WHERE run_id = $1
    AND status IN ('queued', 'running')
  RETURNING
${CHAT_RUN_COLUMNS_SQL}
`;

const UPDATE_CLAIMED_CHAT_RUN_STATUS_SQL = `
  UPDATE ai.chat_runs
  SET status = $3,
      worker_heartbeat_at = $4,
      cancel_requested_at = $5,
      started_at = $6,
      finished_at = $7,
      last_error_message = $8,
      updated_at = now()
  WHERE run_id = $1
    AND status = 'running'
    AND worker_claimed_at = $2::timestamptz
  RETURNING
${CHAT_RUN_COLUMNS_SQL}
`;

const UPDATE_CHAT_RUN_POLICY_SNAPSHOT_SQL = `
  UPDATE ai.chat_runs
  SET model_id = $2,
      reasoning_effort = $3,
      ai_cost_mode = $4,
      chat_turns_last_7d = $5,
      good_review_days_last_7d = $6,
      updated_at = now()
  WHERE run_id = $1
  RETURNING
${CHAT_RUN_COLUMNS_SQL}
`;

// Deliberately leaves updated_at alone: attaching to a run observes it, it does not progress it.
const CLAIM_CHAT_LIVE_ATTACH_OWNERSHIP_SQL = `
  UPDATE ai.chat_runs
  SET live_attach_client_id = $2,
      live_attach_seq = live_attach_seq + 1
  WHERE run_id = $1
  RETURNING live_attach_seq
`;

const SELECT_SESSION_FOR_UPDATE_SQL = `
  SELECT
    chat_sessions.session_id,
    chat_sessions.status,
    chat_sessions.active_run_id,
    chat_sessions.active_run_heartbeat_at,
    chat_sessions.composer_suggestions,
    chat_sessions.active_composer_suggestion_generation_id,
    active_generation.suggestions AS active_generation_suggestions,
    chat_sessions.main_content_invalidation_version,
    chat_sessions.updated_at
  FROM ai.chat_sessions AS chat_sessions
  LEFT JOIN ai.chat_composer_suggestion_generations AS active_generation
    ON active_generation.generation_id = chat_sessions.active_composer_suggestion_generation_id
  WHERE chat_sessions.session_id = $1
  FOR UPDATE OF chat_sessions
`;

const SELECT_CHAT_RUN_BY_SESSION_REQUEST_SQL = `
  SELECT
${CHAT_RUN_COLUMNS_SQL}
  FROM ai.chat_runs
  WHERE session_id = $1
    AND request_id = $2
  ORDER BY created_at DESC, run_id DESC
  LIMIT 1
`;

async function executeQuery<Row extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<SqlValue>,
): Promise<ReadonlyArray<Row>> {
  const result = await executor.query<Row>(text, params);
  return result.rows;
}

async function withScopedExecutor<Result>(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  callback: () => Promise<Result>,
): Promise<Result> {
  await applyWorkspaceDatabaseScopeInExecutor(executor, scope);
  return callback();
}

function toDateOrNull(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  return new Date(value);
}

export function requireSessionRow(row: ChatSessionRow | undefined, operation: string): ChatSessionRow {
  if (row === undefined) {
    throw new ChatSessionRowNotFoundError(operation);
  }

  return row;
}

export function requireRunRow(row: ChatRunRow | undefined, operation: string): ChatRunRow {
  if (row === undefined) {
    throw new ChatRunRowNotFoundError(operation);
  }

  return row;
}

export function mapChatRunStatusToSessionRunState(status: ChatRunStatus): ChatSessionRunState {
  if (status === "queued" || status === "running") {
    return "running";
  }

  if (status === "interrupted") {
    return "interrupted";
  }

  return "idle";
}

export function createChatRunStatusUpdateFromRow(
  run: ChatRunRow,
  params: CreateChatRunStatusUpdateFromRowParams,
): UpdateChatRunStatusParams {
  return {
    runId: run.run_id,
    status: params.status,
    workerHeartbeatAt: params.workerHeartbeatAt === undefined
      ? toDateOrNull(run.worker_heartbeat_at)
      : params.workerHeartbeatAt,
    cancelRequestedAt: params.cancelRequestedAt === undefined
      ? toDateOrNull(run.cancel_requested_at)
      : params.cancelRequestedAt,
    startedAt: params.startedAt === undefined
      ? toDateOrNull(run.started_at)
      : params.startedAt,
    finishedAt: params.finishedAt === undefined
      ? toDateOrNull(run.finished_at)
      : params.finishedAt,
    lastErrorMessage: params.lastErrorMessage,
  };
}

export async function selectChatRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
): Promise<ChatRunRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, SELECT_CHAT_RUN_SQL, [runId]);
    return rows[0] ?? null;
  });
}

export async function selectChatRunForUpdateWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
): Promise<ChatRunRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, SELECT_CHAT_RUN_FOR_UPDATE_SQL, [runId]);
    return rows[0] ?? null;
  });
}

export async function selectChatRunClaimForUpdateWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
): Promise<ChatRunClaimRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunClaimRow>(
      executor,
      SELECT_CHAT_RUN_CLAIM_FOR_UPDATE_SQL,
      [runId],
    );
    return rows[0] ?? null;
  });
}

export async function claimChatLiveAttachOwnershipWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
  liveAttachClientId: string,
): Promise<string> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatLiveAttachOwnershipRow>(
      executor,
      CLAIM_CHAT_LIVE_ATTACH_OWNERSHIP_SQL,
      [runId, liveAttachClientId],
    );
    const row = rows[0];
    if (row === undefined) {
      throw new ChatRunRowNotFoundError("live attach ownership claim");
    }

    return row.live_attach_seq;
  });
}

export async function selectChatRunBySessionRequestWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  requestId: string,
): Promise<ChatRunRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, SELECT_CHAT_RUN_BY_SESSION_REQUEST_SQL, [
      sessionId,
      requestId,
    ]);
    return rows[0] ?? null;
  });
}

export async function selectSessionForUpdateWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_FOR_UPDATE_SQL, [sessionId]);
    return requireSessionRow(rows[0], "lock");
  });
}

export async function insertChatRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: InsertChatRunParams,
): Promise<ChatRunRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, INSERT_CHAT_RUN_SQL, [
      params.sessionId,
      params.assistantItemId,
      params.requestId,
      params.modelId,
      params.reasoningEffort,
      params.timezone,
      params.uiLocale,
      JSON.stringify(params.turnInput),
      params.initiatingAuthIsSignedIn,
    ]);
    return requireRunRow(rows[0], "insert");
  });
}

export async function updateChatRunPolicySnapshotWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: UpdateChatRunPolicySnapshotParams,
): Promise<ChatRunRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, UPDATE_CHAT_RUN_POLICY_SNAPSHOT_SQL, [
      params.runId,
      params.modelId,
      params.reasoningEffort,
      params.aiCostMode,
      params.chatTurnsLast7d,
      params.goodReviewDaysLast7d,
    ]);
    return requireRunRow(rows[0], "policy snapshot update");
  });
}

export async function updateChatRunStatusWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: UpdateChatRunStatusParams,
): Promise<ChatRunRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, UPDATE_CHAT_RUN_STATUS_SQL, [
      params.runId,
      params.status,
      params.workerHeartbeatAt?.toISOString() ?? null,
      params.cancelRequestedAt?.toISOString() ?? null,
      params.startedAt?.toISOString() ?? null,
      params.finishedAt?.toISOString() ?? null,
      params.lastErrorMessage,
    ]);
    return requireRunRow(rows[0], "update");
  });
}

export async function claimChatRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
): Promise<ChatRunRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, CLAIM_CHAT_RUN_SQL, [runId]);
    return rows[0] ?? null;
  });
}

export async function updateClaimedChatRunStatusWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  claimToken: ChatRunClaimToken,
  params: UpdateChatRunStatusParams,
): Promise<ChatRunRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, UPDATE_CLAIMED_CHAT_RUN_STATUS_SQL, [
      params.runId,
      claimToken,
      params.status,
      params.workerHeartbeatAt?.toISOString() ?? null,
      params.cancelRequestedAt?.toISOString() ?? null,
      params.startedAt?.toISOString() ?? null,
      params.finishedAt?.toISOString() ?? null,
      params.lastErrorMessage,
    ]);
    return rows[0] ?? null;
  });
}
