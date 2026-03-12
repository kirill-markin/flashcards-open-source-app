import { useEffect, useRef, type RefObject } from "react";
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  AUTO_SCROLL_INTERVAL_MS,
} from "./chatHelpers";
import type { StoredMessage } from "./useChatHistory";

export type UseChatAutoScrollParams = Readonly<{
  isHydrated: boolean;
  isStreaming: boolean;
  messages: ReadonlyArray<StoredMessage>;
  messagesRef: RefObject<HTMLDivElement | null>;
}>;

export type UseChatAutoScrollResult = Readonly<{
  handleMessagesScroll: () => void;
}>;

/**
 * Returns whether the scroll container is close enough to the bottom for the
 * chat to keep auto-following streamed output.
 */
function isNearBottom(element: HTMLDivElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
}

function scrollToBottomInstant(element: HTMLDivElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
}

function scrollToBottomSmooth(element: HTMLDivElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
}

/**
 * Keeps the messages pane snapped to the latest content while preserving the
 * current UX contract for persisted history, streamed batching, and manual
 * scroll overrides.
 */
export function useChatAutoScroll(params: UseChatAutoScrollParams): UseChatAutoScrollResult {
  const { isHydrated, isStreaming, messages, messagesRef } = params;
  const isAutoScrollEnabledRef = useRef<boolean>(true);
  const hasPendingScrollRef = useRef<boolean>(false);
  const autoScrollIntervalIdRef = useRef<number | null>(null);
  const hasInitialBottomSnapRef = useRef<boolean>(false);
  const shouldSkipNextMessageSyncRef = useRef<boolean>(false);

  function flushPendingAutoScroll(): void {
    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    if (isAutoScrollEnabledRef.current === false || hasPendingScrollRef.current === false) {
      return;
    }

    scrollToBottomSmooth(element);
    hasPendingScrollRef.current = false;
  }

  useEffect(() => {
    if (!isHydrated || hasInitialBottomSnapRef.current) {
      return;
    }

    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    scrollToBottomInstant(element);
    hasInitialBottomSnapRef.current = true;
    shouldSkipNextMessageSyncRef.current = true;
    isAutoScrollEnabledRef.current = isNearBottom(element);
    hasPendingScrollRef.current = false;
  }, [isHydrated, messagesRef]);

  useEffect(() => {
    if (!isHydrated || hasInitialBottomSnapRef.current === false) {
      return;
    }

    if (shouldSkipNextMessageSyncRef.current) {
      shouldSkipNextMessageSyncRef.current = false;
      return;
    }

    hasPendingScrollRef.current = true;
    if (isStreaming === false) {
      flushPendingAutoScroll();
    }
  }, [isHydrated, isStreaming, messages]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (isStreaming) {
      const intervalId = window.setInterval(() => {
        flushPendingAutoScroll();
      }, AUTO_SCROLL_INTERVAL_MS);
      autoScrollIntervalIdRef.current = intervalId;
      return () => {
        window.clearInterval(intervalId);
        if (autoScrollIntervalIdRef.current === intervalId) {
          autoScrollIntervalIdRef.current = null;
        }
      };
    }

    if (autoScrollIntervalIdRef.current !== null) {
      window.clearInterval(autoScrollIntervalIdRef.current);
      autoScrollIntervalIdRef.current = null;
    }

    flushPendingAutoScroll();
  }, [isHydrated, isStreaming]);

  useEffect(() => {
    return () => {
      if (autoScrollIntervalIdRef.current !== null) {
        window.clearInterval(autoScrollIntervalIdRef.current);
        autoScrollIntervalIdRef.current = null;
      }
    };
  }, []);

  function handleMessagesScroll(): void {
    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    isAutoScrollEnabledRef.current = isNearBottom(element);
    if (isAutoScrollEnabledRef.current && !isStreaming) {
      flushPendingAutoScroll();
    }
  }

  return {
    handleMessagesScroll,
  };
}
