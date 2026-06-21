import { useEffect, useRef, type RefObject } from "react";
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  AUTO_SCROLL_INTERVAL_MS,
} from "../shared/chatHelpers";
import type { ToolCallContentPart } from "../../types";
import type { StoredMessage } from "./useChatHistory";

const PROGRAMMATIC_SCROLL_SUPPRESSION_MS = 750;
const USER_SCROLL_INTENT_TIMEOUT_MS = 750;

type ChatScrollState = Readonly<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  wasNearBottom: boolean;
}>;

const savedScrollStatesByKey = new Map<string, ChatScrollState>();

type StreamPosition = NonNullable<ToolCallContentPart["streamPosition"]>;

export type UseChatAutoScrollParams = Readonly<{
  isHydrated: boolean;
  isStreaming: boolean;
  messages: ReadonlyArray<StoredMessage>;
  messagesRef: RefObject<HTMLDivElement | null>;
  messagesContentRef: RefObject<HTMLDivElement | null>;
  scrollKey: string | null;
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

function readScrollState(element: HTMLDivElement): ChatScrollState {
  return {
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    wasNearBottom: isNearBottom(element),
  };
}

function readSavedScrollState(scrollKey: string | null): ChatScrollState | null {
  return scrollKey === null ? null : savedScrollStatesByKey.get(scrollKey) ?? null;
}

function saveScrollState(scrollKey: string | null, scrollState: ChatScrollState): void {
  if (scrollKey === null) {
    return;
  }

  savedScrollStatesByKey.set(scrollKey, scrollState);
}

function areStreamPositionsEqual(
  previousPosition: StreamPosition | undefined,
  nextPosition: StreamPosition | undefined,
): boolean {
  if (previousPosition === nextPosition) {
    return true;
  }

  if (previousPosition === undefined || nextPosition === undefined) {
    return false;
  }

  return previousPosition.itemId === nextPosition.itemId
    && previousPosition.responseIndex === nextPosition.responseIndex
    && previousPosition.outputIndex === nextPosition.outputIndex
    && previousPosition.contentIndex === nextPosition.contentIndex
    && previousPosition.sequenceNumber === nextPosition.sequenceNumber;
}

function areContentPartsEqual(
  previousParts: StoredMessage["content"],
  nextParts: StoredMessage["content"],
): boolean {
  if (previousParts === nextParts) {
    return true;
  }

  if (previousParts.length !== nextParts.length) {
    return false;
  }

  for (let index = 0; index < previousParts.length; index += 1) {
    const previousPart = previousParts[index];
    const nextPart = nextParts[index];
    if (previousPart?.type !== nextPart?.type) {
      return false;
    }

    switch (previousPart?.type) {
      case "text":
        if (nextPart.type !== "text" || previousPart.text !== nextPart.text) {
          return false;
        }
        break;
      case "image":
        if (
          nextPart.type !== "image"
          || previousPart.mediaType !== nextPart.mediaType
          || previousPart.base64Data !== nextPart.base64Data
        ) {
          return false;
        }
        break;
      case "file":
        if (
          nextPart.type !== "file"
          || previousPart.mediaType !== nextPart.mediaType
          || previousPart.base64Data !== nextPart.base64Data
          || previousPart.fileName !== nextPart.fileName
        ) {
          return false;
        }
        break;
      case "card":
        if (
          nextPart.type !== "card"
          || previousPart.cardId !== nextPart.cardId
          || previousPart.frontText !== nextPart.frontText
          || previousPart.backText !== nextPart.backText
          || previousPart.tags.length !== nextPart.tags.length
          || previousPart.tags.some((tag, tagIndex) => tag !== nextPart.tags[tagIndex])
        ) {
          return false;
        }
        break;
      case "tool_call":
        if (
          nextPart.type !== "tool_call"
          || previousPart.id !== nextPart.id
          || previousPart.name !== nextPart.name
          || previousPart.status !== nextPart.status
          || previousPart.providerStatus !== nextPart.providerStatus
          || previousPart.input !== nextPart.input
          || previousPart.output !== nextPart.output
          || areStreamPositionsEqual(previousPart.streamPosition, nextPart.streamPosition) === false
        ) {
          return false;
        }
        break;
      case "reasoning_summary":
        if (
          nextPart.type !== "reasoning_summary"
          || previousPart.reasoningId !== nextPart.reasoningId
          || previousPart.summary !== nextPart.summary
          || previousPart.status !== nextPart.status
          || areStreamPositionsEqual(previousPart.streamPosition, nextPart.streamPosition) === false
        ) {
          return false;
        }
        break;
      default:
        return false;
    }
  }

  return true;
}

function areMessagesEqual(
  previousMessage: StoredMessage,
  nextMessage: StoredMessage,
): boolean {
  return previousMessage === nextMessage
    || (
      previousMessage.role === nextMessage.role
      && previousMessage.timestamp === nextMessage.timestamp
      && previousMessage.isError === nextMessage.isError
      && previousMessage.isStopped === nextMessage.isStopped
      && (previousMessage.itemId ?? null) === (nextMessage.itemId ?? null)
      && (previousMessage.cursor ?? null) === (nextMessage.cursor ?? null)
      && areContentPartsEqual(previousMessage.content, nextMessage.content)
    );
}

function hasSameIncrementalMessageIdentity(
  previousMessage: StoredMessage,
  nextMessage: StoredMessage,
): boolean {
  const previousItemId = previousMessage.itemId ?? null;
  const nextItemId = nextMessage.itemId ?? null;
  return previousMessage.role === nextMessage.role
    && previousMessage.timestamp === nextMessage.timestamp
    && previousMessage.role === "assistant"
    && nextItemId !== null
    && (previousItemId === nextItemId || previousItemId === null);
}

function isIncrementalMessageUpdate(
  previousMessages: ReadonlyArray<StoredMessage>,
  nextMessages: ReadonlyArray<StoredMessage>,
): boolean {
  if (nextMessages.length < previousMessages.length) {
    return false;
  }

  if (nextMessages.length > previousMessages.length) {
    return previousMessages.every((message, index) => {
      const nextMessage = nextMessages[index];
      return nextMessage !== undefined && areMessagesEqual(message, nextMessage);
    });
  }

  if (previousMessages.length === 0) {
    return true;
  }

  const lastIndex = previousMessages.length - 1;
  for (let index = 0; index < lastIndex; index += 1) {
    const previousMessage = previousMessages[index];
    const nextMessage = nextMessages[index];
    if (previousMessage === undefined || nextMessage === undefined || areMessagesEqual(previousMessage, nextMessage) === false) {
      return false;
    }
  }

  const previousLastMessage = previousMessages[lastIndex];
  const nextLastMessage = nextMessages[lastIndex];
  if (previousLastMessage === undefined || nextLastMessage === undefined) {
    return false;
  }

  return previousLastMessage === nextLastMessage
    || hasSameIncrementalMessageIdentity(previousLastMessage, nextLastMessage);
}

/**
 * Keeps the messages pane snapped to the latest content while preserving the
 * current UX contract for persisted history, streamed batching, and manual
 * scroll overrides.
 */
export function useChatAutoScroll(params: UseChatAutoScrollParams): UseChatAutoScrollResult {
  const { isHydrated, isStreaming, messages, messagesRef, messagesContentRef, scrollKey } = params;
  // Follow stays enabled until a user-driven scroll gesture detaches the view from the bottom.
  const isAutoFollowEnabledRef = useRef<boolean>(true);
  const hasPendingScrollRef = useRef<boolean>(false);
  const autoScrollIntervalIdRef = useRef<number | null>(null);
  const hasRestoredScrollKeyRef = useRef<boolean>(false);
  const restoredScrollKeyRef = useRef<string | null>(null);
  const lastScrollStateRef = useRef<ChatScrollState | null>(null);
  const previousMessagesRef = useRef<ReadonlyArray<StoredMessage> | null>(null);
  const programmaticScrollTimeoutIdRef = useRef<number | null>(null);
  const userScrollIntentTimeoutIdRef = useRef<number | null>(null);
  const isProgrammaticScrollActiveRef = useRef<boolean>(false);
  const isUserScrollIntentActiveRef = useRef<boolean>(false);

  function getPersistedScrollState(scrollState: ChatScrollState): ChatScrollState {
    if (isAutoFollowEnabledRef.current || hasPendingScrollRef.current) {
      return {
        ...scrollState,
        wasNearBottom: true,
      };
    }

    return scrollState;
  }

  function saveRememberedScrollStateForKey(key: string | null, scrollState: ChatScrollState): void {
    saveScrollState(key, getPersistedScrollState(scrollState));
  }

  function saveRememberedScrollState(scrollState: ChatScrollState): void {
    saveRememberedScrollStateForKey(scrollKey, scrollState);
  }

  function rememberScrollState(element: HTMLDivElement): ChatScrollState {
    const scrollState = readScrollState(element);
    lastScrollStateRef.current = scrollState;
    saveRememberedScrollState(scrollState);
    return scrollState;
  }

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
    rememberScrollState(element);
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

  function restoreScrollTop(element: HTMLDivElement, scrollTop: number): void {
    startProgrammaticScrollSuppression(element);
    element.scrollTo({ top: Math.max(0, scrollTop), behavior: "auto" });
  }

  function preserveDetachedAnchor(element: HTMLDivElement, previousScrollState: ChatScrollState): void {
    const scrollHeightDelta = element.scrollHeight - previousScrollState.scrollHeight;
    if (scrollHeightDelta === 0) {
      return;
    }

    restoreScrollTop(element, previousScrollState.scrollTop + scrollHeightDelta);
  }

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (hasRestoredScrollKeyRef.current && restoredScrollKeyRef.current === scrollKey) {
      return;
    }

    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    const savedScrollState = readSavedScrollState(scrollKey);
    if (savedScrollState !== null && savedScrollState.wasNearBottom === false) {
      restoreScrollTop(element, savedScrollState.scrollTop);
      isAutoFollowEnabledRef.current = false;
    } else {
      scrollToBottom(element, false);
      isAutoFollowEnabledRef.current = true;
    }

    hasRestoredScrollKeyRef.current = true;
    restoredScrollKeyRef.current = scrollKey;
    hasPendingScrollRef.current = false;
    previousMessagesRef.current = messages;
    rememberScrollState(element);
  }, [isHydrated, messages, messagesRef, scrollKey]);

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
    if (!isHydrated || hasRestoredScrollKeyRef.current === false) {
      return;
    }

    const element = messagesRef.current;
    if (element === null) {
      return;
    }

    const previousMessages = previousMessagesRef.current;
    const previousScrollState = lastScrollStateRef.current;
    if (
      previousMessages !== null
      && previousScrollState !== null
      && isAutoFollowEnabledRef.current === false
    ) {
      if (isIncrementalMessageUpdate(previousMessages, messages) === false) {
        preserveDetachedAnchor(element, previousScrollState);
      }

      hasPendingScrollRef.current = false;
      previousMessagesRef.current = messages;
      rememberScrollState(element);
      return;
    }

    hasPendingScrollRef.current = true;
    if (isStreaming === false) {
      flushPendingAutoScroll();
    }
    previousMessagesRef.current = messages;
    rememberScrollState(element);
  }, [isHydrated, isStreaming, messages, messagesRef]);

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
  }, [isHydrated, isStreaming, scrollKey]);

  useEffect(() => {
    if (!isHydrated || hasRestoredScrollKeyRef.current === false) {
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
    const keyForCleanup = scrollKey;
    return () => {
      const scrollState = lastScrollStateRef.current;
      if (scrollState === null) {
        return;
      }

      saveRememberedScrollStateForKey(keyForCleanup, scrollState);
    };
  }, [scrollKey]);

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

    const scrollState = readScrollState(element);
    lastScrollStateRef.current = scrollState;
    if (isUserScrollIntentActiveRef.current) {
      isAutoFollowEnabledRef.current = scrollState.wasNearBottom;
      if (scrollState.wasNearBottom === false) {
        hasPendingScrollRef.current = false;
      }
    }
    saveRememberedScrollState(scrollState);

    if (isAutoFollowEnabledRef.current && !isStreaming) {
      flushPendingAutoScroll();
    }
  }

  return {
    handleMessagesScroll,
  };
}
