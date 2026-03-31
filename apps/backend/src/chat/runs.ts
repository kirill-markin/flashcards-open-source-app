/**
 * Run lifecycle orchestration for backend-owned chat sessions.
 * This module prepares queued runs, recovers stale work, coordinates worker ownership, and finalizes persisted run state.
 */
import type { QueryResultRow } from "pg";
import {
  applyWorkspaceDatabaseScopeInExecutor,
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../db";
import { finalizePendingToolCallContent } from "./history";
import {
  CHAT_MODEL_ID,
  CHAT_MODEL_REASONING_EFFORT,
} from "./config";
import type { StartPersistedChatRunParams } from "./runtime";
import type { ContentPart } from "./types";
import {
  buildLocalChatMessages,
  buildUserStoppedAssistantContent,
  ChatSessionConflictError,
  getChatSessionSnapshotWithExecutor,
  insertChatItemWithExecutor,
  INTERRUPTED_TOOL_CALL_OUTPUT,
  FAILED_TOOL_CALL_OUTPUT,
  listChatMessagesWithExecutor,
  listChatMessagesLatestWithExecutor,
  listChatMessagesBeforeWithExecutor,
  resolveLatestOrCreateChatSessionWithExecutor,
  resolveRequestedChatSessionWithExecutor,
  STOPPED_BY_USER_TOOL_OUTPUT,
  type ChatSessionRow,
  type ChatSessionRunState,
  type PaginatedChatMessages,
  type PersistedChatMessageItem,
  updateChatItemWithExecutor,
  updateChatSessionRunStateWithExecutor,
  type ChatSessionSnapshot,
} from "./store";
import {
  CHAT_RUN_STALE_HEARTBEAT_MS,
  isChatRunHeartbeatStale,
} from "./workerLease";

export type ChatRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "interrupted";

type ChatRunRow = Readonly<{
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

type InsertChatRunParams = Readonly<{
  sessionId: string;
  assistantItemId: string;
  requestId: string;
  timezone: string;
  turnInput: ReadonlyArray<ContentPart>;
}>;

export type PreparedChatRun = Readonly<{
  sessionId: string;
  runId: string;
  clientRequestId: string;
  runState: ChatSessionRunState;
  deduplicated: boolean;
  shouldInvokeWorker: boolean;
}>;

export type ClaimedChatRun = Readonly<{
  runId: string;
  sessionId: string;
  requestId: string;
  userId: string;
  workspaceId: string;
  timezone: string;
  assistantItemId: string;
  localMessages: StartPersistedChatRunParams["localMessages"];
  turnInput: ReadonlyArray<ContentPart>;
  diagnostics: StartPersistedChatRunParams["diagnostics"];
}>;

export type ChatRunHeartbeatState = Readonly<{
  cancellationRequested: boolean;
  ownershipLost: boolean;
}>;

export type ChatRunStopState = Readonly<{
  sessionId: string;
  stopped: boolean;
  stillRunning: boolean;
  runId: string | null;
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

function requireSessionRow(row: ChatSessionRow | undefined, operation: string): ChatSessionRow {
  if (row === undefined) {
    throw new Error(`Chat session ${operation} failed: query returned no row`);
  }

  return row;
}

function requireRunRow(row: ChatRunRow | undefined, operation: string): ChatRunRow {
  if (row === undefined) {
    throw new Error(`Chat run ${operation} failed: query returned no row`);
  }

  return row;
}

function mapChatRunStatusToSessionRunState(status: ChatRunStatus): ChatSessionRunState {
  if (status === "queued" || status === "running") {
    return "running";
  }

  if (status === "interrupted") {
    return "interrupted";
  }

  return "idle";
}

async function selectChatRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
): Promise<ChatRunRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, SELECT_CHAT_RUN_SQL, [runId]);
    return rows[0] ?? null;
  });
}

async function selectChatRunForUpdateWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  runId: string,
): Promise<ChatRunRow | null> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatRunRow>(executor, SELECT_CHAT_RUN_FOR_UPDATE_SQL, [runId]);
    return rows[0] ?? null;
  });
}

