import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../db";
import {
  CHAT_MODEL_ID,
  CHAT_MODEL_REASONING_EFFORT,
} from "../config";
import type { ChatSessionRow, ChatSessionRunState } from "../store";
import type { ContentPart } from "../types";
import type { ChatRunStatus } from "./types";

export type ChatRunRow = Readonly<{
  run_id: string;
  session_id: string;
  assistant_item_id: string;
  status: ChatRunStatus;
  request_id: string;
  model_id: string;
  reasoning_effort: string;
  timezone: string;
  turn_input: ReadonlyArray<ContentPart>;
  worker_claimed_at: string | null;
  worker_heartbeat_at: string | null;
  cancel_requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  last_error_message: string | null;
}>;

export type InsertChatRunParams = Readonly<{
  sessionId: string;
  assistantItemId: string;
  requestId: string;
  timezone: string;
  turnInput: ReadonlyArray<ContentPart>;
}>;

export type UpdateChatRunStatusParams = Readonly<{
  runId: string;
  status: ChatRunStatus;
  workerClaimedAt: Date | null;
  workerHeartbeatAt: Date | null;
  cancelRequestedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastErrorMessage: string | null;
}>;

type CreateChatRunStatusUpdateFromRowParams = Readonly<{
  status: ChatRunStatus;
  workerClaimedAt?: Date | null;
  workerHeartbeatAt?: Date | null;
  cancelRequestedAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  lastErrorMessage: string | null;
}>;

const SELECT_CHAT_RUN_SQL = `
  SELECT
    run_id,
    session_id,
    assistant_item_id,
    status,
    request_id,
    model_id,
    reasoning_effort,
    timezone,
    turn_input,
    worker_claimed_at,
    worker_heartbeat_at,
    cancel_requested_at,
    started_at,
    finished_at,
    last_error_message
  FROM ai.chat_runs
  WHERE run_id = $1
`;

const SELECT_CHAT_RUN_FOR_UPDATE_SQL = `
  SELECT
    run_id,
    session_id,
    assistant_item_id,
    status,
    request_id,
    model_id,
    reasoning_effort,
    timezone,
    turn_input,
    worker_claimed_at,
    worker_heartbeat_at,
    cancel_requested_at,
    started_at,
    finished_at,
    last_error_message
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
    turn_input,
    updated_at
  )
  VALUES ($1, $2, 'queued', $3, $4, $5, $6, $7::jsonb, now())
  RETURNING
    run_id,
    session_id,
    assistant_item_id,
    status,
    request_id,
    model_id,
    reasoning_effort,
    timezone,
    turn_input,
    worker_claimed_at,
    worker_heartbeat_at,
    cancel_requested_at,
    started_at,
    finished_at,
    last_error_message
`;

const UPDATE_CHAT_RUN_STATUS_SQL = `
  UPDATE ai.chat_runs
  SET status = $2,
      worker_claimed_at = $3,
      worker_heartbeat_at = $4,
      cancel_requested_at = $5,
      started_at = $6,
      finished_at = $7,
      last_error_message = $8,
      updated_at = now()
  WHERE run_id = $1
  RETURNING
    run_id,
    session_id,
    assistant_item_id,
    status,
    request_id,
    model_id,
    reasoning_effort,
    timezone,
    turn_input,
    worker_claimed_at,
    worker_heartbeat_at,
    cancel_requested_at,
    started_at,
    finished_at,
    last_error_message
`;

const SELECT_SESSION_FOR_UPDATE_SQL = `
  SELECT
    session_id,
    status,
    active_run_id,
    active_run_heartbeat_at,
    main_content_invalidation_version,
    updated_at
  FROM ai.chat_sessions
  WHERE session_id = $1
  FOR UPDATE
`;

const SELECT_CHAT_RUN_BY_SESSION_REQUEST_SQL = `
  SELECT
    run_id,
    session_id,
    assistant_item_id,
    status,
    request_id,
    model_id,
    reasoning_effort,
    timezone,
    turn_input,
    worker_claimed_at,
    worker_heartbeat_at,
    cancel_requested_at,
    started_at,
    finished_at,
    last_error_message
  FROM ai.chat_runs
  WHERE session_id = $1
    AND request_id = $2
  ORDER BY created_at DESC, run_id DESC
  LIMIT 1
`;

async function executeQuery<Row extends QueryResultRow>(
  executor: DatabaseExecutor,
  text: string,
  params: ReadonlyArray<string | null>,
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
    throw new Error(`Chat session ${operation} failed: query returned no row`);
  }

  return row;
}

export function requireRunRow(row: ChatRunRow | undefined, operation: string): ChatRunRow {
  if (row === undefined) {
    throw new Error(`Chat run ${operation} failed: query returned no row`);
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
    workerClaimedAt: params.workerClaimedAt === undefined
      ? toDateOrNull(run.worker_claimed_at)
      : params.workerClaimedAt,
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
      CHAT_MODEL_ID,
      CHAT_MODEL_REASONING_EFFORT,
      params.timezone,
      JSON.stringify(params.turnInput),
    ]);
    return requireRunRow(rows[0], "insert");
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
      params.workerClaimedAt?.toISOString() ?? null,
      params.workerHeartbeatAt?.toISOString() ?? null,
      params.cancelRequestedAt?.toISOString() ?? null,
      params.startedAt?.toISOString() ?? null,
      params.finishedAt?.toISOString() ?? null,
      params.lastErrorMessage,
    ]);
    return requireRunRow(rows[0], "update");
  });
}
