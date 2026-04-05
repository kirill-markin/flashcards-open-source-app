/**
 * SSE live stream handler for the chat surface.
 * Snapshot/bootstrap remains the source of truth. The live handler only
 * provides a run-scoped overlay for one known run and always terminates with a
 * single run_terminal event.
 */
import type { Writable } from "node:stream";
import {
  buildConversationScopeId,
  createChatLiveEventSerializer,
  type ChatLiveEventPayload,
} from "./contract";
import type { ChatComposerSuggestion } from "./composerSuggestions";
import { getErrorLogContext, logCloudRouteEvent } from "../server/logging";
import { getChatRunSnapshot, type ChatRunSnapshot } from "./runs";
import {
  getChatSessionSnapshot,
  listChatMessagesAfterCursor,
  listChatMessagesLatest,
  stripBase64FromContentParts,
  type PersistedChatMessageItem,
} from "./store";
import { diffAssistantContent } from "./liveDiff";
import type { LiveStreamParams } from "./liveRequest";
import {
  createLiveConnectionState,
  formatSSEComment,
  formatSSEEvent,
  isStreamWritable,
  waitForNextPollInterval,
} from "./liveTransport";
import type { ContentPart } from "./types";

const LIVE_POLL_INTERVAL_MS = 750;
const KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_CONNECTION_DURATION_MS = 9 * 60 * 1000;

type ChatLiveStreamDependencies = Readonly<{
  getChatSessionSnapshot: typeof getChatSessionSnapshot;
  getChatRunSnapshot: typeof getChatRunSnapshot;
  listChatMessagesAfterCursor: typeof listChatMessagesAfterCursor;
  listChatMessagesLatest: typeof listChatMessagesLatest;
  waitForNextPollInterval: typeof waitForNextPollInterval;
}>;

type AssistantMessageDonePayload = Extract<ChatLiveEventPayload, Readonly<{ type: "assistant_message_done" }>>;
type ComposerSuggestionsUpdatedPayload = Extract<ChatLiveEventPayload, Readonly<{ type: "composer_suggestions_updated" }>>;
type AssistantReasoningDonePayload = Extract<ChatLiveEventPayload, Readonly<{ type: "assistant_reasoning_done" }>>;
type RunTerminalPayload = Extract<ChatLiveEventPayload, Readonly<{ type: "run_terminal" }>>;

type ContentEmissionState = Readonly<{
  lastObservedCursor: number;
  lastDeliveredCursor: number;
  previousAssistantContent: ReadonlyArray<ContentPart>;
  disconnected: boolean;
}>;

type BacklogReplayState = Readonly<{
  lastObservedCursor: number;
  lastDeliveredCursor: number;
  previousAssistantContent: ReadonlyArray<ContentPart>;
  shouldStop: boolean;
  terminationReason: string | null;
}>;

const defaultChatLiveStreamDependencies: ChatLiveStreamDependencies = {
  getChatSessionSnapshot,
  getChatRunSnapshot,
  listChatMessagesAfterCursor,
  listChatMessagesLatest,
  waitForNextPollInterval,
};

function logLiveLifecycleEvent(
  action: string,
  params: LiveStreamParams,
  payload: Record<string, unknown>,
  isError: boolean,
): void {
  logCloudRouteEvent(action, {
    requestId: params.requestId ?? null,
    sessionId: params.sessionId,
    runId: params.runId,
    userId: params.userId,
    workspaceId: params.workspaceId,
    afterCursor: params.afterCursor ?? null,
    resumeAttemptId: params.resumeAttemptId ?? null,
    clientPlatform: params.clientPlatform ?? null,
    clientVersion: params.clientVersion ?? null,
    ...payload,
  }, isError);
}

function cursorOrNull(lastEmittedCursor: number): string | null {
  return lastEmittedCursor > 0 ? String(lastEmittedCursor) : null;
}

function isOpenRunStatus(status: ChatRunSnapshot["status"]): boolean {
  return status === "queued" || status === "running";
}

function findAssistantMessageByItemId(
  messages: ReadonlyArray<PersistedChatMessageItem>,
  assistantItemId: string,
): PersistedChatMessageItem | null {
  return messages.find((message) => message.role === "assistant" && message.itemId === assistantItemId) ?? null;
}

function buildAssistantMessageDonePayload(
  message: PersistedChatMessageItem,
): AssistantMessageDonePayload {
  return {
    type: "assistant_message_done",
    cursor: String(message.itemOrder),
    itemId: message.itemId,
    content: stripBase64FromContentParts(message.content),
    isError: message.isError,
    isStopped: message.isStopped,
  };
}

