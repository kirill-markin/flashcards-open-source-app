import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { IndexedDbOpenRecoveryState } from "../../../appError/AppErrorContext";
import type { ChatLiveStream } from "../../../types";
import {
  ChatLiveContractError,
  ChatLiveHttpError,
  ChatLiveTransportError,
  consumeChatLiveStream,
  type ChatLiveEvent,
} from "../../streaming/liveStream";
import {
  captureWebException,
  normalizeCaughtError,
  type WebObservationScope,
} from "../../../observability/webObservability";

type ActiveLiveStreamConnection = Readonly<{
  sessionId: string;
  runId: string;
  abortController: AbortController;
}>;

type LiveStreamDisposition = "pending" | "terminal";

type UseChatLiveSessionParams = Readonly<{
  applyLiveEvent: (event: ChatLiveEvent) => void;
  finalizeInterruptedRun: (message: string) => void;
  indexedDbOpenRecoveryState: IndexedDbOpenRecoveryState;
  onVisibleResumeRequested: () => void;
  onRecoverableStreamError: (
    sessionId: string,
    runId: string,
    error: ChatLiveTransportError,
    previousResumeAttemptId: number | null,
  ) => void;
  onUnexpectedStreamEnd: (sessionId: string, runId: string) => void;
  onLiveAttachConnected: (sessionId: string, runId: string, resumeAttemptId: number | null) => void;
}>;

export type ChatLiveSessionState = Readonly<{
  isLiveStreamConnected: boolean;
  isDocumentVisibleRef: MutableRefObject<boolean>;
  hasActiveLiveConnection: () => boolean;
  startLiveStream: (
    sessionId: string,
    runId: string,
    liveStream: ChatLiveStream,
    afterCursor: string | null,
    resumeAttemptId: number | null,
  ) => void;
  detachLiveStream: (sessionId: string | null, runId: string | null) => void;
}>;

function isDocumentVisible(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  return document.visibilityState === "visible";
}

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function getLiveErrorRequestId(error: Error): string | null {
  return error instanceof ChatLiveContractError
    || error instanceof ChatLiveHttpError
    || error instanceof ChatLiveTransportError
    ? error.requestId
    : null;
}

function getLiveErrorStatusCode(error: Error): number | null {
  return error instanceof ChatLiveContractError
    || error instanceof ChatLiveHttpError
    || error instanceof ChatLiveTransportError
    ? error.statusCode
    : null;
}

function getLiveErrorCode(error: Error): string | null {
  return error instanceof ChatLiveContractError
    || error instanceof ChatLiveHttpError
    || error instanceof ChatLiveTransportError
    ? error.code
    : null;
}

function buildChatLiveScope(error: Error): WebObservationScope {
  return {
    app: "web",
    feature: "chat",
    userId: null,
    workspaceId: null,
    installationId: null,
    route: getCurrentRoute(),
    requestId: getLiveErrorRequestId(error),
    statusCode: getLiveErrorStatusCode(error),
    code: getLiveErrorCode(error),
  };
}

function captureLiveStreamError(
  error: Error,
  sessionId: string,
  runId: string,
  resumeAttemptId: number | null,
): void {
  const scope = buildChatLiveScope(error);
  if (error instanceof ChatLiveContractError) {
    captureWebException({
      action: "chat_live_contract_failed",
      error,
      scope,
      details: {
        eventType: error.eventType,
        sessionId,
        runId,
        resumeAttemptId,
      },
    });
    return;
  }

  captureWebException({
    action: "chat_live_stream_failed",
    error,
    scope,
    details: {
      sessionId,
      runId,
      resumeAttemptId,
    },
  });
}

function isRecoverableLiveTransportError(
  error: unknown,
  runId: string,
  preResponseRecoveryRunId: string | null,
): error is ChatLiveTransportError {
  return error instanceof ChatLiveTransportError
    && (
      error.statusCode === 200
      || (error.statusCode === null && preResponseRecoveryRunId !== runId)
    );
}

