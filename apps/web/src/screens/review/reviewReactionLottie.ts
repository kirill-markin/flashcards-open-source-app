import type { LottiePlayer } from "lottie-web";
import type { ReviewReactionVariant } from "./reviewReaction";

type ReviewReactionLottiePlayerModule = Readonly<{
  default: LottiePlayer;
}>;

type ReviewEasyUnicornAnimationModule = Readonly<{
  default: object;
}>;

export type ReviewEasyUnicornLottieAssets = Readonly<{
  animationData: object;
  player: LottiePlayer;
}>;

let reviewEasyUnicornLottieAssetsPromise: Promise<ReviewEasyUnicornLottieAssets> | null = null;
let reviewEasyUnicornLottieAssetsReady = false;

export const reviewReactionExpensiveAnimationFallbackVariant: ReviewReactionVariant = "easyCrownBounce";

export function isReviewEasyUnicornLottieAssetsReady(): boolean {
  return reviewEasyUnicornLottieAssetsReady;
}

export function reviewReactionVariantWithReadyLottieFallback(
  variant: ReviewReactionVariant,
): ReviewReactionVariant {
  if (variant === "easyUnicornFlyby" && !isReviewEasyUnicornLottieAssetsReady()) {
    return reviewReactionExpensiveAnimationFallbackVariant;
  }

  return variant;
}

export function loadReviewEasyUnicornLottieAssets(): Promise<ReviewEasyUnicornLottieAssets> {
  if (reviewEasyUnicornLottieAssetsPromise !== null) {
    return reviewEasyUnicornLottieAssetsPromise;
  }

  reviewEasyUnicornLottieAssetsPromise = Promise.all([
    import("lottie-web/build/player/lottie_light"),
    import("../../assets/review_easy_unicorn.json"),
  ]).then((
    [
      lottieModule,
      animationModule,
    ]: [ReviewReactionLottiePlayerModule, ReviewEasyUnicornAnimationModule],
  ): ReviewEasyUnicornLottieAssets => {
    reviewEasyUnicornLottieAssetsReady = true;
    return {
      animationData: animationModule.default,
      player: lottieModule.default,
    };
  });

  return reviewEasyUnicornLottieAssetsPromise;
}
