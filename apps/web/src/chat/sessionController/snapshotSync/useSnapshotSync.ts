import { useCallback, useEffect, useEffectEvent, useRef, useState, type Dispatch, type MutableRefObject } from "react";
import { BrowserGuestSessionInvalidatedError } from "../../../api/transport/transport";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import {
  getChatSnapshot,
  getChatSnapshotWithResumeDiagnostics,
  getCurrentChatSnapshot,
  getCurrentChatSnapshotWithResumeDiagnostics,
} from "../../../api";
import type { ChatActiveRun, ChatSessionHistoryMessage, ContentPart } from "../../../types";
import { captureChatSnapshotError } from "../support/apiObservation";
import { storeChatConfig } from "../support/config";
import {
  areChatConfigsEqual,
  areMessagesEqual,
  extractAssistantErrorMessage,
  extractLatestAssistantMessageText,
  logChatControllerDebug,
  resolveTerminalErrorCode,
  toAssistantReasoningSummaryContentPart,
  toAssistantToolCallContentPart,
  toErrorMessage,
  type ChatDebugDetails,
} from "../support/helpers";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "../state/state";
import type { ChatSessionSnapshot } from "../state/snapshot";
import type { ChatSessionControllerUiMessages } from "../support/types";
import { useChatLiveSession } from "./useLiveSession";
import { useToolRunPostSync } from "./useToolRunPostSync";
import type { ChatHistoryState } from "../../history/useChatHistory";
import type { ChatLiveEvent } from "../../streaming/liveStream";
import { formatChatRunFailureMessage } from "../../shared/chatOwnOpenAIKeyErrorPolicy";

const assistantMessageDoneTerminalReconcileDelayMs = 5_000;

function formatRunFailureMessage(
  uiMessages: ChatSessionControllerUiMessages,
  errorCode: string | null,
  errorText: string,
): string {
  return formatChatRunFailureMessage(
    uiMessages.ownOpenAIKeyErrorPrefix,
    errorCode,
    uiMessages.localizeChatTerminalError(errorCode, errorText),
  );
}

type UseChatSessionSnapshotSyncParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  controllerId: string;
  workspaceId: string | null;
  accountId: string | null;
  isRemoteReady: boolean;
  shouldRecoverCurrentCatalogChat: boolean;
  uiMessages: ChatSessionControllerUiMessages;
  state: ChatSessionControllerState;
  dispatch: Dispatch<ChatSessionControllerAction>;
  history: ChatHistoryState;
  onToolRunPostSyncRequested: () => Promise<void>;
  initialLastSnapshotUpdatedAt: number | null;
  initialServerSessionId: string | null;
}>;

type SnapshotRequestTrigger =
  | "catalog_hydration"
  | "current_session_recovery"
  | "initial_hydration"
  | "stream_transport_error"
  | "terminal_reconcile"
  | "unexpected_stream_end"
  | "visible_resume";

type ChatSnapshotRequest = (workspaceId: string, signal: AbortSignal) => Promise<ChatSessionSnapshot>;

/** Returns whether the snapshot was applied. */
type ChatSnapshotApplication = (snapshot: ChatSessionSnapshot) => boolean;

type ChatWorkspaceScope = Readonly<{ workspaceId: string | null; accountId: string | null }>;

type CurrentSessionRecovery = Readonly<{
  workspaceId: string;
  sessionId: string;
  requestVersion: number;
}>;

export type ChatSessionSnapshotRuntimeRefs = Readonly<{
  currentWorkspaceIdRef: MutableRefObject<string | null>;
  currentSessionIdRef: MutableRefObject<string | null>;
  runStateRef: MutableRefObject<ChatSessionControllerState["runState"]>;
  activeRunIdRef: MutableRefObject<string | null>;
  messagesRef: MutableRefObject<ChatHistoryState["messages"]>;
  chatConfigRef: MutableRefObject<ChatSessionControllerState["chatConfig"]>;
  lastSnapshotUpdatedAtRef: MutableRefObject<number | null>;
  snapshotRequestVersionRef: MutableRefObject<number>;
  currentSessionRecoveryRef: MutableRefObject<CurrentSessionRecovery | null>;
  liveCursorRef: MutableRefObject<string | null>;
  serverSessionIdRef: MutableRefObject<string | null>;
  composerSendCountRef: MutableRefObject<number>;
}>;

