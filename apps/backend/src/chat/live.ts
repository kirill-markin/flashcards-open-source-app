/**
 * SSE live stream handler for the chat surface.
 * Polls the database for in-progress assistant content changes and emits
 * synthetic delta events to connected clients.
 */
import type { Writable } from "node:stream";
import { authenticateRequest, type AuthResult } from "../auth";
import { ensureUserProfile } from "../ensureUser";
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
const IDLE_GRACE_PERIOD_MS = 30_000;
const IDLE_POLL_INTERVAL_MS = 5_000;

type LiveStreamParams = Readonly<{
  sessionId: string;
  afterCursor: number | undefined;
  userId: string;
  workspaceId: string;
}>;

function formatSSEEvent(event: LiveSSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatSSEComment(comment: string): string {
  return `: ${comment}\n\n`;
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
  let lastEmittedCursor = params.afterCursor ?? 0;
  let previousAssistantContent: ReadonlyArray<ContentPart> = [];
  let previousAssistantItemId: string | null = null;
  let previousRunState: ChatSessionRunState | null = null;
  let idleSince: number | null = null;
  const connectionStart = Date.now();
  let lastKeepalive = Date.now();
  let shouldEmitInitialRunState = true;

  const write = (data: string): boolean => {
    if (stream.destroyed) {
      return false;
    }
    return stream.write(data);
  };

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
        if (stream.destroyed) {
          return;
        }
        const event: LiveSSEEvent = {
          type: "assistant_message_done",
          cursor: String(message.itemOrder),
          itemId: message.itemId,
          isError: message.isError,
          isStopped: message.isStopped,
        };
        write(formatSSEEvent(event));
        lastEmittedCursor = message.itemOrder;
      }
    } catch {
      write(formatSSEEvent({ type: "reset_required" }));
      stream.end();
      return;
    }
  }

  // Live phase: poll the database and emit delta events.
  while (!stream.destroyed) {
    const elapsed = Date.now() - connectionStart;
    if (elapsed >= MAX_CONNECTION_DURATION_MS) {
      break;
    }

    // Keepalive
    if (Date.now() - lastKeepalive >= KEEPALIVE_INTERVAL_MS) {
      write(formatSSEComment("keepalive"));
      lastKeepalive = Date.now();
    }

    try {
      const page = await listChatMessagesLatest(userId, workspaceId, sessionId, 4);
      const latestAssistantMessage = findLatestAssistantItem(page.messages);
      const inProgressAssistantItem = findInProgressAssistantItem(page.messages);
      const currentRunState = inProgressAssistantItem === null
        ? "idle" as const
        : "running" as const;

      // Check for new completed messages beyond our cursor.
      if (latestAssistantMessage !== null && latestAssistantMessage.itemOrder > lastEmittedCursor) {
        const newMessages = await listChatMessagesAfterCursor(
          userId,
          workspaceId,
          sessionId,
          lastEmittedCursor,
        );
        const assistantMessages = filterAssistantMessages(newMessages);

        for (const message of assistantMessages) {
          if (stream.destroyed) {
            return;
          }

          if (message.state === "in_progress") {
            // Diff in-progress content
            const prevContent = message.itemId === previousAssistantItemId
              ? previousAssistantContent
              : [];
            const deltaEvents = diffAssistantContent(
              prevContent,
              stripBase64FromContentParts(message.content),
              String(message.itemOrder),
              message.itemId,
            );
            for (const event of deltaEvents) {
              write(formatSSEEvent(event));
            }
            previousAssistantContent = stripBase64FromContentParts(message.content);
            previousAssistantItemId = message.itemId;
          } else {
            // Completed/error/cancelled message
            if (message.itemId === previousAssistantItemId) {
              const strippedContent = stripBase64FromContentParts(message.content);
              const deltaEvents = diffAssistantContent(
                previousAssistantContent,
                strippedContent,
                String(message.itemOrder),
                message.itemId,
              );
              for (const event of deltaEvents) {
                write(formatSSEEvent(event));
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
                write(formatSSEEvent(event));
              }
            }
            write(formatSSEEvent({
              type: "assistant_message_done",
              cursor: String(message.itemOrder),
              itemId: message.itemId,
              isError: message.isError,
              isStopped: message.isStopped,
            }));
            lastEmittedCursor = message.itemOrder;
            previousAssistantContent = [];
            previousAssistantItemId = null;
          }
        }
      } else if (
        inProgressAssistantItem !== null
        && inProgressAssistantItem.itemId === previousAssistantItemId
      ) {
        // Same in-progress item, check for content changes.
        const strippedContent = stripBase64FromContentParts(inProgressAssistantItem.content);
        const deltaEvents = diffAssistantContent(
          previousAssistantContent,
          strippedContent,
          String(inProgressAssistantItem.itemOrder),
          inProgressAssistantItem.itemId,
        );
        for (const event of deltaEvents) {
          write(formatSSEEvent(event));
        }
        previousAssistantContent = strippedContent;
      }

      // Emit run_state changes.
      if (shouldEmitInitialRunState || (previousRunState !== null && currentRunState !== previousRunState)) {
        write(formatSSEEvent({ type: "run_state", runState: currentRunState, sessionId }));
      }
      shouldEmitInitialRunState = false;
      previousRunState = currentRunState;

      // Idle tracking for reduced polling frequency.
      if (currentRunState === "idle") {
        if (idleSince === null) {
          idleSince = Date.now();
        }
      } else {
        idleSince = null;
      }
    } catch {
      write(formatSSEEvent({ type: "error", message: "Failed to poll session state" }));
    }

    const pollInterval = idleSince !== null && Date.now() - idleSince > IDLE_GRACE_PERIOD_MS
      ? IDLE_POLL_INTERVAL_MS
      : LIVE_POLL_INTERVAL_MS;
    await new Promise<void>((resolve) => setTimeout(resolve, pollInterval));
  }

  if (!stream.destroyed) {
    stream.end();
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
