import {
  isChatStorageEntityNotFoundError,
} from "../errors";
import type {
  OpenAILoopCompletion,
} from "../openai/loop";
import type {
  StoredOpenAIReplayItem,
} from "../openai/replayItems";
import type {
  ContentPart,
} from "../types";
import {
  startBackendSpan,
} from "../../observability/sentry";
import {
  applyAssistantDelta,
  persistToolCallProgress,
  updateAssistantInProgress,
  upsertAssistantReasoningSummaryContent,
  upsertAssistantToolCallContent,
} from "./assistantContent";
import {
  createChatRuntimeControl,
  DEADLINE_REACHED_MESSAGE,
} from "./control";
import {
  DEFAULT_CHAT_RUNTIME_DEPENDENCIES,
  type ChatRuntimeDependencies,
} from "./dependencies";
import {
  createWorkerLogContext,
  logProviderCallAborted,
  logProviderCallStarted,
} from "./lifecycleLogs";
import {
  createProviderTerminalEventError,
  isUserAbortError,
} from "./providerErrors";
import {
  persistCancelledChatRun,
  persistCompletedChatRun,
  persistFailedChatRun,
  persistInterruptedChatRun,
} from "./terminalFinalization";
import {
  ChatRunOwnershipLostError,
  type ChatWorkerAbortReason,
  type ChatWorkerRunResult,
  type StartPersistedChatRunParams,
} from "./types";

type RuntimeFinalizationResult = Readonly<{
  assistantContent: ReadonlyArray<ContentPart>;
  result: ChatWorkerRunResult;
}>;

/**
 * Runs one persisted chat session using a single awaited provider-control flow.
 * User cancellation is terminal and persists exactly once.
 * Ownership loss is non-terminal for the losing worker because another worker
 * may already own the run and is the only worker allowed to finalize it.
 */