async function selectChatRunBySessionRequestWithExecutor(
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

async function selectSessionForUpdateWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
): Promise<ChatSessionRow> {
  return withScopedExecutor(executor, scope, async () => {
    const rows = await executeQuery<ChatSessionRow>(executor, SELECT_SESSION_FOR_UPDATE_SQL, [sessionId]);
    return requireSessionRow(rows[0], "lock");
  });
}

async function insertChatRunWithExecutor(
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

async function updateChatRunStatusWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  params: Readonly<{
    runId: string;
    status: ChatRunStatus;
    workerClaimedAt: Date | null;
    workerHeartbeatAt: Date | null;
    cancelRequestedAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    lastErrorMessage: string | null;
  }>,
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

function findAssistantItem(
  messages: ReadonlyArray<PersistedChatMessageItem>,
  assistantItemId: string,
): PersistedChatMessageItem | null {
  return messages.find((message) => message.itemId === assistantItemId) ?? null;
}

async function finalizeCancelledRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  run: ChatRunRow,
): Promise<void> {
  const messages = await listChatMessagesWithExecutor(executor, scope, run.session_id);
  const assistantItem = findAssistantItem(messages, run.assistant_item_id);

  if (assistantItem !== null) {
    await updateChatItemWithExecutor(executor, scope, {
      itemId: assistantItem.itemId,
      content: buildUserStoppedAssistantContent(assistantItem.content),
      state: "cancelled",
      assistantOpenAIItems: assistantItem.openaiItems,
    });
  }

  await updateChatRunStatusWithExecutor(executor, scope, {
    runId: run.run_id,
    status: "cancelled",
    workerClaimedAt: run.worker_claimed_at === null ? null : new Date(run.worker_claimed_at),
    workerHeartbeatAt: run.worker_heartbeat_at === null ? null : new Date(run.worker_heartbeat_at),
    cancelRequestedAt: run.cancel_requested_at === null ? new Date() : new Date(run.cancel_requested_at),
    startedAt: run.started_at === null ? null : new Date(run.started_at),
    finishedAt: new Date(),
    lastErrorMessage: null,
  });

  await updateChatSessionRunStateWithExecutor(
    executor,
    scope,
    run.session_id,
    "idle",
    null,
    null,
  );
}

async function finalizeInterruptedRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  run: ChatRunRow,
  errorMessage: string,
): Promise<void> {
  const messages = await listChatMessagesWithExecutor(executor, scope, run.session_id);
  const assistantItem = findAssistantItem(messages, run.assistant_item_id);
  const assistantContent = assistantItem === null ? [] : finalizePendingToolCallContent(
    assistantItem.content,
    "incomplete",
    INTERRUPTED_TOOL_CALL_OUTPUT,
  );

  if (assistantItem !== null) {
    if (assistantContent.length === 0) {
      await updateChatItemWithExecutor(executor, scope, {
        itemId: assistantItem.itemId,
        content: [{ type: "text", text: errorMessage }],
        state: "error",
        assistantOpenAIItems: assistantItem.openaiItems,
      });
    } else {
      await updateChatItemWithExecutor(executor, scope, {
        itemId: assistantItem.itemId,
        content: assistantContent,
        state: "completed",
        assistantOpenAIItems: assistantItem.openaiItems,
      });
      await insertChatItemWithExecutor(executor, scope, {
        sessionId: run.session_id,
        role: "assistant",
        state: "error",
        content: [{ type: "text", text: errorMessage }],
      });
    }
  }

  await updateChatRunStatusWithExecutor(executor, scope, {
    runId: run.run_id,
    status: "interrupted",
    workerClaimedAt: run.worker_claimed_at === null ? null : new Date(run.worker_claimed_at),
    workerHeartbeatAt: run.worker_heartbeat_at === null ? null : new Date(run.worker_heartbeat_at),
    cancelRequestedAt: run.cancel_requested_at === null ? null : new Date(run.cancel_requested_at),
    startedAt: run.started_at === null ? null : new Date(run.started_at),
    finishedAt: new Date(),
    lastErrorMessage: errorMessage,
  });

  await updateChatSessionRunStateWithExecutor(
    executor,
    scope,
    run.session_id,
    "interrupted",
    null,
    null,
  );
}

