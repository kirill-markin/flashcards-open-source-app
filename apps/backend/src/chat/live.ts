/**
 * SSE live stream handler for the chat surface.
 * Polls the database for in-progress assistant content changes and emits
 * synthetic delta events to connected clients.
 */
import type { Writable } from "node:stream";
import { authenticateRequest, type AuthResult } from "../auth";
import { ensureUserProfile } from "../ensureUser";
import { getErrorLogContext, logCloudRouteEvent } from "../server/logging";
import {
  listChatMessagesAfterCursor,
  listChatMessagesLatest,
  stripBase64FromContentParts,
  type ChatSessionRunState,
  type PersistedChatMessageItem,
} from "./store";
import { diffAssistantContent } from "./liveDiff";
import type { ContentPart, LiveSSEEvent } from "./types";
import { verifyChatLiveAuthorizationHeader } from "./liveAuth";

const LIVE_POLL_INTERVAL_MS = 750;
const KEEPALIVE_INTERVAL_MS = 15_000;
const MAX_CONNECTION_DURATION_MS = 9 * 60 * 1000;

type LiveStreamParams = Readonly<{
  sessionId: string;
  afterCursor: number | undefined;
  userId: string;
  workspaceId: string;
  requestId?: string;
}>;

type LiveDisconnectReason =
  | "close"
  | "finish"
  | "aborted"
  | "stream_error"
  | "write_error";

type LiveConnectionState = Readonly<{
  isClosed: () => boolean;
  closeReason: () => LiveDisconnectReason | null;
  closeError: () => unknown;
  waitForClose: () => Promise<void>;
  dispose: () => void;
}>;

function formatSSEEvent(event: LiveSSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatSSEComment(comment: string): string {
  return `: ${comment}\n\n`;
}

function createLiveConnectionState(stream: Writable): LiveConnectionState {
  let isClosed = false;
  let closeReason: LiveDisconnectReason | null = null;
  let closeError: unknown = null;
  let resolveCloseWaiters: (() => void) | null = null;
  const closePromise = new Promise<void>((resolve) => {
    resolveCloseWaiters = resolve;
  });

  const markClosed = (reason: LiveDisconnectReason, error: unknown): void => {
    if (isClosed) {
      return;
    }

    isClosed = true;
    closeReason = reason;
    closeError = error;
    resolveCloseWaiters?.();
  };

  const handleClose = (): void => {
    markClosed("close", null);
  };
  const handleFinish = (): void => {
    markClosed("finish", null);
  };
  const handleAborted = (): void => {
    markClosed("aborted", null);
  };
  const handleError = (error: unknown): void => {
    markClosed("stream_error", error);
  };

  stream.on("close", handleClose);
  stream.on("finish", handleFinish);
  stream.on("aborted", handleAborted);
  stream.on("error", handleError);

  return {
    isClosed: () => isClosed,
    closeReason: () => closeReason,
    closeError: () => closeError,
    waitForClose: () => closePromise,
    dispose: () => {
      stream.off("close", handleClose);
      stream.off("finish", handleFinish);
      stream.off("aborted", handleAborted);
      stream.off("error", handleError);
    },
  };
}

function isStreamWritable(stream: Writable, connectionState: LiveConnectionState): boolean {
  return connectionState.isClosed() === false
    && stream.destroyed === false
    && stream.writable === true
    && stream.writableEnded === false;
}

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

async function waitForNextPollInterval(
  connectionState: LiveConnectionState,
  intervalMs: number,
): Promise<boolean> {
  const sleepPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, intervalMs);
  });

  return Promise.race([
    sleepPromise,
    connectionState.waitForClose().then(() => false),
  ]);
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
 * Runs the SSE live loop, writing events to the provided writable stream.
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
    // Backlog phase: emit events for items after the client's cursor.
    if (params.afterCursor !== undefined) {
      try {
        const backlogMessages = await listChatMessagesAfterCursor(
          userId,
          workspaceId,
          sessionId,
          params.afterCursor,
        );
        const backlogAssistantMessages = filterAssistantMessages(backlogMessages);
        for (const message of backlogAssistantMessages) {
          if (isStreamWritable(stream, connectionState) === false) {
            terminationReason = "client_disconnect";
            return;
          }
          const event: LiveSSEEvent = {
            type: "assistant_message_done",
            cursor: String(message.itemOrder),
            itemId: message.itemId,
            isError: message.isError,
            isStopped: message.isStopped,
          };
          if (write(formatSSEEvent(event)) === false) {
            terminationReason = "client_disconnect";
            return;
          }
          lastEmittedCursor = message.itemOrder;
        }
      } catch (error) {
        terminationReason = "backlog_reset_required";
        logLiveLifecycleEvent("chat_live_backlog_failed", params, {
          connectionDurationMs: Date.now() - connectionStart,
          ...getErrorLogContext(error),
        }, true);
        write(formatSSEEvent({ type: "reset_required" }));
        return;
      }
    }

    // Live phase: poll the database and emit delta events.
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
              if (write(formatSSEEvent({
                type: "assistant_message_done",
                cursor: String(message.itemOrder),
                itemId: message.itemId,
                isError: message.isError,
                isStopped: message.isStopped,
              })) === false) {
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

/**
 * Parses and validates the SSE live request from a Lambda Function URL event.
 */
export async function handleLiveRequest(
  url: URL,
  authorizationHeader: string | undefined,
): Promise<LiveStreamParams> {
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId === null || sessionId === "") {
    throw new Error("Missing sessionId parameter");
  }

  const afterCursorParam = url.searchParams.get("afterCursor");
  const afterCursor = afterCursorParam !== null
    ? Number.parseInt(afterCursorParam, 10)
    : undefined;
  if (afterCursor !== undefined && (!Number.isSafeInteger(afterCursor) || afterCursor < 0)) {
    throw new Error("Invalid afterCursor parameter");
  }

  const tokenParam = url.searchParams.get("token");
  if (authorizationHeader !== undefined && authorizationHeader.startsWith("Live ")) {
    const verifiedLiveAuth = await verifyChatLiveAuthorizationHeader(authorizationHeader, sessionId);
    return {
      sessionId,
      afterCursor,
      userId: verifiedLiveAuth.userId,
      workspaceId: verifiedLiveAuth.workspaceId,
    };
  }

  const effectiveAuth = authorizationHeader ?? (tokenParam !== null ? `Bearer ${tokenParam}` : undefined);

  const authResult: AuthResult = await authenticateRequest({
    authorizationHeader: effectiveAuth,
    sessionToken: undefined,
  });

  const workspaceId = authResult.transport === "api_key"
    ? authResult.selectedWorkspaceId
    : (await ensureUserProfile(authResult.userId, null)).selectedWorkspaceId;

  if (workspaceId === null) {
    throw new Error("No workspace selected");
  }

  return {
    sessionId,
    afterCursor,
    userId: authResult.userId,
    workspaceId,
  };
}
