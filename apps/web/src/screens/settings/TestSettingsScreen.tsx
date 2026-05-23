import { useEffect, useRef, useState, type ReactElement } from "react";
import { type TranslationKey, type TranslationValues, useI18n } from "../../i18n";
import { settingsTestAnimationsRoute } from "../../routes";
import {
  appendReviewReactionEvent,
  matchesReducedReviewReactionMotion,
  reviewReactionCleanupDelayMillis,
  reviewReactionMaximumActiveEvents,
  reviewReactionRatings,
  reviewReactionVariantDistributionEntries,
  reducedReviewReactionMotionMediaQuery,
  type ReviewReactionEvent,
  type ReviewReactionMotionMode,
  type ReviewReactionRating,
  type ReviewReactionVariantDistributionEntry,
} from "../review/reactions/reviewReaction";
import { ReviewRatingReactionLayer } from "../review/reactions/ReviewRatingReactionLayer";
import { reviewReactionVariantWithReadyLottieFallback } from "../review/reactions/reviewReactionLottie";
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
  const percentText = `${formatNumber(entry.probabilityPercent, probabilityFormatOptions)}%`;
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
    }
  }
}

export function TestAnimationsScreen(): ReactElement {
  const { t, formatNumber } = useI18n();
  const [activeReviewReactionEvents, setActiveReviewReactionEvents] = useState<ReadonlyArray<ReviewReactionEvent>>([]);
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
    return (): void => {
      mediaQueryList.removeEventListener("change", handleMediaQueryChange);
    };
  }, []);

  useEffect(() => {
    return (): void => {
      for (const timerId of cleanupTimersRef.current.values()) {
        window.clearTimeout(timerId);
      }
      cleanupTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    clearTrimmedReviewReactionTimers(cleanupTimersRef.current, activeReviewReactionEvents);
  }, [activeReviewReactionEvents]);

  function playAnimation(entry: ReviewReactionVariantDistributionEntry): void {
    const event: ReviewReactionEvent = {
      id: crypto.randomUUID(),
      rating: entry.rating,
      variant: reviewReactionVariantWithReadyLottieFallback(entry.variant),
    };
    const cleanupTimerId = window.setTimeout(() => {
      clearReviewReactionTimer(cleanupTimersRef.current, event.id);
      setActiveReviewReactionEvents((currentEvents) => (
        currentEvents.filter((activeEvent) => activeEvent.id !== event.id)
      ));
    }, reviewReactionCleanupDelayMillis(event.variant, motionMode));
    cleanupTimersRef.current.set(event.id, cleanupTimerId);

    setActiveReviewReactionEvents((currentEvents) => appendReviewReactionEvent(
      currentEvents,
      event,
      reviewReactionMaximumActiveEvents,
    ));
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
                  onClick={() => playAnimation(entry)}
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
      <ReviewRatingReactionLayer events={activeReviewReactionEvents} />
    </SettingsShell>
  );
}
