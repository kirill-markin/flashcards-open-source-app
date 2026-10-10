import {
  transactionWithWorkspaceScope,
  transactionWithWorkspaceScopeDeadline,
  type DatabaseExecutor,
  type WorkspaceDatabaseScope,
} from "../../database";
import {
  addBackendBreadcrumb,
  createBackendObservationScope,
} from "../../observability/sentry";
import { ChatRunRowNotFoundError, ChatSessionNotCurrentError } from "../errors";
import type { StoredOpenAIReplayItem } from "../openai/replayItems";
import type { ChatSessionRow } from "../store/repository";
import type { ChatSessionRunState } from "../store";
import {
  decideChatCostPolicyWithExecutor,
  getChatRuntimeConfigForCostPolicyMode,
} from "../costPolicy";
import {
  CHAT_MODEL_ID,
  CHAT_MODEL_REASONING_EFFORT,
} from "../config";
import {
  type ChatComposerSuggestionsLocale,
  type ChatComposerSuggestion,
} from "../composerSuggestions";
import {
  buildLocalChatMessages,
  buildUserStoppedAssistantContent,
  ChatSessionConflictError,
  clearActiveChatComposerSuggestionGenerationWithExecutor,
  createFollowUpChatComposerSuggestionGenerationWithExecutor,
  getLatestChatSessionIdWithExecutor,
  insertChatItemWithExecutor,
  listChatMessagesWithExecutor,
  resolveLatestOrCreateChatSessionWithExecutor,
  resolveRequestedOrCreateChatSessionWithExecutor,
  STOPPED_BY_USER_TOOL_OUTPUT,
  updateChatItemWithExecutor,
  updateChatSessionRunStateForActiveRunWithExecutor,
  updateChatSessionRunStateWithExecutor,
  INTERRUPTED_TOOL_CALL_OUTPUT,
} from "../store";
import { finalizePendingToolCallContent } from "../history";
import { FAILED_TOOL_CALL_OUTPUT } from "../store";
import type { ContentPart, UnconvertedContentPart } from "../types";
import {
  logOrphanedChatFileUploads,
  recordTurnChatAttachmentsWithExecutor,
  uploadTurnInlineChatAttachments,
  type UploadedChatAttachment,
} from "../../chatFiles";
import type { ProductAnalyticsClientReportablePlatform } from "../../productAnalytics/catalog";
import { CHAT_RUN_HEARTBEAT_INTERVAL_MS, isChatRunHeartbeatStale } from "../worker/lease";
import { getChatRunClaimStateWithExecutor } from "./claimFence";
import {
  createDiagnostics,
  finalizeCancelledRunWithExecutor,
  finalizeInterruptedRunWithExecutor,
  recoverStaleRunWithExecutor,
} from "./finalization";
import {
  claimChatRunWithExecutor as claimChatRunRowWithExecutor,
  createChatRunStatusUpdateFromRow,
  insertChatRunWithExecutor,
  mapChatRunStatusToSessionRunState,
  requireRunRow,
  selectChatRunBySessionRequestWithExecutor,
  selectChatRunForUpdateWithExecutor,
  selectSessionForUpdateWithExecutor,
  touchClaimedChatRunHeartbeatWithExecutor,
  updateChatRunPolicySnapshotWithExecutor,
  updateClaimedChatRunStatusWithExecutor,
  updateChatRunStatusWithExecutor,
  type ChatRunRow,
} from "./repository";
import type {
  ChatRunClaimToken,
  ChatRunHeartbeatState,
  ChatRunStopState,
  ClaimedChatRun,
  PreparedChatRun,
} from "./types";

/**
 * Only the current (latest) chat session accepts new turns; older sessions are read-only.
 * Removing the single call in `prepareChatRun` allows continuing old chats.
 */
async function assertChatSessionAcceptsNewTurnsWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  requestId: string,
): Promise<void> {
  const currentSessionId = await getLatestChatSessionIdWithExecutor(executor, scope);
  if (currentSessionId === sessionId) {
    return;
  }

  addBackendBreadcrumb({
    action: "chat_session_not_current_refused",
    scope: createBackendObservationScope(
      "backend-api",
      null,
      null,
      null,
      scope.userId,
      scope.workspaceId,
      requestId,
      null,
      sessionId,
      null,
      null,
    ),
    details: { currentSessionId },
  });
  throw new ChatSessionNotCurrentError();
}

/**
 * Persists the user turn, creates the assistant placeholder, and enqueues a new run for the target session.
 *
 * The `ai_message_sent` analytics event is deliberately not emitted here. The caller writes it once
 * the worker has been dispatched, so generation never waits on the analytics pool, and a new caller
 * of this function has to call `recordAiMessageSentAnalytics` itself.
 *
 * `assertAiUsageAllowance` is passed in rather than called before this function because the refusal has
 * to sit behind the deduplication: this function is idempotent by `(session, clientRequestId)`, and a
 * replay of a turn that was already persisted is the retry that dispatches its worker, not a next turn.
 * Refusing a replay would leave that turn undispatched and its session `running` until a later recovery.
 * It runs inside the transaction and only on the branch that inserts a new run, so the run that crosses
 * the allowance is still the one that completes.
 *
 * What it is allowed to be is narrow, and the caller is what keeps it so: the comparison of an allowance
 * the caller already resolved against the usage facts already appended. `apps/backend/src/aiUsage/cap.ts`
 * splits that comparison from the resolution for this reason - resolving reads the billing tables and can
 * refresh `billing.entitlement_snapshots` in a transaction of its own, which would commit independently
 * of this one and survive a rollback. So: this closure reads `ai.usage_events`, on a pooled connection of
 * its own while this transaction holds the session row, and writes nothing. A refusal therefore rolls
 * back having written nothing, and anything added to this closure later has to keep that true.
 *
 * Inline attachments become session files on the branch that inserts a new run, after the refusal, so the
 * turn and its run store references and a replay or a refused turn uploads nothing. Their objects are
 * stored before their rows, so a failure anywhere after the upload, COMMIT included, logs the objects the
 * rollback leaves without a row, because cleanup follows deleted rows and never finds them. A commit with
 * an unknown outcome is logged too; its error class says the rows may exist.
 */
