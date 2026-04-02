import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ChatLiveStream } from "../types";
import { consumeChatLiveStream, type ChatLiveEvent } from "./liveStream";

type ActiveLiveStreamConnection = Readonly<{
  sessionId: string;
  runId: string;
  abortController: AbortController;
}>;

type LiveStreamDisposition = "pending" | "terminal";

type UseChatLiveSessionParams = Readonly<{
  applyLiveEvent: (event: ChatLiveEvent) => void;
  finalizeInterruptedRun: (message: string) => void;
  onVisibleResumeRequested: () => void;
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
    onVisibleResumeRequested,
    onUnexpectedStreamEnd,
    onLiveAttachConnected,
  } = params;
  const [isLiveStreamConnected, setIsLiveStreamConnected] = useState<boolean>(false);
  const activeLiveConnectionRef = useRef<ActiveLiveStreamConnection | null>(null);
  const isDocumentVisibleRef = useRef<boolean>(isDocumentVisible());
  const applyLiveEventRef = useRef<(event: ChatLiveEvent) => void>(applyLiveEvent);
  const finalizeInterruptedRunRef = useRef<(message: string) => void>(finalizeInterruptedRun);
  const onVisibleResumeRequestedRef = useRef<() => void>(onVisibleResumeRequested);
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
    onUnexpectedStreamEndRef.current = onUnexpectedStreamEnd;
  }, [onUnexpectedStreamEnd]);

  useEffect(() => {
    onLiveAttachConnectedRef.current = onLiveAttachConnected;
  }, [onLiveAttachConnected]);

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

    if (isDocumentVisibleRef.current === false) {
      return;
    }

    const abortController = new AbortController();
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
      signal: abortController.signal,
      onEvent: (event) => {
        const activeConnection = activeLiveConnectionRef.current;
        if (
          activeConnection?.sessionId !== sessionId
          || activeConnection.runId !== runId
          || event.sessionId !== sessionId
          || event.runId !== runId
        ) {
          return;
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
      if (abortController.signal.aborted) {
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
      if (abortController.signal.aborted) {
        return;
      }

      const activeConnection = activeLiveConnectionRef.current;
      if (activeConnection?.sessionId !== sessionId || activeConnection.runId !== runId) {
        return;
      }

      activeLiveConnectionRef.current = null;
      setIsLiveStreamConnected(false);
      finalizeInterruptedRunRef.current(error instanceof Error ? error.message : String(error));
    });
  }, [detachLiveStream]);

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

      onVisibleResumeRequestedRef.current();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [detachLiveStream]);

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
