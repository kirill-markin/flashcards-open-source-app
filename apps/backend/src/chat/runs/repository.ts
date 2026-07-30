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
import type { ChatItemState, ChatSessionRunState } from "../store";
import type { ChatSessionRow } from "../store/repository";
import type {
  BindGeneratedCardImageAttemptPayloadParams,
  GeneratedCardImageAttempt,
  GeneratedCardImageAttemptReservation,
  GeneratedCardImageAttemptReservationParams,
  GeneratedCardImageImmutablePayload,
  MarkGeneratedCardImageProviderStartedParams,
  MarkGeneratedCardImageProviderStartedResult,
} from "../openai/tools/generatedImageAttemptBudget";
import type { ContentPart } from "../types";
import { isGeneratedImageOperationKey } from "../generatedImageOperationIdentity";
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

type GeneratedCardImageAttemptStateRow = Readonly<{
  item_id: string;
  state: ChatItemState;
  role: string | null;
  attempt_count_type: string | null;
  attempt_count_text: string | null;
  operations_value: unknown;
}>;

type ReservedGeneratedCardImageAttemptRow = Readonly<{
  attempt_count_text: string;
  operations_value: unknown;
}>;

type GeneratedCardImageOperationState = Readonly<{
  operationKey: string;
  attempt: GeneratedCardImageAttempt;
  payload: GeneratedCardImageImmutablePayload | null;
  providerStarted: boolean;
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
    initiating_auth_is_signed_in
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

const SELECT_GENERATED_CARD_IMAGE_ATTEMPT_STATE_FOR_UPDATE_SQL = `
  SELECT
    chat_items.item_id,
    chat_items.state,
    chat_items.payload->>'role' AS role,
    jsonb_typeof(chat_items.payload->'generatedCardImageAttemptCount') AS attempt_count_type,
    chat_items.payload->>'generatedCardImageAttemptCount' AS attempt_count_text,
    chat_items.payload->'generatedCardImageOperations' AS operations_value
  FROM ai.chat_runs AS chat_runs
  INNER JOIN ai.chat_items AS chat_items
    ON chat_items.item_id = chat_runs.assistant_item_id
  WHERE chat_runs.run_id = $1
    AND chat_items.item_kind = 'message'
  FOR UPDATE OF chat_items
`;

const RESERVE_GENERATED_CARD_IMAGE_ATTEMPT_SQL = `
  UPDATE ai.chat_items
  SET payload = jsonb_set(
    jsonb_set(
      payload,
      '{generatedCardImageAttemptCount}',
      to_jsonb($2::integer),
      true
    ),
    '{generatedCardImageOperations}',
    $3::jsonb,
    true
  )
  WHERE item_id = $1
  RETURNING
    payload->>'generatedCardImageAttemptCount' AS attempt_count_text,
    payload->'generatedCardImageOperations' AS operations_value
`;

const UPDATE_GENERATED_CARD_IMAGE_OPERATIONS_SQL = `
  UPDATE ai.chat_items
  SET payload = jsonb_set(
    payload,
    '{generatedCardImageOperations}',
    $2::jsonb,
    true
  )
  WHERE item_id = $1
  RETURNING
    payload->>'generatedCardImageAttemptCount' AS attempt_count_text,
    payload->'generatedCardImageOperations' AS operations_value
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

function parseGeneratedCardImageAttemptCount(
  row: GeneratedCardImageAttemptStateRow,
  maximumAttempts: 3,
): number {
  if (row.attempt_count_type === null && row.attempt_count_text === null) {
    return 0;
  }
  if (row.attempt_count_type !== "number" || row.attempt_count_text === null) {
    throw new Error(
      `Generated card image attempt count must be a JSON number. itemId=${row.item_id}`,
    );
  }

  const attemptCount = Number(row.attempt_count_text);
  if (
    !Number.isSafeInteger(attemptCount)
    || attemptCount < 0
    || attemptCount > maximumAttempts
  ) {
    throw new Error(
      `Generated card image attempt count must be an integer between 0 and ${maximumAttempts}. itemId=${row.item_id}`,
    );
  }
  return attemptCount;
}

function isGeneratedCardImageAttempt(value: unknown): value is GeneratedCardImageAttempt {
  return value === 1 || value === 2 || value === 3;
}

function parseGeneratedCardImageImmutablePayload(
  value: unknown,
  itemId: string,
  operationKey: string,
): GeneratedCardImageImmutablePayload | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Generated card image operation payload must be an object or null. itemId=${itemId}; operationKey=${operationKey}`,
    );
  }

  const record = value as Readonly<Record<string, unknown>>;
  if (
    typeof record.cardId !== "string"
    || (record.targetSide !== "front" && record.targetSide !== "back")
    || typeof record.imagePrompt !== "string"
    || typeof record.altText !== "string"
  ) {
    throw new Error(
      `Generated card image operation payload is invalid. itemId=${itemId}; operationKey=${operationKey}`,
    );
  }

  return {
    cardId: record.cardId,
    targetSide: record.targetSide,
    imagePrompt: record.imagePrompt,
    altText: record.altText,
  };
}