async function recoverStaleRunWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  session: ChatSessionRow,
): Promise<boolean> {
  if (session.status !== "running" || session.active_run_id === null) {
    return false;
  }

  const heartbeatAt = session.active_run_heartbeat_at === null
    ? null
    : new Date(session.active_run_heartbeat_at).getTime();
  if (!isChatRunHeartbeatStale(heartbeatAt, Date.now())) {
    return false;
  }

  const run = await selectChatRunForUpdateWithExecutor(executor, scope, session.active_run_id);
  if (run === null || (run.status !== "queued" && run.status !== "running")) {
    await updateChatSessionRunStateWithExecutor(executor, scope, session.session_id, "interrupted", null, null);
    return true;
  }

  await finalizeInterruptedRunWithExecutor(
    executor,
    scope,
    run,
    "Chat run interrupted before completion.",
  );
  return true;
}

/**
 * Builds the diagnostic payload that travels with a claimed run into the worker runtime.
 */
function createDiagnostics(
  scope: WorkspaceDatabaseScope,
  run: ChatRunRow,
  turnInput: ReadonlyArray<ContentPart>,
  localMessages: StartPersistedChatRunParams["localMessages"],
): StartPersistedChatRunParams["diagnostics"] {
  return {
    requestId: run.request_id,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    sessionId: run.session_id,
    model: run.model_id,
    messageCount: localMessages.length,
    hasAttachments: turnInput.some((part) => part.type !== "text"),
    attachmentFileNames: turnInput
      .filter((part): part is Extract<ContentPart, { type: "file" }> => part.type === "file")
      .map((part) => part.fileName),
  };
}

/**
 * Returns a session snapshot and recovers any stale active run before the snapshot is returned to a client.
 */
export async function getRecoveredChatSessionSnapshot(
  userId: string,
  workspaceId: string,
  sessionId?: string,
): Promise<ChatSessionSnapshot> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const snapshot = await getChatSessionSnapshotWithExecutor(executor, scope, sessionId);
    if (snapshot.runState !== "running") {
      return snapshot;
    }

    const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, snapshot.sessionId);
    const recovered = await recoverStaleRunWithExecutor(executor, scope, lockedSession);
    if (!recovered) {
      return snapshot;
    }

    return getChatSessionSnapshotWithExecutor(executor, scope, snapshot.sessionId);
  });
}

export type RecoveredPaginatedSession = Readonly<{
  sessionId: string;
  runState: ChatSessionRunState;
  page: PaginatedChatMessages;
}>;

/**
 * Resolves a session with stale-run recovery, then returns a paginated message window.
 */
export async function getRecoveredPaginatedSession(
  userId: string,
  workspaceId: string,
  sessionId: string | undefined,
  limit: number,
  beforeCursor: number | undefined,
): Promise<RecoveredPaginatedSession> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const sessionRow = sessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedChatSessionWithExecutor(executor, scope, sessionId);

    if (sessionRow.status === "running") {
      const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, sessionRow.session_id);
      await recoverStaleRunWithExecutor(executor, scope, lockedSession);
    }

    const resolvedSession = sessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedChatSessionWithExecutor(executor, scope, sessionRow.session_id);

    const page = beforeCursor === undefined
      ? await listChatMessagesLatestWithExecutor(executor, scope, resolvedSession.session_id, limit)
      : await listChatMessagesBeforeWithExecutor(executor, scope, resolvedSession.session_id, beforeCursor, limit);

    return {
      sessionId: resolvedSession.session_id,
      runState: resolvedSession.status,
      page,
    };
  });
}

/**
 * Persists the user turn, creates the assistant placeholder, and enqueues a new run for the target session.
 */
