/**
 * Backend-owned run executor for persisted chat sessions.
 * The worker uses this module to consume provider events, update the assistant item incrementally, and finalize run state independently of client connections.
 */
import OpenAI from "openai";
import {
  emptyChatComposerSuggestions,
  generateFollowUpChatComposerSuggestions,
  type ChatComposerSuggestionsLocale,
  type ChatComposerSuggestion,
} from "./composerSuggestions";
import {
  chatAttachmentUnsupportedTypeMessage,
  isChatAttachmentUnsupportedTypeError,
} from "./attachmentPolicy";
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
import {
  startOpenAILoop,
  type OpenAILoopCompletion,
} from "./openai/loop";
import type {
  ServerChatMessage,
  StoredOpenAIReplayItem,
} from "./openai/replayItems";
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
import {
  captureChatWorkerTerminalStateException,
  logChatWorkerLifecycleEvent,
  type ChatWorkerLogContext,
} from "./worker/logging";
import {
  normalizeCaughtError,
  startBackendSpan,
  type ChatWorkerLifecycleDetails,
} from "../observability/sentry";
import type {
  ChatStreamEvent,
  ContentPart,
  ReasoningSummaryContentPart,
  ToolCallContentPart,
} from "./types";
import { CHAT_RUN_HEARTBEAT_INTERVAL_MS } from "./worker/lease";

const INCOMPLETE_TOOL_CALL_PROVIDER_STATUS = "incomplete";
/**
 * We intentionally keep chat-run cancellation shallow.
 * Instead of threading abort semantics through every tool and DB layer, the
 * worker reserves a pessimistic final window and refuses to start more
 * provider work once the remaining Lambda budget enters that window.
 * Started tool work is therefore treated as a bounded non-preemptible section.
 */
const CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS = 180_000;
const DEADLINE_REACHED_MESSAGE = "This response took too long, so I stopped the run before the server timeout. Please try again or split the request into smaller steps.";
const GENERIC_RUNTIME_ERROR_MESSAGE = "The AI response failed before it could finish. Please try again.";
const PROVIDER_ERROR_MESSAGE = "The AI provider could not complete the response. Please try again.";
const PROVIDER_AUTH_ERROR_MESSAGE = "The AI provider could not authenticate the request. Please try again later.";
const PROVIDER_RATE_LIMITED_ERROR_MESSAGE = "The AI provider is rate limited right now. Please try again in a few minutes.";
const PROVIDER_UNAVAILABLE_ERROR_MESSAGE = "The AI provider is temporarily unavailable. Please try again soon.";
const PROVIDER_ABORT_ERROR_MESSAGE = "The AI request was interrupted. Please try again.";

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
  uiLocale: ChatComposerSuggestionsLocale | null;
  assistantItemId: string;
  localMessages: ReadonlyArray<ServerChatMessage>;
  turnInput: ReadonlyArray<ContentPart>;
  diagnostics: ChatRunDiagnostics;
  getRemainingTimeInMillis: () => number;
}>;

type ChatWorkerAbortReason =
  | "user_cancelled"
  | "ownership_lost"
  | "initial_cancel_state"
  | "deadline_reached";

type ChatWorkerExecutionPhase = "idle" | "model" | "tool";

type SafeProviderErrorDetails = Pick<
  ChatWorkerLifecycleDetails,
  | "providerErrorClass"
  | "providerErrorMessage"
  | "providerErrorStatus"
  | "providerErrorCode"
  | "providerErrorCategory"
  | "providerRequestId"
>;

export type ChatWorkerRunResult = Readonly<{
  outcome: "completed" | "cancelled" | "ownership_lost" | "failed" | "interrupted";
  abortReason: ChatWorkerAbortReason | null;
  runStatus: "completed" | "cancelled" | "failed" | "interrupted" | null;
  sessionState: "idle" | "interrupted" | null;
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
  generateFollowUpChatComposerSuggestions: typeof generateFollowUpChatComposerSuggestions;
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
  generateFollowUpChatComposerSuggestions,
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

function readErrorRecordStringField(error: unknown, fieldName: string): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const value = (error as Readonly<Record<string, unknown>>)[fieldName];
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue === "" ? null : trimmedValue;
}

