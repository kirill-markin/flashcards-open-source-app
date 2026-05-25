import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import type { AnimationItem } from "lottie-web";
import {
  matchesReducedReviewReactionMotion,
  reviewReactionAnimationDurationMillis,
  type ReviewReactionEvent,
  type ReviewReactionRenderableVariant,
} from "./reviewReaction";
import {
  isReviewReactionLottieAssetReady,
  isReviewReactionLottieVariant,
  loadReviewReactionLottieAsset,
  loadReviewReactionLottieAssets,
  reviewReactionLottieFallbackVariant,
  reviewReactionVariantWithReadyLottieFallback,
  type ReviewReactionLottieVariant,
} from "./reviewReactionLottie";

type ReviewRatingReactionLayerProps = Readonly<{
  events: ReadonlyArray<ReviewReactionEvent>;
  onReactionEventFallback: (eventId: string) => void;
}>;

type ReviewReactionStyle = CSSProperties & Readonly<{
  "--review-reaction-duration": string;
}>;

const reviewReactionLottieReducedMotionProgress: number = 0.55;

type ReviewReactionLottieFailurePhase = "preload" | "render";
type ReviewReactionLottieContainerClassMap = Readonly<Record<ReviewReactionLottieVariant, string>>;

const reviewReactionLottieContainerClassByVariant: ReviewReactionLottieContainerClassMap = {
  againWormWiggle: "review-reaction-worm-lottie-mark",
  againTornado: "review-reaction-tornado-lottie-mark",
  againSnailCrawl: "review-reaction-snail-lottie-mark",
  againWiltedFlower: "review-reaction-wilted-flower-lottie-mark",
  goodOwl: "review-reaction-owl-lottie-mark",
  goodPoodle: "review-reaction-poodle-lottie-mark",
  goodWhale: "review-reaction-whale-lottie-mark",
  goodPeacock: "review-reaction-peacock-lottie-mark",
  hardOxCharge: "review-reaction-ox-lottie-mark",
  hardPawPrints: "review-reaction-paw-prints-lottie-mark",
  hardRacehorseGallop: "review-reaction-racehorse-lottie-mark",
  hardVolcanoEruption: "review-reaction-volcano-lottie-mark",
  easyRoseBloom: "review-reaction-rose-lottie-mark",
  easyRainbowStreak: "review-reaction-rainbow-lottie-mark",
  easyPhoenixRise: "review-reaction-phoenix-lottie-mark",
  easyUnicornFlyby: "review-reaction-unicorn-lottie-mark",
};

const reviewReactionLottieNaturalDurationMillisByVariant: Readonly<Record<ReviewReactionLottieVariant, number>> = {
  againWormWiggle: 4267,
  againTornado: 2000,
  againSnailCrawl: 2700,
  againWiltedFlower: 2400,
  goodOwl: 2833,
  goodPoodle: 2800,
  goodWhale: 2633,
  goodPeacock: 1333,
  hardOxCharge: 3300,
  hardPawPrints: 1100,
  hardRacehorseGallop: 517,
  hardVolcanoEruption: 1200,
  easyRoseBloom: 2400,
  easyRainbowStreak: 2000,
  easyPhoenixRise: 3933,
  easyUnicornFlyby: 3800,
};

function reviewReactionLottiePlaybackSpeed(variant: ReviewReactionLottieVariant): number {
  return reviewReactionLottieNaturalDurationMillisByVariant[variant] / reviewReactionAnimationDurationMillis(variant);
}

function makeReviewReactionStyle(event: ReviewReactionEvent): ReviewReactionStyle {
  const variant = reviewReactionVariantWithReadyLottieFallback(event.variant);

  return {
    "--review-reaction-duration": `${reviewReactionAnimationDurationMillis(variant)}ms`,
  };
}

function makeScallopedSealPoints(
  centerX: number,
  centerY: number,
  radius: number,
  teeth: number,
  inset: number,
): string {
  const pointCount = Math.max(teeth * 2, 8);
  const points: Array<string> = [];

  for (let index = 0; index < pointCount; index += 1) {
    const pointRadius = index % 2 === 0 ? radius : radius * (1 - inset);
    const angle = (Math.PI * 2 * index) / pointCount;
    points.push(`${centerX + Math.cos(angle) * pointRadius},${centerY + Math.sin(angle) * pointRadius}`);
  }

  return points.join(" ");
}

function makeSparklePoints(
  centerX: number,
  centerY: number,
  radius: number,
  rotation: number,
): string {
  const points: Array<string> = [];

  for (let index = 0; index < 8; index += 1) {
    const pointRadius = index % 2 === 0 ? radius : radius * 0.34;
    const angle = rotation + (Math.PI * index) / 4;
    points.push(`${centerX + Math.cos(angle) * pointRadius},${centerY + Math.sin(angle) * pointRadius}`);
  }

  return points.join(" ");
}

function EasyCrownBounceReaction(): ReactElement {
  return (
    <g className="review-reaction-crown-mark">
      <path className="review-reaction-yellow-fill" d="M27 62 L31 27 L43 47 L50 22 L57 47 L69 27 L73 62 Z" />
      <path className="review-reaction-orange-stroke" d="M27 62 L31 27 L43 47 L50 22 L57 47 L69 27 L73 62 Z" strokeWidth="3" />
      <rect className="review-reaction-orange-fill" x="25" y="58" width="50" height="11" rx="4" />
      <circle className="review-reaction-pink-fill" cx="31" cy="27" r="4" />
      <circle className="review-reaction-blue-fill" cx="50" cy="22" r="4" />
      <circle className="review-reaction-green-fill" cx="69" cy="27" r="4" />
      <polygon className="review-reaction-sparkle-fill" points={makeSparklePoints(78, 26, 5, 0.2)} />
    </g>
  );
}