export async function prepareChatRun(
  userId: string,
  workspaceId: string,
  requestedSessionId: string | undefined,
  content: ReadonlyArray<ContentPart>,
  requestId: string,
  timezone: string,
): Promise<PreparedChatRun> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const session = requestedSessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedChatSessionWithExecutor(executor, scope, requestedSessionId);
    const lockedSession = await selectSessionForUpdateWithExecutor(executor, scope, session.session_id);
    const existingRun = await selectChatRunBySessionRequestWithExecutor(
      executor,
      scope,
      session.session_id,
      requestId,
    );

    if (existingRun !== null) {
      return {
        sessionId: session.session_id,
        runId: existingRun.run_id,
        clientRequestId: requestId,
        runState: mapChatRunStatusToSessionRunState(existingRun.status),
        deduplicated: true,
        shouldInvokeWorker: existingRun.status === "queued",
      };
    }

    if (lockedSession.status === "running") {
      const recovered = await recoverStaleRunWithExecutor(executor, scope, lockedSession);
      if (!recovered) {
        throw new ChatSessionConflictError(session.session_id);
      }
    }

    await insertChatItemWithExecutor(executor, scope, {
      sessionId: session.session_id,
      role: "user",
      state: "completed",
      content,
    });

    const assistantItem = await insertChatItemWithExecutor(executor, scope, {
      sessionId: session.session_id,
      role: "assistant",
      state: "in_progress",
      content: [],
    });

    const run = await insertChatRunWithExecutor(executor, scope, {
      sessionId: session.session_id,
      assistantItemId: assistantItem.itemId,
      requestId,
      timezone,
      turnInput: content,
    });

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      session.session_id,
      "running",
      run.run_id,
      new Date(),
    );

    return {
      sessionId: session.session_id,
      runId: run.run_id,
      clientRequestId: requestId,
      runState: mapChatRunStatusToSessionRunState(run.status),
      deduplicated: false,
      shouldInvokeWorker: true,
    };
  });
}

/**
 * Claims a queued or stale running chat run for worker execution and rebuilds the local replay context.
 */
export async function claimChatRun(
  userId: string,
  workspaceId: string,
  runId: string,
): Promise<ClaimedChatRun | null> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = await selectChatRunForUpdateWithExecutor(executor, scope, runId);
    if (run === null) {
      return null;
    }

    const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
    if (session.active_run_id !== run.run_id) {
      return null;
    }

    if (run.cancel_requested_at !== null && run.status === "queued") {
      await finalizeCancelledRunWithExecutor(executor, scope, run);
      return null;
    }

    if (run.status === "running") {
      const heartbeatAt = run.worker_heartbeat_at === null
        ? null
        : new Date(run.worker_heartbeat_at).getTime();
      if (!isChatRunHeartbeatStale(heartbeatAt, Date.now())) {
        return null;
      }
    } else if (run.status !== "queued") {
      return null;
    }

    const now = new Date();
    const claimedRun = await updateChatRunStatusWithExecutor(executor, scope, {
      runId: run.run_id,
      status: "running",
      workerClaimedAt: now,
      workerHeartbeatAt: now,
      cancelRequestedAt: run.cancel_requested_at === null ? null : new Date(run.cancel_requested_at),
      startedAt: run.started_at === null ? now : new Date(run.started_at),
      finishedAt: null,
      lastErrorMessage: null,
    });

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      session.session_id,
      "running",
      claimedRun.run_id,
      now,
    );

    const messages = await listChatMessagesWithExecutor(executor, scope, claimedRun.session_id);
    const localMessages = buildLocalChatMessages(
      messages.filter((message) => message.itemId !== claimedRun.assistant_item_id),
    );

    return {
      runId: claimedRun.run_id,
      sessionId: claimedRun.session_id,
      requestId: claimedRun.request_id,
      userId,
      workspaceId,
      timezone: claimedRun.timezone,
      assistantItemId: claimedRun.assistant_item_id,
      localMessages,
      turnInput: claimedRun.turn_input,
      diagnostics: createDiagnostics(scope, claimedRun, claimedRun.turn_input, localMessages),
    };
  });
}

/**
 * Refreshes worker ownership for a claimed run and reports whether cancellation or ownership loss occurred.
 */
export async function touchClaimedChatRunHeartbeat(
  userId: string,
  workspaceId: string,
  runId: string,
  heartbeatAt: Date,
): Promise<ChatRunHeartbeatState> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = await selectChatRunForUpdateWithExecutor(executor, scope, runId);
    if (run === null || run.status !== "running") {
      return {
        cancellationRequested: false,
        ownershipLost: true,
      };
    }

    const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
    if (session.active_run_id !== run.run_id) {
      return {
        cancellationRequested: false,
        ownershipLost: true,
      };
    }

    await updateChatRunStatusWithExecutor(executor, scope, {
      runId,
      status: "running",
      workerClaimedAt: run.worker_claimed_at === null ? heartbeatAt : new Date(run.worker_claimed_at),
      workerHeartbeatAt: heartbeatAt,
      cancelRequestedAt: run.cancel_requested_at === null ? null : new Date(run.cancel_requested_at),
      startedAt: run.started_at === null ? heartbeatAt : new Date(run.started_at),
      finishedAt: null,
      lastErrorMessage: null,
    });

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      run.session_id,
      "running",
      runId,
      heartbeatAt,
    );

    return {
      cancellationRequested: run.cancel_requested_at !== null,
      ownershipLost: false,
    };
  });
}

