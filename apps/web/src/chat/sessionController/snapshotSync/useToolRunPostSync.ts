import { useCallback, useRef, type Dispatch } from "react";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import type { ChatActiveRun, ChatSessionHistoryMessage, ContentPart } from "../../../types";
import { areContentPartsEqual, areMessagesEqual } from "../support/helpers";
import type { ChatSessionControllerAction } from "../state/state";

type UseToolRunPostSyncParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  pendingToolRunPostSync: boolean;
  dispatch: Dispatch<ChatSessionControllerAction>;
  onToolRunPostSyncRequested: () => Promise<void>;
}>;

export type ToolRunPostSync = Readonly<{
  markPendingToolRunPostSync: () => void;
  markRunHadToolCallsFromSnapshot: (
    activeRun: ChatActiveRun | null,
    messages: ReadonlyArray<ChatSessionHistoryMessage>,
    previousMessages: ReadonlyArray<ChatSessionHistoryMessage> | null,
    currentTurnContent: ReadonlyArray<ContentPart> | null,
  ) => void;
  resetToolRunPostSync: () => void;
  triggerToolRunPostSyncIfNeeded: () => void;
}>;

/**
 * Tool-call detection is only safe when it is scoped to the latest run.
 * Inspect assistant messages after the latest user turn so older historical
 * assistant tool calls do not leak into a newer run.
 */
function messageHasToolCalls(message: ChatSessionHistoryMessage): boolean {
  return message.content.some((part) => part.type === "tool_call");
}

function latestRunHasToolCalls(messages: ReadonlyArray<ChatSessionHistoryMessage>): boolean {
  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  for (let index = latestUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role === "assistant" && messageHasToolCalls(message)) {
      return true;
    }
  }

  return false;
}

function trailingAssistantItemHasToolCalls(
  messages: ReadonlyArray<ChatSessionHistoryMessage>,
): boolean {
  const latestMessage = messages[messages.length - 1];
  if (latestMessage?.role !== "assistant") {
    return false;
  }

  const trailingItemId = latestMessage.itemId;
  if (trailingItemId === null) {
    return false;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    if (message.role === "user" || message.itemId !== trailingItemId) {
      return false;
    }

    if (messageHasToolCalls(message)) {
      return true;
    }
  }

  return false;
}

function terminalRunHasToolCalls(messages: ReadonlyArray<ChatSessionHistoryMessage>): boolean {
  const latestMessage = messages[messages.length - 1];

  if (latestRunHasToolCalls(messages)) {
    if (latestMessage?.role === "assistant" && messageHasToolCalls(latestMessage)) {
      return true;
    }
  }

  if (latestMessage?.role === "assistant" && latestMessage.itemId !== null) {
    return trailingAssistantItemHasToolCalls(messages);
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    if (message.role === "user") {
      return false;
    }

    if (messageHasToolCalls(message)) {
      return true;
    }

    if (message.isStopped) {
      return false;
    }
  }

  return false;
}

function resolveAcceptedResponseMessageDelta(
  messages: ReadonlyArray<ChatSessionHistoryMessage>,
  previousMessages: ReadonlyArray<ChatSessionHistoryMessage> | null,
): ReadonlyArray<ChatSessionHistoryMessage> | null {
  if (previousMessages === null) {
    return null;
  }

  if (messages.length <= previousMessages.length) {
    return null;
  }

  const sharedHistory = messages.slice(0, previousMessages.length);
  if (areMessagesEqual(sharedHistory, previousMessages) === false) {
    return null;
  }

  return messages.slice(previousMessages.length);
}

function resolveMessagesAfterCurrentUser(
  messages: ReadonlyArray<ChatSessionHistoryMessage>,
  currentTurnContent: ReadonlyArray<ContentPart>,
): ReadonlyArray<ChatSessionHistoryMessage> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }

    if (areContentPartsEqual(message.content, currentTurnContent)) {
      return messages.slice(index + 1);
    }

    return null;
  }

  return null;
}

function activeRunHasObservedToolCalls(
  messages: ReadonlyArray<ChatSessionHistoryMessage>,
  previousMessages: ReadonlyArray<ChatSessionHistoryMessage> | null,
  currentTurnContent: ReadonlyArray<ContentPart> | null,
): boolean {
  const acceptedResponseDelta = resolveAcceptedResponseMessageDelta(messages, previousMessages);

  if (currentTurnContent !== null) {
    if (acceptedResponseDelta === null) {
      return false;
    }

    const currentRunMessages = resolveMessagesAfterCurrentUser(
      acceptedResponseDelta,
      currentTurnContent,
    );
    if (currentRunMessages !== null) {
      return latestRunHasToolCalls(currentRunMessages);
    }

    const acceptedResponseIncludesUserMessage = acceptedResponseDelta.some((message) => message.role === "user");
    if (acceptedResponseIncludesUserMessage) {
      return false;
    }

    return latestRunHasToolCalls(acceptedResponseDelta);
  }

  return latestRunHasToolCalls(messages);
}