function buildReasoningDonePayloads(
  previousContent: ReadonlyArray<ContentPart>,
  content: ReadonlyArray<ContentPart>,
  cursor: string,
  itemId: string,
): ReadonlyArray<AssistantReasoningDonePayload> {
  const payloads: AssistantReasoningDonePayload[] = [];

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    if (part?.type !== "reasoning_summary") {
      continue;
    }

    const previousIndex = previousContent.findIndex((previousPart) =>
      previousPart.type === "reasoning_summary"
      && previousPart.streamPosition.itemId === part.streamPosition.itemId,
    );
    const wasAlreadyClosed = previousIndex >= 0
      && previousContent.slice(previousIndex + 1).some((nextPart) =>
        nextPart.type === "text"
        || nextPart.type === "tool_call"
        || nextPart.type === "reasoning_summary",
      );
    if (wasAlreadyClosed) {
      continue;
    }

    payloads.push({
      type: "assistant_reasoning_done",
      reasoningId: part.streamPosition.itemId,
      cursor,
      itemId,
      outputIndex: part.streamPosition.outputIndex,
    });
  }

  return payloads;
}

function mapRunOutcome(run: ChatRunSnapshot): "completed" | "stopped" | "error" {
  switch (run.status) {
    case "completed":
      return "completed";
    case "cancelled":
      return "stopped";
    case "failed":
    case "interrupted":
      return "error";
    case "queued":
    case "running":
      throw new Error(`Run ${run.runId} is not terminal`);
  }
}

function buildRunTerminalPayload(
  run: ChatRunSnapshot,
  lastDeliveredCursor: number,
): RunTerminalPayload {
  const outcome = mapRunOutcome(run);

  return {
    type: "run_terminal",
    cursor: cursorOrNull(lastDeliveredCursor),
    outcome,
    assistantItemId: run.assistantItemId,
    ...(run.lastErrorMessage === null ? {} : { message: run.lastErrorMessage }),
    ...(outcome === "error" ? { isError: true } : {}),
    ...(outcome === "stopped" ? { isStopped: true } : {}),
  };
}

function buildResetRequiredPayload(
  lastDeliveredCursor: number,
  assistantItemId?: string,
): RunTerminalPayload {
  return {
    type: "run_terminal",
    cursor: cursorOrNull(lastDeliveredCursor),
    outcome: "reset_required",
    ...(assistantItemId === undefined ? {} : { assistantItemId }),
  };
}

function buildComposerSuggestionsUpdatedPayload(
  suggestions: ReadonlyArray<ChatComposerSuggestion>,
  lastDeliveredCursor: number,
): ComposerSuggestionsUpdatedPayload {
  return {
    type: "composer_suggestions_updated",
    cursor: cursorOrNull(lastDeliveredCursor),
    suggestions,
  };
}

function hasConflictingAssistantMessage(
  messages: ReadonlyArray<PersistedChatMessageItem>,
  assistantItemId: string,
): boolean {
  return messages.some((message) =>
    message.role === "assistant" && message.itemId !== assistantItemId,
  );
}

function hasConflictingInProgressAssistantMessage(
  messages: ReadonlyArray<PersistedChatMessageItem>,
  assistantItemId: string,
): boolean {
  return messages.some((message) =>
    message.role === "assistant"
    && message.state === "in_progress"
    && message.itemId !== assistantItemId,
  );
}

function emitAssistantMessageEvents(
  message: PersistedChatMessageItem,
  previousAssistantContent: ReadonlyArray<ContentPart>,
  lastDeliveredCursor: number,
  emitPayload: (payload: ChatLiveEventPayload) => boolean,
): ContentEmissionState {
  const strippedContent = stripBase64FromContentParts(message.content);
  const nextObservedCursor = message.itemOrder;
  const deltaEvents = diffAssistantContent(
    previousAssistantContent,
    strippedContent,
    String(message.itemOrder),
    message.itemId,
  );

  for (const event of deltaEvents) {
    if (emitPayload(event) === false) {
      return {
        lastObservedCursor: nextObservedCursor,
        lastDeliveredCursor,
        previousAssistantContent,
        disconnected: true,
      };
    }
  }

  if (message.state === "in_progress") {
    return {
      lastObservedCursor: nextObservedCursor,
      lastDeliveredCursor,
      previousAssistantContent: strippedContent,
      disconnected: false,
    };
  }

  for (const event of buildReasoningDonePayloads(
    previousAssistantContent,
    strippedContent,
    String(message.itemOrder),
    message.itemId,
  )) {
    if (emitPayload(event) === false) {
      return {
        lastObservedCursor: nextObservedCursor,
        lastDeliveredCursor,
        previousAssistantContent,
        disconnected: true,
      };
    }
  }

  if (emitPayload(buildAssistantMessageDonePayload(message)) === false) {
    return {
      lastObservedCursor: nextObservedCursor,
      lastDeliveredCursor,
      previousAssistantContent,
      disconnected: true,
    };
  }

  return {
    lastObservedCursor: nextObservedCursor,
    lastDeliveredCursor: nextObservedCursor,
    previousAssistantContent: [],
    disconnected: false,
  };
}