function classifyProviderErrorCategory(error: unknown, providerStatus: number | null): string | null {
  if (error instanceof OpenAI.APIUserAbortError || (error instanceof Error && error.name === "AbortError")) {
    return "provider_abort";
  }

  if (error instanceof Error && error.name === "ChatProviderTerminalEventError") {
    return "provider_error";
  }

  if (providerStatus === 401 || providerStatus === 403) {
    return "provider_auth";
  }

  if (providerStatus === 402 || providerStatus === 429) {
    return "provider_rate_limited";
  }

  if (providerStatus !== null && providerStatus >= 500) {
    return "provider_unavailable";
  }

  if (providerStatus !== null || error instanceof OpenAI.APIError) {
    return "provider_error";
  }

  return error === null ? null : "runtime_error";
}

function createSafeProviderErrorDetails(error: unknown | null): SafeProviderErrorDetails {
  if (error === null) {
    return {
      providerErrorClass: null,
      providerErrorMessage: null,
      providerErrorStatus: null,
      providerErrorCode: null,
      providerErrorCategory: null,
      providerRequestId: null,
    };
  }

  const errorContext = getErrorLogContext(error);
  const providerMetadata = getAIProviderFailureMetadata(error);

  return {
    providerErrorClass: errorContext.errorClass,
    providerErrorMessage: null,
    providerErrorStatus: providerMetadata.upstreamStatus,
    providerErrorCode: readErrorRecordStringField(error, "code"),
    providerErrorCategory: classifyProviderErrorCategory(error, providerMetadata.upstreamStatus),
    providerRequestId: providerMetadata.upstreamRequestId,
  };
}

function createPublicTerminalErrorMessage(error: unknown): string {
  const providerMetadata = getAIProviderFailureMetadata(error);
  const category = classifyProviderErrorCategory(error, providerMetadata.upstreamStatus);
  const providerErrorCode = readErrorRecordStringField(error, "code");

  if (isChatAttachmentUnsupportedTypeError(error) || providerErrorCode === "invalid_file") {
    return chatAttachmentUnsupportedTypeMessage;
  }

  if (category === "provider_auth") {
    return PROVIDER_AUTH_ERROR_MESSAGE;
  }

  if (category === "provider_rate_limited") {
    return PROVIDER_RATE_LIMITED_ERROR_MESSAGE;
  }

  if (category === "provider_unavailable") {
    return PROVIDER_UNAVAILABLE_ERROR_MESSAGE;
  }

  if (category === "provider_abort") {
    return PROVIDER_ABORT_ERROR_MESSAGE;
  }

  if (category === "provider_error") {
    return PROVIDER_ERROR_MESSAGE;
  }

  return GENERIC_RUNTIME_ERROR_MESSAGE;
}

function isHandledProviderFailure(error: unknown): boolean {
  if (isChatAttachmentUnsupportedTypeError(error)) {
    return true;
  }

  const providerMetadata = getAIProviderFailureMetadata(error);
  const category = classifyProviderErrorCategory(error, providerMetadata.upstreamStatus);
  return category !== null && category !== "runtime_error";
}

function createProviderTerminalEventError(): Error {
  const error = new Error("Chat provider emitted a terminal error event");
  error.name = "ChatProviderTerminalEventError";
  return error;
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
    ...createSafeProviderErrorDetails(null),
    heartbeatAt: toIsoStringOrNull(heartbeatAt),
    startedAt: null,
    finishedAt: null,
    outcome: null,
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
    ...createSafeProviderErrorDetails(null),
    heartbeatAt: null,
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    outcome: null,
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
  logChatWorkerLifecycleEvent("chat_worker_provider_call_aborted", context, {
    abortReason,
    signalAborted,
    cancellationRequested,
    ownershipLost,
    runStatus: null,
    sessionState: null,
    ...createSafeProviderErrorDetails(error),
    heartbeatAt: null,
    startedAt: null,
    finishedAt: null,
    outcome: null,
  }, false);
}