function snapshotRunHasToolCalls(
  activeRun: ChatActiveRun | null,
  messages: ReadonlyArray<ChatSessionHistoryMessage>,
  previousMessages: ReadonlyArray<ChatSessionHistoryMessage> | null,
  currentTurnContent: ReadonlyArray<ContentPart> | null,
): boolean {
  return activeRun === null
    ? terminalRunHasToolCalls(messages)
    : activeRunHasObservedToolCalls(messages, previousMessages, currentTurnContent);
}

/** Owns the one-shot sync lifecycle for tool-backed chat runs. */
export function useToolRunPostSync(
  params: UseToolRunPostSyncParams,
): ToolRunPostSync {
  const {
    indexedDbOpenRecoveryState,
    pendingToolRunPostSync,
    dispatch,
    onToolRunPostSyncRequested,
  } = params;
  const pendingToolRunPostSyncRef = useRef<boolean>(pendingToolRunPostSync);
  const activeToolRunPostSyncPromiseRef = useRef<Promise<void> | null>(null);

  pendingToolRunPostSyncRef.current = pendingToolRunPostSync;

  const requestToolRunPostSyncIfNeeded = useCallback((): Promise<void> => {
    if (indexedDbOpenRecoveryState.hasFailed() || pendingToolRunPostSyncRef.current === false) {
      return Promise.resolve();
    }

    const activePostSyncRequest = activeToolRunPostSyncPromiseRef.current;
    if (activePostSyncRequest !== null) {
      return activePostSyncRequest;
    }

    // Web intentionally follows the same AI sync contract as iOS and Android:
    // one explicit sync after a terminal tool-backed run, with no extra
    // invalidation-driven chat refresh on top of it.
    let postSyncRequestPromise: Promise<void> | null = null;
    postSyncRequestPromise = (async (): Promise<void> => {
      try {
        indexedDbOpenRecoveryState.throwIfFailed();
        await onToolRunPostSyncRequested();
        indexedDbOpenRecoveryState.throwIfFailed();
        pendingToolRunPostSyncRef.current = false;
        dispatch({ type: "tool_run_post_sync_consumed" });
      } finally {
        if (activeToolRunPostSyncPromiseRef.current === postSyncRequestPromise) {
          activeToolRunPostSyncPromiseRef.current = null;
        }
      }
    })();

    activeToolRunPostSyncPromiseRef.current = postSyncRequestPromise;
    return postSyncRequestPromise;
  }, [dispatch, indexedDbOpenRecoveryState, onToolRunPostSyncRequested]);

  const triggerToolRunPostSyncIfNeeded = useCallback((): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    void requestToolRunPostSyncIfNeeded().catch(() => undefined);
  }, [indexedDbOpenRecoveryState, requestToolRunPostSyncIfNeeded]);

  const markPendingToolRunPostSync = useCallback((): void => {
    if (indexedDbOpenRecoveryState.hasFailed() || pendingToolRunPostSyncRef.current) {
      return;
    }

    pendingToolRunPostSyncRef.current = true;
    dispatch({ type: "tool_run_post_sync_marked" });
  }, [dispatch, indexedDbOpenRecoveryState]);

  const markRunHadToolCallsFromSnapshot = useCallback((
    activeRun: ChatActiveRun | null,
    messages: ReadonlyArray<ChatSessionHistoryMessage>,
    previousMessages: ReadonlyArray<ChatSessionHistoryMessage> | null,
    currentTurnContent: ReadonlyArray<ContentPart> | null,
  ): void => {
    if (snapshotRunHasToolCalls(
      activeRun,
      messages,
      previousMessages,
      currentTurnContent,
    ) === false) {
      return;
    }

    markPendingToolRunPostSync();
  }, [markPendingToolRunPostSync]);

  const resetToolRunPostSync = useCallback((): void => {
    pendingToolRunPostSyncRef.current = false;
    activeToolRunPostSyncPromiseRef.current = null;
  }, []);

  return {
    markPendingToolRunPostSync,
    markRunHadToolCallsFromSnapshot,
    resetToolRunPostSync,
    triggerToolRunPostSyncIfNeeded,
  };
}