async function replayBacklogEvents(
  params: LiveStreamParams,
  assistantItemId: string,
  lastObservedCursor: number,
  lastDeliveredCursor: number,
  previousAssistantContent: ReadonlyArray<ContentPart>,
  emitPayload: (payload: ChatLiveEventPayload) => boolean,
  emitTerminal: (payload: RunTerminalPayload) => boolean,
  dependencies: ChatLiveStreamDependencies,
): Promise<BacklogReplayState> {
  if (params.afterCursor === undefined) {
    return {
      lastObservedCursor,
      lastDeliveredCursor,
      previousAssistantContent,
      shouldStop: false,
      terminationReason: null,
    };
  }

  try {
    const backlogMessages = await dependencies.listChatMessagesAfterCursor(
      params.userId,
      params.workspaceId,
      params.sessionId,
      params.afterCursor,
    );
    const inProgressAssistantMessages = backlogMessages.filter((message) =>
      message.role === "assistant" && message.state === "in_progress",
    );
    if (
      inProgressAssistantMessages.length > 1
      || hasConflictingAssistantMessage(backlogMessages, assistantItemId)
    ) {
      emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, assistantItemId));
      return {
        lastObservedCursor,
        lastDeliveredCursor,
        previousAssistantContent,
        shouldStop: true,
        terminationReason: "backlog_reset_required",
      };
    }

    const runMessages = backlogMessages.filter((message) =>
      message.role === "assistant" && message.itemId === assistantItemId,
    );
    let nextObservedCursor = lastObservedCursor;
    let nextDeliveredCursor = lastDeliveredCursor;
    let nextPreviousContent = previousAssistantContent;

    for (const message of runMessages) {
      const emission = emitAssistantMessageEvents(
        message,
        nextPreviousContent,
        nextDeliveredCursor,
        emitPayload,
      );
      nextObservedCursor = emission.lastObservedCursor;
      nextDeliveredCursor = emission.lastDeliveredCursor;
      nextPreviousContent = emission.previousAssistantContent;
      if (emission.disconnected) {
        return {
          lastObservedCursor: nextObservedCursor,
          lastDeliveredCursor: nextDeliveredCursor,
          previousAssistantContent: nextPreviousContent,
          shouldStop: true,
          terminationReason: "client_disconnect",
        };
      }
    }

    return {
      lastObservedCursor: nextObservedCursor,
      lastDeliveredCursor: nextDeliveredCursor,
      previousAssistantContent: nextPreviousContent,
      shouldStop: false,
      terminationReason: null,
    };
  } catch (error) {
    logLiveLifecycleEvent("chat_live_backlog_failed", params, {
      ...getErrorLogContext(error),
    }, true);
    emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, assistantItemId));
    return {
      lastObservedCursor,
      lastDeliveredCursor,
      previousAssistantContent,
      shouldStop: true,
      terminationReason: "backlog_reset_required",
    };
  }
}

/**
 * Runs the live SSE orchestration loop for one attached client.
 */
export async function runLiveStream(
  stream: Writable,
  params: LiveStreamParams,
): Promise<void> {
  return runLiveStreamWithDependencies(stream, params, defaultChatLiveStreamDependencies);
}