export async function runPersistedChatSessionWithDeps(
  params: StartPersistedChatRunParams,
  dependencies: ChatRuntimeDependencies,
): Promise<ChatWorkerRunResult> {
  const logContext = createWorkerLogContext(params);
  let assistantContent: ReadonlyArray<ContentPart> = [];
  let isFinalized = false;
  let runtimeResult: ChatWorkerRunResult | null = null;
  const seenInvalidationVersions = new Map<string, number>();
  const startedAt = new Date();
  const control = createChatRuntimeControl(params, dependencies, logContext);

  const createFinalizationBaseParams = (): Readonly<{
    params: StartPersistedChatRunParams;
    dependencies: ChatRuntimeDependencies;
    logContext: typeof logContext;
    startedAt: Date;
    assistantContent: ReadonlyArray<ContentPart>;
    readLifecycleState: () => Readonly<{
      abortReason: ChatWorkerAbortReason | null;
      signalAborted: boolean;
      stopRequestedByUser: boolean;
      ownershipLost: boolean;
    }>;
  }> => ({
    params,
    dependencies,
    logContext,
    startedAt,
    assistantContent,
    readLifecycleState: () => ({
      abortReason: control.getAbortReason(),
      signalAborted: control.abortController.signal.aborted,
      stopRequestedByUser: control.getStopRequestedByUser(),
      ownershipLost: control.getOwnershipLost(),
    }),
  });

  const applyFinalizationResult = (
    finalizationResult: RuntimeFinalizationResult,
  ): ChatWorkerRunResult => {
    assistantContent = finalizationResult.assistantContent;
    isFinalized = true;
    return finalizationResult.result;
  };

  const persistCancelled = async (
    reason: ChatWorkerAbortReason,
  ): Promise<ChatWorkerRunResult> => applyFinalizationResult(
    await persistCancelledChatRun({
      ...createFinalizationBaseParams(),
      reason,
    }),
  );

  const persistFailed = async (
    error: unknown,
  ): Promise<ChatWorkerRunResult> => applyFinalizationResult(
    await persistFailedChatRun({
      ...createFinalizationBaseParams(),
      error,
    }),
  );

  const persistInterrupted = async (
    errorMessage: string,
    assistantOpenAIItems: ReadonlyArray<StoredOpenAIReplayItem> | undefined,
  ): Promise<ChatWorkerRunResult> => applyFinalizationResult(
    await persistInterruptedChatRun({
      ...createFinalizationBaseParams(),
      errorMessage,
      assistantOpenAIItems,
    }),
  );

  const persistCompleted = async (
    assistantOpenAIItems: ReadonlyArray<StoredOpenAIReplayItem>,
  ): Promise<ChatWorkerRunResult> => applyFinalizationResult(
    await persistCompletedChatRun({
      ...createFinalizationBaseParams(),
      assistantOpenAIItems,
    }),
  );

  const persistInterruptedIfDeadlineReached = async (): Promise<ChatWorkerRunResult | null> => {
    return control.getAbortReason() === "deadline_reached"
      ? persistInterrupted(DEADLINE_REACHED_MESSAGE, undefined)
      : null;
  };

  control.startHeartbeat();

  try {
    await dependencies.beginTaskProtection();
    const initialHeartbeat = await control.touchInitialHeartbeat();
    if (initialHeartbeat.outcome === "ownership_lost") {
      return {
        outcome: "ownership_lost",
        abortReason: "ownership_lost",
        runStatus: null,
        sessionState: null,
      };
    }
    if (initialHeartbeat.outcome === "initial_cancelled") {
      return persistCancelled("initial_cancel_state");
    }

    control.scheduleSoftDeadlineTimer();
    const afterInitialHeartbeatDeadlineResult = await persistInterruptedIfDeadlineReached();
    if (afterInitialHeartbeatDeadlineResult !== null) {
      return afterInitialHeartbeatDeadlineResult;
    }

    const beforeObservationDeadlineResult = await persistInterruptedIfDeadlineReached();
    if (beforeObservationDeadlineResult !== null) {
      return beforeObservationDeadlineResult;
    }

    await dependencies.startChatTurnObservation(
      {
        requestId: params.requestId,
        userId: params.userId,
        workspaceId: params.workspaceId,
        sessionId: params.sessionId,
        model: params.diagnostics.model,
        turnIndex: params.diagnostics.messageCount,
        runState: "running",
        turnInput: params.turnInput,
      },
      async (rootObservation): Promise<void> => {
        runtimeResult = await persistInterruptedIfDeadlineReached();
        if (runtimeResult !== null) {
          return;
        }

        logProviderCallStarted(logContext, new Date(), control.abortController.signal.aborted);
        const completion: OpenAILoopCompletion = await startBackendSpan(
          "chat.worker.openai_loop",
          "ai.openai",
          async () => dependencies.startOpenAILoop({
            requestId: params.requestId,
            userId: params.userId,
            workspaceId: params.workspaceId,
            sessionId: params.sessionId,
            timezone: params.timezone,
            localMessages: params.localMessages,
            turnInput: params.turnInput,
            rootObservation,
            signal: control.abortController.signal,
            onExecutionPhaseChanged: control.setExecutionPhase,
            shouldStopBeforeNextStep: control.shouldStopBeforeNextStep,
          }, async (event): Promise<void> => {
            if (control.shouldIgnoreStreamEvent(event)) {
              return;
            }

            if (event.type === "delta") {
              assistantContent = applyAssistantDelta(assistantContent, event);
              await updateAssistantInProgress(
                dependencies,
                params.userId,
                params.workspaceId,
                params.assistantItemId,
                assistantContent,
              );
            } else if (event.type === "tool_call") {
              assistantContent = upsertAssistantToolCallContent(assistantContent, event);
              await persistToolCallProgress(
                dependencies,
                params.userId,
                params.workspaceId,
                params.assistantItemId,
                assistantContent,
                event,
                seenInvalidationVersions,
              );
            } else if (event.type === "reasoning_summary") {
              assistantContent = upsertAssistantReasoningSummaryContent(assistantContent, event);
              await updateAssistantInProgress(
                dependencies,
                params.userId,
                params.workspaceId,
                params.assistantItemId,
                assistantContent,
              );
            } else if (event.type === "error") {
              runtimeResult = await persistFailed(createProviderTerminalEventError());
            }
          }),
        );

        if (runtimeResult !== null) {
          return;
        }

        if (control.getOwnershipLost()) {
          throw new ChatRunOwnershipLostError(params.runId);
        }

        if (
          completion.terminationReason === "stopped_before_next_step"
          || control.getAbortReason() === "deadline_reached"
        ) {
          runtimeResult = await persistInterrupted(
            DEADLINE_REACHED_MESSAGE,
            completion.openaiItems,
          );
          return;
        }

        if (control.getStopRequestedByUser()) {
          runtimeResult = await persistCancelled(control.getAbortReason() ?? "user_cancelled");
          return;
        }

        if (!isFinalized) {
          runtimeResult = await persistCompleted(completion.openaiItems);
          return;
        }
      },
    );
    if (runtimeResult !== null) {
      return runtimeResult;
    }
    if (isFinalized) {
      const abortReason = control.getAbortReason();
      if (abortReason === "initial_cancel_state" || abortReason === "user_cancelled") {
        return {
          outcome: "cancelled",
          abortReason,
          runStatus: "cancelled",
          sessionState: "idle",
        };
      }

      return {
        outcome: "completed",
        abortReason: null,
        runStatus: "completed",
        sessionState: "idle",
      };
    }

    if (control.getOwnershipLost()) {
      return {
        outcome: "ownership_lost",
        abortReason: control.getAbortReason() ?? "ownership_lost",
        runStatus: null,
        sessionState: null,
      };
    }

    return {
      outcome: "completed",
      abortReason: null,
      runStatus: "completed",
      sessionState: "idle",
    };
  } catch (error) {
    const abortReason = control.getAbortReason();
    if (abortReason !== null && isUserAbortError(error)) {
      logProviderCallAborted(
        logContext,
        error,
        abortReason,
        control.getStopRequestedByUser(),
        control.getOwnershipLost(),
        control.abortController.signal.aborted,
      );

      if (abortReason === "ownership_lost") {
        return {
          outcome: "ownership_lost",
          abortReason,
          runStatus: null,
          sessionState: null,
        };
      }

      if (abortReason === "deadline_reached") {
        return persistInterrupted(DEADLINE_REACHED_MESSAGE, undefined);
      }

      return persistCancelled(abortReason);
    }

    if (control.getOwnershipLost() || error instanceof ChatRunOwnershipLostError) {
      return {
        outcome: "ownership_lost",
        abortReason: control.getAbortReason() ?? "ownership_lost",
        runStatus: null,
        sessionState: null,
      };
    }

    if (isChatStorageEntityNotFoundError(error)) {
      return {
        outcome: "ownership_lost",
        abortReason: "ownership_lost",
        runStatus: null,
        sessionState: null,
      };
    }

    return persistFailed(error);
  } finally {
    control.clearTimers();
    await dependencies.endTaskProtection();
  }
}

/**
 * Runs one persisted chat session with the production runtime dependencies.
 */
export async function runPersistedChatSession(
  params: StartPersistedChatRunParams,
): Promise<ChatWorkerRunResult> {
  return runPersistedChatSessionWithDeps(params, DEFAULT_CHAT_RUNTIME_DEPENDENCIES);
}
