import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { type TranslationKey, type TranslationValues, useI18n } from "../../i18n";
import { settingsTestAnimationsRoute } from "../../routes";
import {
  appendReviewReactionEvent,
  matchesReducedReviewReactionMotion,
  reviewReactionCleanupDelayMillis,
  reviewReactionMaximumActiveEvents,
  reviewReactionRatings,
  reviewReactionVariantProbabilityPercent,
  reviewReactionVariantDistributionEntries,
  reducedReviewReactionMotionMediaQuery,
  type ReviewReactionEvent,
  type ReviewReactionMotionMode,
  type ReviewReactionRating,
  type ReviewReactionRenderableVariant,
  type ReviewReactionVariantDistributionEntry,
} from "../review/reactions/reviewReaction";
import { ReviewRatingReactionLayer } from "../review/reactions/ReviewRatingReactionLayer";
import {
  isReviewReactionLottieVariant,
  loadReviewReactionLottieAsset,
  releaseReviewReactionLottieRender,
  reserveReviewReactionLottieRender,
  reviewReactionLottieFallbackVariant,
  startReviewReactionLottiePrewarm,
} from "../review/reactions/reviewReactionLottie";
import { SettingsGroup, SettingsNavigationCard, SettingsShell } from "./SettingsShared";

type Translate = (key: TranslationKey, values?: TranslationValues) => string;
type FormatNumber = (value: number, options?: Readonly<Intl.NumberFormatOptions>) => string;

const probabilityFormatOptions: Readonly<Intl.NumberFormatOptions> = {
  maximumFractionDigits: 0,
};

export function TestSettingsScreen(): ReactElement {
  const { t } = useI18n();

  return (
    <SettingsShell
      title={t("settingsTest.title")}
      subtitle={t("settingsTest.subtitle")}
      activeTab="test"
    >
      <div data-testid="test-settings-screen">
        <SettingsGroup title={t("settingsTest.toolsGroupTitle")}>
          <div className="settings-nav-list">
            <SettingsNavigationCard
              title={t("settingsTest.animations.title")}
              description={t("settingsTest.animations.description")}
              value={t("settingsTest.animations.value")}
              to={settingsTestAnimationsRoute}
              testId="test-settings-animations-row"
            />
          </div>
        </SettingsGroup>
      </div>
    </SettingsShell>
  );
}

function reviewRatingTitle(rating: ReviewReactionRating, t: Translate): string {
  switch (rating) {
    case "again":
      return t("reviewScreen.ratings.again");
    case "hard":
      return t("reviewScreen.ratings.hard");
    case "good":
      return t("reviewScreen.ratings.good");
    case "easy":
      return t("reviewScreen.ratings.easy");
  }
}

function testAnimationProbabilityText(
  entry: ReviewReactionVariantDistributionEntry,
  formatNumber: FormatNumber,
  t: Translate,
): string {
  const percentText = `${formatNumber(reviewReactionVariantProbabilityPercent(entry), probabilityFormatOptions)}%`;
  return t("settingsTest.animations.probability", {
    percent: percentText,
  });
}

function testAnimationAccessibilityLabel(
  entry: ReviewReactionVariantDistributionEntry,
  formatNumber: FormatNumber,
  t: Translate,
): string {
  return t("settingsTest.animations.playAccessibility", {
    variant: entry.variant,
    probability: testAnimationProbabilityText(entry, formatNumber, t),
  });
}

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