export async function runLiveStreamWithDependencies(
  stream: Writable,
  params: LiveStreamParams,
  dependencies: ChatLiveStreamDependencies,
): Promise<void> {
  const connectionState = createLiveConnectionState(stream);
  const serialize = createChatLiveEventSerializer({
    sessionId: params.sessionId,
    conversationScopeId: buildConversationScopeId(params.sessionId),
    runId: params.runId,
    streamEpoch: params.runId,
  });
  const connectionStart = Date.now();
  let lastKeepalive = Date.now();
  let lastObservedCursor = params.afterCursor ?? 0;
  let lastDeliveredCursor = params.afterCursor ?? 0;
  let previousAssistantContent: ReadonlyArray<ContentPart> = [];
  let hasEmittedComposerSuggestions = false;
  let terminationReason = "completed";
  let terminalEventEmitted = false;

  const emit = (data: string): boolean => {
    if (isStreamWritable(stream, connectionState) === false) {
      return false;
    }

    try {
      stream.write(data);
      return true;
    } catch (error) {
      logLiveLifecycleEvent("chat_live_write_failed", params, {
        connectionDurationMs: Date.now() - connectionStart,
        closeReason: "write_error",
        ...getErrorLogContext(error),
      }, true);
      return false;
    }
  };

  const emitPayload = (payload: ChatLiveEventPayload): boolean =>
    emit(formatSSEEvent(serialize(payload)));

  const emitTerminal = (payload: RunTerminalPayload): boolean => {
    if (terminalEventEmitted) {
      return false;
    }

    const didEmit = emitPayload(payload);
    if (didEmit) {
      terminalEventEmitted = true;
    }
    return didEmit;
  };

  try {
    const initialRun = await dependencies.getChatRunSnapshot(
      params.userId,
      params.workspaceId,
      params.runId,
    );
    if (initialRun === null || initialRun.sessionId !== params.sessionId) {
      emitTerminal(buildResetRequiredPayload(lastDeliveredCursor));
      terminationReason = "missing_run";
      return;
    }

    const backlogState = await replayBacklogEvents(
      params,
      initialRun.assistantItemId,
      lastObservedCursor,
      lastDeliveredCursor,
      previousAssistantContent,
      emitPayload,
      emitTerminal,
      dependencies,
    );
    lastObservedCursor = backlogState.lastObservedCursor;
    lastDeliveredCursor = backlogState.lastDeliveredCursor;
    previousAssistantContent = backlogState.previousAssistantContent;
    if (backlogState.shouldStop) {
      terminationReason = backlogState.terminationReason ?? terminationReason;
      return;
    }

    while (isStreamWritable(stream, connectionState)) {
      if (Date.now() - connectionStart >= MAX_CONNECTION_DURATION_MS) {
        emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, initialRun.assistantItemId));
        terminationReason = "max_duration_reset_required";
        break;
      }

      if (Date.now() - lastKeepalive >= KEEPALIVE_INTERVAL_MS) {
        if (emit(formatSSEComment("keepalive")) === false) {
          terminationReason = "client_disconnect";
          break;
        }
        lastKeepalive = Date.now();
      }

      const run = await dependencies.getChatRunSnapshot(
        params.userId,
        params.workspaceId,
        params.runId,
      );
      if (run === null || run.sessionId !== params.sessionId) {
        emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, initialRun.assistantItemId));
        terminationReason = "missing_run";
        break;
      }

      if (isOpenRunStatus(run.status)) {
        const snapshot = await dependencies.getChatSessionSnapshot(
          params.userId,
          params.workspaceId,
          params.sessionId,
        );
        if (snapshot.activeRunId !== params.runId || snapshot.runState !== "running") {
          emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, run.assistantItemId));
          terminationReason = "stale_run_attach";
          break;
        }

        const newMessages = await dependencies.listChatMessagesAfterCursor(
          params.userId,
          params.workspaceId,
          params.sessionId,
          lastObservedCursor,
        );
        if (hasConflictingInProgressAssistantMessage(newMessages, run.assistantItemId)) {
          emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, run.assistantItemId));
          terminationReason = "conflicting_in_progress_item";
          break;
        }

        const runMessages = newMessages.filter((message) =>
          message.role === "assistant" && message.itemId === run.assistantItemId,
        );
        for (const message of runMessages) {
          const emission = emitAssistantMessageEvents(
            message,
            previousAssistantContent,
            lastDeliveredCursor,
            emitPayload,
          );
          previousAssistantContent = emission.previousAssistantContent;
          lastObservedCursor = emission.lastObservedCursor;
          lastDeliveredCursor = emission.lastDeliveredCursor;
          if (emission.disconnected) {
            terminationReason = "client_disconnect";
            break;
          }
        }
        if (terminationReason === "client_disconnect") {
          break;
        }

        if (runMessages.length === 0) {
          const latestMessagesPage = await dependencies.listChatMessagesLatest(
            params.userId,
            params.workspaceId,
            params.sessionId,
            4,
          );
          const inProgressMessage = findAssistantMessageByItemId(
            latestMessagesPage.messages,
            run.assistantItemId,
          );
          if (inProgressMessage !== null && inProgressMessage.state === "in_progress") {
            const emission = emitAssistantMessageEvents(
              inProgressMessage,
              previousAssistantContent,
              lastDeliveredCursor,
              emitPayload,
            );
            previousAssistantContent = emission.previousAssistantContent;
            lastObservedCursor = emission.lastObservedCursor;
            lastDeliveredCursor = emission.lastDeliveredCursor;
            if (emission.disconnected) {
              terminationReason = "client_disconnect";
              break;
            }
          }
        }
      } else {
        const terminalMessages = await dependencies.listChatMessagesAfterCursor(
          params.userId,
          params.workspaceId,
          params.sessionId,
          lastDeliveredCursor,
        );
        if (hasConflictingAssistantMessage(terminalMessages, run.assistantItemId)) {
          emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, run.assistantItemId));
          terminationReason = "terminal_reset_required";
          break;
        }

        const terminalAssistantMessage = terminalMessages.find((message) =>
          message.role === "assistant" && message.itemId === run.assistantItemId,
        ) ?? null;
        if (terminalAssistantMessage !== null) {
          const emission = emitAssistantMessageEvents(
            terminalAssistantMessage,
            previousAssistantContent,
            lastDeliveredCursor,
            emitPayload,
          );
          previousAssistantContent = emission.previousAssistantContent;
          lastObservedCursor = emission.lastObservedCursor;
          lastDeliveredCursor = emission.lastDeliveredCursor;
          if (emission.disconnected) {
            terminationReason = "client_disconnect";
            break;
          }
        } else if (previousAssistantContent.length > 0) {
          emitTerminal(buildResetRequiredPayload(lastDeliveredCursor, run.assistantItemId));
          terminationReason = "terminal_reset_required";
          break;
        }

        if (!hasEmittedComposerSuggestions) {
          const sessionSnapshot = await dependencies.getChatSessionSnapshot(
            params.userId,
            params.workspaceId,
            params.sessionId,
          );
          const composerSuggestions = Array.isArray(sessionSnapshot.composerSuggestions)
            ? sessionSnapshot.composerSuggestions
            : [];
          if (composerSuggestions.length > 0) {
            if (emitPayload(buildComposerSuggestionsUpdatedPayload(
              composerSuggestions,
              lastDeliveredCursor,
            )) === false) {
              terminationReason = "client_disconnect";
              break;
            }
            hasEmittedComposerSuggestions = true;
          }
        }

        emitTerminal(buildRunTerminalPayload(run, lastDeliveredCursor));
        terminationReason = "run_complete";
        break;
      }

      const shouldContinue = await dependencies.waitForNextPollInterval(connectionState, LIVE_POLL_INTERVAL_MS);
      if (shouldContinue === false) {
        terminationReason = "client_disconnect";
        break;
      }
    }
  } catch (error) {
    terminationReason = "poll_error";
    logLiveLifecycleEvent("chat_live_poll_failed", params, {
      connectionDurationMs: Date.now() - connectionStart,
      ...getErrorLogContext(error),
    }, true);
    emitTerminal({
      type: "run_terminal",
      cursor: cursorOrNull(lastDeliveredCursor),
      outcome: "error",
      assistantItemId: undefined,
      message: "Failed to poll session state",
      isError: true,
    });
  } finally {
    const connectionDurationMs = Date.now() - connectionStart;
    const closeReason = connectionState.closeReason();
    const closeError = connectionState.closeError();

    if (isStreamWritable(stream, connectionState)) {
      stream.end();
    }
    connectionState.dispose();

    if (terminationReason === "client_disconnect") {
      logLiveLifecycleEvent("chat_live_client_disconnected", params, {
        connectionDurationMs,
        closeReason,
        ...(closeError === null ? {} : getErrorLogContext(closeError)),
      }, true);
      return;
    }

    logLiveLifecycleEvent("chat_live_stream_closed", params, {
      connectionDurationMs,
      terminationReason,
      closeReason,
      ...(closeError === null ? {} : getErrorLogContext(closeError)),
    }, terminationReason === "poll_error" || terminationReason === "max_duration_reset_required");
  }
}
