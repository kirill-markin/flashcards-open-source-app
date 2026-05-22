import { useCallback, useEffect, useRef, useState } from "react";
import {
  appendReviewReactionEvent,
  makeReviewReactionRating,
  matchesReducedReviewReactionMotion,
  reviewReactionCleanupDelayMillis,
  reviewReactionMaximumActiveEvents,
  reducedReviewReactionMotionMediaQuery,
  selectReviewReactionVariant,
  type ReviewReactionEvent,
  type ReviewReactionMotionMode,
} from "./reviewReaction";

export type UseReviewRatingReactionsResult = Readonly<{
  emitReaction: (rating: 0 | 1 | 2 | 3) => void;
  events: ReadonlyArray<ReviewReactionEvent>;
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

  const emitReaction = useCallback((rating: 0 | 1 | 2 | 3): void => {
    const reactionRating = makeReviewReactionRating(rating);
    const event: ReviewReactionEvent = {
      id: crypto.randomUUID(),
      rating: reactionRating,
      variant: selectReviewReactionVariant(
        reactionRating,
        Math.floor(Math.random() * 1000),
      ),
    };
    const cleanupTimerId = window.setTimeout(() => {
      clearReviewReactionTimer(cleanupTimersRef.current, event.id);
      setEvents((currentEvents) => currentEvents.filter((activeEvent) => activeEvent.id !== event.id));
    }, reviewReactionCleanupDelayMillis(event.variant, motionMode));
    cleanupTimersRef.current.set(event.id, cleanupTimerId);

    setEvents((currentEvents) => {
      return appendReviewReactionEvent(
        currentEvents,
        event,
        reviewReactionMaximumActiveEvents,
      );
    });
  }, [motionMode]);

  return {
    emitReaction,
    events,
  };
}
