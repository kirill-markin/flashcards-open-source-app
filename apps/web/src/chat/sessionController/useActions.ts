import { useCallback, useRef, type Dispatch } from "react";
import {
  ApiContractError,
  ApiError,
  AuthRedirectError,
  createNewChatSession,
  startChatRun,
  stopChatRun,
} from "../../api";
import {
  captureWebException,
  normalizeCaughtError,
  type ChatRunRequestFailureDetails,
  type WebObservationScope,
} from "../../observability/webObservability";
import type { Locale } from "../../i18n/types";
import type {
  NewChatSessionResponse,
  StartChatRunRequestBody,
  StartChatRunResponse,
} from "../../types";
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
} from "../shared/chatHelpers";
import { binaryPendingAttachmentExceedsSizeLimit } from "../attachments/FileAttachment";
import {
  isAiChatAttachmentUnsupportedTypeError,
  isAiChatRequestTooLargeError,
} from "../shared/chatSizePolicy";
import type { ChatHistoryState } from "../history/useChatHistory";

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

type ChatApiObservationMetadata = Readonly<{
  requestId: string | null;
  statusCode: number | null;
  code: string | null;
}>;

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getChatApiObservationMetadata(error: Error): ChatApiObservationMetadata {
  if (error instanceof ApiError || error instanceof ApiContractError) {
    return {
      requestId: error.requestId,
      statusCode: error.statusCode,
      code: error.code,
    };
  }

  return {
    requestId: null,
    statusCode: null,
    code: null,
  };
}

function buildChatRequestScope(workspaceId: string | null, error: Error): WebObservationScope {
  const metadata = getChatApiObservationMetadata(error);
  return {
    app: "web",
    feature: "chat",
    userId: null,
    workspaceId,
    installationId: null,
    route: getCurrentRoute(),
    requestId: metadata.requestId,
    statusCode: metadata.statusCode,
    code: metadata.code,
  };
}

function isExpectedChatProductErrorCode(code: string | null): boolean {
  switch (code) {
    case "ACCOUNT_DELETED":
    case "AI_CHAT_V2_HUMAN_AUTH_REQUIRED":
    case "AUTH_UNAUTHORIZED":
    case "CHAT_ACTIVE_RUN_IN_PROGRESS":
    case "CHAT_ATTACHMENT_UNSUPPORTED_TYPE":
    case "CHAT_REQUEST_TOO_LARGE":
    case "CHAT_SESSION_ID_CONFLICT":
    case "GUEST_AUTH_INVALID":
    case "WORKSPACE_NOT_FOUND":
    case "WORKSPACE_SELECTION_REQUIRED":
      return true;
  }

  return false;
}

function isExpectedChatValidationError(error: ApiError): boolean {
  return error.statusCode === 400
    && error.code === null
    && error.responseBodyKind === "json";
}

function shouldCaptureChatRunRequestError(error: Error): boolean {
  if (error instanceof ApiContractError) {
    return true;
  }

  if (error instanceof AuthRedirectError) {
    return false;
  }

  if (error instanceof ApiError) {
    if (error.statusCode >= 500) {
      return true;
    }

    if (isAiChatRequestTooLargeError({
      statusCode: error.statusCode,
      code: error.code,
    })) {
      return false;
    }

    if (isExpectedChatProductErrorCode(error.code)) {
      return false;
    }

    if (error.statusCode === 401) {
      return false;
    }

    if (isExpectedChatValidationError(error)) {
      return false;
    }

    if (error.statusCode >= 400 && error.statusCode < 500) {
      return true;
    }
  }

  return true;
}

function isChatSessionIdConflictError(error: unknown): boolean {
  return isChatApiError(error) && error.code === "CHAT_SESSION_ID_CONFLICT";
}

