import {
  transactionWithWorkspaceScope,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../db";
import type { StoredOpenAIReplayItem } from "../openai/replayItems";
import type { ChatSessionRunState } from "../store";
import {
  type ChatComposerSuggestion,
} from "../composerSuggestions";
import {
  buildLocalChatMessages,
  buildUserStoppedAssistantContent,
  ChatSessionConflictError,
  clearActiveChatComposerSuggestionGenerationWithExecutor,
  createFollowUpChatComposerSuggestionGenerationWithExecutor,
  insertChatItemWithExecutor,
  listChatMessagesWithExecutor,
  resolveLatestOrCreateChatSessionWithExecutor,
  resolveRequestedChatSessionWithExecutor,
  STOPPED_BY_USER_TOOL_OUTPUT,
  updateChatItemWithExecutor,
  updateChatSessionRunStateWithExecutor,
} from "../store";
import { finalizePendingToolCallContent } from "../history";
import { FAILED_TOOL_CALL_OUTPUT } from "../store";
import type { ContentPart } from "../types";
import { isChatRunHeartbeatStale } from "../workerLease";
import {
  createDiagnostics,
  finalizeCancelledRunWithExecutor,
  finalizeInterruptedRunWithExecutor,
  recoverStaleRunWithExecutor,
} from "./finalization";
import {
  createChatRunStatusUpdateFromRow,
  insertChatRunWithExecutor,
  mapChatRunStatusToSessionRunState,
  requireRunRow,
  selectChatRunBySessionRequestWithExecutor,
  selectChatRunForUpdateWithExecutor,
  selectSessionForUpdateWithExecutor,
  updateChatRunStatusWithExecutor,
} from "./repository";
import type {
  ChatRunHeartbeatState,
  ChatRunStopState,
  ClaimedChatRun,
  PreparedChatRun,
} from "./types";

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
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      session.session_id,
      "run_started",
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
    const claimedRun = await updateChatRunStatusWithExecutor(
      executor,
      scope,
      createChatRunStatusUpdateFromRow(run, {
        status: "running",
        workerClaimedAt: now,
        workerHeartbeatAt: now,
        startedAt: run.started_at === null ? now : undefined,
        finishedAt: null,
        lastErrorMessage: null,
      }),
    );

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      session.session_id,
      "running",
      claimedRun.run_id,
      now,
    );

    const messages = await buildLocalMessagesForClaimedRun(executor, scope, claimedRun.session_id, claimedRun.assistant_item_id);

    return {
      runId: claimedRun.run_id,
      sessionId: claimedRun.session_id,
      requestId: claimedRun.request_id,
      userId,
      workspaceId,
      timezone: claimedRun.timezone,
      assistantItemId: claimedRun.assistant_item_id,
      localMessages: messages,
      turnInput: claimedRun.turn_input,
      diagnostics: createDiagnostics(scope, claimedRun, messages),
    };
  });
}

async function buildLocalMessagesForClaimedRun(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  assistantItemId: string,
): Promise<ClaimedChatRun["localMessages"]> {
  const messages = await listChatMessagesWithExecutor(executor, scope, sessionId);

  return buildLocalChatMessages(
    messages.filter((message) => message.itemId !== assistantItemId),
  );
}

/**
 * Refreshes worker ownership for a claimed run and reports whether cancellation
 * or ownership loss occurred.
 * The worker that loses ownership must stop mutating state immediately and must
 * not persist a terminal state, because another worker may already own the run.
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

    await updateChatRunStatusWithExecutor(
      executor,
      scope,
      createChatRunStatusUpdateFromRow(run, {
        status: "running",
        workerClaimedAt: run.worker_claimed_at === null ? heartbeatAt : undefined,
        workerHeartbeatAt: heartbeatAt,
        startedAt: run.started_at === null ? heartbeatAt : undefined,
        finishedAt: null,
        lastErrorMessage: null,
      }),
    );

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
    assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
    composerSuggestions: ReadonlyArray<ChatComposerSuggestion>;
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

    await updateChatRunStatusWithExecutor(
      executor,
      scope,
      createChatRunStatusUpdateFromRow(run, {
        status: "completed",
        finishedAt: new Date(),
        lastErrorMessage: null,
      }),
    );

    await updateChatSessionRunStateWithExecutor(executor, scope, params.sessionId, "idle", null, null);
    await createFollowUpChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      params.sessionId,
      params.assistantItemId,
      params.composerSuggestions,
    );
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
    assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
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

    await updateChatRunStatusWithExecutor(
      executor,
      scope,
      createChatRunStatusUpdateFromRow(run, {
        status: params.sessionState === "interrupted" ? "interrupted" : "failed",
        finishedAt: new Date(),
        lastErrorMessage: params.errorMessage,
      }),
    );

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      params.sessionId,
      params.sessionState,
      null,
      null,
    );
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      params.sessionId,
      params.sessionState === "interrupted" ? "run_interrupted" : "run_failed",
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
    assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>;
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

    await updateChatRunStatusWithExecutor(
      executor,
      scope,
      createChatRunStatusUpdateFromRow(run, {
        status: "cancelled",
        cancelRequestedAt: run.cancel_requested_at === null ? new Date() : undefined,
        finishedAt: new Date(),
        lastErrorMessage: STOPPED_BY_USER_TOOL_OUTPUT,
      }),
    );

    await updateChatSessionRunStateWithExecutor(executor, scope, params.sessionId, "idle", null, null);
    await clearActiveChatComposerSuggestionGenerationWithExecutor(
      executor,
      scope,
      params.sessionId,
      "run_cancelled",
    );
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
 * Interrupts a queued or running chat run when the API cannot provide an attachable live stream.
 */
export async function interruptPreparedChatRun(
  userId: string,
  workspaceId: string,
  runId: string,
  errorMessage: string,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = await selectChatRunForUpdateWithExecutor(executor, scope, runId);
    if (run === null) {
      return;
    }

    if (run.status !== "queued" && run.status !== "running") {
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
      await clearActiveChatComposerSuggestionGenerationWithExecutor(
        executor,
        scope,
        sessionId,
        "run_interrupted",
      );
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

    await updateChatRunStatusWithExecutor(
      executor,
      scope,
      createChatRunStatusUpdateFromRow(run, {
        status: "running",
        cancelRequestedAt: new Date(),
        finishedAt: null,
        lastErrorMessage: null,
      }),
    );

    return {
      sessionId,
      stopped: true,
      stillRunning: true,
      runId: run.run_id,
    };
  });
}
