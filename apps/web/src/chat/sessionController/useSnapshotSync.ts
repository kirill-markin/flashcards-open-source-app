import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from "react";
import { getChatSnapshot, getChatSnapshotWithResumeDiagnostics } from "../../api";
import type { ChatActiveRun, ChatSessionHistoryMessage, ContentPart } from "../../types";
import { storeChatConfig } from "./config";
import {
  areChatConfigsEqual,
  areContentPartsEqual,
  areMessagesEqual,
  extractAssistantErrorMessage,
  extractLatestAssistantMessageText,
  logChatControllerDebug,
  toAssistantReasoningSummaryContentPart,
  toAssistantToolCallContentPart,
  toErrorMessage,
  type ChatDebugDetails,
} from "./helpers";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "./state";
import type { ChatSessionSnapshot } from "./snapshot";
import { useChatLiveSession } from "./useLiveSession";
import type { ChatHistoryState } from "../useChatHistory";
import type { ChatLiveEvent } from "../liveStream";

type UseChatSessionSnapshotSyncParams = Readonly<{
  controllerId: string;
  workspaceId: string | null;
  isRemoteReady: boolean;
  state: ChatSessionControllerState;
  dispatch: Dispatch<ChatSessionControllerAction>;
  history: ChatHistoryState;
  onToolRunPostSyncRequested: () => Promise<void>;
  initialLastSnapshotUpdatedAt: number | null;
}>;

type SnapshotRequestTrigger =
  | "initial_hydration"
  | "terminal_reconcile"
  | "unexpected_stream_end"
  | "visible_resume";

export type ChatSessionSnapshotRuntimeRefs = Readonly<{
  currentWorkspaceIdRef: MutableRefObject<string | null>;
  currentSessionIdRef: MutableRefObject<string | null>;
  runStateRef: MutableRefObject<ChatSessionControllerState["runState"]>;
  messagesRef: MutableRefObject<ChatHistoryState["messages"]>;
  chatConfigRef: MutableRefObject<ChatSessionControllerState["chatConfig"]>;
  lastSnapshotUpdatedAtRef: MutableRefObject<number | null>;
  snapshotRequestVersionRef: MutableRefObject<number>;
  liveCursorRef: MutableRefObject<string | null>;
}>;

export type ChatSessionSnapshotSync = Readonly<{
  isLiveStreamConnected: boolean;
  isDocumentVisibleRef: MutableRefObject<boolean>;
  hasActiveLiveConnection: () => boolean;
  detachLiveStream: (sessionId: string | null, runId: string | null) => void;
  invalidatePendingSnapshotRequests: () => void;
  loadAndApplySnapshot: (
    sessionId: string | undefined,
    replaceHistory: boolean,
    trigger: SnapshotRequestTrigger,
    resumeAttemptId: number | null,
  ) => Promise<ChatSessionSnapshot | null>;
  resetSnapshotTracking: (updatedAt: number | null) => void;
  runtimeRefs: ChatSessionSnapshotRuntimeRefs;
  setKnownLiveCursor: (cursor: string | null) => void;
  startActiveRunLiveStream: (
    sessionId: string,
    activeRun: ChatActiveRun,
    resumeAttemptId: number | null,
  ) => void;
  startSnapshotLiveStream: (
    snapshot: ChatSessionSnapshot,
    resumeAttemptId: number | null,
  ) => void;
  reconcileTerminalSnapshot: () => void;
  markRunHadToolCallsFromSnapshot: (
    activeRun: ChatActiveRun | null,
    messages: ReadonlyArray<ChatSessionHistoryMessage>,
    previousMessages: ReadonlyArray<ChatSessionHistoryMessage> | null,
    currentTurnContent: ReadonlyArray<ContentPart> | null,
  ) => void;
}>;

function toSnapshotRunState(snapshot: ChatSessionSnapshot): ChatSessionControllerState["runState"] {
  return snapshot.activeRun === null ? "idle" : "running";
}

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

