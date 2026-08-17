import { useCallback, useRef } from "react";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import { createNewChatSession } from "../../../api";
import type { Locale } from "../../../i18n/types";
import type { NewChatSessionResponse } from "../../../types";
import { createClientChatSessionId } from "../support/helpers";
import type { ChatSessionControllerUiMessages } from "../support/types";

type RemoteSessionProvisioningMessages = Readonly<Pick<
  ChatSessionControllerUiMessages,
  "remoteNotReady" | "unexpectedSessionId" | "workspaceRequired"
>>;

type UseRemoteSessionProvisioningParams = Readonly<{
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  workspaceId: string | null;
  isRemoteReady: boolean;
  uiLocale: Locale;
  uiMessages: RemoteSessionProvisioningMessages;
}>;

type RemoteSessionProvisioningState = Readonly<{
  workspaceId: string;
  sessionId: string;
  uiLocale: Locale;
  promise: Promise<NewChatSessionResponse>;
}>;

type ActiveRemoteSessionProvisioning = Readonly<{
  sessionId: string;
  promise: Promise<NewChatSessionResponse>;
}>;

type RemoteSessionResolution = Readonly<{
  sessionId: string;
  provisionedResponse: NewChatSessionResponse | null;
}>;

type RemoteSessionProvisioning = Readonly<{
  provisionRequestedSession: (sessionId: string) => Promise<NewChatSessionResponse>;
  resolveCurrentOrNewSession: (currentSessionId: string | null) => Promise<RemoteSessionResolution>;
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

export function useRemoteSessionProvisioning(
  params: UseRemoteSessionProvisioningParams,
): RemoteSessionProvisioning {
  const {
    indexedDbOpenRecoveryState,
    workspaceId,
    isRemoteReady,
    uiLocale,
    uiMessages,
  } = params;
  const provisioningRef = useRef<RemoteSessionProvisioningState | null>(null);

  const getActiveProvisioning = useCallback((): ActiveRemoteSessionProvisioning | null => {
    const provisioningState = provisioningRef.current;
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
  }, [uiLocale, workspaceId]);

  const provisionRequestedSession = useCallback(async (
    sessionId: string,
  ): Promise<NewChatSessionResponse> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    if (workspaceId === null) {
      throw createRemoteSessionProvisioningError(uiMessages.workspaceRequired);
    }

    const activeProvisioning = getActiveProvisioning();
    if (activeProvisioning !== null && activeProvisioning.sessionId === sessionId) {
      try {
        const response = await activeProvisioning.promise;
        indexedDbOpenRecoveryState.throwIfFailed();
        return response;
      } catch (error) {
        indexedDbOpenRecoveryState.throwIfFailed();
        indexedDbOpenRecoveryState.markFailed(error);
        indexedDbOpenRecoveryState.throwIfFailed();
        throw error;
      }
    }

    const nextPromise = createNewChatSession(sessionId, workspaceId, uiLocale);
    provisioningRef.current = {
      workspaceId,
      sessionId,
      uiLocale,
      promise: nextPromise,
    };

    try {
      const response = await nextPromise;
      indexedDbOpenRecoveryState.throwIfFailed();
      return response;
    } catch (error) {
      indexedDbOpenRecoveryState.throwIfFailed();
      indexedDbOpenRecoveryState.markFailed(error);
      indexedDbOpenRecoveryState.throwIfFailed();
      throw error;
    } finally {
      const currentProvisioning = provisioningRef.current;
      if (
        currentProvisioning !== null
        && currentProvisioning.workspaceId === workspaceId
        && currentProvisioning.sessionId === sessionId
        && currentProvisioning.uiLocale === uiLocale
      ) {
        provisioningRef.current = null;
      }
    }
  }, [getActiveProvisioning, indexedDbOpenRecoveryState, uiLocale, uiMessages, workspaceId]);

  const resolveCurrentOrNewSession = useCallback(async (
    currentSessionId: string | null,
  ): Promise<RemoteSessionResolution> => {
    indexedDbOpenRecoveryState.throwIfFailed();
    if (workspaceId === null) {
      throw createRemoteSessionProvisioningError(uiMessages.workspaceRequired);
    }

    if (isRemoteReady === false) {
      throw createRemoteSessionProvisioningError(uiMessages.remoteNotReady);
    }

    const normalizedSessionId = normalizeExistingSessionId(currentSessionId);
    const activeProvisioning = getActiveProvisioning();

    if (normalizedSessionId !== null) {
      if (activeProvisioning !== null && activeProvisioning.sessionId === normalizedSessionId) {
        const response = await activeProvisioning.promise;
        indexedDbOpenRecoveryState.throwIfFailed();
        if (response.sessionId !== normalizedSessionId) {
          throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
        }
      }

      return {
        sessionId: normalizedSessionId,
        provisionedResponse: null,
      };
    }

    if (activeProvisioning !== null) {
      const response = await activeProvisioning.promise;
      indexedDbOpenRecoveryState.throwIfFailed();
      if (response.sessionId !== activeProvisioning.sessionId) {
        throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
      }

      return {
        sessionId: response.sessionId,
        provisionedResponse: response,
      };
    }

    const nextSessionId = createClientChatSessionId();
    const response = await provisionRequestedSession(nextSessionId);
    indexedDbOpenRecoveryState.throwIfFailed();
    if (response.sessionId !== nextSessionId) {
      throw createRemoteSessionProvisioningError(uiMessages.unexpectedSessionId);
    }

    return {
      sessionId: response.sessionId,
      provisionedResponse: response,
    };
  }, [
    getActiveProvisioning,
    indexedDbOpenRecoveryState,
    isRemoteReady,
    provisionRequestedSession,
    uiMessages,
    workspaceId,
  ]);

  return {
    provisionRequestedSession,
    resolveCurrentOrNewSession,
  };
}