/**
 * Finalizes a claimed run as completed and clears the session's active-run pointer.
 */
export async function completeClaimedChatRun(
  userId: string,
  workspaceId: string,
  params: Readonly<{
    runId: string;
    sessionId: string;
    assistantItemId: string;
    assistantContent: ReadonlyArray<ContentPart>;
    assistantOpenAIItems?: ReadonlyArray<import("./openai/replayItems").StoredOpenAIReplayItem>;
  }>,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = requireRunRow(
      await selectChatRunForUpdateWithExecutor(executor, scope, params.runId) ?? undefined,
      "complete",
    );

    await updateChatItemWithExecutor(executor, scope, {
      itemId: params.assistantItemId,
      content: params.assistantContent,
      state: "completed",
      assistantOpenAIItems: params.assistantOpenAIItems,
    });

    await updateChatRunStatusWithExecutor(executor, scope, {
      runId: params.runId,
      status: "completed",
      workerClaimedAt: run.worker_claimed_at === null ? null : new Date(run.worker_claimed_at),
      workerHeartbeatAt: run.worker_heartbeat_at === null ? null : new Date(run.worker_heartbeat_at),
      cancelRequestedAt: run.cancel_requested_at === null ? null : new Date(run.cancel_requested_at),
      startedAt: run.started_at === null ? null : new Date(run.started_at),
      finishedAt: new Date(),
      lastErrorMessage: null,
    });

    await updateChatSessionRunStateWithExecutor(executor, scope, params.sessionId, "idle", null, null);
  });
}

/**
 * Persists the terminal assistant state for a failed or interrupted run and finalizes the run status.
 */
export async function persistClaimedChatRunTerminalError(
  userId: string,
  workspaceId: string,
  params: Readonly<{
    runId: string;
    sessionId: string;
    assistantItemId: string;
    assistantContent: ReadonlyArray<ContentPart>;
    assistantOpenAIItems?: ReadonlyArray<import("./openai/replayItems").StoredOpenAIReplayItem>;
    errorMessage: string;
    sessionState: ChatSessionRunState;
  }>,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = requireRunRow(
      await selectChatRunForUpdateWithExecutor(executor, scope, params.runId) ?? undefined,
      "fail",
    );
    const finalizedAssistantContent = finalizePendingToolCallContent(
      params.assistantContent,
      "incomplete",
      FAILED_TOOL_CALL_OUTPUT,
    );

    if (finalizedAssistantContent.length === 0) {
      await updateChatItemWithExecutor(executor, scope, {
        itemId: params.assistantItemId,
        content: [{ type: "text", text: params.errorMessage }],
        state: "error",
        assistantOpenAIItems: params.assistantOpenAIItems,
      });
    } else {
      await updateChatItemWithExecutor(executor, scope, {
        itemId: params.assistantItemId,
        content: finalizedAssistantContent,
        state: "completed",
        assistantOpenAIItems: params.assistantOpenAIItems,
      });
      await insertChatItemWithExecutor(executor, scope, {
        sessionId: params.sessionId,
        role: "assistant",
        state: "error",
        content: [{ type: "text", text: params.errorMessage }],
      });
    }

    await updateChatRunStatusWithExecutor(executor, scope, {
      runId: params.runId,
      status: params.sessionState === "interrupted" ? "interrupted" : "failed",
      workerClaimedAt: run.worker_claimed_at === null ? null : new Date(run.worker_claimed_at),
      workerHeartbeatAt: run.worker_heartbeat_at === null ? null : new Date(run.worker_heartbeat_at),
      cancelRequestedAt: run.cancel_requested_at === null ? null : new Date(run.cancel_requested_at),
      startedAt: run.started_at === null ? null : new Date(run.started_at),
      finishedAt: new Date(),
      lastErrorMessage: params.errorMessage,
    });

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      params.sessionId,
      params.sessionState,
      null,
      null,
    );
  });
}

