/**
 * SSE live stream handler for the chat surface.
 * The chat snapshot/bootstrap response remains the source of truth for full UI
 * state. This loop only provides a temporary live overlay while a run is
 * actively streaming, and clients must resume from snapshot/bootstrap instead
 * of depending on long-lived reconnect semantics.
 */
import type { Writable } from "node:stream";
import { getErrorLogContext, logCloudRouteEvent } from "../server/logging";
import {
  listChatMessagesAfterCursor,
  listChatMessagesLatest,
  stripBase64FromContentParts,
  type ChatSessionRunState,
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
import type { ContentPart, LiveSSEEvent } from "./types";

const LIVE_POLL_INTERVAL_MS = 750;
const KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_CONNECTION_DURATION_MS = 9 * 60 * 1000;

function logLiveLifecycleEvent(
  action: string,
  params: LiveStreamParams,
  payload: Record<string, unknown>,
  isError: boolean,
): void {
  logCloudRouteEvent(action, {
    requestId: params.requestId ?? null,
    sessionId: params.sessionId,
    userId: params.userId,
    workspaceId: params.workspaceId,
    afterCursor: params.afterCursor ?? null,
    ...payload,
  }, isError);
}

/**
 * Finds the in-progress assistant item from a list of messages.
 */
function findInProgressAssistantItem(
  messages: ReadonlyArray<PersistedChatMessageItem>,
): PersistedChatMessageItem | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "assistant" && message.state === "in_progress") {
      return message;
    }
  }
  return null;
}

function findLatestAssistantItem(
  messages: ReadonlyArray<PersistedChatMessageItem>,
): PersistedChatMessageItem | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]!;
    if (message.role === "assistant") {
      return message;
    }
  }
  return null;
}

function filterAssistantMessages(
  messages: ReadonlyArray<PersistedChatMessageItem>,
): ReadonlyArray<PersistedChatMessageItem> {
  return messages.filter((message) => message.role === "assistant");
}

function buildAssistantMessageDoneEvent(
  message: PersistedChatMessageItem,
): Extract<LiveSSEEvent, { type: "assistant_message_done" }> {
  return {
    type: "assistant_message_done",
    cursor: String(message.itemOrder),
    itemId: message.itemId,
    content: stripBase64FromContentParts(message.content),
    isError: message.isError,
    isStopped: message.isStopped,
  };
}