function captureChatRunRequestError(
  caughtError: unknown,
  workspaceId: string | null,
  details: ChatRunRequestFailureDetails,
): void {
  const error = normalizeCaughtError(caughtError);
  if (shouldCaptureChatRunRequestError(error) === false) {
    return;
  }

  const scope = buildChatRequestScope(workspaceId, error);
  if (error instanceof ApiContractError) {
    captureWebException({
      action: "api_contract_failed",
      error,
      scope,
      details: {
        endpoint: error.endpoint,
        fieldPath: error.fieldPath,
        expected: error.expected,
        sourceAction: details.operation,
      },
    });
    return;
  }

  captureWebException({
    action: "chat_run_request_failed",
    error,
    scope,
    details,
  });
}

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
    replaceMessages,
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
    setKnownActiveRunId,
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

  type SessionConflictRecovery =
    | Readonly<{ status: "not_recoverable" }>
    | Readonly<{ status: "recovered"; session: NewChatSessionResponse }>
    | Readonly<{ status: "stale" }>;

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
    if (workspaceId === null) {
      throw createRemoteSessionProvisioningError(uiMessages.workspaceRequired);
    }

    const activeProvisioning = getActiveProvisioningState();
    if (activeProvisioning !== null && activeProvisioning.sessionId === sessionId) {
      return activeProvisioning.promise;
    }

    const nextPromise = createNewChatSession(sessionId, workspaceId, uiLocale);
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

  const canRecoverFromSessionIdConflict = useCallback((
    requestSequence: number,
    sourceSessionId: string | null,
  ): boolean => {
    if (
      workspaceId === null
      || isRequestSequenceCurrent(requestSequence) === false
      || runtimeRefs.currentSessionIdRef.current !== sourceSessionId
    ) {
      return false;
    }

    return runtimeRefs.messagesRef.current.length === 0
      && runtimeRefs.runStateRef.current === "idle";
  }, [isRequestSequenceCurrent, runtimeRefs, workspaceId]);

  const recoverFromSessionIdConflict = useCallback(async (
    requestSequence: number,
    sourceSessionId: string | null,
  ): Promise<SessionConflictRecovery> => {
    if (isRequestSequenceCurrent(requestSequence) === false) {
      return { status: "stale" };
    }

    if (canRecoverFromSessionIdConflict(requestSequence, sourceSessionId) === false) {
      return { status: "not_recoverable" };
    }

    invalidatePendingSnapshotRequests();
    resetSnapshotTracking(null);
    const nextSessionId = createClientChatSessionId();
    remoteSessionProvisioningRef.current = null;
    const response = await provisionRemoteSession(nextSessionId);
    if (response.sessionId !== nextSessionId) {
      throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
    }

    if (
      isRequestSequenceCurrent(requestSequence) === false
      || canRecoverFromSessionIdConflict(requestSequence, sourceSessionId) === false
    ) {
      return { status: "stale" };
    }

    return {
      status: "recovered",
      session: response,
    };
  }, [
    canRecoverFromSessionIdConflict,
    invalidatePendingSnapshotRequests,
    isRequestSequenceCurrent,
    provisionRemoteSession,
    resetSnapshotTracking,
    uiMessages,
  ]);

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

        captureChatRunRequestError(error, workspaceId, {
          operation: "chat_fresh_session_failed",
          sessionId,
          workspaceId,
        });

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
  }, [dispatch, isFreshSessionEnsureCurrent, provisionRemoteSession, uiMessages, workspaceId]);

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
    const createRejectedSendResult = (sessionId: string | null): SendChatMessageResult => ({
      status: "rejected",
      accepted: false,
      sessionId,
    });

    if (
      workspaceId === null
      || isRemoteReady === false
      || state.isHistoryLoaded === false
      || state.runState === "running"
      || state.isStopping
    ) {
      return createRejectedSendResult(state.currentSessionId);
    }

    const contentParts = buildContentParts(sendParams.text, sendParams.attachments);
    if (contentParts.length === 0) {
      return createRejectedSendResult(state.currentSessionId);
    }

    if (sendParams.attachments.some(binaryPendingAttachmentExceedsSizeLimit)) {
      dispatch({
        type: "error_shown",
        message: uiMessages.attachmentLimit,
      });
      return createRejectedSendResult(state.currentSessionId);
    }

    const requestSequence = getActiveRequestSequence();
    const sourceSessionId = runtimeRefs.currentSessionIdRef.current;

    const finishStaleRequest = (): SendChatMessageResult => ({
      status: "stale",
      accepted: false,
      sessionId: runtimeRefs.currentSessionIdRef.current,
    });

    const failRemoteSessionRequest = (error: unknown): SendChatMessageResult => {
      captureChatRunRequestError(error, workspaceId, {
        operation: "chat_remote_session_failed",
        sessionId: runtimeRefs.currentSessionIdRef.current,
        workspaceId,
      });
      dispatch({
        type: "error_shown",
        message: `${uiMessages.requestFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
      });
      return createRejectedSendResult(state.currentSessionId);
    };

    let preparedDraftSessionId: string | null = sourceSessionId;
    const prepareDraftTargetSession = (targetSessionId: string): boolean => {
      if (isRequestSequenceCurrent(requestSequence) === false) {
        return false;
      }

      if (preparedDraftSessionId === targetSessionId) {
        return true;
      }

      sendParams.onSessionDraftTargetReady(targetSessionId);
      preparedDraftSessionId = targetSessionId;
      return true;
    };

    const activateRecoveredSession = (session: NewChatSessionResponse): boolean => {
      if (prepareDraftTargetSession(session.sessionId) === false) {
        return false;
      }

      invalidatePendingSnapshotRequests();
      resetSnapshotTracking(null);
      runtimeRefs.messagesRef.current = [];
      clearHistory();
      dispatch({
        type: "fresh_session_ready",
        sessionId: session.sessionId,
        composerSuggestions: session.composerSuggestions,
        chatConfig: session.chatConfig,
      });
      storeChatConfig(session.chatConfig);
      return true;
    };

    const recoverAndActivateSession = async (): Promise<SessionConflictRecovery> => {
      const recovery = await recoverFromSessionIdConflict(requestSequence, sourceSessionId);
      if (recovery.status === "recovered" && activateRecoveredSession(recovery.session) === false) {
        return { status: "stale" };
      }

      return recovery;
    };

    let sessionId: string | null = null;
    let didRecoverSessionIdConflict = false;

    try {
      sessionId = await ensureRemoteSession();
      if (prepareDraftTargetSession(sessionId) === false) {
        return finishStaleRequest();
      }
    } catch (error) {
      if (isRequestSequenceCurrent(requestSequence) === false) {
        return finishStaleRequest();
      }

      if (isChatSessionIdConflictError(error)) {
        try {
          const recovery = await recoverAndActivateSession();
          if (recovery.status === "recovered") {
            didRecoverSessionIdConflict = true;
            sessionId = recovery.session.sessionId;
          } else if (recovery.status === "stale") {
            return finishStaleRequest();
          }
        } catch (recoveryError) {
          if (isRequestSequenceCurrent(requestSequence) === false) {
            return finishStaleRequest();
          }

          return failRemoteSessionRequest(recoveryError);
        }
      }

      if (isChatSessionIdConflictError(error) === false || didRecoverSessionIdConflict === false) {
        return failRemoteSessionRequest(error);
      }
    }

    if (sessionId === null) {
      return failRemoteSessionRequest(createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId));
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const createStartRunRequestBody = (requestSessionId: string): StartChatRunRequestBody => ({
      sessionId: requestSessionId,
      workspaceId,
      clientRequestId: sendParams.clientRequestId,
      content: contentParts,
      timezone,
      // Optional on the wire so older backend/client contract phases keep working.
      uiLocale,
    });

    const startRunForSession = async (requestSessionId: string): Promise<StartChatRunResponse | null> => {
      const requestBody = createStartRunRequestBody(requestSessionId);
      if (toRequestBodySizeBytes(requestBody) > ATTACHMENT_PAYLOAD_LIMIT_BYTES) {
        dispatch({
          type: "error_shown",
          message: uiMessages.attachmentLimit,
        });
        return null;
      }

      return startChatRun(requestBody);
    };

    const failStartRunRequest = (
      error: unknown,
      requestSessionId: string,
      resultSessionId: string | null,
    ): SendChatMessageResult => {
      if (isChatApiError(error) && error.code === "CHAT_ACTIVE_RUN_IN_PROGRESS") {
        dispatch({
          type: "error_shown",
          message: uiMessages.activeRunInProgress,
        });
        return createRejectedSendResult(resultSessionId);
      }

      if (
        isChatApiError(error)
        && isAiChatRequestTooLargeError({
          statusCode: error.statusCode,
          code: error.code,
        })
      ) {
        dispatch({
          type: "error_shown",
          message: uiMessages.attachmentLimit,
        });
        return createRejectedSendResult(resultSessionId);
      }

      if (
        isChatApiError(error)
        && isAiChatAttachmentUnsupportedTypeError({
          statusCode: error.statusCode,
          code: error.code,
        })
      ) {
        dispatch({
          type: "error_shown",
          message: uiMessages.attachmentUnsupported,
        });
        return createRejectedSendResult(resultSessionId);
      }

      captureChatRunRequestError(error, workspaceId, {
        operation: "chat_start_run_failed",
        sessionId: requestSessionId,
        workspaceId,
      });
      dispatch({
        type: "error_shown",
        message: `${uiMessages.requestFailedPrefix} ${toErrorMessage(error, uiMessages.errorFallbacks)}`,
      });
      return createRejectedSendResult(resultSessionId);
    };

    let response: StartChatRunResponse | null = null;

    try {
      const initialResponse = await startRunForSession(sessionId);
      if (initialResponse === null) {
        return createRejectedSendResult(didRecoverSessionIdConflict ? sessionId : state.currentSessionId);
      }
      response = initialResponse;
    } catch (error) {
      if (isRequestSequenceCurrent(requestSequence) === false) {
        return finishStaleRequest();
      }

      if (isChatSessionIdConflictError(error) && didRecoverSessionIdConflict === false) {
        try {
          const recovery = await recoverAndActivateSession();
          if (recovery.status === "recovered") {
            didRecoverSessionIdConflict = true;
            sessionId = recovery.session.sessionId;

            try {
              const retryResponse = await startRunForSession(recovery.session.sessionId);
              if (retryResponse === null) {
                return createRejectedSendResult(recovery.session.sessionId);
              }
              response = retryResponse;
            } catch (retryError) {
              if (isRequestSequenceCurrent(requestSequence) === false) {
                return finishStaleRequest();
              }

              return failStartRunRequest(retryError, recovery.session.sessionId, recovery.session.sessionId);
            }
          } else if (recovery.status === "not_recoverable") {
            return failStartRunRequest(error, sessionId, state.currentSessionId);
          } else {
            return finishStaleRequest();
          }
        } catch (retryError) {
          if (isRequestSequenceCurrent(requestSequence) === false) {
            return finishStaleRequest();
          }

          return failStartRunRequest(retryError, sessionId, state.currentSessionId);
        }
      } else {
        return failStartRunRequest(error, sessionId, didRecoverSessionIdConflict ? sessionId : state.currentSessionId);
      }
    }

    if (response === null) {
      return createRejectedSendResult(state.currentSessionId);
    }

    if (isRequestSequenceCurrent(requestSequence) === false) {
      return finishStaleRequest();
    }

    invalidatePendingSnapshotRequests();

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
    if (response.activeRun === null && response.conversation.messages.length > 0) {
      runtimeRefs.messagesRef.current = response.conversation.messages;
      replaceMessages(response.conversation.messages);
    } else {
      appendUserMessage(contentParts);
      startAssistantMessage(null);
    }
    dispatch({
      type: "run_started",
      sessionId: response.sessionId,
      runState: response.activeRun === null ? "idle" : "running",
      composerSuggestions: response.composerSuggestions,
      chatConfig: response.chatConfig,
    });
    storeChatConfig(response.chatConfig);
    setKnownActiveRunId(response.activeRun?.runId ?? null);
    setKnownLiveCursor(response.activeRun?.live.cursor ?? null);
    if (response.activeRun === null) {
      reconcileTerminalSnapshot(response.sessionId);
    } else if (isDocumentVisibleRef.current) {
      startActiveRunLiveStream(response.sessionId, response.activeRun, null);
    }

    return {
      status: "accepted",
      accepted: true,
      sessionId: response.sessionId,
    };
  }, [
    appendUserMessage,
    dispatch,
    getActiveRequestSequence,
    invalidatePendingSnapshotRequests,
    isDocumentVisibleRef,
    isRemoteReady,
    isRequestSequenceCurrent,
    markRunHadToolCallsFromSnapshot,
    reconcileTerminalSnapshot,
    recoverFromSessionIdConflict,
    replaceMessages,
    resetSnapshotTracking,
    runtimeRefs,
    setKnownActiveRunId,
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

    const requestSessionId = state.currentSessionId;
    const requestWorkspaceId = workspaceId;
    const requestActiveRunId = runtimeRefs.activeRunIdRef.current;
    const isStopRequestSessionCurrent = (): boolean => {
      return requestWorkspaceId !== null
        && runtimeRefs.currentSessionIdRef.current === requestSessionId
        && runtimeRefs.currentWorkspaceIdRef.current === requestWorkspaceId;
    };
    const isStopRequestCurrent = (): boolean => {
      return isStopRequestSessionCurrent()
        && runtimeRefs.activeRunIdRef.current === requestActiveRunId;
    };

    dispatch({ type: "stop_requested", runId: requestActiveRunId });
    try {
      if (requestWorkspaceId === null) {
        throw createRemoteSessionProvisioningError(uiMessages.workspaceRequired);
      }

      const response = await stopChatRun(requestSessionId, requestWorkspaceId, requestActiveRunId);
      if (isStopRequestCurrent() === false) {
        if (isStopRequestSessionCurrent()) {
          dispatch({ type: "stop_request_stale", runId: requestActiveRunId });
        }
        return;
      }

      if (response.stopped === false) {
        if (response.stillRunning === false) {
          setKnownActiveRunId(null);
        }
        reconcileTerminalSnapshot(requestSessionId);
        dispatch({
          type: "stop_finished",
          runState: response.stillRunning ? "running" : "idle",
        });
        return;
      }

      if (response.stopped && response.stillRunning === false && hasActiveLiveConnection() === false) {
        reconcileTerminalSnapshot(requestSessionId);
        dispatch({
          type: "stop_finished",
          runState: "idle",
        });
        return;
      }
    } catch (error) {
      if (requestWorkspaceId !== null && isStopRequestCurrent() === false) {
        if (isStopRequestSessionCurrent()) {
          dispatch({ type: "stop_request_stale", runId: requestActiveRunId });
        }
        return;
      }

      captureChatRunRequestError(error, requestWorkspaceId, {
        operation: "chat_stop_run_failed",
        sessionId: requestSessionId,
        workspaceId: requestWorkspaceId,
      });
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
    runtimeRefs.activeRunIdRef,
    runtimeRefs.currentSessionIdRef,
    runtimeRefs.currentWorkspaceIdRef,
    setKnownActiveRunId,
    state.currentSessionId,
    state.isStopping,
    state.runState,
    uiMessages,
    workspaceId,
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
