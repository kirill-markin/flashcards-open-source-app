import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";
import type { AnimationItem } from "lottie-web";
import {
  matchesReducedReviewReactionMotion,
  reviewReactionAnimationDurationMillis,
  type ReviewReactionEvent,
  type ReviewReactionRenderableVariant,
} from "./reviewReaction";
import {
  isReviewReactionLottieVariant,
  mountReservedReviewReactionLottieRender,
  reviewReactionLottieFallbackVariant,
  unmountReservedReviewReactionLottieRender,
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

type ReviewReactionLottieFailurePhase = "render" | "playback";
type ReviewReactionLottieContainerClassMap = Readonly<Record<ReviewReactionLottieVariant, string>>;

const reviewReactionLottieContainerClassByVariant: ReviewReactionLottieContainerClassMap = {
  againRainCloud: "review-reaction-rain-cloud-lottie-mark",
  againTornado: "review-reaction-tornado-lottie-mark",
  againWindFace: "review-reaction-wind-face-lottie-mark",
  againSnowflake: "review-reaction-snowflake-lottie-mark",
  againSnailCrawl: "review-reaction-snail-lottie-mark",
  againTurtle: "review-reaction-turtle-lottie-mark",
  againWiltedFlower: "review-reaction-wilted-flower-lottie-mark",
  againSpider: "review-reaction-spider-lottie-mark",
  againRat: "review-reaction-rat-lottie-mark",
  againWormWiggle: "review-reaction-worm-lottie-mark",
  hardTiger: "review-reaction-tiger-lottie-mark",
  hardTRex: "review-reaction-t-rex-lottie-mark",
  hardShark: "review-reaction-shark-lottie-mark",
  hardOxCharge: "review-reaction-ox-lottie-mark",
  hardRacehorseGallop: "review-reaction-racehorse-lottie-mark",
  hardSnake: "review-reaction-snake-lottie-mark",
  hardVolcanoEruption: "review-reaction-volcano-lottie-mark",
  hardScorpion: "review-reaction-scorpion-lottie-mark",
  hardPawPrints: "review-reaction-paw-prints-lottie-mark",
  hardRooster: "review-reaction-rooster-lottie-mark",
  goodOtter: "review-reaction-otter-lottie-mark",
  goodOwl: "review-reaction-owl-lottie-mark",
  goodRabbit: "review-reaction-rabbit-lottie-mark",
  goodSeal: "review-reaction-seal-lottie-mark",
  goodServiceDog: "review-reaction-service-dog-lottie-mark",
  goodPoodle: "review-reaction-poodle-lottie-mark",
  goodChimpanzee: "review-reaction-chimpanzee-lottie-mark",
  goodWhale: "review-reaction-whale-lottie-mark",
  goodPeacock: "review-reaction-peacock-lottie-mark",
  goodPig: "review-reaction-pig-lottie-mark",
  easySunrise: "review-reaction-sunrise-lottie-mark",
  easySunriseOverMountains: "review-reaction-sunrise-over-mountains-lottie-mark",
  easyRoseBloom: "review-reaction-rose-lottie-mark",
  easyPeace: "review-reaction-peace-lottie-mark",
  easyPlant: "review-reaction-plant-lottie-mark",
  easyRainbowStreak: "review-reaction-rainbow-lottie-mark",
  easyPhoenixRise: "review-reaction-phoenix-lottie-mark",
  easyUnicornFlyby: "review-reaction-unicorn-lottie-mark",
};

const reviewReactionLottieNaturalDurationMillisByVariant: Readonly<Record<ReviewReactionLottieVariant, number>> = {
  againRainCloud: 3267,
  againTornado: 2000,
  againWindFace: 1600,
  againSnowflake: 4500,
  againSnailCrawl: 2700,
  againTurtle: 3400,
  againWiltedFlower: 2400,
  againSpider: 2400,
  againRat: 2633,
  againWormWiggle: 4267,
  hardTiger: 5100,
  hardTRex: 1550,
  hardShark: 3200,
  hardOxCharge: 3300,
  hardRacehorseGallop: 517,
  hardSnake: 3267,
  hardVolcanoEruption: 1200,
  hardScorpion: 1800,
  hardPawPrints: 1100,
  hardRooster: 2850,
  goodOtter: 3000,
  goodOwl: 2833,
  goodRabbit: 1333,
  goodSeal: 2567,
  goodServiceDog: 3000,
  goodPoodle: 2800,
  goodChimpanzee: 3833,
  goodWhale: 2633,
  goodPeacock: 1333,
  goodPig: 3567,
  easySunrise: 5000,
  easySunriseOverMountains: 1017,
  easyRoseBloom: 2400,
  easyPeace: 3167,
  easyPlant: 5750,
  easyRainbowStreak: 2000,
  easyPhoenixRise: 3933,
  easyUnicornFlyby: 3800,
};

function reviewReactionLottiePlaybackSpeed(variant: ReviewReactionLottieVariant): number {
  return reviewReactionLottieNaturalDurationMillisByVariant[variant] / reviewReactionAnimationDurationMillis(variant);
}

function makeReviewReactionStyle(event: ReviewReactionEvent): ReviewReactionStyle {
  return {
    "--review-reaction-duration": `${reviewReactionAnimationDurationMillis(event.variant)}ms`,
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
      <path className="review-reaction-yellow-fill" d="M27 69 L31 34 L43 54 L50 29 L57 54 L69 34 L73 69 Z" />
      <path className="review-reaction-orange-stroke" d="M27 69 L31 34 L43 54 L50 29 L57 54 L69 34 L73 69 Z" strokeWidth="3" />
      <rect className="review-reaction-orange-fill" x="25" y="65" width="50" height="11" rx="4" />
      <circle className="review-reaction-pink-fill" cx="31" cy="34" r="4" />
      <circle className="review-reaction-blue-fill" cx="50" cy="29" r="4" />
      <circle className="review-reaction-green-fill" cx="69" cy="34" r="4" />
      <polygon className="review-reaction-sparkle-fill" points={makeSparklePoints(78, 33, 5, 0.2)} />
    </g>
  );
}

function reportReviewReactionLottieFailure(
  error: unknown,
  phase: ReviewReactionLottieFailurePhase,
  variant: ReviewReactionLottieVariant | null,
): void {
  console.warn("Review reaction Lottie render failed.", {
    error,
    phase,
    variant,
  });
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

    let animationItem: AnimationItem;
    try {
      animationItem = mountReservedReviewReactionLottieRender(eventId, variant, mountedContainer).animationItem;
    } catch (error: unknown) {
      reportReviewReactionLottieFailure(error, "render", variant);
      onReactionEventFallback(eventId);
      return;
    }

    let hasReportedFailure = false;
    const handlePlaybackFailure = (error: unknown): void => {
      if (hasReportedFailure) {
        return;
      }

      hasReportedFailure = true;
      reportReviewReactionLottieFailure(error, "playback", variant);
      onReactionEventFallback(eventId);
    };
    const removeErrorListener = animationItem.addEventListener("error", () => {
      handlePlaybackFailure(new Error(`Review reaction Lottie playback emitted error for variant ${variant}.`));
    });
    const removeDataFailedListener = animationItem.addEventListener("data_failed", () => {
      handlePlaybackFailure(new Error(`Review reaction Lottie playback emitted data_failed for variant ${variant}.`));
    });

    try {
      animationItem.setSpeed(reviewReactionLottiePlaybackSpeed(variant));
      if (matchesReducedReviewReactionMotion()) {
        animationItem.goToAndStop(
          animationItem.totalFrames * reviewReactionLottieReducedMotionProgress,
          true,
        );
      } else {
        animationItem.goToAndStop(0, true);
        if (!hasReportedFailure) {
          animationItem.play();
        }
      }
    } catch (error: unknown) {
      handlePlaybackFailure(error);
    }

    return () => {
      removeErrorListener();
      removeDataFailedListener();
      unmountReservedReviewReactionLottieRender(eventId);
    };
  }, [eventId, onReactionEventFallback, variant]);

  return (
    <div ref={containerRef} className={reviewReactionLottieContainerClassByVariant[variant]} />
  );
}