function parseGeneratedCardImageOperations(
  value: unknown,
  itemId: string,
  maximumAttempts: 3,
): ReadonlyArray<GeneratedCardImageOperationState> {
  if (value === null) {
    return [];
  }
  if (Array.isArray(value) === false || value.length > maximumAttempts) {
    throw new Error(
      `Generated card image operations must be an array with at most ${maximumAttempts} entries. itemId=${itemId}`,
    );
  }

  const operationKeys = new Set<string>();
  const attempts = new Set<number>();
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(
        `Generated card image operation entry must be an object. itemId=${itemId}; index=${index}`,
      );
    }

    const record = entry as Readonly<Record<string, unknown>>;
    if (
      typeof record.operationKey !== "string"
      || isGeneratedImageOperationKey(record.operationKey) === false
      || isGeneratedCardImageAttempt(record.attempt) === false
    ) {
      throw new Error(
        `Generated card image operation entry has an invalid identity. itemId=${itemId}; index=${index}`,
      );
    }
    if (operationKeys.has(record.operationKey) || attempts.has(record.attempt)) {
      throw new Error(
        `Generated card image operation entries must have unique keys and attempts. itemId=${itemId}`,
      );
    }

    operationKeys.add(record.operationKey);
    attempts.add(record.attempt);
    if (
      record.providerStarted !== undefined
      && record.providerStarted !== true
    ) {
      throw new Error(
        `Generated card image operation provider-started state must be true when present. itemId=${itemId}; operationKey=${record.operationKey}`,
      );
    }
    return {
      operationKey: record.operationKey,
      attempt: record.attempt,
      payload: parseGeneratedCardImageImmutablePayload(
        record.payload,
        itemId,
        record.operationKey,
      ),
      providerStarted: record.providerStarted === true,
    };
  });
}

function serializeGeneratedCardImageOperations(
  operations: ReadonlyArray<GeneratedCardImageOperationState>,
): string {
  return JSON.stringify(operations.map((operation) => ({
    operationKey: operation.operationKey,
    attempt: operation.attempt,
    payload: operation.payload,
    ...(operation.providerStarted ? { providerStarted: true } : {}),
  })));
}