export type ChatSessionSnapshotSync = Readonly<{
  isLiveStreamConnected: boolean;
  isWorkspaceRunReconciled: boolean;
  isRunRecoveryPending: () => boolean;
  hasPendingToolRunPostSync: () => boolean;
  isDocumentVisibleRef: MutableRefObject<boolean>;
  hasActiveLiveConnection: () => boolean;
  detachLiveStream: (sessionId: string | null, runId: string | null) => void;
  invalidatePendingSnapshotRequests: () => void;
  loadAndApplySnapshot: (
    sessionId: string,
    replaceHistory: boolean,
    trigger: SnapshotRequestTrigger,
    resumeAttemptId: number | null,
  ) => Promise<ChatSessionSnapshot | null>;
  loadAndApplyLatestSnapshot: (
    shownSessionId: string | null,
    trigger: SnapshotRequestTrigger,
    resumeAttemptId: number | null,
  ) => Promise<ChatSessionSnapshot | null>;
  canRequestLatestSession: (shownSessionId: string) => boolean;
  applyRecoveredSnapshot: (snapshot: ChatSessionSnapshot) => void;
  resetSnapshotTracking: (updatedAt: number | null) => void;
  restoreToolRunPostSync: (pending: boolean) => void;
  runtimeRefs: ChatSessionSnapshotRuntimeRefs;
  setKnownActiveRunId: (runId: string | null) => void;
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
  reconcileTerminalSnapshot: (sessionId: string | null) => void;
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

export function useChatSessionSnapshotSync(
  params: UseChatSessionSnapshotSyncParams,
): ChatSessionSnapshotSync {
  const {
    indexedDbOpenRecoveryState,
    controllerId,
    workspaceId,
    accountId,
    isRemoteReady,
    shouldRecoverCurrentCatalogChat,
    uiMessages,
    state,
    dispatch,
    history,
    onToolRunPostSyncRequested,
    initialLastSnapshotUpdatedAt,
    initialServerSessionId,
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
  const activeRunIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatHistoryState["messages"]>(messages);
  const chatConfigRef = useRef<ChatSessionControllerState["chatConfig"]>(state.chatConfig);
  const lastSnapshotUpdatedAtRef = useRef<number | null>(initialLastSnapshotUpdatedAt);
  const snapshotRequestVersionRef = useRef<number>(0);
  const currentSessionRecoveryRef = useRef<CurrentSessionRecovery | null>(null);
  const activeSnapshotAbortControllersRef = useRef(new Map<number, AbortController>());
  const [reconciledScope, setReconciledScope] = useState<ChatWorkspaceScope | null>(null);
  const pendingCatalogReconnectScopeRef = useRef<ChatWorkspaceScope | null>(null);
  const [catalogReconnectSettlement, setCatalogReconnectSettlement] = useState(0);
  const isWorkspaceRunReconciled = reconciledScope !== null && reconciledScope.workspaceId === workspaceId
    && reconciledScope.accountId === accountId;
  const visibilityResumePromiseRef = useRef<Promise<void> | null>(null);
  const streamTransportRecoveryPromiseRef = useRef<Promise<void> | null>(null);
  const liveCursorRef = useRef<string | null>(null);
  const serverSessionIdRef = useRef<string | null>(initialServerSessionId);
  const composerSendCountRef = useRef<number>(0);
  const resumeAttemptCounterRef = useRef<number>(0);
  const assistantMessageDoneTerminalReconcileTimerRef = useRef<number | null>(null);
  const reconcileTerminalSnapshotRef = useRef<(sessionId: string | null) => void>(() => {});
  const {
    hasPendingToolRunPostSync,
    markPendingToolRunPostSync,
    markRunHadToolCallsFromSnapshot,
    restoreToolRunPostSync,
    triggerToolRunPostSyncIfNeeded,
  } = useToolRunPostSync({
    indexedDbOpenRecoveryState,
    pendingToolRunPostSync: state.pendingToolRunPostSync,
    dispatch,
    onToolRunPostSyncRequested,
  });

  const runtimeRefs: ChatSessionSnapshotRuntimeRefs = {
    currentWorkspaceIdRef,
    currentSessionIdRef,
    runStateRef,
    activeRunIdRef,
    messagesRef,
    chatConfigRef,
    lastSnapshotUpdatedAtRef,
    snapshotRequestVersionRef,
    currentSessionRecoveryRef,
    liveCursorRef,
    serverSessionIdRef,
    composerSendCountRef,
  };

  currentWorkspaceIdRef.current = workspaceId;
  currentSessionIdRef.current = state.currentSessionId;
  runStateRef.current = state.runState;
  messagesRef.current = messages;
  chatConfigRef.current = state.chatConfig;

  const debugLog = useCallback((event: string, details: ChatDebugDetails): void => {
    logChatControllerDebug(controllerId, event, details);
  }, [controllerId]);

  const setKnownLiveCursor = useCallback((cursor: string | null): void => {
    liveCursorRef.current = cursor;
  }, []);

  const setKnownActiveRunId = useCallback((runId: string | null): void => {
    activeRunIdRef.current = runId;
  }, []);

  const invalidatePendingSnapshotRequests = useCallback((): void => {
    snapshotRequestVersionRef.current += 1;
    currentSessionRecoveryRef.current = null;
  }, []);

  const abortPendingSnapshotRequests = useCallback((): void => {
    for (const controller of activeSnapshotAbortControllersRef.current.values()) {
      controller.abort();
    }
    activeSnapshotAbortControllersRef.current.clear();
  }, []);

  const clearAssistantMessageDoneTerminalReconcileTimer = useCallback((): void => {
    const timerId = assistantMessageDoneTerminalReconcileTimerRef.current;
    if (timerId === null) {
      return;
    }

    window.clearTimeout(timerId);
    assistantMessageDoneTerminalReconcileTimerRef.current = null;
  }, []);

  const scheduleAssistantMessageDoneTerminalReconcile = useCallback((
    sessionId: string,
    runId: string,
  ): void => {
    clearAssistantMessageDoneTerminalReconcileTimer();
    assistantMessageDoneTerminalReconcileTimerRef.current = window.setTimeout((): void => {
      assistantMessageDoneTerminalReconcileTimerRef.current = null;
      if (
        indexedDbOpenRecoveryState.hasFailed()
        || currentSessionIdRef.current !== sessionId
        || runStateRef.current !== "running"
        || activeRunIdRef.current !== runId
      ) {
        return;
      }

      reconcileTerminalSnapshotRef.current(sessionId);
    }, assistantMessageDoneTerminalReconcileDelayMs);
  }, [clearAssistantMessageDoneTerminalReconcileTimer, indexedDbOpenRecoveryState]);

  const resetSnapshotTracking = useCallback((updatedAt: number | null): void => {
    clearAssistantMessageDoneTerminalReconcileTimer();
    lastSnapshotUpdatedAtRef.current = updatedAt;
    activeRunIdRef.current = null;
    liveCursorRef.current = null;
  }, [clearAssistantMessageDoneTerminalReconcileTimer]);

  /**
   * The server's latest chat is its newest unarchived one, so it replaces the shown chat without moving the
   * user backwards only once the shown chat is known to exist there: a chat created here whose `/chat/new`
   * has not answered loses to an older chat. A running turn resumes in its own chat, and a send in flight
   * finishes or recovers in the chat it started from.
   */
  const canRequestLatestSession = useCallback((shownSessionId: string): boolean => {
    return serverSessionIdRef.current === shownSessionId
      && runStateRef.current !== "running"
      && composerSendCountRef.current === 0;
  }, []);

  const nextResumeAttemptId = useCallback((): number => {
    const nextAttemptId = resumeAttemptCounterRef.current + 1;
    resumeAttemptCounterRef.current = nextAttemptId;
    return nextAttemptId;
  }, []);

  const applyLiveEvent = useCallback((event: ChatLiveEvent): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

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
        event.errorCode,
        event.isStopped,
        event.completedAt,
      );
      if (didFinish === false) {
        clearAssistantMessageDoneTerminalReconcileTimer();
        reconcileTerminalSnapshotRef.current(event.sessionId);
        return;
      }

      // The live protocol can finalize the assistant message before the run
      // itself becomes terminal. Keep the run active until run_terminal (or a
      // terminal snapshot recovery path) so post-run sync stays terminal-only.
      scheduleAssistantMessageDoneTerminalReconcile(event.sessionId, event.runId);
      return;
    }

    if (event.type === "composer_suggestions_updated") {
      dispatch({
        type: "snapshot_applied",
        sessionId: state.currentSessionId ?? event.sessionId,
        runState: runStateRef.current,
        activeRunId: activeRunIdRef.current,
        mainContentInvalidationVersion: state.mainContentInvalidationVersion,
        composerSuggestions: event.suggestions,
        chatConfig: chatConfigRef.current,
      });
      return;
    }

    if (event.type === "repair_status") {
      return;
    }

    clearAssistantMessageDoneTerminalReconcileTimer();
    setKnownActiveRunId(null);

    if (event.outcome === "reset_required") {
      reconcileTerminalSnapshotRef.current(event.sessionId);
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
      message: formatRunFailureMessage(
        uiMessages,
        resolveTerminalErrorCode(messagesRef.current, event.message ?? null),
        event.message ?? extractLatestAssistantMessageText(messagesRef.current) ?? uiMessages.genericChatFailed,
      ),
    });
  }, [
    appendAssistantText,
    clearAssistantMessageDoneTerminalReconcileTimer,
    completeAssistantReasoningSummary,
    dispatch,
    finishAssistantMessage,
    indexedDbOpenRecoveryState,
    markPendingToolRunPostSync,
    state.currentSessionId,
    state.mainContentInvalidationVersion,
    scheduleAssistantMessageDoneTerminalReconcile,
    triggerToolRunPostSyncIfNeeded,
    uiMessages,
    setKnownActiveRunId,
    setKnownLiveCursor,
    upsertAssistantReasoningSummary,
    upsertAssistantToolCall,
  ]);

  const hasPendingSnapshotRefresh = useCallback((): boolean => (
    visibilityResumePromiseRef.current !== null
    || activeSnapshotAbortControllersRef.current.has(snapshotRequestVersionRef.current)
  ), []);

  const notifyCatalogReconnectOfSettlement = useCallback((): void => {
    if (pendingCatalogReconnectScopeRef.current !== null && !hasPendingSnapshotRefresh()) {
      setCatalogReconnectSettlement((settlement) => settlement + 1);
    }
  }, [hasPendingSnapshotRefresh]);

  const resumeVisibleChat = useEffectEvent((): void => {
    const currentSessionId = currentSessionIdRef.current;
    const shouldRecoverCatalogSnapshot = shouldRecoverCurrentCatalogChat && !isWorkspaceRunReconciled;
    const canRecoverCatalogSession = shouldRecoverCatalogSnapshot
      && runStateRef.current !== "running" && composerSendCountRef.current === 0;
    const loadSnapshot = canRecoverCatalogSession
      ? (attemptId: number) => loadAndApplyLatestSnapshot(currentSessionId, "catalog_hydration", attemptId)
      : currentSessionId === null ? null : (attemptId: number) => canRequestLatestSession(currentSessionId)
        ? loadAndApplyLatestSnapshot(currentSessionId, "visible_resume", attemptId)
        : loadAndApplySnapshot(currentSessionId, true, "visible_resume", attemptId);

    if (
      loadSnapshot === null
      || indexedDbOpenRecoveryState.hasFailed()
      || isDocumentVisibleRef.current === false
      || workspaceId === null
      || isRemoteReady === false
      || state.isHistoryLoaded === false
      || hasActiveLiveConnection()
      || visibilityResumePromiseRef.current !== null
      || (shouldRecoverCatalogSnapshot && activeSnapshotAbortControllersRef.current.has(snapshotRequestVersionRef.current))
      || (currentSessionRecoveryRef.current?.workspaceId === workspaceId
        && currentSessionRecoveryRef.current.sessionId === currentSessionIdRef.current)
    ) {
      return;
    }

    const resumeAttemptId = nextResumeAttemptId();
    let refreshPromise: Promise<void> | null = null;
    refreshPromise = (async (): Promise<void> => {
      try {
        const snapshot = await loadSnapshot(resumeAttemptId);
        if (
          indexedDbOpenRecoveryState.hasFailed()
          || snapshot === null
          || isDocumentVisibleRef.current === false
        ) {
          return;
        }

        if (shouldRecoverCatalogSnapshot) dispatch({ type: "error_dismissed" });
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
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }

        if (isDocumentVisibleRef.current === false) {
          return;
        }

        detachLiveStream(null, null);
        dispatch({
          type: "run_interrupted",
          message: `${uiMessages.refreshFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
        });
      } finally {
        if (visibilityResumePromiseRef.current === refreshPromise) {
          visibilityResumePromiseRef.current = null;
          notifyCatalogReconnectOfSettlement();
        }
      }
    })();

    visibilityResumePromiseRef.current = refreshPromise;
  });

  const {
    isLiveStreamConnected,
    isDocumentVisibleRef,
    hasActiveLiveConnection,
    startLiveStream,
    detachLiveStream,
  } = useChatLiveSession({
    applyLiveEvent,
    finalizeInterruptedRun: (message) => {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      dispatch({
        type: "run_interrupted",
        message: toErrorMessage(new Error(message), uiMessages.errorFallbacks),
      });
    },
    indexedDbOpenRecoveryState,
    onVisibleResumeRequested: () => resumeVisibleChat(),
    onRecoverableStreamError: (sessionId) => {
      if (indexedDbOpenRecoveryState.hasFailed() || streamTransportRecoveryPromiseRef.current !== null) {
        return;
      }

      const resumeAttemptId = nextResumeAttemptId();
      let recoveryPromise: Promise<void> | null = null;
      recoveryPromise = (async (): Promise<void> => {
        try {
          const snapshot = await loadAndApplySnapshot(
            sessionId,
            true,
            "stream_transport_error",
            resumeAttemptId,
          );
          if (indexedDbOpenRecoveryState.hasFailed() || snapshot === null) {
            return;
          }

          const snapshotErrorMessage = extractAssistantErrorMessage(snapshot.conversation.messages);
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
          if (snapshotErrorMessage !== null) {
            dispatch({
              type: "run_interrupted",
              message: formatRunFailureMessage(
                uiMessages,
                resolveTerminalErrorCode(snapshot.conversation.messages, null),
                snapshotErrorMessage,
              ),
            });
          }
        } catch (error) {
          if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
            return;
          }

          detachLiveStream(null, null);
          dispatch({
            type: "run_interrupted",
            message: `${uiMessages.refreshFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
          });
        } finally {
          if (streamTransportRecoveryPromiseRef.current === recoveryPromise) {
            streamTransportRecoveryPromiseRef.current = null;
          }
        }
      })();

      streamTransportRecoveryPromiseRef.current = recoveryPromise;
    },
    onLiveAttachConnected: () => {
      if (indexedDbOpenRecoveryState.hasFailed() === false) {
        dispatch({ type: "live_attach_connected" });
      }
    },
    onUnexpectedStreamEnd: (sessionId, runId) => {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      clearAssistantMessageDoneTerminalReconcileTimer();
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
          if (indexedDbOpenRecoveryState.hasFailed() || snapshot === null) {
            return;
          }

          const snapshotErrorMessage = extractAssistantErrorMessage(snapshot.conversation.messages);
          if (snapshotErrorMessage !== null) {
            dispatch({
              type: "run_interrupted",
              message: formatRunFailureMessage(
                uiMessages,
                resolveTerminalErrorCode(snapshot.conversation.messages, null),
                snapshotErrorMessage,
              ),
            });
            return;
          }

          if (snapshot.activeRun !== null && snapshot.activeRun.runId === runId) {
            dispatch({
              type: "run_interrupted",
              message: uiMessages.liveStreamEndedBeforeCompletion,
            });
          }
        } catch (error) {
          if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
            return;
          }

          dispatch({
            type: "run_interrupted",
            message: `${uiMessages.refreshFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
          });
        }
      })();
    },
  });

  useEffect(() => {
    if (indexedDbOpenRecoveryState.isFailed === false) {
      return;
    }

    invalidatePendingSnapshotRequests();
    abortPendingSnapshotRequests();
    clearAssistantMessageDoneTerminalReconcileTimer();
    visibilityResumePromiseRef.current = null;
    streamTransportRecoveryPromiseRef.current = null;
    restoreToolRunPostSync(false);
  }, [
    abortPendingSnapshotRequests,
    clearAssistantMessageDoneTerminalReconcileTimer,
    indexedDbOpenRecoveryState.isFailed,
    invalidatePendingSnapshotRequests,
    restoreToolRunPostSync,
  ]);

  const applySnapshot = useCallback((
    snapshot: ChatSessionSnapshot,
    replaceHistory: boolean,
    trigger: SnapshotRequestTrigger,
  ): void => {
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

    setReconciledScope({ workspaceId, accountId });
    serverSessionIdRef.current = snapshot.sessionId;
    setKnownActiveRunId(snapshot.activeRun?.runId ?? null);
    dispatch({
      type: "snapshot_applied",
      sessionId: snapshot.sessionId,
      runState: nextRunState,
      activeRunId: snapshot.activeRun?.runId ?? null,
      mainContentInvalidationVersion: nextMainContentInvalidationVersion,
      composerSuggestions: snapshot.composerSuggestions,
      chatConfig: snapshot.chatConfig,
    });
    setKnownLiveCursor(snapshot.activeRun?.live.cursor ?? null);
    if (shouldUpdateChatConfig) {
      storeChatConfig(snapshot.chatConfig);
    }

    if (nextRunState === "idle") {
      triggerToolRunPostSyncIfNeeded();
    }

    if (shouldReplaceVisibleMessages) {
      messagesRef.current = snapshot.conversation.messages;
      replaceMessages(snapshot.conversation.messages);
    }

    lastSnapshotUpdatedAtRef.current = lastSnapshotUpdatedAtRef.current === null
      ? snapshot.conversation.updatedAt
      : Math.max(lastSnapshotUpdatedAtRef.current, snapshot.conversation.updatedAt);
  }, [
    accountId,
    dispatch,
    markRunHadToolCallsFromSnapshot,
    replaceMessages,
    setKnownActiveRunId,
    setKnownLiveCursor,
    triggerToolRunPostSyncIfNeeded,
    workspaceId,
  ]);

  const applyRecoveredSnapshot = useCallback((snapshot: ChatSessionSnapshot): void => {
    invalidatePendingSnapshotRequests();
    detachLiveStream(null, null);
    resetSnapshotTracking(null);
    // The pending tool sync belongs to the workspace and survives recovery into its latest chat.
    currentSessionIdRef.current = snapshot.sessionId;
    runStateRef.current = toSnapshotRunState(snapshot);
    applySnapshot(snapshot, true, "current_session_recovery");
  }, [applySnapshot, detachLiveStream, invalidatePendingSnapshotRequests, resetSnapshotTracking]);

  const requestAndApplySnapshot = useCallback(async (
    sessionId: string | null,
    replaceHistory: boolean,
    trigger: SnapshotRequestTrigger,
    resumeAttemptId: number | null,
    requestSnapshot: ChatSnapshotRequest,
    applyRequestedSnapshot: ChatSnapshotApplication,
  ): Promise<ChatSessionSnapshot | null> => {
    if (indexedDbOpenRecoveryState.hasFailed() || isRemoteReady === false) {
      return null;
    }

    const currentSessionRecovery = currentSessionRecoveryRef.current;
    if (
      currentSessionRecovery !== null
      && currentSessionRecovery.workspaceId === workspaceId
      && currentSessionRecovery.sessionId === sessionId
      && currentSessionRecovery.requestVersion === snapshotRequestVersionRef.current
    ) {
      return null;
    }

    const requestVersion = snapshotRequestVersionRef.current + 1;
    snapshotRequestVersionRef.current = requestVersion;
    const abortController = new AbortController();
    activeSnapshotAbortControllersRef.current.set(requestVersion, abortController);
    setReconciledScope(null);

    debugLog("snapshot_request_started", {
      workspaceId,
      currentSessionId: sessionId,
      replaceHistory,
      requestVersion,
      trigger,
    });

    try {
      indexedDbOpenRecoveryState.throwIfFailed();
      if (workspaceId === null) {
        throw new Error(uiMessages.workspaceRequired);
      }

      const snapshot = await requestSnapshot(workspaceId, abortController.signal);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (requestVersion !== snapshotRequestVersionRef.current) {
        return null;
      }

      if (applyRequestedSnapshot(snapshot) === false) {
        return null;
      }

      debugLog("snapshot_request_succeeded", {
        workspaceId,
        currentSessionId: snapshot.sessionId,
        replaceHistory,
        requestVersion,
        trigger,
        runState: toSnapshotRunState(snapshot),
        messageCount: snapshot.conversation.messages.length,
        composerSuggestionCount: snapshot.composerSuggestions.length,
      });
      return snapshot;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        invalidatePendingSnapshotRequests();
        clearAssistantMessageDoneTerminalReconcileTimer();
        return null;
      }

      if (requestVersion !== snapshotRequestVersionRef.current || abortController.signal.aborted
        || error instanceof BrowserGuestSessionInvalidatedError) {
        return null;
      }

      debugLog("snapshot_request_failed", {
        workspaceId,
        currentSessionId: sessionId,
        replaceHistory,
        requestVersion,
        trigger,
      });
      captureChatSnapshotError(error, { sessionId, workspaceId, trigger, resumeAttemptId });
      throw error;
    } finally {
      activeSnapshotAbortControllersRef.current.delete(requestVersion);
      notifyCatalogReconnectOfSettlement();
    }
  }, [
    debugLog,
    dispatch,
    clearAssistantMessageDoneTerminalReconcileTimer,
    indexedDbOpenRecoveryState,
    isRemoteReady,
    invalidatePendingSnapshotRequests,
    notifyCatalogReconnectOfSettlement,
    uiMessages,
    workspaceId,
  ]);

  const loadAndApplySnapshot = useCallback((
    sessionId: string,
    replaceHistory: boolean,
    trigger: SnapshotRequestTrigger,
    resumeAttemptId: number | null,
  ): Promise<ChatSessionSnapshot | null> => requestAndApplySnapshot(
    sessionId,
    replaceHistory,
    trigger,
    resumeAttemptId,
    (requestWorkspaceId, signal) => resumeAttemptId === null
      ? getChatSnapshot(sessionId, requestWorkspaceId, signal, accountId)
      : getChatSnapshotWithResumeDiagnostics(sessionId, requestWorkspaceId, { resumeAttemptId }, signal, accountId),
    (snapshot) => {
      applySnapshot(snapshot, replaceHistory, trigger);
      return true;
    },
  ), [accountId, applySnapshot, requestAndApplySnapshot]);

  const loadAndApplyLatestSnapshot = useCallback((
    shownSessionId: string | null,
    trigger: SnapshotRequestTrigger,
    resumeAttemptId: number | null,
  ): Promise<ChatSessionSnapshot | null> => requestAndApplySnapshot(
    shownSessionId,
    true,
    trigger,
    resumeAttemptId,
    async (requestWorkspaceId, signal) => {
      const knownCatalogSessionId = trigger === "catalog_hydration" && serverSessionIdRef.current === shownSessionId
        ? shownSessionId : null;
      const latest = resumeAttemptId === null
        ? await getCurrentChatSnapshot(requestWorkspaceId, signal, accountId)
        : await getCurrentChatSnapshotWithResumeDiagnostics(requestWorkspaceId, { resumeAttemptId }, signal, accountId);
      if (knownCatalogSessionId === null || knownCatalogSessionId === latest.sessionId) return latest;

      // Another device may have created a newer chat while the saved chat still has a running turn.
      signal.throwIfAborted();
      const shown = resumeAttemptId === null
        ? await getChatSnapshot(knownCatalogSessionId, requestWorkspaceId, signal, accountId)
        : await getChatSnapshotWithResumeDiagnostics(knownCatalogSessionId, requestWorkspaceId, { resumeAttemptId }, signal, accountId);
      return shown.activeRun === null ? latest : shown;
    },
    (snapshot) => {
      if (snapshot.sessionId === shownSessionId) {
        applySnapshot(snapshot, true, trigger);
        return true;
      }

      const canRecoverCurrent = trigger === "catalog_hydration"
        ? composerSendCountRef.current === 0 && activeRunIdRef.current === null
        : shownSessionId !== null && canRequestLatestSession(shownSessionId);
      if (currentSessionIdRef.current !== shownSessionId || !canRecoverCurrent) {
        return false;
      }

      applyRecoveredSnapshot(snapshot);
      return true;
    },
  ), [accountId, applyRecoveredSnapshot, applySnapshot, canRequestLatestSession, requestAndApplySnapshot]);

  const startActiveRunLiveStream = useCallback((
    sessionId: string,
    activeRun: ChatActiveRun,
    resumeAttemptId: number | null,
  ): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    setKnownActiveRunId(activeRun.runId);
    startLiveStream(
      sessionId,
      activeRun.runId,
      activeRun.live.stream,
      activeRun.live.cursor,
      resumeAttemptId,
    );
  }, [indexedDbOpenRecoveryState, setKnownActiveRunId, startLiveStream]);

  const startSnapshotLiveStream = useCallback((
    snapshot: ChatSessionSnapshot,
    resumeAttemptId: number | null,
  ): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }
    if (snapshot.activeRun === null) {
      detachLiveStream(snapshot.sessionId, null);
      return;
    }

    startActiveRunLiveStream(snapshot.sessionId, snapshot.activeRun, resumeAttemptId);
  }, [detachLiveStream, indexedDbOpenRecoveryState, startActiveRunLiveStream]);

  const reconcileTerminalSnapshot = useCallback((sessionId: string | null): void => {
    if (
      indexedDbOpenRecoveryState.hasFailed()
      || workspaceId === null
      || isRemoteReady === false
      || sessionId === null
    ) {
      return;
    }

    void (async (): Promise<void> => {
      try {
        const snapshot = await loadAndApplySnapshot(
          sessionId,
          true,
          "terminal_reconcile",
          null,
        );
        if (indexedDbOpenRecoveryState.hasFailed() || snapshot === null) {
          return;
        }

        if (isDocumentVisibleRef.current && snapshot.activeRun !== null) {
          startSnapshotLiveStream(snapshot, null);
          return;
        }

        detachLiveStream(snapshot.sessionId, null);
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }

        detachLiveStream(null, null);
        dispatch({
          type: "run_interrupted",
          message: `${uiMessages.refreshFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
        });
      }
    })();
  }, [
    detachLiveStream,
    dispatch,
    indexedDbOpenRecoveryState,
    isDocumentVisibleRef,
    isRemoteReady,
    loadAndApplySnapshot,
    startSnapshotLiveStream,
    uiMessages,
    workspaceId,
  ]);

  useEffect(() => {
    reconcileTerminalSnapshotRef.current = reconcileTerminalSnapshot;
  }, [reconcileTerminalSnapshot]);

  const resumeCatalogChatAfterReconnect = useEffectEvent((): void => {
    if (!shouldRecoverCurrentCatalogChat || workspaceId === null || !isRemoteReady) return;
    if (!state.isHistoryLoaded || hasPendingSnapshotRefresh()) {
      pendingCatalogReconnectScopeRef.current = { workspaceId, accountId };
      return;
    }
    pendingCatalogReconnectScopeRef.current = null;
    if (!isWorkspaceRunReconciled || hasPendingToolRunPostSync()) resumeVisibleChat();
  });

  useEffect(() => {
    const handleOnline = (): void => resumeCatalogChatAfterReconnect();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  useEffect(() => {
    const pending = pendingCatalogReconnectScopeRef.current;
    if (pending === null) return;
    if (pending.workspaceId !== workspaceId || pending.accountId !== accountId
      || !isRemoteReady || !shouldRecoverCurrentCatalogChat) {
      pendingCatalogReconnectScopeRef.current = null;
      return;
    }
    if (!state.isHistoryLoaded || hasPendingSnapshotRefresh()) return;
    pendingCatalogReconnectScopeRef.current = null;
    if (!isWorkspaceRunReconciled) resumeVisibleChat();
  }, [
    accountId,
    catalogReconnectSettlement,
    hasPendingSnapshotRefresh,
    isRemoteReady,
    isWorkspaceRunReconciled,
    shouldRecoverCurrentCatalogChat,
    state.isHistoryLoaded,
    workspaceId,
  ]);

  useEffect(() => {
    if (isRemoteReady) return;
    setReconciledScope(null);
    invalidatePendingSnapshotRequests();
    abortPendingSnapshotRequests();
    detachLiveStream(null, null);
    clearAssistantMessageDoneTerminalReconcileTimer();
  }, [abortPendingSnapshotRequests, clearAssistantMessageDoneTerminalReconcileTimer, detachLiveStream, invalidatePendingSnapshotRequests, isRemoteReady]);

  useEffect(() => () => {
    invalidatePendingSnapshotRequests();
    abortPendingSnapshotRequests();
    clearAssistantMessageDoneTerminalReconcileTimer();
  }, [abortPendingSnapshotRequests, clearAssistantMessageDoneTerminalReconcileTimer, invalidatePendingSnapshotRequests]);

  function isRunRecoveryPending(): boolean {
    return activeSnapshotAbortControllersRef.current.has(snapshotRequestVersionRef.current)
      || currentSessionRecoveryRef.current !== null || activeRunIdRef.current !== null;
  }

  return {
    isLiveStreamConnected,
    isWorkspaceRunReconciled,
    isRunRecoveryPending,
    hasPendingToolRunPostSync,
    isDocumentVisibleRef,
    hasActiveLiveConnection,
    detachLiveStream,
    invalidatePendingSnapshotRequests,
    loadAndApplySnapshot,
    loadAndApplyLatestSnapshot,
    canRequestLatestSession,
    applyRecoveredSnapshot,
    resetSnapshotTracking,
    restoreToolRunPostSync,
    runtimeRefs,
    setKnownActiveRunId,
    setKnownLiveCursor,
    startActiveRunLiveStream,
    startSnapshotLiveStream,
    reconcileTerminalSnapshot,
    markRunHadToolCallsFromSnapshot,
  };
}
