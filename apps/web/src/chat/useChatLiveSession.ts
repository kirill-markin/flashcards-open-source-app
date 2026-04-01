import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ChatLiveStream } from "../types";
import { consumeChatLiveStream, type ChatLiveEvent } from "./liveStream";

type ActiveLiveStreamConnection = Readonly<{
  sessionId: string;
  abortController: AbortController;
}>;

type LiveStreamDisposition = "pending" | "terminal";

type UseChatLiveSessionParams = Readonly<{
  applyLiveEvent: (event: ChatLiveEvent) => void;
  finalizeInterruptedRun: (message: string) => void;
  onVisibleResumeRequested: () => void;
  onUnexpectedStreamEnd: (sessionId: string) => void;
}>;

export type ChatLiveSessionState = Readonly<{
  isLiveStreamConnected: boolean;
  isDocumentVisibleRef: MutableRefObject<boolean>;
  hasActiveLiveConnection: () => boolean;
  startLiveStream: (sessionId: string, liveStream: ChatLiveStream | null, afterCursor: string | null) => void;
  detachLiveStream: (sessionId: string | null) => void;
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
  } = params;
  const [isLiveStreamConnected, setIsLiveStreamConnected] = useState<boolean>(false);
  const activeLiveConnectionRef = useRef<ActiveLiveStreamConnection | null>(null);
  const isDocumentVisibleRef = useRef<boolean>(isDocumentVisible());
  const applyLiveEventRef = useRef<(event: ChatLiveEvent) => void>(applyLiveEvent);
  const finalizeInterruptedRunRef = useRef<(message: string) => void>(finalizeInterruptedRun);
  const onVisibleResumeRequestedRef = useRef<() => void>(onVisibleResumeRequested);
  const onUnexpectedStreamEndRef = useRef<(sessionId: string) => void>(onUnexpectedStreamEnd);
  const hasActiveLiveConnection = useCallback((): boolean => activeLiveConnectionRef.current !== null, []);

  const detachLiveStream = useCallback((sessionId: string | null): void => {
    const activeConnection = activeLiveConnectionRef.current;
    if (activeConnection === null) {
      return;
    }

    if (sessionId !== null && activeConnection.sessionId !== sessionId) {
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

  /**
   * Attaches live SSE only while the chat surface is visible. Existing sessions
   * must provide the latest known cursor so the stream continues after the last
   * trusted snapshot/bootstrap boundary instead of replaying older turns.
   */
  const startLiveStream = useCallback((
    sessionId: string,
    liveStream: ChatLiveStream | null,
    afterCursor: string | null,
  ): void => {
    detachLiveStream(null);

    if (isDocumentVisibleRef.current === false) {
      return;
    }

    if (liveStream === null) {
      finalizeInterruptedRunRef.current("AI live stream is unavailable for the active run.");
      return;
    }

    const abortController = new AbortController();
    let liveStreamDisposition: LiveStreamDisposition = "pending";
    activeLiveConnectionRef.current = { sessionId, abortController };
    setIsLiveStreamConnected(false);

    void consumeChatLiveStream({
      liveStream,
      sessionId,
      afterCursor,
      signal: abortController.signal,
      onEvent: (event) => {
        if (activeLiveConnectionRef.current?.sessionId !== sessionId) {
          return;
        }

        if (
          event.type === "assistant_message_done"
          || event.type === "error"
          || event.type === "reset_required"
        ) {
          liveStreamDisposition = "terminal";
        }

        setIsLiveStreamConnected(true);
        applyLiveEventRef.current(event);
      },
    }).then(() => {
      if (abortController.signal.aborted) {
        return;
      }

      if (activeLiveConnectionRef.current?.sessionId !== sessionId) {
        return;
      }

      activeLiveConnectionRef.current = null;
      setIsLiveStreamConnected(false);
      if (liveStreamDisposition === "terminal") {
        return;
      }

      onUnexpectedStreamEndRef.current(sessionId);
    }).catch((error: unknown) => {
      if (abortController.signal.aborted) {
        return;
      }

      if (activeLiveConnectionRef.current?.sessionId !== sessionId) {
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
        detachLiveStream(null);
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
      detachLiveStream(null);
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
