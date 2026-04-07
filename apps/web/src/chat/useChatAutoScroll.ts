import { useEffect, useRef, type RefObject } from "react";
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  AUTO_SCROLL_INTERVAL_MS,
} from "./chatHelpers";
import type { StoredMessage } from "./useChatHistory";

const PROGRAMMATIC_SCROLL_SUPPRESSION_MS = 750;
const USER_SCROLL_INTENT_TIMEOUT_MS = 750;

export type UseChatAutoScrollParams = Readonly<{
  isHydrated: boolean;
  isStreaming: boolean;
  messages: ReadonlyArray<StoredMessage>;
  messagesRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
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

function scrollToBottomSmooth(element: HTMLDivElement): void {
  element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
}

/**
 * Keeps the messages pane snapped to the latest content while preserving the
 * current UX contract for persisted history, streamed batching, and manual
 * scroll overrides.
 */
export function useChatAutoScroll(params: UseChatAutoScrollParams): UseChatAutoScrollResult {
  const { isHydrated, isStreaming, messages, messagesRef, messagesContentRef } = params;
  // Follow stays enabled until a user-driven scroll gesture detaches the view from the bottom.
  const isAutoFollowEnabledRef = useRef<boolean>(true);
  const hasPendingScrollRef = useRef<boolean>(false);
  const autoScrollIntervalIdRef = useRef<number | null>(null);
  const hasInitialBottomSnapRef = useRef<boolean>(false);
  const programmaticScrollTimeoutIdRef = useRef<number | null>(null);
  const userScrollIntentTimeoutIdRef = useRef<number | null>(null);
  const isProgrammaticScrollActiveRef = useRef<boolean>(false);
  const isUserScrollIntentActiveRef = useRef<boolean>(false);

  function flushPendingAutoScroll(): void {
    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    if (
      isAutoFollowEnabledRef.current === false
      || hasPendingScrollRef.current === false
      || isProgrammaticScrollActiveRef.current
    ) {
      return;
    }

    scrollToBottomSmooth(element);
    hasPendingScrollRef.current = false;
  }

  function clearProgrammaticScrollSuppression(): void {
    isProgrammaticScrollActiveRef.current = false;
    if (programmaticScrollTimeoutIdRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutIdRef.current);
      programmaticScrollTimeoutIdRef.current = null;
    }
  }

  function startProgrammaticScrollSuppression(element: HTMLDivElement): void {
    // Ignore scroll events emitted by our own smooth-scroll until the motion settles.
    isProgrammaticScrollActiveRef.current = true;
    if (programmaticScrollTimeoutIdRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutIdRef.current);
    }

    if ("onscrollend" in element) {
      const handleScrollEnd = (): void => {
        clearProgrammaticScrollSuppression();
      };

      element.addEventListener("scrollend", handleScrollEnd, { once: true });
      programmaticScrollTimeoutIdRef.current = window.setTimeout(() => {
        element.removeEventListener("scrollend", handleScrollEnd);
        clearProgrammaticScrollSuppression();
      }, PROGRAMMATIC_SCROLL_SUPPRESSION_MS);
      return;
    }

    programmaticScrollTimeoutIdRef.current = window.setTimeout(() => {
      clearProgrammaticScrollSuppression();
    }, PROGRAMMATIC_SCROLL_SUPPRESSION_MS);
  }

  function markUserScrollIntent(): void {
    if (isProgrammaticScrollActiveRef.current) {
      return;
    }

    isUserScrollIntentActiveRef.current = true;
    if (userScrollIntentTimeoutIdRef.current !== null) {
      window.clearTimeout(userScrollIntentTimeoutIdRef.current);
    }

    userScrollIntentTimeoutIdRef.current = window.setTimeout(() => {
      isUserScrollIntentActiveRef.current = false;
      userScrollIntentTimeoutIdRef.current = null;
    }, USER_SCROLL_INTENT_TIMEOUT_MS);
  }

  function scrollToBottom(element: HTMLDivElement, isAnimated: boolean): void {
    startProgrammaticScrollSuppression(element);
    if (isAnimated) {
      scrollToBottomSmooth(element);
      return;
    }

    element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
  }

  useEffect(() => {
    if (!isHydrated || hasInitialBottomSnapRef.current) {
      return;
    }

    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    scrollToBottom(element, false);
    hasInitialBottomSnapRef.current = true;
    isAutoFollowEnabledRef.current = true;
    hasPendingScrollRef.current = false;
  }, [isHydrated, messagesRef]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    const handleUserScrollIntent = (): void => {
      markUserScrollIntent();
    };

    element.addEventListener("wheel", handleUserScrollIntent, { passive: true });
    element.addEventListener("mousedown", handleUserScrollIntent);
    element.addEventListener("pointerdown", handleUserScrollIntent);
    element.addEventListener("pointermove", handleUserScrollIntent);
    element.addEventListener("touchstart", handleUserScrollIntent, { passive: true });
    element.addEventListener("touchmove", handleUserScrollIntent, { passive: true });
    element.addEventListener("keydown", handleUserScrollIntent);

    return () => {
      element.removeEventListener("wheel", handleUserScrollIntent);
      element.removeEventListener("mousedown", handleUserScrollIntent);
      element.removeEventListener("pointerdown", handleUserScrollIntent);
      element.removeEventListener("pointermove", handleUserScrollIntent);
      element.removeEventListener("touchstart", handleUserScrollIntent);
      element.removeEventListener("touchmove", handleUserScrollIntent);
      element.removeEventListener("keydown", handleUserScrollIntent);
    };
  }, [isHydrated, messagesRef]);

  useEffect(() => {
    if (!isHydrated || hasInitialBottomSnapRef.current === false) {
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
    if (!isHydrated || hasInitialBottomSnapRef.current === false) {
      return;
    }

    const contentElement = messagesContentRef.current;
    if (contentElement === null || typeof ResizeObserver === "undefined") {
      return;
    }

    // Keep following when the rendered content grows in place without a new message boundary.
    const resizeObserver = new ResizeObserver(() => {
      if (isAutoFollowEnabledRef.current === false || isProgrammaticScrollActiveRef.current) {
        return;
      }

      hasPendingScrollRef.current = true;
      flushPendingAutoScroll();
    });

    resizeObserver.observe(contentElement);
    return () => {
      resizeObserver.disconnect();
    };
  }, [isHydrated, messagesContentRef]);

  useEffect(() => {
    return () => {
      if (autoScrollIntervalIdRef.current !== null) {
        window.clearInterval(autoScrollIntervalIdRef.current);
        autoScrollIntervalIdRef.current = null;
      }
      if (programmaticScrollTimeoutIdRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutIdRef.current);
        programmaticScrollTimeoutIdRef.current = null;
      }
      if (userScrollIntentTimeoutIdRef.current !== null) {
        window.clearTimeout(userScrollIntentTimeoutIdRef.current);
        userScrollIntentTimeoutIdRef.current = null;
      }
    };
  }, []);

  function handleMessagesScroll(): void {
    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    if (isProgrammaticScrollActiveRef.current) {
      return;
    }

    if (isUserScrollIntentActiveRef.current) {
      isAutoFollowEnabledRef.current = isNearBottom(element);
    }

    if (isAutoFollowEnabledRef.current && !isStreaming) {
      flushPendingAutoScroll();
    }
  }

  return {
    handleMessagesScroll,
  };
}
