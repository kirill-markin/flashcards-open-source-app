import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  appendReviewReactionEvent,
  makeReviewReactionRating,
  matchesReducedReviewReactionMotion,
  reviewReactionCleanupDelayMillis,
  reviewReactionMaximumActiveEvents,
  reviewReactionVariantDistributionEntries,
  reviewReactionVariantTotalWeight,
  reducedReviewReactionMotionMediaQuery,
  selectReviewReactionVariant,
  type ReviewReactionEvent,
  type ReviewReactionMotionMode,
  type ReviewReactionRating,
  type ReviewReactionRenderableVariant,
  type ReviewReactionVariant,
  type ReviewReactionVariantDistributionEntry,
} from "./reviewReaction";
import {
  isReviewReactionLottieAssetReady,
  isReviewReactionLottieVariant,
  releaseReviewReactionLottieRender,
  reserveReviewReactionLottieRender,
  reviewReactionLottieFallbackVariant,
} from "./reviewReactionLottie";

export type UseReviewRatingReactionsParams = Readonly<{
  reviewReactionAnimationsEnabled: boolean;
}>;

export type UseReviewRatingReactionsResult = Readonly<{
  dismissReactions: () => void;
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
      releaseReviewReactionLottieRender(eventId);
    }
  }
}

function reviewReactionDistributionEntryTotalWeight(
  rating: ReviewReactionRating,
  entries: ReadonlyArray<ReviewReactionVariantDistributionEntry>,
): number {
  if (entries.length === 0) {
    throw new Error(`Review reaction ready distribution is missing rating ${rating}.`);
  }

  let totalWeight = 0;
  for (const entry of entries) {
    if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
      throw new RangeError(`Invalid review reaction ready weight for ${entry.id}: ${entry.weight}`);
    }
    totalWeight += entry.weight;
  }

  return totalWeight;
}

function selectReviewReactionVariantFromEntries(
  rating: ReviewReactionRating,
  entries: ReadonlyArray<ReviewReactionVariantDistributionEntry>,
  roll: number,
): ReviewReactionVariant {
  const totalWeight = reviewReactionDistributionEntryTotalWeight(rating, entries);
  if (!Number.isInteger(roll) || roll < 0 || roll >= totalWeight) {
    throw new RangeError(`Review reaction ready roll must be an integer in 0...${totalWeight - 1}, received ${roll}.`);
  }

  let cumulativeWeight = 0;
  for (const entry of entries) {
    cumulativeWeight += entry.weight;
    if (roll < cumulativeWeight) {
      return entry.variant;
    }
  }

  throw new Error(`Review reaction ready distribution is missing rating ${rating} roll ${roll}.`);
}

function readyReviewReactionVariantDistributionEntries(
  rating: ReviewReactionRating,
): ReadonlyArray<ReviewReactionVariantDistributionEntry> {
  return reviewReactionVariantDistributionEntries(rating).filter((entry) => (
    isReviewReactionLottieVariant(entry.variant) && isReviewReactionLottieAssetReady(entry.variant)
  ));
}

function reserveReviewReactionEventVariant(
  eventId: string,
  rating: ReviewReactionRating,
  selectedVariant: ReviewReactionVariant,
): ReviewReactionVariant | null {
  if (
    isReviewReactionLottieVariant(selectedVariant)
    && isReviewReactionLottieAssetReady(selectedVariant)
    && reserveReviewReactionLottieRender(eventId, selectedVariant)
  ) {
    return selectedVariant;
  }

  const readyEntries = readyReviewReactionVariantDistributionEntries(rating);
  if (readyEntries.length === 0) {
    return null;
  }

  const totalWeight = reviewReactionDistributionEntryTotalWeight(rating, readyEntries);
  const readyVariant = selectReviewReactionVariantFromEntries(
    rating,
    readyEntries,
    Math.floor(Math.random() * totalWeight),
  );
  if (!isReviewReactionLottieVariant(readyVariant)) {
    throw new Error(`Review reaction ready variant ${readyVariant} is not a Lottie variant.`);
  }
  if (!reserveReviewReactionLottieRender(eventId, readyVariant)) {
    return null;
  }

  return readyVariant;
}

export function useReviewRatingReactions(
  params: UseReviewRatingReactionsParams,
): UseReviewRatingReactionsResult {
  const { reviewReactionAnimationsEnabled } = params;
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
      for (const event of eventsRef.current) {
        releaseReviewReactionLottieRender(event.id);
      }
      eventsRef.current = [];
    };
  }, []);

  useLayoutEffect(() => {
    clearTrimmedReviewReactionTimers(cleanupTimersRef.current, events);
  }, [events]);

  const removeReactionEvent = useCallback((eventId: string): void => {
    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    releaseReviewReactionLottieRender(eventId);
    setEvents((currentEvents) => {
      const nextEvents = currentEvents.filter((activeEvent) => activeEvent.id !== eventId);
      eventsRef.current = nextEvents;
      return nextEvents;
    });
  }, []);

  const dismissReactions = useCallback((): void => {
    if (eventsRef.current.length === 0 && cleanupTimersRef.current.size === 0) {
      return;
    }

    for (const timerId of cleanupTimersRef.current.values()) {
      window.clearTimeout(timerId);
    }
    cleanupTimersRef.current.clear();

    for (const event of eventsRef.current) {
      releaseReviewReactionLottieRender(event.id);
    }
    eventsRef.current = [];
    setEvents([]);
  }, []);

  useEffect(() => {
    if (reviewReactionAnimationsEnabled === false) {
      dismissReactions();
    }
  }, [dismissReactions, reviewReactionAnimationsEnabled]);

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
    if (reviewReactionAnimationsEnabled === false) {
      return;
    }

    const reactionRating = makeReviewReactionRating(rating);
    const totalWeight = reviewReactionVariantTotalWeight(reactionRating);
    const eventId = crypto.randomUUID();
    const selectedVariant = selectReviewReactionVariant(
      reactionRating,
      Math.floor(Math.random() * totalWeight),
    );
    const reservedVariant = reserveReviewReactionEventVariant(
      eventId,
      reactionRating,
      selectedVariant,
    );
    if (reservedVariant === null) {
      return;
    }

    const event: ReviewReactionEvent = {
      id: eventId,
      rating: reactionRating,
      variant: reservedVariant,
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
  }, [reviewReactionAnimationsEnabled, scheduleReactionEventCleanup]);

  const handleReactionEventFallback = useCallback((eventId: string): void => {
    const event = eventsRef.current.find((activeEvent) => activeEvent.id === eventId);
    if (event === undefined || !isReviewReactionLottieVariant(event.variant)) {
      return;
    }

    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    releaseReviewReactionLottieRender(eventId);
    const fallbackEventId = crypto.randomUUID();
    scheduleReactionEventCleanup(fallbackEventId, reviewReactionLottieFallbackVariant);
    setEvents((currentEvents) => {
      const nextEvents = currentEvents.map((activeEvent) => {
        if (activeEvent.id !== eventId || !isReviewReactionLottieVariant(activeEvent.variant)) {
          return activeEvent;
        }

        return {
          ...activeEvent,
          id: fallbackEventId,
          variant: reviewReactionLottieFallbackVariant,
        };
      });
      eventsRef.current = nextEvents;
      return nextEvents;
    });
  }, [scheduleReactionEventCleanup]);

  return {
    dismissReactions,
    emitReaction,
    events,
    handleReactionEventFallback,
  };
}
