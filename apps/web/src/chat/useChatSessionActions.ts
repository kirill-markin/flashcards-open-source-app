import { useCallback, useRef, type Dispatch } from "react";
import {
  ApiError,
  createNewChatSession,
  startChatRun,
  stopChatRun,
} from "../api";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "./chatSessionControllerState";
import {
  ATTACHMENT_LIMIT_ERROR_MESSAGE,
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  buildContentParts,
  toRequestBodySizeBytes,
} from "./chatHelpers";
import {
  createClientChatSessionId,
  isChatApiError,
  toErrorMessage,
} from "./chatSessionControllerHelpers";
import type {
  SendChatMessageParams,
  SendChatMessageResult,
} from "./chatSessionControllerTypes";
import { loadStoredChatConfig, storeChatConfig } from "./chatConfig";
import { OPTIMISTIC_ASSISTANT_STATUS_TEXT, type ChatHistoryState } from "./useChatHistory";
import type { ChatSessionSnapshotSync } from "./useChatSessionSnapshotSync";

type UseChatSessionActionsParams = Readonly<{
  workspaceId: string | null;
  isRemoteReady: boolean;
  state: ChatSessionControllerState;
  dispatch: Dispatch<ChatSessionControllerAction>;
  history: ChatHistoryState;
  snapshotSync: ChatSessionSnapshotSync;
}>;

type ChatSessionActions = Readonly<{
  sendMessage: (params: SendChatMessageParams) => Promise<SendChatMessageResult>;
  stopMessage: () => Promise<void>;
  clearConversation: () => Promise<string | null>;
  ensureFreshSession: (sessionId: string) => void;
}>;