export function useChatSessionSnapshotSync(
  params: UseChatSessionSnapshotSyncParams,
): ChatSessionSnapshotSync {
  const {
    controllerId,
    workspaceId,
    isRemoteReady,
    state,
    dispatch,
    history,
    onToolRunPostSyncRequested,
    initialLastSnapshotUpdatedAt,
  } = params;
  const {
    messages,
    replaceMessages,
    appendAssistantText,
    upsertAssistantToolCall,
    upsertAssistantReasoningSummary,
    completeAssistantReasoningSummary,
    finishAssistantMessage,
  } = history;
  const currentWorkspaceIdRef = useRef<string | null>(workspaceId);
  const currentSessionIdRef = useRef<string | null>(state.currentSessionId);
  const runStateRef = useRef<ChatSessionControllerState["runState"]>(state.runState);
  const messagesRef = useRef<ChatHistoryState["messages"]>(messages);
  const chatConfigRef = useRef<ChatSessionControllerState["chatConfig"]>(state.chatConfig);
  const lastSnapshotUpdatedAtRef = useRef<number | null>(initialLastSnapshotUpdatedAt);
  const snapshotRequestVersionRef = useRef<number>(0);
  const visibilityResumePromiseRef = useRef<Promise<void> | null>(null);
  const activeToolRunPostSyncPromiseRef = useRef<Promise<void> | null>(null);
  const liveCursorRef = useRef<string | null>(null);
  const resumeAttemptCounterRef = useRef<number>(0);
  const reconcileTerminalSnapshotRef = useRef<() => void>(() => {});
  const pendingToolRunPostSyncRef = useRef<boolean>(state.pendingToolRunPostSync);

  const runtimeRefs: ChatSessionSnapshotRuntimeRefs = {
    currentWorkspaceIdRef,
    currentSessionIdRef,
    runStateRef,
    messagesRef,
    chatConfigRef,
    lastSnapshotUpdatedAtRef,
    snapshotRequestVersionRef,
    liveCursorRef,
  };

  const debugLog = useCallback((event: string, details: ChatDebugDetails): void => {
    logChatControllerDebug(controllerId, event, details);
  }, [controllerId]);

  useEffect(() => {
    currentWorkspaceIdRef.current = workspaceId;
  }, [workspaceId]);

  useEffect(() => {
    currentSessionIdRef.current = state.currentSessionId;
  }, [state.currentSessionId]);

  useEffect(() => {
    runStateRef.current = state.runState;
  }, [state.runState]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    chatConfigRef.current = state.chatConfig;
  }, [state.chatConfig]);

  useEffect(() => {
    pendingToolRunPostSyncRef.current = state.pendingToolRunPostSync;
  }, [state.pendingToolRunPostSync]);

  const setKnownLiveCursor = useCallback((cursor: string | null): void => {
    liveCursorRef.current = cursor;
  }, []);

  const invalidatePendingSnapshotRequests = useCallback((): void => {
    snapshotRequestVersionRef.current += 1;
  }, []);

  const resetSnapshotTracking = useCallback((updatedAt: number | null): void => {
    lastSnapshotUpdatedAtRef.current = updatedAt;
    liveCursorRef.current = null;
  }, []);

  const nextResumeAttemptId = useCallback((): number => {
    const nextAttemptId = resumeAttemptCounterRef.current + 1;
    resumeAttemptCounterRef.current = nextAttemptId;
    return nextAttemptId;
  }, []);

  const requestToolRunPostSyncIfNeeded = useCallback((): Promise<void> => {
    if (pendingToolRunPostSyncRef.current === false) {
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
        await onToolRunPostSyncRequested();
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
  }, [dispatch, onToolRunPostSyncRequested]);

  const triggerToolRunPostSyncIfNeeded = useCallback((): void => {
    void requestToolRunPostSyncIfNeeded().catch(() => undefined);
  }, [requestToolRunPostSyncIfNeeded]);

  const markPendingToolRunPostSync = useCallback((): void => {
    if (pendingToolRunPostSyncRef.current) {
      return;
    }

    pendingToolRunPostSyncRef.current = true;
    dispatch({ type: "tool_run_post_sync_marked" });
  }, [dispatch]);

  const markRunHadToolCallsFromSnapshot = useCallback((
    activeRun: ChatActiveRun | null,
    nextMessages: ReadonlyArray<ChatSessionHistoryMessage>,
    previousMessages: ReadonlyArray<ChatSessionHistoryMessage> | null,
    currentTurnContent: ReadonlyArray<ContentPart> | null,
  ): void => {
    if (snapshotRunHasToolCalls(
      activeRun,
      nextMessages,
      previousMessages,
      currentTurnContent,
    ) === false) {
      return;
    }

    markPendingToolRunPostSync();
  }, [markPendingToolRunPostSync]);

  const applyLiveEvent = useCallback((event: ChatLiveEvent): void => {
    if (event.type === "assistant_delta") {
      setKnownLiveCursor(event.cursor);
      appendAssistantText(event.text, event.itemId, event.cursor);
      return;
    }

    if (event.type === "assistant_tool_call") {
      setKnownLiveCursor(event.cursor);
      markPendingToolRunPostSync();
      upsertAssistantToolCall(toAssistantToolCallContentPart(event), event.itemId, event.cursor);
      return;
    }

    if (event.type === "assistant_reasoning_started" || event.type === "assistant_reasoning_summary") {
      setKnownLiveCursor(event.cursor);
      upsertAssistantReasoningSummary(
        toAssistantReasoningSummaryContentPart(event),
        event.itemId,
        event.cursor,
      );
      return;
    }

    if (event.type === "assistant_reasoning_done") {
      setKnownLiveCursor(event.cursor);
      completeAssistantReasoningSummary(event.reasoningId, event.itemId, event.cursor);
      return;
    }

    if (event.type === "assistant_message_done") {
      setKnownLiveCursor(event.cursor);
      const didFinish = finishAssistantMessage(
        event.content,
        event.itemId,
        event.cursor,
        event.isError,
        event.isStopped,
      );
      if (didFinish === false) {
        reconcileTerminalSnapshotRef.current();
        return;
      }

      // The live protocol can finalize the assistant message before the run
      // itself becomes terminal. Keep the run active until run_terminal (or a
      // terminal snapshot recovery path) so post-run sync stays terminal-only.
      return;
    }

    if (event.type === "composer_suggestions_updated") {
      dispatch({
        type: "snapshot_applied",
        sessionId: state.currentSessionId ?? event.sessionId,
        runState: runStateRef.current,
        mainContentInvalidationVersion: state.mainContentInvalidationVersion,
        composerSuggestions: event.suggestions,
        chatConfig: chatConfigRef.current,
      });
      return;
    }

    if (event.type === "repair_status") {
      return;
    }

    if (event.outcome === "reset_required") {
      reconcileTerminalSnapshotRef.current();
      return;
    }

    if (event.outcome === "completed" || event.outcome === "stopped") {
      triggerToolRunPostSyncIfNeeded();
      dispatch({ type: "run_completed" });
      return;
    }

    triggerToolRunPostSyncIfNeeded();
    dispatch({
      type: "run_interrupted",
      message: event.message ?? extractLatestAssistantMessageText(messagesRef.current) ?? "AI chat failed.",
    });
  }, [
    appendAssistantText,
    completeAssistantReasoningSummary,
    dispatch,
    finishAssistantMessage,
    markPendingToolRunPostSync,
    state.currentSessionId,
    state.mainContentInvalidationVersion,
    triggerToolRunPostSyncIfNeeded,
    setKnownLiveCursor,
    upsertAssistantReasoningSummary,
    upsertAssistantToolCall,
  ]);

  const {
    isLiveStreamConnected,
    isDocumentVisibleRef,
    hasActiveLiveConnection,
    startLiveStream,
    detachLiveStream,
  } = useChatLiveSession({
    applyLiveEvent,
    finalizeInterruptedRun: (message) => {
      dispatch({
        type: "run_interrupted",
        message: toErrorMessage(new Error(message)),
      });
    },
    onVisibleResumeRequested: () => {
      if (
        isDocumentVisibleRef.current === false
        || workspaceId === null
        || isRemoteReady === false
        || state.isHistoryLoaded === false
        || hasActiveLiveConnection()
        || visibilityResumePromiseRef.current !== null
      ) {
        return;
      }

      const resumeAttemptId = nextResumeAttemptId();
      let refreshPromise: Promise<void> | null = null;
      refreshPromise = (async (): Promise<void> => {
        try {
          const snapshot = await loadAndApplySnapshot(
            currentSessionIdRef.current ?? undefined,
            true,
            "visible_resume",
            resumeAttemptId,
          );
          if (snapshot === null || isDocumentVisibleRef.current === false) {
            return;
          }

          if (snapshot.activeRun !== null) {
            startLiveStream(
              snapshot.sessionId,
              snapshot.activeRun.runId,
              snapshot.activeRun.live.stream,
              snapshot.activeRun.live.cursor,
              resumeAttemptId,
            );
            return;
          }

          detachLiveStream(snapshot.sessionId, null);
        } catch (error) {
          if (isDocumentVisibleRef.current === false) {
            return;
          }

          detachLiveStream(null, null);
          dispatch({
            type: "run_interrupted",
            message: `Chat refresh failed. ${toErrorMessage(error)}`,
          });
        } finally {
          if (visibilityResumePromiseRef.current === refreshPromise) {
            visibilityResumePromiseRef.current = null;
          }
        }
      })();

      visibilityResumePromiseRef.current = refreshPromise;
    },
    onLiveAttachConnected: () => {
      dispatch({ type: "live_attach_connected" });
    },
    onUnexpectedStreamEnd: (sessionId, runId) => {
      dispatch({
        type: "stop_finished",
        runState: runStateRef.current,
      });

      void (async (): Promise<void> => {
        try {
          const snapshot = await loadAndApplySnapshot(
            sessionId,
            true,
            "unexpected_stream_end",
            null,
          );
          if (snapshot === null) {
            return;
          }

          const snapshotErrorMessage = extractAssistantErrorMessage(snapshot.conversation.messages);
          if (snapshotErrorMessage !== null) {
            dispatch({
              type: "run_interrupted",
              message: snapshotErrorMessage,
            });
            return;
          }

          if (snapshot.activeRun !== null && snapshot.activeRun.runId === runId) {
            dispatch({
              type: "run_interrupted",
              message: "AI live stream ended before the run finished.",
            });
          }
        } catch (error) {
          dispatch({
            type: "run_interrupted",
            message: `Chat refresh failed. ${toErrorMessage(error)}`,
          });
        }
      })();
    },
  });

  const loadAndApplySnapshot = useCallback(async (
    sessionId: string | undefined,
    replaceHistory: boolean,
    trigger: SnapshotRequestTrigger,
    resumeAttemptId: number | null,
  ): Promise<ChatSessionSnapshot | null> => {
    const requestVersion = snapshotRequestVersionRef.current + 1;
    snapshotRequestVersionRef.current = requestVersion;

    debugLog("snapshot_request_started", {
      workspaceId,
      currentSessionId: sessionId ?? null,
      replaceHistory,
      requestVersion,
      trigger,
    });

    try {
      const snapshot = resumeAttemptId === null
        ? await getChatSnapshot(sessionId)
        : await getChatSnapshotWithResumeDiagnostics(sessionId, { resumeAttemptId });
      if (requestVersion !== snapshotRequestVersionRef.current) {
        return null;
      }

      const nextRunState = toSnapshotRunState(snapshot);
      const nextMainContentInvalidationVersion = snapshot.conversation.mainContentInvalidationVersion;
      const shouldReplaceVisibleMessages = replaceHistory
        && areMessagesEqual(messagesRef.current, snapshot.conversation.messages) === false;
      const shouldUpdateChatConfig = areChatConfigsEqual(chatConfigRef.current, snapshot.chatConfig) === false;
      const didRunBecomeTerminal = runStateRef.current === "running" && nextRunState === "idle";
      const snapshotBelongsToCurrentRun = snapshot.activeRun !== null
        || didRunBecomeTerminal
        || trigger === "terminal_reconcile";
      if (snapshotBelongsToCurrentRun) {
        markRunHadToolCallsFromSnapshot(
          snapshot.activeRun,
          snapshot.conversation.messages,
          null,
          null,
        );
      }

      dispatch({
        type: "snapshot_applied",
        sessionId: snapshot.sessionId,
        runState: nextRunState,
        // Keep the server invalidation version in controller state for snapshot
        // parity and warm-start persistence even though AI-triggered refreshes
        // now come only from tool-call detection + terminal run completion.
        mainContentInvalidationVersion: nextMainContentInvalidationVersion,
        composerSuggestions: snapshot.composerSuggestions,
        chatConfig: snapshot.chatConfig,
      });
      setKnownLiveCursor(snapshot.activeRun?.live.cursor ?? null);
      if (shouldUpdateChatConfig) {
        storeChatConfig(snapshot.chatConfig);
      }

      if (nextRunState === "idle") {
        // Snapshot recovery is the fallback terminal path for runs that finish
        // outside the happy-path live event flow, and cold-start hydration
        // consumes the same persisted one-shot flag after a reload.
        triggerToolRunPostSyncIfNeeded();
      }

      if (shouldReplaceVisibleMessages) {
        replaceMessages(snapshot.conversation.messages);
      }

      lastSnapshotUpdatedAtRef.current = lastSnapshotUpdatedAtRef.current === null
        ? snapshot.conversation.updatedAt
        : Math.max(lastSnapshotUpdatedAtRef.current, snapshot.conversation.updatedAt);

      debugLog("snapshot_request_succeeded", {
        workspaceId,
        currentSessionId: snapshot.sessionId,
        replaceHistory,
        requestVersion,
        trigger,
        runState: nextRunState,
        messageCount: snapshot.conversation.messages.length,
        composerSuggestionCount: snapshot.composerSuggestions.length,
      });
      return snapshot;
    } catch (error) {
      debugLog("snapshot_request_failed", {
        workspaceId,
        currentSessionId: sessionId ?? null,
        replaceHistory,
        requestVersion,
        trigger,
        message: toErrorMessage(error),
      });
      throw error;
    }
  }, [
    debugLog,
    dispatch,
    markRunHadToolCallsFromSnapshot,
    replaceMessages,
    triggerToolRunPostSyncIfNeeded,
    setKnownLiveCursor,
    workspaceId,
  ]);

  const startActiveRunLiveStream = useCallback((
    sessionId: string,
    activeRun: ChatActiveRun,
    resumeAttemptId: number | null,
  ): void => {
    startLiveStream(
      sessionId,
      activeRun.runId,
      activeRun.live.stream,
      activeRun.live.cursor,
      resumeAttemptId,
    );
  }, [startLiveStream]);

  const startSnapshotLiveStream = useCallback((
    snapshot: ChatSessionSnapshot,
    resumeAttemptId: number | null,
  ): void => {
    if (snapshot.activeRun === null) {
      detachLiveStream(snapshot.sessionId, null);
      return;
    }

    startActiveRunLiveStream(snapshot.sessionId, snapshot.activeRun, resumeAttemptId);
  }, [detachLiveStream, startActiveRunLiveStream]);

  const reconcileTerminalSnapshot = useCallback((): void => {
    if (workspaceId === null || isRemoteReady === false) {
      return;
    }

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadAndApplySnapshot(
          currentSessionIdRef.current ?? undefined,
          true,
          "terminal_reconcile",
          null,
        );
        if (snapshot === null) {
          return;
        }

        if (isDocumentVisibleRef.current && snapshot.activeRun !== null) {
          startSnapshotLiveStream(snapshot, null);
          return;
        }

        detachLiveStream(snapshot.sessionId, null);
      } catch (error) {
        detachLiveStream(null, null);
        dispatch({
          type: "run_interrupted",
          message: `Chat refresh failed. ${toErrorMessage(error)}`,
        });
      }
    })();
  }, [
    detachLiveStream,
    dispatch,
    isDocumentVisibleRef,
    isRemoteReady,
    loadAndApplySnapshot,
    startSnapshotLiveStream,
    workspaceId,
  ]);

  useEffect(() => {
    reconcileTerminalSnapshotRef.current = reconcileTerminalSnapshot;
  }, [reconcileTerminalSnapshot]);

  return {
    isLiveStreamConnected,
    isDocumentVisibleRef,
    hasActiveLiveConnection,
    detachLiveStream,
    invalidatePendingSnapshotRequests,
    loadAndApplySnapshot,
    resetSnapshotTracking,
    runtimeRefs,
    setKnownLiveCursor,
    startActiveRunLiveStream,
    startSnapshotLiveStream,
    reconcileTerminalSnapshot,
    markRunHadToolCallsFromSnapshot,
  };
}
