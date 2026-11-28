import { useCallback, useLayoutEffect, useRef, type Dispatch } from "react";
import { BrowserGuestSessionInvalidatedError } from "../../../api/transport/transport";
import { usePremiumPresenter } from "../../../premium/PremiumProvider";
import {
  markIndexedDbOpenRecoveryFailureAndCheckActive,
  type IndexedDbOpenRecoveryState,
} from "../../../appError/AppErrorContext";
import {
  getCurrentChatSnapshot,
  startChatRun,
  stopChatRun,
} from "../../../api";
import type { Locale } from "../../../i18n/types";
import type {
  AiUsageStatus,
  NewChatSessionResponse,
  StartChatRunContentPart,
  StartChatRunRequestBody,
  StartChatRunResponse,
} from "../../../types";
import { captureChatRunRequestError } from "../support/apiObservation";
import { loadStoredChatConfig, storeChatConfig } from "../support/config";
import {
  createClientChatSessionId,
  isChatApiError,
  toErrorMessage,
} from "../support/helpers";
import type {
  ChatSessionControllerAction,
  ChatSessionControllerState,
} from "../state/state";
import type {
  ChatSessionControllerUiMessages,
  SendChatMessageParams,
  SendChatMessageResult,
} from "../support/types";
import type { ChatSessionSnapshotSync } from "../snapshotSync/useSnapshotSync";
import {
  buildContentParts,
  buildStartRunContentParts,
  toRequestBodySizeBytes,
} from "../../shared/chatHelpers";
import {
  findPendingAttachmentLimitViolation,
  type BinaryPendingAttachment,
} from "../../attachments/FileAttachment";
import { uploadPendingAttachments } from "../../attachments/chatAttachmentUploads";
import {
  AI_CHAT_MAXIMUM_START_RUN_REQUEST_BYTES,
  CHAT_FILE_UPLOAD_NOT_FOUND_CODE,
  isAiChatAttachmentUnsupportedTypeError,
  isAiChatRequestTooLargeError,
  toChatAttachmentLimitViolation,
} from "../../shared/chatSizePolicy";
import { getBrowserGuestAiErrorRefusal, isAiLimitReachedError } from "../../shared/chatAiLimitPolicy";
import {
  formatOwnOpenAIKeyErrorMessage,
  isOwnOpenAIKeyError,
} from "../../shared/chatOwnOpenAIKeyErrorPolicy";
import type { ChatHistoryState } from "../../history/useChatHistory";
import { useRemoteSessionProvisioning } from "./useRemoteSessionProvisioning";

type FreshSessionErrorPresentation = "new_chat" | "refresh" | "silent";

type UseChatSessionActionsParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  workspaceId: string | null;
  accountId: string | null;
  isRemoteReady: boolean;
  uiLocale: Locale;
  uiMessages: ChatSessionControllerUiMessages;
  state: ChatSessionControllerState;
  dispatch: Dispatch<ChatSessionControllerAction>;
  history: ChatHistoryState;
  snapshotSync: ChatSessionSnapshotSync;
  readHeldAiUsage: () => AiUsageStatus | null;
  refreshAiUsageInBackground: () => void;
}>;

type ChatSessionActions = Readonly<{
  sendMessage: (params: SendChatMessageParams) => Promise<SendChatMessageResult>;
  stopMessage: () => Promise<void>;
  clearConversation: (prepareDraft: ((sessionId: string) => void) | null) => string | null;
  ensureRemoteSession: () => Promise<string>;
  ensureRemoteSessionForHydration: () => Promise<string>;
  ensureFreshSessionInBackground: (sessionId: string, requestSequence: number) => void;
  ensureFreshSessionWithRefreshError: (sessionId: string, requestSequence: number) => void;
  getFreshSessionRequestSequence: () => number;
}>;

function isChatSessionIdConflictError(error: unknown): boolean {
  return isChatApiError(error) && error.code === "CHAT_SESSION_ID_CONFLICT";
}