function buildReasoningDoneEvents(
  previousContent: ReadonlyArray<ContentPart>,
  content: ReadonlyArray<ContentPart>,
  cursor: string,
  itemId: string,
): ReadonlyArray<Extract<LiveSSEEvent, { type: "assistant_reasoning_done" }>> {
  const events: Array<Extract<LiveSSEEvent, { type: "assistant_reasoning_done" }>> = [];

  for (let index = 0; index < content.length; index += 1) {
    const part = content[index];
    if (part.type !== "reasoning_summary") {
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

    events.push({
      type: "assistant_reasoning_done",
      reasoningId: part.streamPosition.itemId,
      cursor,
      itemId,
      outputIndex: part.streamPosition.outputIndex,
    });
  }

  return events;
}

/**
 * Replays assistant terminal events after the caller's cursor before the live
 * polling loop starts. Clients use this to bridge the gap between their last
 * snapshot/bootstrap cursor and the moment they reattached the live stream.
 */
async function replayBacklogEvents(
  stream: Writable,
  connectionState: ReturnType<typeof createLiveConnectionState>,
  params: LiveStreamParams,
  write: (data: string) => boolean,
  connectionStart: number,
): Promise<Readonly<{
  lastEmittedCursor: number;
  shouldStop: boolean;
  terminationReason: string | null;
}>> {
  if (params.afterCursor === undefined) {
    return {
      lastEmittedCursor: params.afterCursor ?? 0,
      shouldStop: false,
      terminationReason: null,
    };
  }

  let lastEmittedCursor = params.afterCursor;
  try {
    const backlogMessages = await listChatMessagesAfterCursor(
      params.userId,
      params.workspaceId,
      params.sessionId,
      params.afterCursor,
    );
    const backlogAssistantMessages = filterAssistantMessages(backlogMessages);
    for (const message of backlogAssistantMessages) {
      if (isStreamWritable(stream, connectionState) === false) {
        return {
          lastEmittedCursor,
          shouldStop: true,
          terminationReason: "client_disconnect",
        };
      }
      const event: LiveSSEEvent = buildAssistantMessageDoneEvent(message);
      if (write(formatSSEEvent(event)) === false) {
        return {
          lastEmittedCursor,
          shouldStop: true,
          terminationReason: "client_disconnect",
        };
      }
      lastEmittedCursor = message.itemOrder;
    }

    return {
      lastEmittedCursor,
      shouldStop: false,
      terminationReason: null,
    };
  } catch (error) {
    logLiveLifecycleEvent("chat_live_backlog_failed", params, {
      connectionDurationMs: Date.now() - connectionStart,
      ...getErrorLogContext(error),
    }, true);
    write(formatSSEEvent({ type: "reset_required" }));
    return {
      lastEmittedCursor,
      shouldStop: true,
      terminationReason: "backlog_reset_required",
    };
  }
}

/**
 * Runs the live SSE orchestration loop for one attached client.
 * Attach is only meaningful while a run is actively streaming. Once the run is
 * no longer running, or the client disconnects, the loop closes and leaves
 * recovery to the next snapshot/bootstrap fetch.
 */
export async function runLiveStream(
  stream: Writable,
  params: LiveStreamParams,
): Promise<void> {
  const { sessionId, userId, workspaceId } = params;
  const connectionState = createLiveConnectionState(stream);
  let lastEmittedCursor = params.afterCursor ?? 0;
  let previousAssistantContent: ReadonlyArray<ContentPart> = [];
  let previousAssistantItemId: string | null = null;
  let previousRunState: ChatSessionRunState | null = null;
  let lastObservedRunState: ChatSessionRunState | null = null;
  const connectionStart = Date.now();
  let lastKeepalive = Date.now();
  let shouldEmitInitialRunState = true;
  let terminationReason = "completed";

  const write = (data: string): boolean => {
    if (isStreamWritable(stream, connectionState) === false) {
      return false;
    }

    try {
      stream.write(data);
      return true;
    } catch (error) {
      logLiveLifecycleEvent("chat_live_write_failed", params, {
        lastObservedRunState,
        connectionDurationMs: Date.now() - connectionStart,
        closeReason: "write_error",
        ...getErrorLogContext(error),
      }, true);
      return false;
    }
  };

  try {
    const backlogResult = await replayBacklogEvents(
      stream,
      connectionState,
      params,
      write,
      connectionStart,
    );
    lastEmittedCursor = backlogResult.lastEmittedCursor;
    if (backlogResult.shouldStop) {
      terminationReason = backlogResult.terminationReason ?? terminationReason;
      return;
    }

    // Live phase: poll the database and emit delta events until the run ends.
    while (isStreamWritable(stream, connectionState)) {
      const elapsed = Date.now() - connectionStart;
      if (elapsed >= MAX_CONNECTION_DURATION_MS) {
        terminationReason = "max_duration";
        logLiveLifecycleEvent("chat_live_max_duration_reached", params, {
          connectionDurationMs: elapsed,
          lastObservedRunState,
        }, true);
        break;
      }

      if (Date.now() - lastKeepalive >= KEEPALIVE_INTERVAL_MS) {
        if (write(formatSSEComment("keepalive")) === false) {
          terminationReason = "client_disconnect";
          break;
        }
        lastKeepalive = Date.now();
      }

      try {
        const page = await listChatMessagesLatest(userId, workspaceId, sessionId, 4);
        const latestAssistantMessage = findLatestAssistantItem(page.messages);
        const inProgressAssistantItem = findInProgressAssistantItem(page.messages);
        const currentRunState = inProgressAssistantItem === null
          ? "idle" as const
          : "running" as const;
        lastObservedRunState = currentRunState;

        if (latestAssistantMessage !== null && latestAssistantMessage.itemOrder > lastEmittedCursor) {
          const newMessages = await listChatMessagesAfterCursor(
            userId,
            workspaceId,
            sessionId,
            lastEmittedCursor,
          );
          const assistantMessages = filterAssistantMessages(newMessages);

          for (const message of assistantMessages) {
            if (isStreamWritable(stream, connectionState) === false) {
              terminationReason = "client_disconnect";
              break;
            }

            if (message.state === "in_progress") {
              const nextContent = stripBase64FromContentParts(message.content);
              const prevContent = message.itemId === previousAssistantItemId
                ? previousAssistantContent
                : [];
              const deltaEvents = diffAssistantContent(
                prevContent,
                nextContent,
                String(message.itemOrder),
                message.itemId,
              );
              for (const event of deltaEvents) {
                if (write(formatSSEEvent(event)) === false) {
                  terminationReason = "client_disconnect";
                  break;
                }
              }
              if (terminationReason === "client_disconnect") {
                break;
              }
              previousAssistantContent = nextContent;
              previousAssistantItemId = message.itemId;
            } else {
              if (message.itemId === previousAssistantItemId) {
                const strippedContent = stripBase64FromContentParts(message.content);
                const deltaEvents = diffAssistantContent(
                  previousAssistantContent,
                  strippedContent,
                  String(message.itemOrder),
                  message.itemId,
                );
                for (const event of deltaEvents) {
                  if (write(formatSSEEvent(event)) === false) {
                    terminationReason = "client_disconnect";
                    break;
                  }
                }
                if (terminationReason === "client_disconnect") {
                  break;
                }
                for (const event of buildReasoningDoneEvents(
                  previousAssistantContent,
                  strippedContent,
                  String(message.itemOrder),
                  message.itemId,
                )) {
                  const alreadyEmittedReasoningDone = deltaEvents.some((deltaEvent) => {
                    if (deltaEvent.type !== "assistant_reasoning_done") {
                      return false;
                    }

                    return deltaEvent.reasoningId === event.reasoningId;
                  });
                  if (alreadyEmittedReasoningDone) {
                    continue;
                  }
                  if (write(formatSSEEvent(event)) === false) {
                    terminationReason = "client_disconnect";
                    break;
                  }
                }
                if (terminationReason === "client_disconnect") {
                  break;
                }
              }
              if (write(formatSSEEvent(buildAssistantMessageDoneEvent(message))) === false) {
                terminationReason = "client_disconnect";
                break;
              }
              lastEmittedCursor = message.itemOrder;
              previousAssistantContent = [];
              previousAssistantItemId = null;
            }
          }
        } else if (
          inProgressAssistantItem !== null
          && inProgressAssistantItem.itemId === previousAssistantItemId
        ) {
          const strippedContent = stripBase64FromContentParts(inProgressAssistantItem.content);
          const deltaEvents = diffAssistantContent(
            previousAssistantContent,
            strippedContent,
            String(inProgressAssistantItem.itemOrder),
            inProgressAssistantItem.itemId,
          );
          for (const event of deltaEvents) {
            if (write(formatSSEEvent(event)) === false) {
              terminationReason = "client_disconnect";
              break;
            }
          }
          if (terminationReason === "client_disconnect") {
            break;
          }
          previousAssistantContent = strippedContent;
        }

        if (shouldEmitInitialRunState || (previousRunState !== null && currentRunState !== previousRunState)) {
          if (write(formatSSEEvent({ type: "run_state", runState: currentRunState, sessionId })) === false) {
            terminationReason = "client_disconnect";
            break;
          }
        }
        shouldEmitInitialRunState = false;
        previousRunState = currentRunState;

        if (currentRunState !== "running") {
          terminationReason = "run_complete";
          break;
        }

        const shouldContinue = await waitForNextPollInterval(connectionState, LIVE_POLL_INTERVAL_MS);
        if (shouldContinue === false) {
          terminationReason = "client_disconnect";
          break;
        }
      } catch (error) {
        terminationReason = "poll_error";
        logLiveLifecycleEvent("chat_live_poll_failed", params, {
          connectionDurationMs: Date.now() - connectionStart,
          lastObservedRunState,
          ...getErrorLogContext(error),
        }, true);
        write(formatSSEEvent({ type: "error", message: "Failed to poll session state" }));
        break;
      }
    }
  } finally {
    const connectionDurationMs = Date.now() - connectionStart;
    const closeReason = connectionState.closeReason();
    const closeError = connectionState.closeError();
    connectionState.dispose();

    if (isStreamWritable(stream, connectionState)) {
      stream.end();
    }

    if (terminationReason === "client_disconnect" && lastObservedRunState === "running") {
      logLiveLifecycleEvent("chat_live_client_disconnected_while_running", params, {
        connectionDurationMs,
        lastObservedRunState,
        closeReason,
        ...(closeError === null ? {} : getErrorLogContext(closeError)),
      }, true);
      return;
    }

    logLiveLifecycleEvent("chat_live_stream_closed", params, {
      connectionDurationMs,
      terminationReason,
      lastObservedRunState,
      closeReason,
      ...(closeError === null ? {} : getErrorLogContext(closeError)),
    }, terminationReason === "max_duration" || terminationReason === "poll_error");
  }
}
