import type { LottiePlayer } from "lottie-web";
import type { ReviewReactionFallbackVariant, ReviewReactionRenderableVariant } from "./reviewReaction";

type ReviewReactionLottiePlayerModule = Readonly<{
  default: LottiePlayer;
}>;

type ReviewReactionLottieAnimationModule = Readonly<{
  default: object;
}>;

export type ReviewReactionLottieVariant =
  | "againWormWiggle"
  | "againTornado"
  | "againSnailCrawl"
  | "againWiltedFlower"
  | "goodOwl"
  | "goodPoodle"
  | "goodWhale"
  | "goodPeacock"
  | "hardOxCharge"
  | "hardPawPrints"
  | "hardRacehorseGallop"
  | "hardVolcanoEruption"
  | "easyRoseBloom"
  | "easyRainbowStreak"
  | "easyPhoenixRise"
  | "easyUnicornFlyby";

export type ReviewReactionLottieAssets = Readonly<{
  animationDataByVariant: Readonly<Record<ReviewReactionLottieVariant, object>>;
  player: LottiePlayer;
}>;

let reviewReactionLottieAssetsPromise: Promise<ReviewReactionLottieAssets> | null = null;
let reviewReactionLottieAssetsReady = false;

export const reviewReactionLottieFallbackVariant: ReviewReactionFallbackVariant = "fallbackCrownBounce";

export function isReviewReactionLottieVariant(
  variant: ReviewReactionRenderableVariant,
): variant is ReviewReactionLottieVariant {
  return variant === "againWormWiggle"
    || variant === "againTornado"
    || variant === "againSnailCrawl"
    || variant === "againWiltedFlower"
    || variant === "goodOwl"
    || variant === "goodPoodle"
    || variant === "goodWhale"
    || variant === "goodPeacock"
    || variant === "hardOxCharge"
    || variant === "hardPawPrints"
    || variant === "hardRacehorseGallop"
    || variant === "hardVolcanoEruption"
    || variant === "easyRoseBloom"
    || variant === "easyRainbowStreak"
    || variant === "easyPhoenixRise"
    || variant === "easyUnicornFlyby";
}

export function isReviewReactionLottieAssetsReady(): boolean {
  return reviewReactionLottieAssetsReady;
}

export function reviewReactionVariantWithReadyLottieFallback(
  variant: ReviewReactionRenderableVariant,
): ReviewReactionRenderableVariant {
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
    import("../../../assets/review_again_tornado.json"),
    import("../../../assets/review_again_snail.json"),
    import("../../../assets/review_again_wilted_flower.json"),
    import("../../../assets/review_good_owl.json"),
    import("../../../assets/review_good_poodle.json"),
    import("../../../assets/review_good_whale.json"),
    import("../../../assets/review_good_peacock.json"),
    import("../../../assets/review_hard_ox.json"),
    import("../../../assets/review_hard_paw_prints.json"),
    import("../../../assets/review_hard_racehorse.json"),
    import("../../../assets/review_hard_volcano.json"),
    import("../../../assets/review_easy_rose.json"),
    import("../../../assets/review_easy_rainbow.json"),
    import("../../../assets/review_easy_phoenix.json"),
    import("../../../assets/review_easy_unicorn.json"),
  ]).then((
    [
      lottieModule,
      wormAnimationModule,
      tornadoAnimationModule,
      snailAnimationModule,
      wiltedFlowerAnimationModule,
      owlAnimationModule,
      poodleAnimationModule,
      whaleAnimationModule,
      peacockAnimationModule,
      oxAnimationModule,
      pawPrintsAnimationModule,
      racehorseAnimationModule,
      volcanoAnimationModule,
      roseAnimationModule,
      rainbowAnimationModule,
      phoenixAnimationModule,
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
        againTornado: tornadoAnimationModule.default,
        againSnailCrawl: snailAnimationModule.default,
        againWiltedFlower: wiltedFlowerAnimationModule.default,
        goodOwl: owlAnimationModule.default,
        goodPoodle: poodleAnimationModule.default,
        goodWhale: whaleAnimationModule.default,
        goodPeacock: peacockAnimationModule.default,
        hardOxCharge: oxAnimationModule.default,
        hardPawPrints: pawPrintsAnimationModule.default,
        hardRacehorseGallop: racehorseAnimationModule.default,
        hardVolcanoEruption: volcanoAnimationModule.default,
        easyRoseBloom: roseAnimationModule.default,
        easyRainbowStreak: rainbowAnimationModule.default,
        easyPhoenixRise: phoenixAnimationModule.default,
        easyUnicornFlyby: unicornAnimationModule.default,
      },
      player: lottieModule.default,
    };
  });

  return reviewReactionLottieAssetsPromise;
}
