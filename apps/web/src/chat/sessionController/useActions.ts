import { useCallback, useRef, type Dispatch } from "react";
import {
  createNewChatSession,
  startChatRun,
  stopChatRun,
} from "../../api";
import type { Locale } from "../../i18n/types";
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
  ChatSessionControllerUiMessages,
  SendChatMessageParams,
  SendChatMessageResult,
} from "./types";
import type { ChatSessionSnapshotSync } from "./useSnapshotSync";
import {
  ATTACHMENT_PAYLOAD_LIMIT_BYTES,
  buildContentParts,
  toRequestBodySizeBytes,
} from "../chatHelpers";
import type { ChatHistoryState } from "../useChatHistory";

type FreshSessionErrorPresentation = "new_chat" | "refresh" | "silent";

type UseChatSessionActionsParams = Readonly<{
  workspaceId: string | null;
  isRemoteReady: boolean;
  uiLocale: Locale;
  uiMessages: ChatSessionControllerUiMessages;
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
  ensureFreshSessionInBackground: (sessionId: string, requestSequence: number) => void;
  ensureFreshSessionWithRefreshError: (sessionId: string, requestSequence: number) => void;
  getFreshSessionRequestSequence: () => number;
}>;

export function useChatSessionActions(
  params: UseChatSessionActionsParams,
): ChatSessionActions {
  const {
    workspaceId,
    isRemoteReady,
    uiLocale,
    uiMessages,
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
  const currentUiLocaleRef = useRef<Locale>(uiLocale);
  currentUiLocaleRef.current = uiLocale;
  const remoteSessionProvisioningRef = useRef<Readonly<{
    workspaceId: string | null;
    sessionId: string;
    uiLocale: Locale;
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
    if (
      provisioningState === null
      || provisioningState.workspaceId !== workspaceId
      || provisioningState.uiLocale !== uiLocale
    ) {
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

    const nextPromise = createNewChatSession(sessionId, uiLocale);
    remoteSessionProvisioningRef.current = {
      workspaceId,
      sessionId,
      uiLocale,
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
        && currentProvisioning.uiLocale === uiLocale
      ) {
        remoteSessionProvisioningRef.current = null;
      }
    }
  }, [uiLocale, workspaceId]);

  const beginFreshSessionRequestSequence = useCallback((): number => {
    const nextSequence = clearConversationRequestSequenceRef.current + 1;
    clearConversationRequestSequenceRef.current = nextSequence;
    return nextSequence;
  }, []);

  const getActiveRequestSequence = useCallback((): number => {
    return clearConversationRequestSequenceRef.current;
  }, []);

  const isRequestSequenceCurrent = useCallback((requestSequence: number): boolean => {
    return clearConversationRequestSequenceRef.current === requestSequence
      && runtimeRefs.currentWorkspaceIdRef.current === workspaceId;
  }, [runtimeRefs, workspaceId]);

  const isFreshSessionEnsureCurrent = useCallback((
    sessionId: string,
    requestSequence: number,
    requestLocale: Locale,
  ): boolean => {
    return clearConversationRequestSequenceRef.current === requestSequence
      && runtimeRefs.currentWorkspaceIdRef.current === workspaceId
      && runtimeRefs.currentSessionIdRef.current === sessionId
      && runtimeRefs.messagesRef.current.length === 0
      && runtimeRefs.runStateRef.current === "idle"
      && currentUiLocaleRef.current === requestLocale;
  }, [runtimeRefs, workspaceId]);

  const ensureFreshSession = useCallback((
    sessionId: string,
    requestSequence: number,
    errorPresentation: FreshSessionErrorPresentation,
  ): void => {
    const requestLocale = uiLocale;
    void (async (): Promise<void> => {
      try {
        const response = await provisionRemoteSession(sessionId);
        if (response.sessionId !== sessionId) {
          return;
        }

        // Locale changes must invalidate earlier /chat/new responses so the
        // empty-session suggestions cannot snap back to an older language.
        if (isFreshSessionEnsureCurrent(sessionId, requestSequence, requestLocale) === false) {
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
        if (isFreshSessionEnsureCurrent(sessionId, requestSequence, requestLocale) === false) {
          return;
        }

        if (errorPresentation === "silent") {
          return;
        }

        const errorPrefix = errorPresentation === "new_chat"
          ? uiMessages.newChatFailedPrefix
          : uiMessages.refreshFailedPrefix;
        dispatch({
          type: "error_shown",
          message: `${errorPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
        });
      }
    })();
  }, [dispatch, isFreshSessionEnsureCurrent, provisionRemoteSession, uiMessages]);

  const ensureFreshSessionInBackground = useCallback((sessionId: string, requestSequence: number): void => {
    ensureFreshSession(sessionId, requestSequence, "silent");
  }, [ensureFreshSession]);

  const ensureFreshSessionWithRefreshError = useCallback((sessionId: string, requestSequence: number): void => {
    ensureFreshSession(sessionId, requestSequence, "refresh");
  }, [ensureFreshSession]);

  const ensureRemoteSession = useCallback(async (): Promise<string> => {
    if (workspaceId === null) {
      throw createRemoteSessionProvisioningError(uiMessages.workspaceRequired);
    }

    if (isRemoteReady === false) {
      throw createRemoteSessionProvisioningError(uiMessages.remoteNotReady);
    }

    const resolveRemoteSession = async (): Promise<RemoteSessionResolution> => {
      const currentSessionId = normalizeExistingSessionId(runtimeRefs.currentSessionIdRef.current);
      const activeProvisioning = getActiveProvisioningState();

      if (currentSessionId !== null) {
        if (activeProvisioning !== null && activeProvisioning.sessionId === currentSessionId) {
          const response = await activeProvisioning.promise;
          if (response.sessionId !== currentSessionId) {
            throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
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
          throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
        }

        return {
          sessionId: response.sessionId,
          provisionedResponse: response,
        };
      }

      const nextSessionId = createClientChatSessionId();
      const response = await provisionRemoteSession(nextSessionId);
      if (response.sessionId !== nextSessionId) {
        throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
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
  }, [dispatch, isRemoteReady, provisionRemoteSession, runtimeRefs, uiMessages, workspaceId]);

  const ensureRemoteSessionForHydration = useCallback(async (): Promise<string> => {
    if (workspaceId === null) {
      throw createRemoteSessionProvisioningError(uiMessages.workspaceRequired);
    }

    if (isRemoteReady === false) {
      throw createRemoteSessionProvisioningError(uiMessages.remoteNotReady);
    }

    const currentSessionId = normalizeExistingSessionId(runtimeRefs.currentSessionIdRef.current);
    const activeProvisioning = getActiveProvisioningState();

    if (currentSessionId !== null) {
      if (activeProvisioning !== null && activeProvisioning.sessionId === currentSessionId) {
        const response = await activeProvisioning.promise;
        if (response.sessionId !== currentSessionId) {
          throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
        }
      }

      return currentSessionId;
    }

    if (activeProvisioning !== null) {
      const response = await activeProvisioning.promise;
      if (response.sessionId !== activeProvisioning.sessionId) {
        throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
      }

      return response.sessionId;
    }

    const nextSessionId = createClientChatSessionId();
    const response = await provisionRemoteSession(nextSessionId);
    if (response.sessionId !== nextSessionId) {
      throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
    }

    return response.sessionId;
  }, [isRemoteReady, provisionRemoteSession, runtimeRefs, uiMessages, workspaceId]);

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

    const requestSequence = getActiveRequestSequence();
    let sessionId: string;
    try {
      sessionId = await ensureRemoteSession();
    } catch (error) {
      if (isRequestSequenceCurrent(requestSequence) === false) {
        return { accepted: false, sessionId: runtimeRefs.currentSessionIdRef.current };
      }

      dispatch({
        type: "error_shown",
        message: `${uiMessages.requestFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
      });
      return { accepted: false, sessionId: state.currentSessionId };
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requestBody = {
      sessionId,
      clientRequestId: sendParams.clientRequestId,
      content: contentParts,
      timezone,
      // Optional on the wire so older backend/client contract phases keep working.
      uiLocale,
    };
    if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
      dispatch({
        type: "error_shown",
        message: uiMessages.attachmentLimit,
      });
      return { accepted: false, sessionId: state.currentSessionId };
    }

    try {
      const response = await startChatRun(requestBody);
      if (isRequestSequenceCurrent(requestSequence) === false) {
        return {
          accepted: false,
          sessionId: runtimeRefs.currentSessionIdRef.current,
        };
      }

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
      startAssistantMessage(null);
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
      if (isRequestSequenceCurrent(requestSequence) === false) {
        return { accepted: false, sessionId: runtimeRefs.currentSessionIdRef.current };
      }

      if (isChatApiError(error) && error.code === "CHAT_ACTIVE_RUN_IN_PROGRESS") {
        dispatch({
          type: "error_shown",
          message: uiMessages.activeRunInProgress,
        });
        return { accepted: false, sessionId: state.currentSessionId };
      }

      dispatch({
        type: "error_shown",
        message: `${uiMessages.requestFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
      });
      return { accepted: false, sessionId: state.currentSessionId };
    }
  }, [
    appendUserMessage,
    dispatch,
    getActiveRequestSequence,
    isDocumentVisibleRef,
    isRemoteReady,
    isRequestSequenceCurrent,
    markRunHadToolCallsFromSnapshot,
    reconcileTerminalSnapshot,
    runtimeRefs,
    setKnownLiveCursor,
    startActiveRunLiveStream,
    startAssistantMessage,
    ensureRemoteSession,
    state.currentSessionId,
    state.isHistoryLoaded,
    state.isStopping,
    state.runState,
    uiMessages,
    workspaceId,
    uiLocale,
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
        message: `${uiMessages.stopFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
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
    uiMessages,
  ]);

  const clearConversation = useCallback(async (): Promise<string | null> => {
    beginFreshSessionRequestSequence();

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
    ensureFreshSession(nextSessionId, clearConversationRequestSequenceRef.current, "new_chat");
    return nextSessionId;
  }, [
    beginFreshSessionRequestSequence,
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
    ensureFreshSessionInBackground,
    ensureFreshSessionWithRefreshError,
    getFreshSessionRequestSequence: getActiveRequestSequence,
  };
}
