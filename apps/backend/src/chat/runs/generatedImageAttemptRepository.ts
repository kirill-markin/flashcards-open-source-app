import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  type DatabaseExecutor,
  type SqlValue,
  type WorkspaceDatabaseScope,
} from "../../database";
import { isGeneratedImageOperationKey } from "../generatedImageOperationIdentity";
import type {
  BindGeneratedCardImageAttemptPayloadParams,
  GeneratedCardImageAttempt,
  GeneratedCardImageAttemptReservation,
  GeneratedCardImageAttemptReservationParams,
  GeneratedCardImageImmutablePayload,
  MarkGeneratedCardImageProviderStartedParams,
  MarkGeneratedCardImageProviderStartedResult,
} from "../openai/tools/generatedImageAttemptBudget";
import type { ChatItemState } from "../store";

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