function reportReviewReactionLottieFailure(
  error: unknown,
  phase: ReviewReactionLottieFailurePhase,
  variant: ReviewReactionLottieVariant | null,
): void {
  console.warn("Review reaction Lottie asset failed to load.", {
    error,
    phase,
    variant,
  });
}

function ReviewReactionCrownFallbackArt(): ReactElement {
  return (
    <svg className="review-rating-reaction-art review-rating-reaction-crown-fallback-art" viewBox="0 0 100 100" focusable="false">
      {renderReviewReactionVariant(reviewReactionLottieFallbackVariant)}
    </svg>
  );
}

type ReviewReactionLottieAnimationProps = Readonly<{
  eventId: string;
  onReactionEventFallback: (eventId: string) => void;
  variant: ReviewReactionLottieVariant;
}>;

function ReviewReactionLottieAnimation(props: ReviewReactionLottieAnimationProps): ReactElement {
  const { eventId, onReactionEventFallback, variant } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mountedContainer = containerRef.current;
    if (mountedContainer === null) {
      reportReviewReactionLottieFailure(
        new Error("Review reaction Lottie container was not mounted."),
        "render",
        variant,
      );
      onReactionEventFallback(eventId);
      return;
    }
    const container: HTMLDivElement = mountedContainer;

    let animationItem: AnimationItem | null = null;
    let removeDomLoadedListener: (() => void) | null = null;
    let isCancelled = false;

    async function loadReviewReactionLottieAnimation(): Promise<void> {
      const asset = await loadReviewReactionLottieAsset(variant);

      if (isCancelled) {
        return;
      }

      const isReducedMotionEnabled = matchesReducedReviewReactionMotion();
      const nextAnimationItem = asset.player.loadAnimation({
        container,
        renderer: "svg",
        loop: false,
        autoplay: !isReducedMotionEnabled,
        animationData: asset.animationData,
      });

      animationItem = nextAnimationItem;
      nextAnimationItem.setSpeed(reviewReactionLottiePlaybackSpeed(variant));

      if (isReducedMotionEnabled) {
        const showReducedMotionFrame = (): void => {
          nextAnimationItem.goToAndStop(
            nextAnimationItem.totalFrames * reviewReactionLottieReducedMotionProgress,
            true,
          );
        };
        removeDomLoadedListener = nextAnimationItem.addEventListener("DOMLoaded", showReducedMotionFrame);
        if (nextAnimationItem.isLoaded) {
          showReducedMotionFrame();
        }
      }
    }

    void loadReviewReactionLottieAnimation().catch((error: unknown) => {
      if (isCancelled) {
        return;
      }

      reportReviewReactionLottieFailure(error, "render", variant);
      onReactionEventFallback(eventId);
    });

    return () => {
      isCancelled = true;
      removeDomLoadedListener?.();
      animationItem?.destroy();
    };
  }, [eventId, onReactionEventFallback, variant]);

  return (
    <div ref={containerRef} className={reviewReactionLottieContainerClassByVariant[variant]} />
  );
}

function renderReviewReactionVariant(variant: ReviewReactionRenderableVariant): ReactElement {
  switch (variant) {
    case "againWormWiggle":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "againTornado":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "againSnailCrawl":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "againWiltedFlower":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "hardOxCharge":
    case "hardPawPrints":
    case "hardRacehorseGallop":
    case "hardVolcanoEruption":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "goodOwl":
    case "goodPoodle":
    case "goodWhale":
    case "goodPeacock":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "easyRoseBloom":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "easyRainbowStreak":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "easyPhoenixRise":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "fallbackCrownBounce":
      return <EasyCrownBounceReaction />;
    case "easyUnicornFlyby":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
  }
}

function renderReviewReactionArt(
  event: ReviewReactionEvent,
  onReactionEventFallback: (eventId: string) => void,
): ReactElement {
  const { variant } = event;

  if (isReviewReactionLottieVariant(variant)) {
    if (!isReviewReactionLottieAssetReady(variant)) {
      return <ReviewReactionCrownFallbackArt />;
    }

    return (
      <div className="review-rating-reaction-art review-rating-reaction-lottie-art">
        <ReviewReactionLottieAnimation
          eventId={event.id}
          onReactionEventFallback={onReactionEventFallback}
          variant={variant}
        />
      </div>
    );
  }

  return (
    <svg className="review-rating-reaction-art" viewBox="0 0 100 100" focusable="false">
      {renderReviewReactionVariant(variant)}
    </svg>
  );
}

export function ReviewRatingReactionLayer(props: ReviewRatingReactionLayerProps): ReactElement {
  const { events, onReactionEventFallback } = props;

  useEffect(() => {
    let isMounted = true;
    void loadReviewReactionLottieAssets()
      .then((preloadResult) => {
        if (!isMounted) {
          return;
        }

        for (const failure of preloadResult.failures) {
          reportReviewReactionLottieFailure(failure.error, "preload", failure.variant);
        }
      })
      .catch((error: unknown) => {
        if (!isMounted) {
          return;
        }

        reportReviewReactionLottieFailure(error, "preload", null);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="review-rating-reaction-layer" aria-hidden="true" data-testid="review-rating-reaction-layer">
      {events.map((event) => (
        <div
          key={event.id}
          className={`review-rating-reaction-event review-rating-reaction-${event.variant}`}
          data-review-reaction-rating={event.rating}
          data-review-reaction-variant={event.variant}
          data-testid="review-rating-reaction-event"
          style={makeReviewReactionStyle(event)}
        >
          {renderReviewReactionArt(event, onReactionEventFallback)}
        </div>
      ))}
    </div>
  );
}