/**
 * Owns the browser-side live SSE lifecycle for one visible chat surface.
 * Snapshot loading remains outside this hook. On resume, callers must refresh
 * snapshot state first and only then decide whether live attach is still valid.
 */
export function useChatLiveSession(
  params: UseChatLiveSessionParams,
): ChatLiveSessionState {
  const {
    applyLiveEvent,
    finalizeInterruptedRun,
    indexedDbOpenRecoveryState,
    onVisibleResumeRequested,
    onRecoverableStreamError,
    onUnexpectedStreamEnd,
    onLiveAttachConnected,
  } = params;
  const [isLiveStreamConnected, setIsLiveStreamConnected] = useState<boolean>(false);
  const activeLiveConnectionRef = useRef<ActiveLiveStreamConnection | null>(null);
  const preResponseRecoveryRunIdRef = useRef<string | null>(null);
  const isDocumentVisibleRef = useRef<boolean>(isDocumentVisible());
  const applyLiveEventRef = useRef<(event: ChatLiveEvent) => void>(applyLiveEvent);
  const finalizeInterruptedRunRef = useRef<(message: string) => void>(finalizeInterruptedRun);
  const onVisibleResumeRequestedRef = useRef<() => void>(onVisibleResumeRequested);
  const onRecoverableStreamErrorRef = useRef<(
    sessionId: string,
    runId: string,
    error: ChatLiveTransportError,
    previousResumeAttemptId: number | null,
  ) => void>(onRecoverableStreamError);
  const onUnexpectedStreamEndRef = useRef<(sessionId: string, runId: string) => void>(onUnexpectedStreamEnd);
  const onLiveAttachConnectedRef = useRef<(sessionId: string, runId: string, resumeAttemptId: number | null) => void>(
    onLiveAttachConnected,
  );
  const hasActiveLiveConnection = useCallback((): boolean => activeLiveConnectionRef.current !== null, []);

  const detachLiveStream = useCallback((sessionId: string | null, runId: string | null): void => {
    const activeConnection = activeLiveConnectionRef.current;
    if (activeConnection === null) {
      return;
    }

    if (sessionId !== null && activeConnection.sessionId !== sessionId) {
      return;
    }

    if (runId !== null && activeConnection.runId !== runId) {
      return;
    }

    activeConnection.abortController.abort();
    activeLiveConnectionRef.current = null;
    setIsLiveStreamConnected(false);
  }, []);

  useEffect(() => {
    applyLiveEventRef.current = applyLiveEvent;
  }, [applyLiveEvent]);

  useEffect(() => {
    finalizeInterruptedRunRef.current = finalizeInterruptedRun;
  }, [finalizeInterruptedRun]);

  useEffect(() => {
    onVisibleResumeRequestedRef.current = onVisibleResumeRequested;
  }, [onVisibleResumeRequested]);

  useEffect(() => {
    onRecoverableStreamErrorRef.current = onRecoverableStreamError;
  }, [onRecoverableStreamError]);

  useEffect(() => {
    onUnexpectedStreamEndRef.current = onUnexpectedStreamEnd;
  }, [onUnexpectedStreamEnd]);

  useEffect(() => {
    onLiveAttachConnectedRef.current = onLiveAttachConnected;
  }, [onLiveAttachConnected]);

  useEffect(() => {
    if (indexedDbOpenRecoveryState.isFailed) {
      detachLiveStream(null, null);
    }
  }, [detachLiveStream, indexedDbOpenRecoveryState.isFailed]);

  /**
   * Attaches live SSE only while the chat surface is visible. Existing sessions
   * must provide the latest known cursor so the stream continues after the last
   * trusted snapshot/bootstrap boundary instead of replaying older turns.
   */
  const startLiveStream = useCallback((
    sessionId: string,
    runId: string,
    liveStream: ChatLiveStream,
    afterCursor: string | null,
    resumeAttemptId: number | null,
  ): void => {
    detachLiveStream(null, null);

    if (indexedDbOpenRecoveryState.hasFailed() || isDocumentVisibleRef.current === false) {
      return;
    }

    const abortController = new AbortController();
    const liveStreamSignal = AbortSignal.any([
      indexedDbOpenRecoveryState.signal,
      abortController.signal,
    ]);
    let liveStreamDisposition: LiveStreamDisposition = "pending";
    let didReportConnected = false;
    activeLiveConnectionRef.current = { sessionId, runId, abortController };
    setIsLiveStreamConnected(false);

    void consumeChatLiveStream({
      liveStream,
      sessionId,
      runId,
      afterCursor,
      resumeAttemptId,
      signal: liveStreamSignal,
      onEvent: (event) => {
        const activeConnection = activeLiveConnectionRef.current;
        if (
          indexedDbOpenRecoveryState.hasFailed()
          || activeConnection?.sessionId !== sessionId
          || activeConnection.runId !== runId
          || event.sessionId !== sessionId
          || event.runId !== runId
        ) {
          return;
        }

        if (preResponseRecoveryRunIdRef.current === runId) {
          preResponseRecoveryRunIdRef.current = null;
        }

        if (event.type === "run_terminal") {
          liveStreamDisposition = "terminal";
        }

        if (didReportConnected === false) {
          didReportConnected = true;
          onLiveAttachConnectedRef.current(sessionId, runId, resumeAttemptId);
        }

        setIsLiveStreamConnected(true);
        applyLiveEventRef.current(event);
      },
    }).then(() => {
      if (liveStreamSignal.aborted || indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      const activeConnection = activeLiveConnectionRef.current;
      if (activeConnection?.sessionId !== sessionId || activeConnection.runId !== runId) {
        return;
      }

      activeLiveConnectionRef.current = null;
      setIsLiveStreamConnected(false);
      if (liveStreamDisposition === "terminal") {
        return;
      }

      onUnexpectedStreamEndRef.current(sessionId, runId);
    }).catch((error: unknown) => {
      if (liveStreamSignal.aborted || indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }

      const activeConnection = activeLiveConnectionRef.current;
      if (activeConnection?.sessionId !== sessionId || activeConnection.runId !== runId) {
        return;
      }

      activeLiveConnectionRef.current = null;
      setIsLiveStreamConnected(false);
      if (isRecoverableLiveTransportError(error, runId, preResponseRecoveryRunIdRef.current)) {
        if (error.statusCode === null) {
          preResponseRecoveryRunIdRef.current = runId;
        }
        onRecoverableStreamErrorRef.current(sessionId, runId, error, resumeAttemptId);
        return;
      }

      const normalizedError = normalizeCaughtError(error);
      captureLiveStreamError(normalizedError, sessionId, runId, resumeAttemptId);
      finalizeInterruptedRunRef.current(normalizedError.message);
    });
  }, [detachLiveStream, indexedDbOpenRecoveryState]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    /**
     * Hidden tabs must detach immediately. Visible tabs resume by first asking
     * the caller to refresh snapshot state, which then decides whether live
     * streaming is still warranted for the current run.
     */
    const handleVisibilityChange = (): void => {
      const previousIsVisible = isDocumentVisibleRef.current;
      const nextIsVisible = isDocumentVisible();
      isDocumentVisibleRef.current = nextIsVisible;

      if (previousIsVisible === nextIsVisible) {
        return;
      }

      if (nextIsVisible === false) {
        detachLiveStream(null, null);
        return;
      }

      if (indexedDbOpenRecoveryState.hasFailed()) {
        return;
      }
      onVisibleResumeRequestedRef.current();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [detachLiveStream, indexedDbOpenRecoveryState]);

  useEffect(() => {
    return () => {
      detachLiveStream(null, null);
    };
  }, [detachLiveStream]);

  return {
    isLiveStreamConnected,
    isDocumentVisibleRef,
    hasActiveLiveConnection,
    startLiveStream,
    detachLiveStream,
  };
}