export async function prepareChatRun(
  userId: string,
  workspaceId: string,
  requestedSessionId: string | undefined,
  content: ReadonlyArray<UnconvertedContentPart>,
  requestId: string,
  timezone: string,
  uiLocale: ChatComposerSuggestionsLocale | null,
  initiatingAuthIsSignedIn: boolean,
  clientPlatform: ProductAnalyticsClientReportablePlatform | null,
  assertAiUsageAllowance: () => Promise<void>,
): Promise<PreparedChatRun> {
  const observationScope = createBackendObservationScope(
    "backend-api",
    null,
    null,
    null,
    userId,
    workspaceId,
    requestId,
    null,
    requestedSessionId ?? null,
    null,
    null,
  );
  let uploadedAttachments: ReadonlyArray<UploadedChatAttachment> = [];
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const session = requestedSessionId === undefined
      ? await resolveLatestOrCreateChatSessionWithExecutor(executor, scope)
      : await resolveRequestedOrCreateChatSessionWithExecutor(executor, scope, requestedSessionId);
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
        initiatingAuthIsSignedIn: existingRun.initiating_auth_is_signed_in,
      };
    }

    await assertChatSessionAcceptsNewTurnsWithExecutor(executor, scope, session.session_id, requestId);
    await assertAiUsageAllowance();

    if (lockedSession.status === "running") {
      const recovered = await recoverStaleRunWithExecutor(executor, scope, lockedSession);
      if (!recovered) {
        throw new ChatSessionConflictError(session.session_id);
      }
    }

    const uploads = await uploadTurnInlineChatAttachments(session.session_id, content, observationScope);
    uploadedAttachments = [...uploads.values()];
    const storedContent = await recordTurnChatAttachmentsWithExecutor(
      executor,
      scope,
      session.session_id,
      content,
      uploads,
    );
    await insertChatItemWithExecutor(executor, scope, {
      sessionId: session.session_id,
      role: "user",
      state: "completed",
      content: storedContent,
    });

    const assistantItem = await insertChatItemWithExecutor(executor, scope, {
      sessionId: session.session_id,
      role: "assistant",
      state: "in_progress",
      content: [],
    });

    const insertedRun = await insertChatRunWithExecutor(executor, scope, {
      sessionId: session.session_id,
      assistantItemId: assistantItem.itemId,
      requestId,
      modelId: CHAT_MODEL_ID,
      reasoningEffort: CHAT_MODEL_REASONING_EFFORT,
      timezone,
      uiLocale,
      turnInput: storedContent,
      initiatingAuthIsSignedIn,
      clientPlatform,
    });
    const costPolicy = await decideChatCostPolicyWithExecutor(executor, scope, timezone);
    const run = await updateChatRunPolicySnapshotWithExecutor(executor, scope, {
      runId: insertedRun.run_id,
      modelId: costPolicy.modelId,
      reasoningEffort: costPolicy.reasoningEffort,
      aiCostMode: costPolicy.mode,
      chatTurnsLast7d: costPolicy.chatTurnsLast7d,
      goodReviewDaysLast7d: costPolicy.goodReviewDaysLast7d,
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
      initiatingAuthIsSignedIn: run.initiating_auth_is_signed_in,
    };
  }).catch((error: unknown) => {
    logOrphanedChatFileUploads(observationScope, uploadedAttachments, "write_failed", error);
    throw error;
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

    const claimedRun = requireRunRow(
      await claimChatRunRowWithExecutor(executor, scope, run.run_id) ?? undefined,
      "claim",
    );
    if (claimedRun.worker_claimed_at === null) {
      throw new Error(`Claimed chat run is missing worker_claimed_at: ${claimedRun.run_id}`);
    }
    const claimToken = claimedRun.worker_claimed_at;
    const claimedAt = new Date(claimToken);

    await updateChatSessionRunStateWithExecutor(
      executor,
      scope,
      session.session_id,
      "running",
      claimedRun.run_id,
      claimedAt,
    );

    const messages = await buildLocalMessagesForClaimedRun(executor, scope, claimedRun.session_id, claimedRun.assistant_item_id);
    // The policy mode is the stable producer/worker contract across rolling
    // deployments. Resolve provider settings at claim time so the current
    // worker can execute runs prepared by the previous API version without
    // admitting retired provider model IDs into the runtime configuration.
    const runtimeConfig = getChatRuntimeConfigForCostPolicyMode(claimedRun.ai_cost_mode);

    return {
      runId: claimedRun.run_id,
      claimToken,
      sessionId: claimedRun.session_id,
      requestId: claimedRun.request_id,
      userId,
      workspaceId,
      timezone: claimedRun.timezone,
      uiLocale: claimedRun.ui_locale,
      modelId: runtimeConfig.modelId,
      reasoningEffort: runtimeConfig.reasoningEffort,
      assistantItemId: claimedRun.assistant_item_id,
      localMessages: messages,
      turnInput: claimedRun.turn_input,
      initiatingAuthIsSignedIn: claimedRun.initiating_auth_is_signed_in,
      clientPlatform: claimedRun.client_platform,
      diagnostics: createDiagnostics(scope, claimedRun, messages, {
        model: runtimeConfig.modelId,
        aiCostMode: claimedRun.ai_cost_mode,
        chatTurnsLast7d: claimedRun.chat_turns_last_7d,
        goodReviewDaysLast7d: claimedRun.good_review_days_last_7d,
      }),
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

export function assertClaimedRunStillActive(
  run: ChatRunRow,
  session: ChatSessionRow,
  claimToken: ChatRunClaimToken,
  operation: string,
): void {
  if (
    run.status !== "running"
    || run.worker_claimed_at !== claimToken
    || session.status !== "running"
    || session.active_run_id !== run.run_id
  ) {
    throw new ChatRunRowNotFoundError(operation);
  }
}

// A heartbeat stuck on a lock wait or a dead pooled connection fails at this bound, early enough for a
// later tick's heartbeat to land before the last landed one goes stale.
const CHAT_RUN_HEARTBEAT_DATABASE_TIMEOUT_MS = 2 * CHAT_RUN_HEARTBEAT_INTERVAL_MS;

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
  claimToken: ChatRunClaimToken,
  heartbeatAt: Date,
): Promise<ChatRunHeartbeatState> {
  const touchedRun = await transactionWithWorkspaceScopeDeadline(
    { userId, workspaceId },
    heartbeatAt.getTime() + CHAT_RUN_HEARTBEAT_DATABASE_TIMEOUT_MS,
    async (executor) => touchClaimedChatRunHeartbeatWithExecutor(
      executor,
      { userId, workspaceId },
      runId,
      claimToken,
      heartbeatAt,
    ),
  );
  if (touchedRun === null) {
    return {
      cancellationRequested: false,
      ownershipLost: true,
    };
  }

  return {
    cancellationRequested: touchedRun.cancel_requested_at !== null,
    ownershipLost: false,
  };
}

export async function reconcileInactiveClaimedChatRun(
  userId: string,
  workspaceId: string,
  params: Readonly<{
    runId: string;
    sessionId: string;
    claimToken: ChatRunClaimToken;
    databaseDeadlineAtMs: number;
  }>,
): Promise<"user_cancelled" | "ownership_lost"> {
  const state = await transactionWithWorkspaceScopeDeadline(
    { userId, workspaceId },
    params.databaseDeadlineAtMs,
    async (executor) => getChatRunClaimStateWithExecutor(
      executor,
      { userId, workspaceId, ...params },
    ),
  );
  return state === "cancellation_requested" ? "user_cancelled" : "ownership_lost";
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
  claimToken: ChatRunClaimToken,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = requireRunRow(
      await selectChatRunForUpdateWithExecutor(executor, scope, params.runId) ?? undefined,
      "complete",
    );
    const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
    assertClaimedRunStillActive(run, session, claimToken, "complete");

    await updateChatItemWithExecutor(executor, scope, {
      itemId: params.assistantItemId,
      content: params.assistantContent,
      state: "completed",
      assistantOpenAIItems: params.assistantOpenAIItems,
    });

    requireRunRow(
      await updateClaimedChatRunStatusWithExecutor(
        executor,
        scope,
        claimToken,
        createChatRunStatusUpdateFromRow(run, {
          status: "completed",
          finishedAt: new Date(),
          lastErrorMessage: null,
        }),
      ) ?? undefined,
      "complete",
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
  claimToken: ChatRunClaimToken,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = requireRunRow(
      await selectChatRunForUpdateWithExecutor(executor, scope, params.runId) ?? undefined,
      "fail",
    );
    const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
    assertClaimedRunStillActive(run, session, claimToken, "fail");
    const finalizedAssistantContent = finalizePendingToolCallContent(
      params.assistantContent,
      "incomplete",
      params.sessionState === "interrupted"
        ? INTERRUPTED_TOOL_CALL_OUTPUT
        : FAILED_TOOL_CALL_OUTPUT,
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

    requireRunRow(
      await updateClaimedChatRunStatusWithExecutor(
        executor,
        scope,
        claimToken,
        createChatRunStatusUpdateFromRow(run, {
          status: params.sessionState === "interrupted" ? "interrupted" : "failed",
          finishedAt: new Date(),
          lastErrorMessage: params.errorMessage,
        }),
      ) ?? undefined,
      "fail",
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
  claimToken: ChatRunClaimToken,
): Promise<void> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = requireRunRow(
      await selectChatRunForUpdateWithExecutor(executor, scope, params.runId) ?? undefined,
      "cancel",
    );
    const session = await selectSessionForUpdateWithExecutor(executor, scope, run.session_id);
    assertClaimedRunStillActive(run, session, claimToken, "cancel");

    await updateChatItemWithExecutor(executor, scope, {
      itemId: params.assistantItemId,
      content: buildUserStoppedAssistantContent(params.assistantContent),
      state: "cancelled",
      assistantOpenAIItems: params.assistantOpenAIItems,
    });

    requireRunRow(
      await updateClaimedChatRunStatusWithExecutor(
        executor,
        scope,
        claimToken,
        createChatRunStatusUpdateFromRow(run, {
          status: "cancelled",
          cancelRequestedAt: run.cancel_requested_at === null ? new Date() : undefined,
          finishedAt: new Date(),
          lastErrorMessage: STOPPED_BY_USER_TOOL_OUTPUT,
        }),
      ) ?? undefined,
      "cancel",
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
 * Fails a queued run the worker could not prepare for its claim, so the turn ends with `errorMessage`
 * instead of staying queued until stale-run recovery interrupts it. Returns whether it failed the run; a
 * run that is no longer queued belongs to whoever moved it on and is left as it is.
 */
export async function failQueuedChatRun(
  userId: string,
  workspaceId: string,
  runId: string,
  errorMessage: string,
): Promise<boolean> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) => {
    const scope = { userId, workspaceId };
    const run = await selectChatRunForUpdateWithExecutor(executor, scope, runId);
    if (run === null || run.status !== "queued") {
      return false;
    }

    await updateChatItemWithExecutor(executor, scope, {
      itemId: run.assistant_item_id,
      content: [{ type: "text", text: errorMessage }],
      state: "error",
    });
    await updateChatRunStatusWithExecutor(
      executor,
      scope,
      createChatRunStatusUpdateFromRow(run, {
        status: "failed",
        finishedAt: new Date(),
        lastErrorMessage: errorMessage,
      }),
    );
    const sessionUpdated = await updateChatSessionRunStateForActiveRunWithExecutor(
      executor,
      scope,
      run.session_id,
      "idle",
      null,
      null,
      run.run_id,
    );
    if (sessionUpdated) {
      await clearActiveChatComposerSuggestionGenerationWithExecutor(
        executor,
        scope,
        run.session_id,
        "run_failed",
      );
    }
    return true;
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
function createInactiveChatRunStopState(sessionId: string): ChatRunStopState {
  return {
    sessionId,
    stopped: false,
    stillRunning: false,
    runId: null,
  };
}

function createExpectedRunMismatchStopState(session: ChatSessionRow): ChatRunStopState {
  if (session.active_run_id !== null && session.status === "running") {
    return {
      sessionId: session.session_id,
      stopped: false,
      stillRunning: true,
      runId: session.active_run_id,
    };
  }

  return createInactiveChatRunStopState(session.session_id);
}

export async function requestChatRunCancellationWithExecutor(
  executor: DatabaseExecutor,
  scope: WorkspaceDatabaseScope,
  sessionId: string,
  expectedRunId: string | null,
): Promise<ChatRunStopState> {
  const session = await selectSessionForUpdateWithExecutor(executor, scope, sessionId);
  if (session.active_run_id === null || session.status !== "running") {
    return createInactiveChatRunStopState(sessionId);
  }

  if (expectedRunId !== null && session.active_run_id !== expectedRunId) {
    return createExpectedRunMismatchStopState(session);
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
}

export async function requestChatRunCancellation(
  userId: string,
  workspaceId: string,
  sessionId: string,
  expectedRunId: string | null,
): Promise<ChatRunStopState> {
  return transactionWithWorkspaceScope({ userId, workspaceId }, async (executor) =>
    requestChatRunCancellationWithExecutor(
      executor,
      { userId, workspaceId },
      sessionId,
      expectedRunId,
    ));
}
