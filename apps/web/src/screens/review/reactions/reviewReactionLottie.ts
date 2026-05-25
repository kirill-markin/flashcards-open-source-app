import type { LottiePlayer } from "lottie-web";
import type { ReviewReactionVariant } from "./reviewReaction";

type ReviewReactionLottiePlayerModule = Readonly<{
  default: LottiePlayer;
}>;

type ReviewReactionLottieAnimationModule = Readonly<{
  default: object;
}>;

export type ReviewReactionLottieVariant =
  | "againWormWiggle"
  | "againSnailCrawl"
  | "againWiltedFlower"
  | "goodOwl"
  | "goodPoodle"
  | "goodWhale"
  | "goodPeacock"
  | "easyRainbowStreak"
  | "easyUnicornFlyby";

export type ReviewReactionLottieAssets = Readonly<{
  animationDataByVariant: Readonly<Record<ReviewReactionLottieVariant, object>>;
  player: LottiePlayer;
}>;

let reviewReactionLottieAssetsPromise: Promise<ReviewReactionLottieAssets> | null = null;
let reviewReactionLottieAssetsReady = false;

export const reviewReactionLottieFallbackVariant: ReviewReactionVariant = "easyCrownBounce";

export function isReviewReactionLottieVariant(
  variant: ReviewReactionVariant,
): variant is ReviewReactionLottieVariant {
  return variant === "againWormWiggle"
    || variant === "againSnailCrawl"
    || variant === "againWiltedFlower"
    || variant === "goodOwl"
    || variant === "goodPoodle"
    || variant === "goodWhale"
    || variant === "goodPeacock"
    || variant === "easyRainbowStreak"
    || variant === "easyUnicornFlyby";
}

export function isReviewReactionLottieAssetsReady(): boolean {
  return reviewReactionLottieAssetsReady;
}

export function reviewReactionVariantWithReadyLottieFallback(
  variant: ReviewReactionVariant,
): ReviewReactionVariant {
  if (isReviewReactionLottieVariant(variant) && !isReviewReactionLottieAssetsReady()) {
    return reviewReactionLottieFallbackVariant;
  }

  return variant;
}

export function loadReviewReactionLottieAssets(): Promise<ReviewReactionLottieAssets> {
  if (reviewReactionLottieAssetsPromise !== null) {
    return reviewReactionLottieAssetsPromise;
  }

  reviewReactionLottieAssetsPromise = Promise.all([
    import("lottie-web/build/player/lottie_light"),
    import("../../../assets/review_again_worm.json"),
    import("../../../assets/review_again_snail.json"),
    import("../../../assets/review_again_wilted_flower.json"),
    import("../../../assets/review_good_owl.json"),
    import("../../../assets/review_good_poodle.json"),
    import("../../../assets/review_good_whale.json"),
    import("../../../assets/review_good_peacock.json"),
    import("../../../assets/review_easy_rainbow.json"),
    import("../../../assets/review_easy_unicorn.json"),
  ]).then((
    [
      lottieModule,
      wormAnimationModule,
      snailAnimationModule,
      wiltedFlowerAnimationModule,
      owlAnimationModule,
      poodleAnimationModule,
      whaleAnimationModule,
      peacockAnimationModule,
      rainbowAnimationModule,
      unicornAnimationModule,
    ]: [
      ReviewReactionLottiePlayerModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
      ReviewReactionLottieAnimationModule,
    ],
  ): ReviewReactionLottieAssets => {
    reviewReactionLottieAssetsReady = true;
    return {
      animationDataByVariant: {
        againWormWiggle: wormAnimationModule.default,
        againSnailCrawl: snailAnimationModule.default,
        againWiltedFlower: wiltedFlowerAnimationModule.default,
        goodOwl: owlAnimationModule.default,
        goodPoodle: poodleAnimationModule.default,
        goodWhale: whaleAnimationModule.default,
        goodPeacock: peacockAnimationModule.default,
        easyRainbowStreak: rainbowAnimationModule.default,
        easyUnicornFlyby: unicornAnimationModule.default,
      },
      player: lottieModule.default,
    };
  });

  return reviewReactionLottieAssetsPromise;
}