function requireReservedGeneratedCardImageAttempt(
  value: string,
  expectedAttempt: number,
  maximumAttempts: 3,
): 1 | 2 | 3 {
  const attempt = Number(value);
  if (
    !Number.isSafeInteger(attempt)
    || attempt < 1
    || attempt > maximumAttempts
    || attempt !== expectedAttempt
  ) {
    throw new Error(
      `Generated card image attempt reservation returned an invalid attempt. attempt=${value}; expectedAttempt=${expectedAttempt}`,
    );
  }
  return attempt as 1 | 2 | 3;
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

export async function reserveGeneratedCardImageAttemptForActiveRunWithExecutor(
  executor: DatabaseExecutor,
  params: GeneratedCardImageAttemptReservationParams,
  maximumAttempts: 3,
): Promise<GeneratedCardImageAttemptReservation> {
  return withScopedExecutor(executor, params, async () => {
    const stateRows = await executeQuery<GeneratedCardImageAttemptStateRow>(
      executor,
      SELECT_GENERATED_CARD_IMAGE_ATTEMPT_STATE_FOR_UPDATE_SQL,
      [params.runId],
    );
    const state = stateRows[0];
    if (
      state === undefined
      || state.state !== "in_progress"
      || state.role !== "assistant"
    ) {
      return { status: "run_inactive" };
    }

    const attemptCount = parseGeneratedCardImageAttemptCount(state, maximumAttempts);
    const operations = parseGeneratedCardImageOperations(
      state.operations_value,
      state.item_id,
      maximumAttempts,
    );
    const existingOperation = operations.find(
      (operation) => operation.operationKey === params.operationKey,
    );
    if (existingOperation !== undefined) {
      return {
        status: "reserved",
        attempt: existingOperation.attempt,
        payload: existingOperation.payload,
      };
    }
    if (attemptCount === maximumAttempts) {
      return { status: "limit_reached" };
    }

    const reservedAttempt = attemptCount + 1;
    const reservedOperations: ReadonlyArray<GeneratedCardImageOperationState> = [
      ...operations,
      {
        operationKey: params.operationKey,
        attempt: reservedAttempt as GeneratedCardImageAttempt,
        payload: null,
        providerStarted: false,
      },
    ];
    const reservedRows = await executeQuery<ReservedGeneratedCardImageAttemptRow>(
      executor,
      RESERVE_GENERATED_CARD_IMAGE_ATTEMPT_SQL,
      [state.item_id, reservedAttempt, serializeGeneratedCardImageOperations(reservedOperations)],
    );
    const reservedRow = reservedRows[0];
    if (reservedRow === undefined) {
      throw new Error(
        `Generated card image attempt target disappeared while locked. itemId=${state.item_id}`,
      );
    }

    return {
      status: "reserved",
      attempt: requireReservedGeneratedCardImageAttempt(
        reservedRow.attempt_count_text,
        reservedAttempt,
        maximumAttempts,
      ),
      payload: null,
    };
  });
}

export async function bindGeneratedCardImageAttemptPayloadForActiveRunWithExecutor(
  executor: DatabaseExecutor,
  params: BindGeneratedCardImageAttemptPayloadParams,
): Promise<GeneratedCardImageImmutablePayload> {
  return withScopedExecutor(executor, params, async () => {
    const stateRows = await executeQuery<GeneratedCardImageAttemptStateRow>(
      executor,
      SELECT_GENERATED_CARD_IMAGE_ATTEMPT_STATE_FOR_UPDATE_SQL,
      [params.runId],
    );
    const state = stateRows[0];
    if (
      state === undefined
      || state.state !== "in_progress"
      || state.role !== "assistant"
    ) {
      throw new Error(
        `Generated card image operation target is no longer active. runId=${params.runId}`,
      );
    }

    const operations = parseGeneratedCardImageOperations(
      state.operations_value,
      state.item_id,
      3,
    );
    const operation = operations.find(
      (entry) => entry.operationKey === params.operationKey
        && entry.attempt === params.attempt,
    );
    if (operation === undefined) {
      throw new Error(
        `Generated card image operation reservation was not found. runId=${params.runId}; operationKey=${params.operationKey}; attempt=${params.attempt}`,
      );
    }
    if (operation.payload !== null) {
      return operation.payload;
    }

    const boundOperations = operations.map((entry) =>
      entry.operationKey === params.operationKey
        ? { ...entry, payload: params.payload }
        : entry);
    const updatedRows = await executeQuery<ReservedGeneratedCardImageAttemptRow>(
      executor,
      UPDATE_GENERATED_CARD_IMAGE_OPERATIONS_SQL,
      [state.item_id, serializeGeneratedCardImageOperations(boundOperations)],
    );
    if (updatedRows[0] === undefined) {
      throw new Error(
        `Generated card image operation target disappeared while locked. itemId=${state.item_id}`,
      );
    }
    return params.payload;
  });
}

export async function markGeneratedCardImageProviderStartedForActiveRunWithExecutor(
  executor: DatabaseExecutor,
  params: MarkGeneratedCardImageProviderStartedParams,
): Promise<MarkGeneratedCardImageProviderStartedResult> {
  return withScopedExecutor(executor, params, async () => {
    const stateRows = await executeQuery<GeneratedCardImageAttemptStateRow>(
      executor,
      SELECT_GENERATED_CARD_IMAGE_ATTEMPT_STATE_FOR_UPDATE_SQL,
      [params.runId],
    );
    const state = stateRows[0];
    if (
      state === undefined
      || state.state !== "in_progress"
      || state.role !== "assistant"
    ) {
      throw new Error(
        `Generated card image operation target is no longer active. runId=${params.runId}`,
      );
    }

    const operations = parseGeneratedCardImageOperations(
      state.operations_value,
      state.item_id,
      3,
    );
    const operation = operations.find(
      (entry) => entry.operationKey === params.operationKey,
    );
    if (operation === undefined || operation.payload === null) {
      throw new Error(
        `Generated card image provider start requires a bound operation payload. runId=${params.runId}; operationKey=${params.operationKey}`,
      );
    }
    if (operation.providerStarted) {
      return { status: "previously_started" };
    }

    const startedOperations = operations.map((entry) =>
      entry.operationKey === params.operationKey
        ? { ...entry, providerStarted: true }
        : entry);
    const updatedRows = await executeQuery<ReservedGeneratedCardImageAttemptRow>(
      executor,
      UPDATE_GENERATED_CARD_IMAGE_OPERATIONS_SQL,
      [state.item_id, serializeGeneratedCardImageOperations(startedOperations)],
    );
    const updatedRow = updatedRows[0];
    if (updatedRow === undefined) {
      throw new Error(
        `Generated card image operation target disappeared while locked. itemId=${state.item_id}`,
      );
    }
    const updatedOperation = parseGeneratedCardImageOperations(
      updatedRow.operations_value,
      state.item_id,
      3,
    ).find((entry) => entry.operationKey === params.operationKey);
    if (updatedOperation?.providerStarted !== true) {
      throw new Error(
        `Generated card image provider start was not persisted. runId=${params.runId}; operationKey=${params.operationKey}`,
      );
    }
    return { status: "first_started" };
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