export function TestAnimationsScreen(): ReactElement {
  const { t, formatNumber } = useI18n();
  const [activeReviewReactionEvents, setActiveReviewReactionEvents] = useState<ReadonlyArray<ReviewReactionEvent>>([]);
  const [motionMode, setMotionMode] = useState<ReviewReactionMotionMode>(
    matchesReducedReviewReactionMotion() ? "reduced" : "standard",
  );
  const activeReviewReactionEventsRef = useRef<ReadonlyArray<ReviewReactionEvent>>([]);
  const cleanupTimersRef = useRef<Map<string, number>>(new Map<string, number>());
  const isMountedRef = useRef<boolean>(false);

  function reportTestAnimationPlaybackFailure(
    error: unknown,
    entry: ReviewReactionVariantDistributionEntry,
  ): void {
    console.warn("Review reaction test animation failed.", {
      error,
      rating: entry.rating,
      variant: entry.variant,
    });
  }

  useEffect(() => {
    startReviewReactionLottiePrewarm();
  }, []);

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
    return (): void => {
      mediaQueryList.removeEventListener("change", handleMediaQueryChange);
    };
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    return (): void => {
      isMountedRef.current = false;
      for (const timerId of cleanupTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      cleanupTimersRef.current.clear();
      for (const event of activeReviewReactionEventsRef.current) {
        releaseReviewReactionLottieRender(event.id);
      }
      activeReviewReactionEventsRef.current = [];
    };
  }, []);

  useLayoutEffect(() => {
    clearTrimmedReviewReactionTimers(cleanupTimersRef.current, activeReviewReactionEvents);
  }, [activeReviewReactionEvents]);

  const removeReviewReactionEvent = useCallback((eventId: string): void => {
    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    releaseReviewReactionLottieRender(eventId);
    setActiveReviewReactionEvents((currentEvents) => {
      const nextEvents = currentEvents.filter((activeEvent) => activeEvent.id !== eventId);
      activeReviewReactionEventsRef.current = nextEvents;
      return nextEvents;
    });
  }, []);

  const scheduleReviewReactionEventCleanup = useCallback((
    eventId: string,
    variant: ReviewReactionRenderableVariant,
  ): void => {
    const cleanupTimerId = window.setTimeout(() => {
      removeReviewReactionEvent(eventId);
    }, reviewReactionCleanupDelayMillis(variant, motionMode));
    cleanupTimersRef.current.set(eventId, cleanupTimerId);
  }, [motionMode, removeReviewReactionEvent]);

  const handleReviewReactionEventFallback = useCallback((eventId: string): void => {
    const event = activeReviewReactionEventsRef.current.find((activeEvent) => activeEvent.id === eventId);
    if (event === undefined || !isReviewReactionLottieVariant(event.variant)) {
      return;
    }

    clearReviewReactionTimer(cleanupTimersRef.current, eventId);
    releaseReviewReactionLottieRender(eventId);
    const fallbackEventId = crypto.randomUUID();
    scheduleReviewReactionEventCleanup(fallbackEventId, reviewReactionLottieFallbackVariant);
    setActiveReviewReactionEvents((currentEvents) => {
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
      activeReviewReactionEventsRef.current = nextEvents;
      return nextEvents;
    });
  }, [scheduleReviewReactionEventCleanup]);

  async function reserveTestAnimationRender(
    eventId: string,
    variant: ReviewReactionVariantDistributionEntry["variant"],
  ): Promise<void> {
    if (!isReviewReactionLottieVariant(variant)) {
      throw new Error(`Test animation variant ${variant} is not a Lottie variant.`);
    }
    if (reserveReviewReactionLottieRender(eventId, variant)) {
      return;
    }

    await loadReviewReactionLottieAsset(variant);
    if (reserveReviewReactionLottieRender(eventId, variant)) {
      return;
    }

    throw new Error(`Test animation variant ${variant} was not available after prewarm.`);
  }

  async function playAnimation(entry: ReviewReactionVariantDistributionEntry): Promise<void> {
    if (!isReviewReactionLottieVariant(entry.variant)) {
      throw new Error(`Test animation entry ${entry.id} is not a Lottie variant.`);
    }

    const eventId = crypto.randomUUID();
    await reserveTestAnimationRender(eventId, entry.variant);
    if (!isMountedRef.current) {
      releaseReviewReactionLottieRender(eventId);
      return;
    }

    const event: ReviewReactionEvent = {
      id: eventId,
      rating: entry.rating,
      variant: entry.variant,
    };
    scheduleReviewReactionEventCleanup(event.id, event.variant);

    setActiveReviewReactionEvents((currentEvents) => {
      const nextEvents = appendReviewReactionEvent(
        currentEvents,
        event,
        reviewReactionMaximumActiveEvents,
      );
      activeReviewReactionEventsRef.current = nextEvents;
      return nextEvents;
    });
  }

  return (
    <SettingsShell
      title={t("settingsTest.animations.screenTitle")}
      subtitle={t("settingsTest.animations.screenSubtitle")}
      activeTab="test"
      panelClassName="settings-panel-test-animations"
    >
      <div className="settings-test-animation-list" data-testid="test-animations-screen">
        {reviewReactionRatings.map((rating) => (
          <SettingsGroup key={rating} title={reviewRatingTitle(rating, t)}>
            <div className="settings-test-animation-rows">
              {reviewReactionVariantDistributionEntries(rating).map((entry) => (
                <button
                  key={entry.id}
                  className="settings-test-animation-row content-card"
                  type="button"
                  aria-label={testAnimationAccessibilityLabel(entry, formatNumber, t)}
                  data-review-reaction-rating={entry.rating}
                  data-review-reaction-variant={entry.variant}
                  data-testid="test-animation-row"
                  onClick={() => {
                    void playAnimation(entry).catch((error: unknown) => {
                      reportTestAnimationPlaybackFailure(error, entry);
                    });
                  }}
                >
                  <span className="settings-test-animation-name">{entry.variant}</span>
                  <span className="badge">
                    {testAnimationProbabilityText(entry, formatNumber, t)}
                  </span>
                </button>
              ))}
            </div>
          </SettingsGroup>
        ))}
      </div>
      <ReviewRatingReactionLayer
        events={activeReviewReactionEvents}
        onReactionEventFallback={handleReviewReactionEventFallback}
      />
    </SettingsShell>
  );
}