function logTerminalStatePersisted(
  context: ChatWorkerLogContext,
  error: unknown | null,
  abortReason: ChatWorkerAbortReason | null,
  signalAborted: boolean,
  runStatus: "completed" | "cancelled" | "failed" | "interrupted",
  sessionState: "idle" | "interrupted",
  cancellationRequested: boolean,
  ownershipLost: boolean,
  startedAt: Date,
  finishedAt: Date,
): void {
  const payload = {
    abortReason,
    signalAborted,
    cancellationRequested,
    ownershipLost,
    runStatus,
    sessionState,
    ...createSafeProviderErrorDetails(error),
    heartbeatAt: null,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    outcome: null,
  };

  if (runStatus === "failed" && error !== null && !isHandledProviderFailure(error)) {
    captureChatWorkerTerminalStateException(
      context,
      payload,
      normalizeCaughtError(error),
    );
    return;
  }

  logChatWorkerLifecycleEvent(
    "chat_worker_terminal_state_persisted",
    context,
    payload,
    runStatus === "failed",
  );
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

async function generateTerminalComposerSuggestions(
  params: StartPersistedChatRunParams,
  assistantContent: ReadonlyArray<ContentPart>,
  logContext: ChatWorkerLogContext,
  dependencies: ChatRuntimeDependencies,
): Promise<ReadonlyArray<ChatComposerSuggestion>> {
  try {
    return await dependencies.generateFollowUpChatComposerSuggestions(
      params.userId,
      params.turnInput,
      assistantContent,
      params.assistantItemId,
      params.uiLocale,
    );
  } catch (error) {
    logChatWorkerLifecycleEvent("chat_worker_composer_suggestions_failed", logContext, {
      abortReason: null,
      signalAborted: false,
      cancellationRequested: false,
      ownershipLost: false,
      runStatus: null,
      sessionState: null,
      ...createSafeProviderErrorDetails(error),
      heartbeatAt: null,
      startedAt: null,
      finishedAt: null,
      outcome: null,
    }, true);
    return emptyChatComposerSuggestions();
  }
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
  let executionPhase: ChatWorkerExecutionPhase = "idle";
  let softDeadlineTimer: ReturnType<typeof setTimeout> | null = null;

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
      abortController.signal.aborted,
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
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    const finishedAt = new Date();
    await dependencies.persistAssistantTerminalError(params.userId, params.workspaceId, {
      runId: params.runId,
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
      errorMessage: createPublicTerminalErrorMessage(error),
      sessionState: "idle",
    });
    isFinalized = true;
    logTerminalStatePersisted(
      logContext,
      error,
      abortReason,
      abortController.signal.aborted,
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

  const persistInterrupted = async (
    errorMessage: string,
    assistantOpenAIItems?: ReadonlyArray<StoredOpenAIReplayItem>,
  ): Promise<ChatWorkerRunResult> => {
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    const finishedAt = new Date();
    await dependencies.persistAssistantTerminalError(params.userId, params.workspaceId, {
      runId: params.runId,
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
      assistantOpenAIItems,
      errorMessage,
      sessionState: "interrupted",
    });
    isFinalized = true;
    logTerminalStatePersisted(
      logContext,
      null,
      abortReason,
      abortController.signal.aborted,
      "interrupted",
      "interrupted",
      stopRequestedByUser,
      ownershipLost,
      startedAt,
      finishedAt,
    );
    return {
      outcome: "interrupted",
      abortReason,
      runStatus: "interrupted",
      sessionState: "interrupted",
    };
  };

  const persistCompleted = async (
    assistantOpenAIItems: ReadonlyArray<import("./openai/replayItems").StoredOpenAIReplayItem>,
  ): Promise<ChatWorkerRunResult> => {
    assistantContent = finalizeAssistantToolCalls(assistantContent);
    const composerSuggestions = await generateTerminalComposerSuggestions(
      params,
      assistantContent,
      logContext,
      dependencies,
    );
    const finishedAt = new Date();
    await dependencies.completeChatRun(params.userId, params.workspaceId, {
      runId: params.runId,
      sessionId: params.sessionId,
      assistantItemId: params.assistantItemId,
      assistantContent,
      assistantOpenAIItems,
      composerSuggestions,
    });
    isFinalized = true;
    logTerminalStatePersisted(
      logContext,
      null,
      null,
      abortController.signal.aborted,
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

  /**
   * The first abort reason wins and becomes the only terminal cause that may
   * drive finalization for the rest of this worker execution.
   */
  const recordAbortRequest = (
    reason: ChatWorkerAbortReason,
    heartbeatAt: Date | null,
    cancellationRequested: boolean,
    ownershipLostState: boolean,
    abortSignal: boolean,
  ): void => {
    if (abortReason !== null) {
      return;
    }

    abortReason = reason;
    if (abortSignal && !abortController.signal.aborted) {
      abortController.abort();
    }
    logAbortRequested(
      logContext,
      reason,
      heartbeatAt,
      cancellationRequested,
      ownershipLostState,
      abortController.signal.aborted,
    );
  };

  const requestHardAbort = (
    reason: Exclude<ChatWorkerAbortReason, "deadline_reached">,
    heartbeatAt: Date | null,
    cancellationRequested: boolean,
    ownershipLostState: boolean,
  ): void => {
    recordAbortRequest(
      reason,
      heartbeatAt,
      cancellationRequested,
      ownershipLostState,
      true,
    );
  };

  const requestSoftDeadlineStop = (): void => {
    if (abortReason !== null) {
      return;
    }

    recordAbortRequest(
      "deadline_reached",
      null,
      false,
      false,
      executionPhase === "model",
    );
  };

  const scheduleSoftDeadlineTimer = (): void => {
    const remainingTimeMs = params.getRemainingTimeInMillis();
    const softDeadlineDelayMs = remainingTimeMs - CHAT_WORKER_PRE_TIMEOUT_BUFFER_MS;
    if (softDeadlineDelayMs <= 0) {
      requestSoftDeadlineStop();
      return;
    }

    softDeadlineTimer = setTimeout(() => {
      requestSoftDeadlineStop();
    }, softDeadlineDelayMs);
  };

  const persistInterruptedIfDeadlineReached = async (): Promise<ChatWorkerRunResult | null> => {
    return abortReason === "deadline_reached"
      ? persistInterrupted(DEADLINE_REACHED_MESSAGE)
      : null;
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
        requestHardAbort(
          "ownership_lost",
          heartbeatAt,
          state.cancellationRequested,
          true,
        );
        return;
      }

      if (state.cancellationRequested) {
        stopRequestedByUser = true;
        requestHardAbort(
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
      requestHardAbort(
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
      requestHardAbort("initial_cancel_state", initialHeartbeatAt, true, false);
      return persistCancelled("initial_cancel_state");
    }

    scheduleSoftDeadlineTimer();
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

        logProviderCallStarted(logContext, new Date(), abortController.signal.aborted);
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
            signal: abortController.signal,
            onExecutionPhaseChanged: (phase): void => {
              executionPhase = phase;
            },
            shouldStopBeforeNextStep: (): boolean => abortReason === "deadline_reached",
          }, async (event): Promise<void> => {
          const shouldIgnoreEvent = stopRequestedByUser
            || ownershipLost
            || (
              abortReason === "deadline_reached"
              && !(executionPhase === "tool" && event.type === "tool_call" && event.status === "completed")
            );
          if (shouldIgnoreEvent) {
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
            runtimeResult = await persistFailed(createProviderTerminalEventError());
          }
          }),
        );

        if (runtimeResult !== null) {
          return;
        }

        if (ownershipLost) {
          throw new ChatRunOwnershipLostError(params.runId);
        }

        if (
          completion.terminationReason === "stopped_before_next_step"
          || abortReason === "deadline_reached"
        ) {
          runtimeResult = await persistInterrupted(
            DEADLINE_REACHED_MESSAGE,
            completion.openaiItems,
          );
          return;
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

      if (abortReason === "deadline_reached") {
        return persistInterrupted(DEADLINE_REACHED_MESSAGE);
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
    if (softDeadlineTimer !== null) {
      clearTimeout(softDeadlineTimer);
    }
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