/**
 * Persists the stopped assistant state for a user-cancelled run and finalizes the run status.
 */
export async function persistClaimedChatRunCancelled(
  userId: string,
  workspaceId: string,
  params: Readonly<{
    runId: string;
    sessionId: string;
    assistantItemId: string;
    assistantContent: ReadonlyArray<ContentPart>;
    assistantOpenAIItems?: ReadonlyArray<import("./openai/replayItems").StoredOpenAIReplayItem>;
  }>,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = requireRunRow(
      await selectChatRunForUpdateWithExecutor(executor, scope, params.runId) ?? undefined,
      "cancel",
    );

    await updateChatItemWithExecutor(executor, scope, {
      itemId: params.assistantItemId,
      content: buildUserStoppedAssistantContent(params.assistantContent),
      state: "cancelled",
      assistantOpenAIItems: params.assistantOpenAIItems,
    });

    await updateChatRunStatusWithExecutor(executor, scope, {
      runId: params.runId,
      status: "cancelled",
      workerClaimedAt: run.worker_claimed_at === null ? null : new Date(run.worker_claimed_at),
      workerHeartbeatAt: run.worker_heartbeat_at === null ? null : new Date(run.worker_heartbeat_at),
      cancelRequestedAt: run.cancel_requested_at === null ? new Date() : new Date(run.cancel_requested_at),
      startedAt: run.started_at === null ? null : new Date(run.started_at),
      finishedAt: new Date(),
      lastErrorMessage: STOPPED_BY_USER_TOOL_OUTPUT,
    });

    await updateChatSessionRunStateWithExecutor(executor, scope, params.sessionId, "idle", null, null);
  });
}

/**
 * Marks a queued run as interrupted when worker dispatch fails before any worker can claim it.
 */
export async function markQueuedChatRunDispatchFailed(
  userId: string,
  workspaceId: string,
  runId: string,
  errorMessage: string,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = await selectChatRunForUpdateWithExecutor(executor, scope, runId);
    if (run === null || run.status !== "queued") {
      return;
    }

    await finalizeInterruptedRunWithExecutor(executor, scope, run, errorMessage);
  });
}

/**
 * Requests cancellation for the active run of a session and returns whether the run stopped immediately.
 */
export async function requestChatRunCancellation(
  userId: string,
  workspaceId: string,
  sessionId: string,
): Promise<ChatRunStopState> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const session = await selectSessionForUpdateWithExecutor(executor, scope, sessionId);
    if (session.active_run_id === null || session.status !== "running") {
      return {
        sessionId,
        stopped: false,
        stillRunning: false,
        runId: null,
      };
    }

    const run = await selectChatRunForUpdateWithExecutor(executor, scope, session.active_run_id);
    if (run === null) {
      await updateChatSessionRunStateWithExecutor(executor, scope, sessionId, "interrupted", null, null);
      return {
        sessionId,
        stopped: true,
        stillRunning: false,
        runId: session.active_run_id,
      };
    }

    if (run.status === "queued") {
      await finalizeCancelledRunWithExecutor(executor, scope, run);
      return {
        sessionId,
        stopped: true,
        stillRunning: false,
        runId: run.run_id,
      };
    }

    if (run.status !== "running") {
      return {
        sessionId,
        stopped: false,
        stillRunning: false,
        runId: run.run_id,
      };
    }

    await updateChatRunStatusWithExecutor(executor, scope, {
      runId: run.run_id,
      status: "running",
      workerClaimedAt: run.worker_claimed_at === null ? null : new Date(run.worker_claimed_at),
      workerHeartbeatAt: run.worker_heartbeat_at === null ? null : new Date(run.worker_heartbeat_at),
      cancelRequestedAt: new Date(),
      startedAt: run.started_at === null ? null : new Date(run.started_at),
      finishedAt: null,
      lastErrorMessage: null,
    });

    return {
      sessionId,
      stopped: true,
      stillRunning: true,
      runId: run.run_id,
    };
  });
}