function renderReviewReactionVariant(variant: ReviewReactionRenderableVariant): ReactElement {
  switch (variant) {
    case "againRainCloud":
    case "againTornado":
    case "againWindFace":
    case "againSnowflake":
    case "againSnailCrawl":
    case "againTurtle":
    case "againWiltedFlower":
    case "againSpider":
    case "againRat":
    case "againWormWiggle":
    case "hardTiger":
    case "hardTRex":
    case "hardShark":
    case "hardOxCharge":
    case "hardRacehorseGallop":
    case "hardSnake":
    case "hardVolcanoEruption":
    case "hardScorpion":
    case "hardPawPrints":
    case "hardRooster":
    case "goodOtter":
    case "goodOwl":
    case "goodRabbit":
    case "goodSeal":
    case "goodServiceDog":
    case "goodPoodle":
    case "goodChimpanzee":
    case "goodWhale":
    case "goodPeacock":
    case "goodPig":
    case "easySunrise":
    case "easySunriseOverMountains":
    case "easyRoseBloom":
    case "easyPeace":
    case "easyPlant":
    case "easyRainbowStreak":
    case "easyPhoenixRise":
    case "easyUnicornFlyby":
      return renderReviewReactionVariant(reviewReactionLottieFallbackVariant);
    case "fallbackCrownBounce":
      return <EasyCrownBounceReaction />;
  }
}

function renderReviewReactionArt(
  event: ReviewReactionEvent,
  onReactionEventFallback: (eventId: string) => void,
): ReactElement {
  const { variant } = event;

  if (isReviewReactionLottieVariant(variant)) {
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

  const artClassName = variant === reviewReactionLottieFallbackVariant
    ? "review-rating-reaction-art review-rating-reaction-crown-fallback-art"
    : "review-rating-reaction-art";

  return (
    <svg className={artClassName} viewBox="0 0 100 100" focusable="false">
      {renderReviewReactionVariant(variant)}
    </svg>
  );
}

export function ReviewRatingReactionLayer(props: ReviewRatingReactionLayerProps): ReactElement {
  const { events, onReactionEventFallback } = props;

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