export function useChatSessionActions(
  params: UseChatSessionActionsParams,
): ChatSessionActions {
  const presentPremium = usePremiumPresenter();
  const {
    indexedDbOpenRecoveryState,
    workspaceId,
    accountId,
    isRemoteReady,
    uiLocale,
    uiMessages,
    state,
    dispatch,
    history,
    snapshotSync,
    readHeldAiUsage,
    refreshAiUsageInBackground,
  } = params;
  const {
    appendUserMessage,
    clearHistory,
    replaceMessages,
    startAssistantMessage,
  } = history;
  const {
    applyRecoveredSnapshot,
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
  const requestSequenceRef = useRef<number>(0);
  const currentAccountIdRef = useRef<string | null>(accountId);
  const currentUiLocaleRef = useRef<Locale>(uiLocale);
  currentUiLocaleRef.current = uiLocale;
  type SessionConflictRecovery =
    | Readonly<{ status: "not_recoverable" }>
    | Readonly<{ status: "recovered"; session: NewChatSessionResponse }>
    | Readonly<{ status: "stale" }>;

  function createChatSessionActionError(message: string): Error {
    return new Error(message);
  }

  const {
    provisionRequestedSession,
    resolveCurrentOrNewSession,
  } = useRemoteSessionProvisioning({
    indexedDbOpenRecoveryState,
    workspaceId,
    accountId,
    isRemoteReady,
    uiLocale,
    uiMessages,
  });

  const invalidatePendingActions = useCallback((): void => {
    requestSequenceRef.current += 1;
  }, []);

  useLayoutEffect(() => {
    if (currentAccountIdRef.current !== accountId) {
      currentAccountIdRef.current = accountId;
      invalidatePendingActions();
    }
  }, [accountId, invalidatePendingActions]);

  const getActiveRequestSequence = useCallback((): number => {
    return requestSequenceRef.current;
  }, []);

  const isRequestSequenceCurrent = useCallback((requestSequence: number): boolean => {
    return requestSequenceRef.current === requestSequence
      && currentAccountIdRef.current === accountId
      && runtimeRefs.currentWorkspaceIdRef.current === workspaceId;
  }, [accountId, runtimeRefs, workspaceId]);

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
    const response = await provisionRequestedSession(nextSessionId);
    if (response.sessionId !== nextSessionId) {
      throw createChatSessionActionError(uiMessages.unexpectedSessionId);
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
    provisionRequestedSession,
    resetSnapshotTracking,
    uiMessages,
  ]);

  const isFreshSessionEnsureCurrent = useCallback((
    sessionId: string,
    requestSequence: number,
    requestLocale: Locale,
  ): boolean => {
    return isRequestSequenceCurrent(requestSequence)
      && runtimeRefs.currentSessionIdRef.current === sessionId
      && runtimeRefs.messagesRef.current.length === 0
      && runtimeRefs.runStateRef.current === "idle"
      && currentUiLocaleRef.current === requestLocale;
  }, [isRequestSequenceCurrent, runtimeRefs]);

  const ensureFreshSession = useCallback((
    sessionId: string,
    requestSequence: number,
    errorPresentation: FreshSessionErrorPresentation,
  ): void => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return;
    }

    const requestLocale = uiLocale;
    void (async (): Promise<void> => {
      try {
        const response = await provisionRequestedSession(sessionId);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (response.sessionId !== sessionId) {
          return;
        }

        // Locale changes must invalidate earlier /chat/new responses so the
        // empty-session suggestions cannot snap back to an older language.
        if (isFreshSessionEnsureCurrent(sessionId, requestSequence, requestLocale) === false) {
          return;
        }

        runtimeRefs.serverSessionIdRef.current = sessionId;
        dispatch({
          type: "fresh_session_ready",
          sessionId,
          composerSuggestions: response.composerSuggestions,
          chatConfig: response.chatConfig,
        });
        storeChatConfig(response.chatConfig);
      } catch (error) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
          return;
        }

        if (error instanceof BrowserGuestSessionInvalidatedError) return;

        if (isFreshSessionEnsureCurrent(sessionId, requestSequence, requestLocale) === false) {
          return;
        }

        captureChatRunRequestError(error, {
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
  }, [dispatch, indexedDbOpenRecoveryState, isFreshSessionEnsureCurrent, provisionRequestedSession, runtimeRefs, uiMessages, workspaceId]);

  const ensureFreshSessionInBackground = useCallback((sessionId: string, requestSequence: number): void => {
    ensureFreshSession(sessionId, requestSequence, "silent");
  }, [ensureFreshSession]);

  const ensureFreshSessionWithRefreshError = useCallback((sessionId: string, requestSequence: number): void => {
    ensureFreshSession(sessionId, requestSequence, "refresh");
  }, [ensureFreshSession]);

  const ensureRemoteSession = useCallback(async (): Promise<string> => {
    const resolution = await resolveCurrentOrNewSession(runtimeRefs.currentSessionIdRef.current);
    indexedDbOpenRecoveryState.throwIfFailed();
    if (
      resolution.provisionedResponse !== null
      && runtimeRefs.currentWorkspaceIdRef.current === workspaceId
      && runtimeRefs.currentSessionIdRef.current === null
    ) {
      runtimeRefs.serverSessionIdRef.current = resolution.provisionedResponse.sessionId;
      dispatch({
        type: "fresh_session_ready",
        sessionId: resolution.provisionedResponse.sessionId,
        composerSuggestions: resolution.provisionedResponse.composerSuggestions,
        chatConfig: resolution.provisionedResponse.chatConfig,
      });
      storeChatConfig(resolution.provisionedResponse.chatConfig);
    }

    return resolution.sessionId;
  }, [dispatch, indexedDbOpenRecoveryState, resolveCurrentOrNewSession, runtimeRefs, workspaceId]);

  const ensureRemoteSessionForHydration = useCallback(async (): Promise<string> => {
    const resolution = await resolveCurrentOrNewSession(runtimeRefs.currentSessionIdRef.current);
    indexedDbOpenRecoveryState.throwIfFailed();
    return resolution.sessionId;
  }, [indexedDbOpenRecoveryState, resolveCurrentOrNewSession, runtimeRefs]);

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

    const attachmentLimitViolation = findPendingAttachmentLimitViolation(sendParams.attachments);
    if (attachmentLimitViolation !== null) {
      dispatch({
        type: "error_shown",
        message: uiMessages.attachmentLimits[attachmentLimitViolation],
      });
      return createRejectedSendResult(state.currentSessionId);
    }

    const requestSequence = getActiveRequestSequence();
    const sourceSessionId = runtimeRefs.currentSessionIdRef.current;
    const { requiredSessionId } = sendParams;
    if (requiredSessionId !== null && sourceSessionId !== requiredSessionId) {
      dispatch({
        type: "error_shown",
        message: uiMessages.activeChatChanged,
      });
      return createRejectedSendResult(requiredSessionId);
    }

    const finishStaleRequest = (): SendChatMessageResult => ({
      status: "stale",
      accepted: false,
      sessionId: runtimeRefs.currentSessionIdRef.current,
    });

    const failRemoteSessionRequest = (error: unknown): SendChatMessageResult => {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return createRejectedSendResult(state.currentSessionId);
      }

      const guestAiRefusal = getBrowserGuestAiErrorRefusal(error, "chat");
      if (guestAiRefusal !== null) {
        refreshAiUsageInBackground();
        return { status: "rejected", accepted: false, sessionId: state.currentSessionId, guestAiRefusal };
      }
      captureChatRunRequestError(error, {
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

      if (requiredSessionId !== null && targetSessionId !== requiredSessionId) {
        throw createChatSessionActionError(uiMessages.activeChatChanged);
      }

      if (preparedDraftSessionId === targetSessionId) {
        return true;
      }

      if (sendParams.onSessionDraftTargetReady(targetSessionId) === null) {
        throw createChatSessionActionError(uiMessages.currentChatDraftConflict);
      }
      preparedDraftSessionId = targetSessionId;
      return true;
    };

    const activateRecoveredSession = (session: NewChatSessionResponse): boolean => {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return false;
      }

      if (prepareDraftTargetSession(session.sessionId) === false) {
        return false;
      }

      invalidatePendingSnapshotRequests();
      resetSnapshotTracking(null);
      runtimeRefs.messagesRef.current = [];
      clearHistory();
      runtimeRefs.currentSessionIdRef.current = session.sessionId;
      runtimeRefs.serverSessionIdRef.current = session.sessionId;
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
      indexedDbOpenRecoveryState.throwIfFailed();
      if (recovery.status === "recovered" && activateRecoveredSession(recovery.session) === false) {
        return { status: "stale" };
      }

      return recovery;
    };

    let sessionId: string | null = null;
    let didRecoverSessionIdConflict = false;

    try {
      const ensuredSessionId = await ensureRemoteSession();
      indexedDbOpenRecoveryState.throwIfFailed();
      sessionId = ensuredSessionId;
      if (prepareDraftTargetSession(ensuredSessionId) === false) {
        return finishStaleRequest();
      }
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return createRejectedSendResult(state.currentSessionId);
      }

      if (isRequestSequenceCurrent(requestSequence) === false) {
        return finishStaleRequest();
      }

      if (isChatSessionIdConflictError(error)) {
        try {
          const recovery = await recoverAndActivateSession();
          indexedDbOpenRecoveryState.throwIfFailed();
          if (recovery.status === "recovered") {
            didRecoverSessionIdConflict = true;
            sessionId = recovery.session.sessionId;
          } else if (recovery.status === "stale") {
            return finishStaleRequest();
          }
        } catch (recoveryError) {
          if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, recoveryError)) {
            return createRejectedSendResult(state.currentSessionId);
          }

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
      return failRemoteSessionRequest(createChatSessionActionError(uiMessages.unexpectedSessionId));
    }

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const createStartRunRequestBody = (
      requestSessionId: string,
      content: ReadonlyArray<StartChatRunContentPart>,
    ): StartChatRunRequestBody => ({
      sessionId: requestSessionId,
      workspaceId,
      clientRequestId: sendParams.clientRequestId,
      content,
      timezone,
      // Optional on the wire so older backend/client contract phases keep working.
      uiLocale,
    });

    const startRunForSession = async (
      requestSessionId: string,
      content: ReadonlyArray<StartChatRunContentPart>,
    ): Promise<StartChatRunResponse | null> => {
      indexedDbOpenRecoveryState.throwIfFailed();
      const requestBody = createStartRunRequestBody(requestSessionId, content);
      if (toRequestBodySizeBytes(requestBody) > AI_CHAT_MAXIMUM_START_RUN_REQUEST_BYTES) {
        dispatch({
          type: "error_shown",
          message: uiMessages.requestTooLarge,
        });
        return null;
      }

      const startRunResponse = await startChatRun(requestBody, accountId);
      indexedDbOpenRecoveryState.throwIfFailed();
      return startRunResponse;
    };

    const showAttachmentUploadFailure = (
      error: unknown,
      requestSessionId: string,
      resultSessionId: string | null,
    ): SendChatMessageResult => {
      captureChatRunRequestError(error, {
        operation: "chat_attachment_upload_failed",
        sessionId: requestSessionId,
        workspaceId,
      });
      dispatch({
        type: "error_shown",
        message: uiMessages.attachmentUploadFailed,
      });
      return createRejectedSendResult(resultSessionId);
    };

    const failAttachmentUploadRequest = (
      error: unknown,
      requestSessionId: string,
      resultSessionId: string | null,
    ): SendChatMessageResult => {
      const uploadLimitViolation = isChatApiError(error) ? toChatAttachmentLimitViolation(error.code) : null;
      if (uploadLimitViolation !== null) {
        dispatch({
          type: "error_shown",
          message: uiMessages.attachmentLimits[uploadLimitViolation],
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

      return showAttachmentUploadFailure(error, requestSessionId, resultSessionId);
    };

    const failStartRunRequest = (
      error: unknown,
      requestSessionId: string,
      resultSessionId: string | null,
    ): SendChatMessageResult => {
      if (indexedDbOpenRecoveryState.hasFailed()) {
        return createRejectedSendResult(resultSessionId);
      }

      const guestAiRefusal = getBrowserGuestAiErrorRefusal(error, "chat")
        ?? (readHeldAiUsage()?.browserGuestCapabilities?.isGuest === true
          && isChatApiError(error) && isAiLimitReachedError({ code: error.code })
          ? { feature: "chat" as const, scope: "guest" as const, resetsAt: null } : null);
      if (guestAiRefusal !== null) {
        refreshAiUsageInBackground();
        return { status: "rejected", accepted: false, sessionId: resultSessionId, guestAiRefusal };
      }

      if (isChatApiError(error) && error.code === "CHAT_ACTIVE_RUN_IN_PROGRESS") {
        dispatch({
          type: "error_shown",
          message: uiMessages.activeRunInProgress,
        });
        return createRejectedSendResult(resultSessionId);
      }

      if (isChatApiError(error) && isAiLimitReachedError({ code: error.code })) {
        dispatch({
          type: "error_shown",
          message: uiMessages.formatAiLimitReached(readHeldAiUsage()),
        });
        presentPremium?.({ reason: "ai-limit", entryPoint: "ai_limit", aiUsage: readHeldAiUsage() });
        // Brings the remaining-messages notice down to zero; the refusal above does not wait for it.
        refreshAiUsageInBackground();
        return createRejectedSendResult(resultSessionId);
      }

      if (isChatApiError(error) && isOwnOpenAIKeyError(error.code)) {
        dispatch({
          type: "error_shown",
          message: formatOwnOpenAIKeyErrorMessage(
            uiMessages.ownOpenAIKeyErrorPrefix,
            toErrorMessage(error, uiMessages.errorFallbacks),
          ),
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
          message: uiMessages.requestTooLarge,
        });
        return createRejectedSendResult(resultSessionId);
      }

      const uploadLimitViolation = isChatApiError(error) ? toChatAttachmentLimitViolation(error.code) : null;
      if (uploadLimitViolation !== null) {
        dispatch({
          type: "error_shown",
          message: uiMessages.attachmentLimits[uploadLimitViolation],
        });
        return createRejectedSendResult(resultSessionId);
      }

      // This client stages every upload right before this request and the backend keeps staged objects for a
      // day, so a missing one means the staging pipeline broke.
      if (isChatApiError(error) && error.code === CHAT_FILE_UPLOAD_NOT_FOUND_CODE) {
        return showAttachmentUploadFailure(error, requestSessionId, resultSessionId);
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

      captureChatRunRequestError(error, {
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

    const recoverCurrentSession = async (requestSessionId: string): Promise<SendChatMessageResult> => {
      // An automatic send is authorized only for its target conversation.
      if (requiredSessionId !== null) {
        dispatch({ type: "error_shown", message: uiMessages.activeChatChanged });
        return createRejectedSendResult(requiredSessionId);
      }

      const isRecoverySessionCurrent = (): boolean => isRequestSequenceCurrent(requestSequence)
        && runtimeRefs.currentSessionIdRef.current === requestSessionId
        && sendParams.isDraftTargetCurrent();
      if (isRecoverySessionCurrent() === false) {
        return finishStaleRequest();
      }

      invalidatePendingSnapshotRequests();
      const snapshotRequestVersion = runtimeRefs.snapshotRequestVersionRef.current;
      const recoveryRequest = { workspaceId, sessionId: requestSessionId, requestVersion: snapshotRequestVersion };
      runtimeRefs.currentSessionRecoveryRef.current = recoveryRequest;
      const abortController = new AbortController();
      try {
        const snapshot = await getCurrentChatSnapshot(workspaceId, abortController.signal, accountId);
        indexedDbOpenRecoveryState.throwIfFailed();
        if (isRecoverySessionCurrent() === false) {
          return finishStaleRequest();
        }
        if (runtimeRefs.snapshotRequestVersionRef.current !== snapshotRequestVersion) {
          return createRejectedSendResult(requestSessionId);
        }

        if (sendParams.onSessionDraftTargetReady(snapshot.sessionId) === null) {
          dispatch({ type: "error_shown", message: uiMessages.currentChatDraftConflict });
          return createRejectedSendResult(requestSessionId);
        }
        preparedDraftSessionId = snapshot.sessionId;
        applyRecoveredSnapshot(snapshot);
        dispatch({ type: "composer_notice_shown", message: uiMessages.currentChatRecovered });
        if (snapshot.activeRun !== null && isDocumentVisibleRef.current) {
          startActiveRunLiveStream(snapshot.sessionId, snapshot.activeRun, null);
        }
        return createRejectedSendResult(snapshot.sessionId);
      } catch (recoveryError) {
        if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, recoveryError)) {
          return createRejectedSendResult(requestSessionId);
        }
        if (isRecoverySessionCurrent() === false) {
          return finishStaleRequest();
        }
        return failStartRunRequest(recoveryError, requestSessionId, requestSessionId);
      } finally {
        if (runtimeRefs.currentSessionRecoveryRef.current === recoveryRequest) {
          runtimeRefs.currentSessionRecoveryRef.current = null;
        }
      }
    };

    let uploadIdsByAttachment: ReadonlyMap<BinaryPendingAttachment, string>;
    try {
      uploadIdsByAttachment = await uploadPendingAttachments(sendParams.attachments);
      indexedDbOpenRecoveryState.throwIfFailed();
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return createRejectedSendResult(state.currentSessionId);
      }

      if (isRequestSequenceCurrent(requestSequence) === false) {
        return finishStaleRequest();
      }

      return failAttachmentUploadRequest(
        error,
        sessionId,
        didRecoverSessionIdConflict ? sessionId : state.currentSessionId,
      );
    }

    if (isRequestSequenceCurrent(requestSequence) === false) {
      return finishStaleRequest();
    }

    const startRunContent = buildStartRunContentParts(
      sendParams.text,
      sendParams.attachments,
      uploadIdsByAttachment,
    );
    let response: StartChatRunResponse | null = null;

    try {
      const initialResponse = await startRunForSession(sessionId, startRunContent);
      indexedDbOpenRecoveryState.throwIfFailed();
      if (initialResponse === null) {
        return createRejectedSendResult(didRecoverSessionIdConflict ? sessionId : state.currentSessionId);
      }
      response = initialResponse;
    } catch (error) {
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return createRejectedSendResult(state.currentSessionId);
      }

      if (isRequestSequenceCurrent(requestSequence) === false) {
        return finishStaleRequest();
      }

      if (isChatApiError(error) && error.statusCode === 409 && error.code === "CHAT_SESSION_NOT_CURRENT") {
        return recoverCurrentSession(sessionId);
      }

      if (isChatSessionIdConflictError(error) && didRecoverSessionIdConflict === false) {
        try {
          const recovery = await recoverAndActivateSession();
          indexedDbOpenRecoveryState.throwIfFailed();
          if (recovery.status === "recovered") {
            didRecoverSessionIdConflict = true;
            sessionId = recovery.session.sessionId;

            try {
              const retryResponse = await startRunForSession(recovery.session.sessionId, startRunContent);
              indexedDbOpenRecoveryState.throwIfFailed();
              if (retryResponse === null) {
                return createRejectedSendResult(recovery.session.sessionId);
              }
              response = retryResponse;
            } catch (retryError) {
              if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, retryError)) {
                return createRejectedSendResult(recovery.session.sessionId);
              }

              if (isRequestSequenceCurrent(requestSequence) === false) {
                return finishStaleRequest();
              }

              if (isChatApiError(retryError) && retryError.statusCode === 409 && retryError.code === "CHAT_SESSION_NOT_CURRENT") {
                return recoverCurrentSession(recovery.session.sessionId);
              }

              return failStartRunRequest(retryError, recovery.session.sessionId, recovery.session.sessionId);
            }
          } else if (recovery.status === "not_recoverable") {
            return failStartRunRequest(error, sessionId, state.currentSessionId);
          } else {
            return finishStaleRequest();
          }
        } catch (retryError) {
          if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, retryError)) {
            return createRejectedSendResult(state.currentSessionId);
          }

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

    const isSessionBoundReplay = requiredSessionId !== null && response.deduplicated === true;
    // A fresh acceptance can already include tool calls. Compare it against local history
    // so older messages do not get mistaken for the new run.
    markRunHadToolCallsFromSnapshot(
      response.activeRun,
      response.conversation.messages,
      runtimeRefs.messagesRef.current,
      isSessionBoundReplay ? null : contentParts,
    );
    if ((response.activeRun === null || isSessionBoundReplay) && response.conversation.messages.length > 0) {
      runtimeRefs.messagesRef.current = response.conversation.messages;
      replaceMessages(response.conversation.messages);
    } else {
      appendUserMessage(contentParts);
      startAssistantMessage(null);
    }
    runtimeRefs.serverSessionIdRef.current = response.sessionId;
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
    accountId,
    applyRecoveredSnapshot,
    appendUserMessage,
    dispatch,
    getActiveRequestSequence,
    indexedDbOpenRecoveryState,
    invalidatePendingSnapshotRequests,
    isDocumentVisibleRef,
    isRemoteReady,
    isRequestSequenceCurrent,
    markRunHadToolCallsFromSnapshot,
    readHeldAiUsage,
    presentPremium,
    reconcileTerminalSnapshot,
    recoverFromSessionIdConflict,
    refreshAiUsageInBackground,
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
        throw createChatSessionActionError(uiMessages.workspaceRequired);
      }

      const response = await stopChatRun(requestSessionId, requestWorkspaceId, requestActiveRunId);
      indexedDbOpenRecoveryState.throwIfFailed();
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
      if (markIndexedDbOpenRecoveryFailureAndCheckActive(indexedDbOpenRecoveryState, error)) {
        return;
      }

      if (requestWorkspaceId !== null && isStopRequestCurrent() === false) {
        if (isStopRequestSessionCurrent()) {
          dispatch({ type: "stop_request_stale", runId: requestActiveRunId });
        }
        return;
      }

      captureChatRunRequestError(error, {
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
    indexedDbOpenRecoveryState,
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

  const clearConversation = useCallback((prepareDraft: ((sessionId: string) => void) | null): string | null => {
    if (indexedDbOpenRecoveryState.hasFailed()) {
      return null;
    }

    if (workspaceId === null) {
      invalidatePendingActions();
      detachLiveStream(null, null);
      invalidatePendingSnapshotRequests();
      clearHistory();
      resetSnapshotTracking(null);
      dispatch({ type: "workspace_cleared" });
      return null;
    }

    const nextSessionId = createClientChatSessionId();
    const chatConfig = loadStoredChatConfig();
    prepareDraft?.(nextSessionId);
    invalidatePendingActions();
    detachLiveStream(null, null);
    invalidatePendingSnapshotRequests();
    clearHistory();
    resetSnapshotTracking(null);
    dispatch({
      type: "fresh_session_requested",
      sessionId: nextSessionId,
      chatConfig,
    });
    ensureFreshSession(nextSessionId, requestSequenceRef.current, "new_chat");
    return nextSessionId;
  }, [
    invalidatePendingActions,
    clearHistory,
    detachLiveStream,
    dispatch,
    ensureFreshSession,
    indexedDbOpenRecoveryState,
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
