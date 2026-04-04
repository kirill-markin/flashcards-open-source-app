/**
 * Backend-owned run executor for persisted chat sessions.
 * The worker uses this module to consume provider events, update the assistant item incrementally, and finalize run state independently of client connections.
 */
import OpenAI from "openai";
import { isChatStorageEntityNotFoundError } from "./errors";
import { getAIProviderFailureMetadata } from "./providerFailure";
import { getErrorLogContext } from "../server/logging";
import { startChatTurnObservation } from "../telemetry/langfuse";
import {
  appendAssistantTextContent,
  finalizePendingToolCallContent,
  upsertReasoningSummaryContent,
  upsertToolCallContent,
} from "./history";
import { startOpenAILoop } from "./openai/loop";
import type { ServerChatMessage } from "./openai/replayItems";
import {
  completeClaimedChatRun,
  persistClaimedChatRunCancelled,
  persistClaimedChatRunTerminalError,
  touchClaimedChatRunHeartbeat,
} from "./runs";
import {
  INTERRUPTED_TOOL_CALL_OUTPUT,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
} from "./store";
import { logChatWorkerLifecycleEvent, type ChatWorkerLogContext } from "./workerLogging";
import type {
  ChatStreamEvent,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "./types";
import { CHAT_RUN_HEARTBEAT_INTERVAL_MS } from "./workerLease";

const INCOMPLETE_TOOL_CALL_PROVIDER_STATUS = "incomplete";

type ChatRunDiagnostics = Readonly<{
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  model: string;
  messageCount: number;
  hasAttachments: boolean;
  attachmentFileNames: ReadonlyArray<string>;
}>;

export type StartPersistedChatRunParams = Readonly<{
  lambdaRequestId: string | null;
  runId: string;
  requestId: string;
  userId: string;
  workspaceId: string;
  sessionId: string;
  timezone: string;
  assistantItemId: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  diagnostics: ChatRunDiagnostics;
}>;

type ChatWorkerAbortReason =
  | "user_cancelled"
  | "ownership_lost"
  | "initial_cancel_state";

export type ChatWorkerRunResult = Readonly<{
  outcome: "completed" | "cancelled" | "ownership_lost" | "failed";
  abortReason: ChatWorkerAbortReason | null;
  runStatus: "completed" | "cancelled" | "failed" | null;
  sessionState: "idle" | null;
}>;

export class ChatRunOwnershipLostError extends Error {
  public constructor(runId: string) {
    super(`Chat run ownership lost: ${runId}`);
    this.name = "ChatRunOwnershipLostError";
  }
}

export type ChatRuntimeDependencies = Readonly<{
  startChatTurnObservation: typeof startChatTurnObservation;
  startOpenAILoop: typeof startOpenAILoop;
  completeChatRun: typeof completeClaimedChatRun;
  persistAssistantCancelled: typeof persistClaimedChatRunCancelled;
  persistAssistantTerminalError: typeof persistClaimedChatRunTerminalError;
  touchChatRunHeartbeat: typeof touchClaimedChatRunHeartbeat;
  updateAssistantMessageItem: typeof updateAssistantMessageItem;
  updateAssistantMessageItemAndInvalidateMainContent: typeof updateAssistantMessageItemAndInvalidateMainContent;
  beginTaskProtection: () => Promise<void>;
  endTaskProtection: () => Promise<void>;
}>;

const DEFAULT_CHAT_RUNTIME_DEPENDENCIES: ChatRuntimeDependencies = {
  startChatTurnObservation,
  startOpenAILoop,
  completeChatRun: completeClaimedChatRun,
  persistAssistantCancelled: persistClaimedChatRunCancelled,
  persistAssistantTerminalError: persistClaimedChatRunTerminalError,
  touchChatRunHeartbeat: touchClaimedChatRunHeartbeat,
  updateAssistantMessageItem,
  updateAssistantMessageItemAndInvalidateMainContent,
  beginTaskProtection: async (): Promise<void> => undefined,
  endTaskProtection: async (): Promise<void> => undefined,
};

function createWorkerLogContext(params: StartPersistedChatRunParams): ChatWorkerLogContext {
  return {
    lambdaRequestId: params.lambdaRequestId,
    chatRequestId: params.requestId,
    runId: params.runId,
    sessionId: params.sessionId,
    userId: params.userId,
    workspaceId: params.workspaceId,
  };
}

function toIsoStringOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function logAbortRequested(
  context: ChatWorkerLogContext,
  reason: ChatWorkerAbortReason,
  heartbeatAt: Date | null,
  cancellationRequested: boolean,
  ownershipLost: boolean,
  signalAborted: boolean,
): void {
  logChatWorkerLifecycleEvent("chat_worker_abort_requested", context, {
    abortReason: reason,
    signalAborted,
    cancellationRequested,
    ownershipLost,
    runStatus: null,
    sessionState: null,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerRequestId: null,
    heartbeatAt: toIsoStringOrNull(heartbeatAt),
    startedAt: null,
    finishedAt: null,
  }, false);
}

function logProviderCallStarted(
  context: ChatWorkerLogContext,
  startedAt: Date,
  signalAborted: boolean,
): void {
  logChatWorkerLifecycleEvent("chat_worker_provider_call_started", context, {
    abortReason: null,
    signalAborted,
    cancellationRequested: false,
    ownershipLost: false,
    runStatus: null,
    sessionState: null,
    providerErrorClass: null,
    providerErrorMessage: null,
    providerRequestId: null,
    heartbeatAt: null,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
  }, false);
}

function logProviderCallAborted(
  context: ChatWorkerLogContext,
  error: unknown,
  abortReason: ChatWorkerAbortReason,
  cancellationRequested: boolean,
  ownershipLost: boolean,
  signalAborted: boolean,
): void {
  const errorContext = getErrorLogContext(error);
  const providerMetadata = getAIProviderFailureMetadata(error);
  logChatWorkerLifecycleEvent("chat_worker_provider_call_aborted", context, {
    abortReason,
    signalAborted,
    cancellationRequested,
    ownershipLost,
    runStatus: null,
    sessionState: null,
    providerErrorClass: errorContext.errorClass,
    providerErrorMessage: errorContext.errorMessage,
    providerRequestId: providerMetadata.upstreamRequestId,
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
  }, false);
}

function logTerminalStatePersisted(
  context: ChatWorkerLogContext,
  error: unknown | null,
  abortReason: ChatWorkerAbortReason | null,
  runStatus: "completed" | "cancelled" | "failed",
  sessionState: "idle",
  cancellationRequested: boolean,
  ownershipLost: boolean,
  startedAt: Date,
  finishedAt: Date,
): void {
  const errorContext = error === null ? null : getErrorLogContext(error);
  const providerMetadata = error === null ? null : getAIProviderFailureMetadata(error);

  logChatWorkerLifecycleEvent("chat_worker_terminal_state_persisted", context, {
    abortReason,
    signalAborted: abortReason !== null,
    cancellationRequested,
    ownershipLost,
    runStatus,
    sessionState,
    providerErrorClass: errorContext?.errorClass ?? null,
    providerErrorMessage: errorContext?.errorMessage ?? null,
    providerRequestId: providerMetadata?.upstreamRequestId ?? null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  }, runStatus === "failed");
}

/**
 * Narrows the provider abort case used when a user stop request interrupts the active run.
 */
function isUserAbortError(error: unknown): boolean {
  return error instanceof OpenAI.APIUserAbortError
    || (error instanceof Error && error.name === "AbortError");
}

/**
 * Converts one streamed tool-call event into the persisted assistant content-part shape.
 */
function createToolCallContentPart(
  event: Extract<ChatStreamEvent, { type: "tool_call" }>,
): ToolCallContentPart {
  return {
    type: "tool_call",
    id: event.id,
    name: event.name,
    status: event.status,
    providerStatus: event.providerStatus ?? null,
    input: event.input ?? null,
    output: event.output ?? null,
    streamPosition: {
      itemId: event.itemId,
      responseIndex: event.responseIndex,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: event.sequenceNumber,
    },
  };
}

/**
 * Converts one streamed reasoning summary into the persisted assistant content-part shape.
 */
function createReasoningSummaryContentPart(
  event: Extract<ChatStreamEvent, { type: "reasoning_summary" }>,
): ReasoningSummaryContentPart {
  return {
    type: "reasoning_summary",
    summary: event.summary,
    streamPosition: {
      itemId: event.itemId,
      responseIndex: event.responseIndex,
      outputIndex: event.outputIndex,
      contentIndex: null,
      sequenceNumber: event.sequenceNumber,
    },
  };
}

/**
 * Applies one streamed assistant text delta to the persisted assistant content array.
 */
function applyAssistantDelta(
  content: ReadonlyArray<ContentPart>,
  event: Extract<ChatStreamEvent, { type: "delta" }>,
): ReadonlyArray<ContentPart> {
  return appendAssistantTextContent(content, {
    text: event.text,
    streamPosition: {
      itemId: event.itemId,
      responseIndex: event.responseIndex,
      outputIndex: event.outputIndex,
      contentIndex: event.contentIndex,
      sequenceNumber: event.sequenceNumber,
    },
  });
}

/**
 * Persists the in-progress assistant item after ordinary streamed updates.
 */
async function updateAssistantInProgress(
  dependencies: ChatRuntimeDependencies,
  userId: string,
  workspaceId: string,
  assistantItemId: string,
  assistantContent: ReadonlyArray<ContentPart>,
): Promise<void> {
  await dependencies.updateAssistantMessageItem(userId, workspaceId, {
    itemId: assistantItemId,
    content: assistantContent,
    state: "in_progress",
  });
}

/**
 * Persists tool-call progress and invalidates main content when a completed tool requests a UI refresh.
 */
async function persistToolCallProgress(
  dependencies: ChatRuntimeDependencies,
  userId: string,
  workspaceId: string,
  assistantItemId: string,
  assistantContent: ReadonlyArray<ContentPart>,
  event: Extract<ChatStreamEvent, { type: "tool_call" }>,
  seenInvalidationVersions: Map<string, number>,
): Promise<void> {
  if (event.status !== "completed" || event.refreshRoute !== true) {
    await updateAssistantInProgress(
      dependencies,
      userId,
      workspaceId,
      assistantItemId,
      assistantContent,
    );
    return;
  }

  const existingVersion = seenInvalidationVersions.get(event.id);
  if (existingVersion !== undefined) {
    await updateAssistantInProgress(
      dependencies,
      userId,
      workspaceId,
      assistantItemId,
      assistantContent,
    );
    return;
  }

  const mainContentInvalidationVersion = await dependencies.updateAssistantMessageItemAndInvalidateMainContent(
    userId,
    workspaceId,
    {
      itemId: assistantItemId,
      content: assistantContent,
      state: "in_progress",
    },
  );
  seenInvalidationVersions.set(event.id, mainContentInvalidationVersion);
}

/**
 * Finalizes any open tool calls when the run stops before a terminal provider event arrives.
 */
function finalizeAssistantToolCalls(
  assistantContent: ReadonlyArray<ContentPart>,
): ReadonlyArray<ContentPart> {
  return finalizePendingToolCallContent(
    assistantContent,
    INCOMPLETE_TOOL_CALL_PROVIDER_STATUS,
    INTERRUPTED_TOOL_CALL_OUTPUT,
  );
}

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
  let stopRequestedByUser = false;
  let ownershipLost = false;
  let abortReason: ChatWorkerAbortReason | null = null;
  let runtimeResult: ChatWorkerRunResult | null = null;
  const seenInvalidationVersions = new Map<string, number>();
  const abortController = new AbortController();
  const startedAt = new Date();

  const persistCancelled = async (
    reason: ChatWorkerAbortReason,
  ): Promise<ChatWorkerRunResult> => {
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    const finishedAt = new Date();
    await dependencies.persistAssistantCancelled(params.userId, params.workspaceId, {
      runId: params.runId,
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
    });
    isFinalized = true;
    logTerminalStatePersisted(
      logContext,
      null,
      reason,
      "cancelled",
      "idle",
      stopRequestedByUser,
      ownershipLost,
      startedAt,
      finishedAt,
    );
    return {
      outcome: "cancelled",
      abortReason: reason,
      runStatus: "cancelled",
      sessionState: "idle",
    };
  };

  const persistFailed = async (
    error: unknown,
  ): Promise<ChatWorkerRunResult> => {
    const message = error instanceof Error ? error.message : String(error);
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    const finishedAt = new Date();
    await dependencies.persistAssistantTerminalError(params.userId, params.workspaceId, {
      runId: params.runId,
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
      errorMessage: message,
      sessionState: "idle",
    });
    isFinalized = true;
    logTerminalStatePersisted(
      logContext,
      error,
      abortReason,
      "failed",
      "idle",
      stopRequestedByUser,
      ownershipLost,
      startedAt,
      finishedAt,
    );
    return {
      outcome: "failed",
      abortReason,
      runStatus: "failed",
      sessionState: "idle",
    };
  };

  const persistCompleted = async (
    assistantOpenAIItems: ReadonlyArray<import("./openai/replayItems").StoredOpenAIReplayItem>,
  ): Promise<ChatWorkerRunResult> => {
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    const finishedAt = new Date();
    await dependencies.completeChatRun(params.userId, params.workspaceId, {
      runId: params.runId,
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
      assistantOpenAIItems,
    });
    isFinalized = true;
    logTerminalStatePersisted(
      logContext,
      null,
      null,
      "completed",
      "idle",
      stopRequestedByUser,
      ownershipLost,
      startedAt,
      finishedAt,
    );
    return {
      outcome: "completed",
      abortReason: null,
      runStatus: "completed",
      sessionState: "idle",
    };
  };

  const recordAbortRequest = (
    reason: ChatWorkerAbortReason,
    heartbeatAt: Date | null,
    cancellationRequested: boolean,
    ownershipLostState: boolean,
  ): void => {
    if (abortReason !== null) {
      return;
    }

    abortReason = reason;
    abortController.abort();
    logAbortRequested(
      logContext,
      reason,
      heartbeatAt,
      cancellationRequested,
      ownershipLostState,
      abortController.signal.aborted,
    );
  };

  const heartbeatTimer = setInterval(() => {
    const heartbeatAt = new Date();
    void dependencies.touchChatRunHeartbeat(
      params.userId,
      params.workspaceId,
      params.runId,
      heartbeatAt,
    ).then((state) => {
      if (state.ownershipLost) {
        ownershipLost = true;
        recordAbortRequest(
          "ownership_lost",
          heartbeatAt,
          state.cancellationRequested,
          true,
        );
        return;
      }

      if (state.cancellationRequested) {
        stopRequestedByUser = true;
        recordAbortRequest(
          "user_cancelled",
          heartbeatAt,
          true,
          ownershipLost,
        );
      }
    }).catch((): void => undefined);
  }, CHAT_RUN_HEARTBEAT_INTERVAL_MS);

  try {
    await dependencies.beginTaskProtection();
    const initialHeartbeatAt = new Date();
    const initialHeartbeatState = await dependencies.touchChatRunHeartbeat(
      params.userId,
      params.workspaceId,
      params.runId,
      initialHeartbeatAt,
    );
    if (initialHeartbeatState.ownershipLost) {
      ownershipLost = true;
      recordAbortRequest(
        "ownership_lost",
        initialHeartbeatAt,
        initialHeartbeatState.cancellationRequested,
        true,
      );
      return {
        outcome: "ownership_lost",
        abortReason: "ownership_lost",
        runStatus: null,
        sessionState: null,
      };
    }
    stopRequestedByUser = initialHeartbeatState.cancellationRequested;
    if (stopRequestedByUser) {
      recordAbortRequest("initial_cancel_state", initialHeartbeatAt, true, false);
      return persistCancelled("initial_cancel_state");
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
        logProviderCallStarted(logContext, new Date(), abortController.signal.aborted);
        const completion = await dependencies.startOpenAILoop({
          requestId: params.requestId,
          userId: params.userId,
          workspaceId: params.workspaceId,
          sessionId: params.sessionId,
          timezone: params.timezone,
          localMessages: params.localMessages,
          turnInput: params.turnInput,
          rootObservation,
          signal: abortController.signal,
        }, async (event): Promise<void> => {
          if (stopRequestedByUser || ownershipLost) {
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
            assistantContent = upsertToolCallContent(assistantContent, createToolCallContentPart(event));
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
            assistantContent = upsertReasoningSummaryContent(
              assistantContent,
              createReasoningSummaryContentPart(event),
            );
            await updateAssistantInProgress(
              dependencies,
              params.userId,
              params.workspaceId,
              params.assistantItemId,
              assistantContent,
            );
          } else if (event.type === "error") {
            runtimeResult = await persistFailed(new Error(event.message));
          }
        });

        if (runtimeResult !== null) {
          return;
        }

        if (ownershipLost) {
          throw new ChatRunOwnershipLostError(params.runId);
        }

        if (stopRequestedByUser) {
          runtimeResult = await persistCancelled(abortReason ?? "user_cancelled");
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

    if (ownershipLost) {
      return {
        outcome: "ownership_lost",
        abortReason: abortReason ?? "ownership_lost",
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
    if (abortReason !== null && isUserAbortError(error)) {
      logProviderCallAborted(
        logContext,
        error,
        abortReason,
        stopRequestedByUser,
        ownershipLost,
        abortController.signal.aborted,
      );

      if (abortReason === "ownership_lost") {
        return {
          outcome: "ownership_lost",
          abortReason,
          runStatus: null,
          sessionState: null,
        };
      }

      return persistCancelled(abortReason);
    }

    if (ownershipLost || error instanceof ChatRunOwnershipLostError) {
      return {
        outcome: "ownership_lost",
        abortReason: abortReason ?? "ownership_lost",
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
    clearInterval(heartbeatTimer);
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
