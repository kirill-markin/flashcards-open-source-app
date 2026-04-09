import { useCallback, useRef, type Dispatch } from "react";
import {
  createNewChatSession,
  startChatRun,
  stopChatRun,
} from "../../api";
import type { NewChatSessionResponse } from "../../types";
import { loadStoredChatConfig, storeChatConfig } from "./config";
import {
  createClientChatSessionId,
  isChatApiError,
  toErrorMessage,
} from "./helpers";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "./state";
import type {
  SendChatMessageParams,
  SendChatMessageResult,
} from "./types";
import type { ChatSessionSnapshotSync } from "./useSnapshotSync";
import {
  ATTACHMENT_LIMIT_ERROR_MESSAGE,
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  buildContentParts,
  toRequestBodySizeBytes,
} from "../chatHelpers";
import { OPTIMISTIC_ASSISTANT_STATUS_TEXT, type ChatHistoryState } from "../useChatHistory";

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
  ensureRemoteSession: () => Promise<string>;
  ensureRemoteSessionForHydration: () => Promise<string>;
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
  const remoteSessionProvisioningRef = useRef<Readonly<{
    workspaceId: string | null;
    sessionId: string;
    promise: Promise<NewChatSessionResponse>;
  }> | null>(null);

  type RemoteSessionResolution = Readonly<{
    sessionId: string;
    provisionedResponse: NewChatSessionResponse | null;
  }>;

  function createRemoteSessionProvisioningError(message: string): Error {
    return new Error(message);
  }

  function normalizeExistingSessionId(sessionId: string | null): string | null {
    if (sessionId === null) {
      return null;
    }

    const trimmedSessionId = sessionId.trim();
    return trimmedSessionId === "" ? null : trimmedSessionId;
  }

  function getActiveProvisioningState(): Readonly<{
    sessionId: string;
    promise: Promise<NewChatSessionResponse>;
  }> | null {
    const provisioningState = remoteSessionProvisioningRef.current;
    if (provisioningState === null || provisioningState.workspaceId !== workspaceId) {
      return null;
    }

    return {
      sessionId: provisioningState.sessionId,
      promise: provisioningState.promise,
    };
  }

  const provisionRemoteSession = useCallback(async (
    sessionId: string,
  ): Promise<NewChatSessionResponse> => {
    const activeProvisioning = getActiveProvisioningState();
    if (activeProvisioning !== null && activeProvisioning.sessionId === sessionId) {
      return activeProvisioning.promise;
    }

    const nextPromise = createNewChatSession(sessionId);
    remoteSessionProvisioningRef.current = {
      workspaceId,
      sessionId,
      promise: nextPromise,
    };

    try {
      return await nextPromise;
    } finally {
      const currentProvisioning = remoteSessionProvisioningRef.current;
      if (
        currentProvisioning !== null
        && currentProvisioning.workspaceId === workspaceId
        && currentProvisioning.sessionId === sessionId
      ) {
        remoteSessionProvisioningRef.current = null;
      }
    }
  }, [workspaceId]);

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
        const response = await provisionRemoteSession(sessionId);
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
  }, [beginFreshSessionRequestSequence, dispatch, isFreshSessionEnsureCurrent, provisionRemoteSession]);

  const ensureRemoteSession = useCallback(async (): Promise<string> => {
    if (workspaceId === null) {
      throw createRemoteSessionProvisioningError("Select a workspace before using AI chat.");
    }

    if (isRemoteReady === false) {
      throw createRemoteSessionProvisioningError("Remote AI chat is not ready yet.");
    }

    const resolveRemoteSession = async (): Promise<RemoteSessionResolution> => {
      const currentSessionId = normalizeExistingSessionId(runtimeRefs.currentSessionIdRef.current);
      const activeProvisioning = getActiveProvisioningState();

      if (currentSessionId !== null) {
        if (activeProvisioning !== null && activeProvisioning.sessionId === currentSessionId) {
          const response = await activeProvisioning.promise;
          if (response.sessionId !== currentSessionId) {
            throw createRemoteSessionProvisioningError("New chat returned an unexpected session ID.");
          }
        }

        return {
          sessionId: currentSessionId,
          provisionedResponse: null,
        };
      }

      if (activeProvisioning !== null) {
        const response = await activeProvisioning.promise;
        if (response.sessionId !== activeProvisioning.sessionId) {
          throw createRemoteSessionProvisioningError("New chat returned an unexpected session ID.");
        }

        return {
          sessionId: response.sessionId,
          provisionedResponse: response,
        };
      }

      const nextSessionId = createClientChatSessionId();
      const response = await provisionRemoteSession(nextSessionId);
      if (response.sessionId !== nextSessionId) {
        throw createRemoteSessionProvisioningError("New chat returned an unexpected session ID.");
      }

      return {
        sessionId: response.sessionId,
        provisionedResponse: response,
      };
    };

    const resolution = await resolveRemoteSession();
    if (
      resolution.provisionedResponse !== null
      && runtimeRefs.currentWorkspaceIdRef.current === workspaceId
      && runtimeRefs.currentSessionIdRef.current === null
    ) {
      dispatch({
        type: "fresh_session_ready",
        sessionId: resolution.provisionedResponse.sessionId,
        composerSuggestions: resolution.provisionedResponse.composerSuggestions,
        chatConfig: resolution.provisionedResponse.chatConfig,
      });
      storeChatConfig(resolution.provisionedResponse.chatConfig);
    }

    return resolution.sessionId;
  }, [dispatch, isRemoteReady, provisionRemoteSession, runtimeRefs, workspaceId]);

  const ensureRemoteSessionForHydration = useCallback(async (): Promise<string> => {
    if (workspaceId === null) {
      throw createRemoteSessionProvisioningError("Select a workspace before using AI chat.");
    }

    if (isRemoteReady === false) {
      throw createRemoteSessionProvisioningError("Remote AI chat is not ready yet.");
    }

    const currentSessionId = normalizeExistingSessionId(runtimeRefs.currentSessionIdRef.current);
    const activeProvisioning = getActiveProvisioningState();

    if (currentSessionId !== null) {
      if (activeProvisioning !== null && activeProvisioning.sessionId === currentSessionId) {
        const response = await activeProvisioning.promise;
        if (response.sessionId !== currentSessionId) {
          throw createRemoteSessionProvisioningError("New chat returned an unexpected session ID.");
        }
      }

      return currentSessionId;
    }

    if (activeProvisioning !== null) {
      const response = await activeProvisioning.promise;
      if (response.sessionId !== activeProvisioning.sessionId) {
        throw createRemoteSessionProvisioningError("New chat returned an unexpected session ID.");
      }

      return response.sessionId;
    }

    const nextSessionId = createClientChatSessionId();
    const response = await provisionRemoteSession(nextSessionId);
    if (response.sessionId !== nextSessionId) {
      throw createRemoteSessionProvisioningError("New chat returned an unexpected session ID.");
    }

    return response.sessionId;
  }, [isRemoteReady, provisionRemoteSession, runtimeRefs, workspaceId]);

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

    let sessionId: string;
    try {
      sessionId = await ensureRemoteSession();
    } catch (error) {
      dispatch({
        type: "error_shown",
        message: `Chat request failed. ${toErrorMessage(error)}`,
      });
      return { accepted: false, sessionId: state.currentSessionId };
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requestBody = {
      sessionId,
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
    ensureRemoteSession,
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
    ensureRemoteSession,
    ensureRemoteSessionForHydration,
    ensureFreshSession,
  };
}