export function useChatSessionActions(
  params: UseChatSessionActionsParams,
): ChatSessionActions {
  const {
    workspaceId,
    isRemoteReady,
    state,
    dispatch,
    history,
    snapshotSync,
  } = params;
  const {
    appendUserMessage,
    clearHistory,
    startAssistantMessage,
  } = history;
  const {
    detachLiveStream,
    hasActiveLiveConnection,
    invalidatePendingSnapshotRequests,
    isDocumentVisibleRef,
    markRunHadToolCallsFromSnapshot,
    reconcileTerminalSnapshot,
    resetSnapshotTracking,
    runtimeRefs,
    setKnownLiveCursor,
    startActiveRunLiveStream,
  } = snapshotSync;
  const clearConversationRequestSequenceRef = useRef<number>(0);

  const beginFreshSessionRequestSequence = useCallback((): number => {
    const nextSequence = clearConversationRequestSequenceRef.current + 1;
    clearConversationRequestSequenceRef.current = nextSequence;
    return nextSequence;
  }, []);

  const isFreshSessionEnsureCurrent = useCallback((
    sessionId: string,
    requestSequence: number,
  ): boolean => {
    return clearConversationRequestSequenceRef.current === requestSequence
      && runtimeRefs.currentWorkspaceIdRef.current === workspaceId
      && runtimeRefs.currentSessionIdRef.current === sessionId
      && runtimeRefs.messagesRef.current.length === 0
      && runtimeRefs.runStateRef.current === "idle";
  }, [runtimeRefs, workspaceId]);

  const ensureFreshSession = useCallback((sessionId: string): void => {
    const requestSequence = beginFreshSessionRequestSequence();

    void (async (): Promise<void> => {
      try {
        const response = await createNewChatSession(sessionId);
        if (response.sessionId !== sessionId) {
          return;
        }

        if (isFreshSessionEnsureCurrent(sessionId, requestSequence) === false) {
          return;
        }

        dispatch({
          type: "fresh_session_ready",
          sessionId,
          composerSuggestions: response.composerSuggestions,
          chatConfig: response.chatConfig,
        });
        storeChatConfig(response.chatConfig);
      } catch (error) {
        if (isFreshSessionEnsureCurrent(sessionId, requestSequence)) {
          dispatch({
            type: "error_shown",
            message: `New chat failed. ${toErrorMessage(error)}`,
          });
        }
      }
    })();
  }, [beginFreshSessionRequestSequence, dispatch, isFreshSessionEnsureCurrent]);

  const sendMessage = useCallback(async (
    sendParams: SendChatMessageParams,
  ): Promise<SendChatMessageResult> => {
    if (
      workspaceId === null
      || isRemoteReady === false
      || state.isHistoryLoaded === false
      || state.runState === "running"
      || state.isStopping
    ) {
      return { accepted: false, sessionId: state.currentSessionId };
    }

    const contentParts = buildContentParts(sendParams.text, sendParams.attachments);
    if (contentParts.length === 0) {
      return { accepted: false, sessionId: state.currentSessionId };
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requestBody = {
      sessionId: state.currentSessionId ?? undefined,
      clientRequestId: sendParams.clientRequestId,
      content: contentParts,
      timezone,
    };
    if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      dispatch({
        type: "error_shown",
        message: ATTACHMENT_LIMIT_ERROR_MESSAGE,
      });
      return { accepted: false, sessionId: state.currentSessionId };
    }

    try {
      const response = await startChatRun(requestBody);
      // Accepted responses can already include tool-call content for the
      // current run, whether the snapshot is terminal or still active. The
      // accepted response is compared against the current local history so
      // older server messages do not get mistaken for the new run.
      markRunHadToolCallsFromSnapshot(
        response.activeRun,
        response.conversation.messages,
        runtimeRefs.messagesRef.current,
        contentParts,
      );
      appendUserMessage(contentParts);
      startAssistantMessage(OPTIMISTIC_ASSISTANT_STATUS_TEXT);
      dispatch({
        type: "run_started",
        sessionId: response.sessionId,
        runState: response.activeRun === null ? "idle" : "running",
        composerSuggestions: response.composerSuggestions,
        chatConfig: response.chatConfig,
      });
      storeChatConfig(response.chatConfig);
      setKnownLiveCursor(response.activeRun?.live.cursor ?? null);
      if (response.activeRun === null) {
        reconcileTerminalSnapshot();
      } else if (isDocumentVisibleRef.current) {
        startActiveRunLiveStream(response.sessionId, response.activeRun, null);
      }

      return {
        accepted: true,
        sessionId: response.sessionId,
      };
    } catch (error) {
      if (isChatApiError(error) && error.code === "CHAT_ACTIVE_RUN_IN_PROGRESS") {
        dispatch({
          type: "error_shown",
          message: "A response is already in progress. Wait for it to finish or stop it before sending another message.",
        });
        return { accepted: false, sessionId: state.currentSessionId };
      }

      dispatch({
        type: "error_shown",
        message: `Chat request failed. ${toErrorMessage(error)}`,
      });
      return { accepted: false, sessionId: state.currentSessionId };
    }
  }, [
    appendUserMessage,
    dispatch,
    isDocumentVisibleRef,
    isRemoteReady,
    markRunHadToolCallsFromSnapshot,
    reconcileTerminalSnapshot,
    setKnownLiveCursor,
    startActiveRunLiveStream,
    startAssistantMessage,
    state.currentSessionId,
    state.isHistoryLoaded,
    state.isStopping,
    state.runState,
    workspaceId,
  ]);

  const stopMessage = useCallback(async (): Promise<void> => {
    if (state.currentSessionId === null || state.runState !== "running" || state.isStopping) {
      return;
    }

    dispatch({ type: "stop_requested" });
    try {
      const response = await stopChatRun(state.currentSessionId);
      if (response.stopped && response.stillRunning === false && hasActiveLiveConnection() === false) {
        reconcileTerminalSnapshot();
        dispatch({
          type: "stop_finished",
          runState: "idle",
        });
      }
    } catch (error) {
      dispatch({
        type: "run_interrupted",
        message: `Chat stop failed. ${toErrorMessage(error)}`,
      });
      return;
    }

    if (hasActiveLiveConnection() === false) {
      dispatch({
        type: "stop_finished",
        runState: runtimeRefs.runStateRef.current,
      });
    }
  }, [
    dispatch,
    hasActiveLiveConnection,
    reconcileTerminalSnapshot,
    runtimeRefs.runStateRef,
    state.currentSessionId,
    state.isStopping,
    state.runState,
  ]);

  const clearConversation = useCallback(async (): Promise<string | null> => {
    if (workspaceId === null) {
      detachLiveStream(null, null);
      invalidatePendingSnapshotRequests();
      clearHistory();
      resetSnapshotTracking(null);
      dispatch({ type: "workspace_cleared" });
      return null;
    }

    const nextSessionId = createClientChatSessionId();
    detachLiveStream(null, null);
    invalidatePendingSnapshotRequests();
    clearHistory();
    resetSnapshotTracking(null);
    dispatch({
      type: "fresh_session_requested",
      sessionId: nextSessionId,
      chatConfig: loadStoredChatConfig(),
    });
    ensureFreshSession(nextSessionId);
    return nextSessionId;
  }, [
    clearHistory,
    detachLiveStream,
    dispatch,
    ensureFreshSession,
    invalidatePendingSnapshotRequests,
    resetSnapshotTracking,
    workspaceId,
  ]);

  return {
    sendMessage,
    stopMessage,
    clearConversation,
    ensureFreshSession,
  };
}
