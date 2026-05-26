import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendReviewReactionEvent,
  makeReviewReactionRating,
  matchesReducedReviewReactionMotion,
  reviewReactionCleanupDelayMillis,
  reviewReactionMaximumActiveEvents,
  reviewReactionVariantTotalWeight,
  reducedReviewReactionMotionMediaQuery,
  selectReviewReactionVariant,
  type ReviewReactionEvent,
  type ReviewReactionMotionMode,
  type ReviewReactionRenderableVariant,
} from "./reviewReaction";
import {
  isReviewReactionLottieVariant,
  reviewReactionLottieFallbackVariant,
} from "./reviewReactionLottie";

export type UseReviewRatingReactionsResult = Readonly<{
  emitReaction: (rating: 0 | 1 | 2 | 3) => void;
  events: ReadonlyArray<ReviewReactionEvent>;
  handleReactionEventFallback: (eventId: string) => void;
}>;

function clearReviewReactionTimer(
  cleanupTimers: Map<string, number>,
  eventId: string,
): void {
  const timerId = cleanupTimers.get(eventId);
  if (timerId === undefined) {
    return;
  }

  window.clearTimeout(timerId);
  cleanupTimers.delete(eventId);
}

function clearTrimmedReviewReactionTimers(
  cleanupTimers: Map<string, number>,
  retainedEvents: ReadonlyArray<ReviewReactionEvent>,
): void {
  const retainedEventIds = new Set(retainedEvents.map((event) => event.id));
  for (const eventId of cleanupTimers.keys()) {
    if (!retainedEventIds.has(eventId)) {
      clearReviewReactionTimer(cleanupTimers, eventId);
    }
  }
}

export function useReviewRatingReactions(): UseReviewRatingReactionsResult {
  const [events, setEvents] = useState<ReadonlyArray<ReviewReactionEvent>>([]);
  const [motionMode, setMotionMode] = useState<ReviewReactionMotionMode>(
    matchesReducedReviewReactionMotion() ? "reduced" : "standard",
  );
  const eventsRef = useRef<ReadonlyArray<ReviewReactionEvent>>([]);
  const cleanupTimersRef = useRef<Map<string, number>>(new Map<string, number>());

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQueryList = window.matchMedia(reducedReviewReactionMotionMediaQuery);
    const handleMediaQueryChange = (event: MediaQueryListEvent): void => {
      setMotionMode(event.matches ? "reduced" : "standard");
    };

    setMotionMode(mediaQueryList.matches ? "reduced" : "standard");
    mediaQueryList.addEventListener("change", handleMediaQueryChange);
    return () => mediaQueryList.removeEventListener("change", handleMediaQueryChange);
  }, []);

  useEffect(() => {
    return () => {
      for (const timerId of cleanupTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      cleanupTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    clearTrimmedReviewReactionTimers(cleanupTimersRef.current, events);
  }, [events]);

  const removeReactionEvent = useCallback((eventId: string): void => {
    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    setEvents((currentEvents) => {
      const nextEvents = currentEvents.filter((activeEvent) => activeEvent.id !== eventId);
      eventsRef.current = nextEvents;
      return nextEvents;
    });
  }, []);

  const scheduleReactionEventCleanup = useCallback((
    eventId: string,
    variant: ReviewReactionRenderableVariant,
  ): void => {
    const cleanupTimerId = window.setTimeout(() => {
      removeReactionEvent(eventId);
    }, reviewReactionCleanupDelayMillis(variant, motionMode));
    cleanupTimersRef.current.set(eventId, cleanupTimerId);
  }, [motionMode, removeReactionEvent]);

  const emitReaction = useCallback((rating: 0 | 1 | 2 | 3): void => {
    const reactionRating = makeReviewReactionRating(rating);
    const totalWeight = reviewReactionVariantTotalWeight(reactionRating);
    const event: ReviewReactionEvent = {
      id: crypto.randomUUID(),
      rating: reactionRating,
      variant: selectReviewReactionVariant(
        reactionRating,
        Math.floor(Math.random() * totalWeight),
      ),
    };
    scheduleReactionEventCleanup(event.id, event.variant);

    setEvents((currentEvents) => {
      const nextEvents = appendReviewReactionEvent(
        currentEvents,
        event,
        reviewReactionMaximumActiveEvents,
      );
      eventsRef.current = nextEvents;
      return nextEvents;
    });
  }, [scheduleReactionEventCleanup]);

  const handleReactionEventFallback = useCallback((eventId: string): void => {
    const event = eventsRef.current.find((activeEvent) => activeEvent.id === eventId);
    if (event === undefined || !isReviewReactionLottieVariant(event.variant)) {
      return;
    }

    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    scheduleReactionEventCleanup(eventId, reviewReactionLottieFallbackVariant);
    setEvents((currentEvents) => {
      const nextEvents = currentEvents.map((activeEvent) => {
        if (activeEvent.id !== eventId || !isReviewReactionLottieVariant(activeEvent.variant)) {
          return activeEvent;
        }

        return {
          ...activeEvent,
          variant: reviewReactionLottieFallbackVariant,
        };
      });
      eventsRef.current = nextEvents;
      return nextEvents;
    });
  }, [scheduleReactionEventCleanup]);

  return {
    emitReaction,
    events,
    handleReactionEventFallback,
  };
}
