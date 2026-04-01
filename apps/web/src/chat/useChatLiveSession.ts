import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ChatLiveStream } from "../types";
import { consumeChatLiveStream, type ChatLiveEvent } from "./liveStream";

type ActiveLiveStreamConnection = Readonly<{
  sessionId: string;
  abortController: AbortController;
}>;

type UseChatLiveSessionParams = Readonly<{
  applyLiveEvent: (event: ChatLiveEvent) => void;
  finalizeInterruptedRun: (message: string) => void;
  onVisibleResumeRequested: () => void;
  onUnexpectedStreamEnd: () => void;
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
      finalizeInterruptedRun("AI live stream is unavailable for the active run.");
      return;
    }

    const abortController = new AbortController();
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

        setIsLiveStreamConnected(true);
        applyLiveEvent(event);
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
      onUnexpectedStreamEnd();
    }).catch((error: unknown) => {
      if (abortController.signal.aborted) {
        return;
      }

      if (activeLiveConnectionRef.current?.sessionId !== sessionId) {
        return;
      }

      activeLiveConnectionRef.current = null;
      setIsLiveStreamConnected(false);
      finalizeInterruptedRun(error instanceof Error ? error.message : String(error));
    });
  }, [applyLiveEvent, detachLiveStream, finalizeInterruptedRun, onUnexpectedStreamEnd]);

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
      const nextIsVisible = isDocumentVisible();
      isDocumentVisibleRef.current = nextIsVisible;

      if (nextIsVisible === false) {
        detachLiveStream(null);
        return;
      }

      onVisibleResumeRequested();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [detachLiveStream, onVisibleResumeRequested]);

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
