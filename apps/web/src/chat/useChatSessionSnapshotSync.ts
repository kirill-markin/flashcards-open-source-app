import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject } from "react";
import { getChatSnapshot, getChatSnapshotWithResumeDiagnostics } from "../api";
import { storeChatConfig } from "./chatConfig";
import {
  areChatConfigsEqual,
  areMessagesEqual,
  extractAssistantErrorMessage,
  extractLatestAssistantMessageText,
  logChatControllerDebug,
  toAssistantReasoningSummaryContentPart,
  toAssistantToolCallContentPart,
  toErrorMessage,
  type ChatDebugDetails,
} from "./chatSessionControllerHelpers";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "./chatSessionControllerState";
import type { ChatSessionSnapshot } from "./chatSessionSnapshot";
import type { ChatHistoryState } from "./useChatHistory";
import type { ChatLiveEvent } from "./liveStream";
import { useChatLiveSession } from "./useChatLiveSession";
import type { ChatActiveRun } from "../types";

type UseChatSessionSnapshotSyncParams = Readonly<{
  controllerId: string;
  workspaceId: string | null;
  isRemoteReady: boolean;
  state: ChatSessionControllerState;
  dispatch: Dispatch<ChatSessionControllerAction>;
  history: ChatHistoryState;
  onMainContentInvalidated: (mainContentInvalidationVersion: number) => void;
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
  hasObservedMainContentInvalidationVersionRef: MutableRefObject<boolean>;
  lastMainContentInvalidationVersionRef: MutableRefObject<number>;
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
}>;

function toSnapshotRunState(snapshot: ChatSessionSnapshot): ChatSessionControllerState["runState"] {
  return snapshot.activeRun === null ? "idle" : "running";
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
    onMainContentInvalidated,
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
  const hasObservedMainContentInvalidationVersionRef = useRef<boolean>(false);
  const lastMainContentInvalidationVersionRef = useRef<number>(0);
  const snapshotRequestVersionRef = useRef<number>(0);
  const visibilityResumePromiseRef = useRef<Promise<void> | null>(null);
  const liveCursorRef = useRef<string | null>(null);
  const resumeAttemptCounterRef = useRef<number>(0);
  const reconcileTerminalSnapshotRef = useRef<() => void>(() => {});

  const runtimeRefs: ChatSessionSnapshotRuntimeRefs = {
    currentWorkspaceIdRef,
    currentSessionIdRef,
    runStateRef,
    messagesRef,
    chatConfigRef,
    lastSnapshotUpdatedAtRef,
    hasObservedMainContentInvalidationVersionRef,
    lastMainContentInvalidationVersionRef,
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

  const setKnownLiveCursor = useCallback((cursor: string | null): void => {
    liveCursorRef.current = cursor;
  }, []);

  const invalidatePendingSnapshotRequests = useCallback((): void => {
    snapshotRequestVersionRef.current += 1;
  }, []);

  const resetSnapshotTracking = useCallback((updatedAt: number | null): void => {
    hasObservedMainContentInvalidationVersionRef.current = false;
    lastMainContentInvalidationVersionRef.current = 0;
    lastSnapshotUpdatedAtRef.current = updatedAt;
    liveCursorRef.current = null;
  }, []);

  const nextResumeAttemptId = useCallback((): number => {
    const nextAttemptId = resumeAttemptCounterRef.current + 1;
    resumeAttemptCounterRef.current = nextAttemptId;
    return nextAttemptId;
  }, []);

  const applyLiveEvent = useCallback((event: ChatLiveEvent): void => {
    if (event.type === "assistant_delta") {
      setKnownLiveCursor(event.cursor);
      appendAssistantText(event.text, event.itemId, event.cursor);
      return;
    }

    if (event.type === "assistant_tool_call") {
      setKnownLiveCursor(event.cursor);
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

      if (event.isError) {
        dispatch({
          type: "run_interrupted",
          message: extractLatestAssistantMessageText(messagesRef.current) ?? "AI chat failed.",
        });
        return;
      }

      dispatch({ type: "run_completed" });
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
      dispatch({ type: "run_completed" });
      return;
    }

    dispatch({
      type: "run_interrupted",
      message: event.message ?? extractLatestAssistantMessageText(messagesRef.current) ?? "AI chat failed.",
    });
  }, [
    appendAssistantText,
    completeAssistantReasoningSummary,
    dispatch,
    finishAssistantMessage,
    state.currentSessionId,
    state.mainContentInvalidationVersion,
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

      dispatch({
        type: "snapshot_applied",
        sessionId: snapshot.sessionId,
        runState: nextRunState,
        mainContentInvalidationVersion: nextMainContentInvalidationVersion,
        composerSuggestions: snapshot.composerSuggestions,
        chatConfig: snapshot.chatConfig,
      });
      setKnownLiveCursor(snapshot.activeRun?.live.cursor ?? null);
      if (shouldUpdateChatConfig) {
        storeChatConfig(snapshot.chatConfig);
      }

      if (hasObservedMainContentInvalidationVersionRef.current) {
        if (nextMainContentInvalidationVersion > lastMainContentInvalidationVersionRef.current) {
          onMainContentInvalidated(nextMainContentInvalidationVersion);
        }
      } else {
        hasObservedMainContentInvalidationVersionRef.current = true;
      }
      lastMainContentInvalidationVersionRef.current = nextMainContentInvalidationVersion;

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
  }, [debugLog, dispatch, onMainContentInvalidated, replaceMessages, setKnownLiveCursor, workspaceId]);

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
  };
}
