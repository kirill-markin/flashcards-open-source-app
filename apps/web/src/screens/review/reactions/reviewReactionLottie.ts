import type { LottiePlayer } from "lottie-web";
import againSnailCrawlAnimationUrl from "../../../assets/review_again_snail.json?url";
import againTornadoAnimationUrl from "../../../assets/review_again_tornado.json?url";
import againWiltedFlowerAnimationUrl from "../../../assets/review_again_wilted_flower.json?url";
import againWormWiggleAnimationUrl from "../../../assets/review_again_worm.json?url";
import easyPhoenixRiseAnimationUrl from "../../../assets/review_easy_phoenix.json?url";
import easyRainbowStreakAnimationUrl from "../../../assets/review_easy_rainbow.json?url";
import easyRoseBloomAnimationUrl from "../../../assets/review_easy_rose.json?url";
import easyUnicornFlybyAnimationUrl from "../../../assets/review_easy_unicorn.json?url";
import goodOwlAnimationUrl from "../../../assets/review_good_owl.json?url";
import goodPeacockAnimationUrl from "../../../assets/review_good_peacock.json?url";
import goodPoodleAnimationUrl from "../../../assets/review_good_poodle.json?url";
import goodWhaleAnimationUrl from "../../../assets/review_good_whale.json?url";
import hardOxChargeAnimationUrl from "../../../assets/review_hard_ox.json?url";
import hardPawPrintsAnimationUrl from "../../../assets/review_hard_paw_prints.json?url";
import hardRacehorseGallopAnimationUrl from "../../../assets/review_hard_racehorse.json?url";
import hardVolcanoEruptionAnimationUrl from "../../../assets/review_hard_volcano.json?url";
import type { ReviewReactionFallbackVariant, ReviewReactionRenderableVariant } from "./reviewReaction";

type ReviewReactionLottiePlayerModule = Readonly<{
  default: LottiePlayer;
}>;

type ReviewReactionLottieAnimationLoader = () => Promise<object>;
type ReviewReactionLottieAnimationDataByVariant = Record<ReviewReactionLottieVariant, object | null>;
type ReviewReactionLottieAnimationPromiseByVariant = Record<ReviewReactionLottieVariant, Promise<object> | null>;

export const reviewReactionLottieVariants = [
  "againWormWiggle",
  "againTornado",
  "againSnailCrawl",
  "againWiltedFlower",
  "goodOwl",
  "goodPoodle",
  "goodWhale",
  "goodPeacock",
  "hardOxCharge",
  "hardPawPrints",
  "hardRacehorseGallop",
  "hardVolcanoEruption",
  "easyRoseBloom",
  "easyRainbowStreak",
  "easyPhoenixRise",
  "easyUnicornFlyby",
] as const;

export type ReviewReactionLottieVariant = (typeof reviewReactionLottieVariants)[number];

export type ReviewReactionLottieAsset = Readonly<{
  animationData: object;
  player: LottiePlayer;
}>;

export type ReviewReactionLottieAssetFailure = Readonly<{
  error: unknown;
  variant: ReviewReactionLottieVariant;
}>;

export type ReviewReactionLottiePreloadResult = Readonly<{
  failures: ReadonlyArray<ReviewReactionLottieAssetFailure>;
}>;

const reviewReactionLottieVariantSet: ReadonlySet<ReviewReactionRenderableVariant> = new Set(
  reviewReactionLottieVariants,
);

const reviewReactionLottieAnimationUrlByVariant: Readonly<Record<ReviewReactionLottieVariant, string>> = {
  againWormWiggle: againWormWiggleAnimationUrl,
  againTornado: againTornadoAnimationUrl,
  againSnailCrawl: againSnailCrawlAnimationUrl,
  againWiltedFlower: againWiltedFlowerAnimationUrl,
  goodOwl: goodOwlAnimationUrl,
  goodPoodle: goodPoodleAnimationUrl,
  goodWhale: goodWhaleAnimationUrl,
  goodPeacock: goodPeacockAnimationUrl,
  hardOxCharge: hardOxChargeAnimationUrl,
  hardPawPrints: hardPawPrintsAnimationUrl,
  hardRacehorseGallop: hardRacehorseGallopAnimationUrl,
  hardVolcanoEruption: hardVolcanoEruptionAnimationUrl,
  easyRoseBloom: easyRoseBloomAnimationUrl,
  easyRainbowStreak: easyRainbowStreakAnimationUrl,
  easyPhoenixRise: easyPhoenixRiseAnimationUrl,
  easyUnicornFlyby: easyUnicornFlybyAnimationUrl,
};

const reviewReactionLottieAnimationLoaderByVariant: Readonly<Record<ReviewReactionLottieVariant, ReviewReactionLottieAnimationLoader>> = {
  againWormWiggle: () => fetchReviewReactionLottieAnimationData("againWormWiggle"),
  againTornado: () => fetchReviewReactionLottieAnimationData("againTornado"),
  againSnailCrawl: () => fetchReviewReactionLottieAnimationData("againSnailCrawl"),
  againWiltedFlower: () => fetchReviewReactionLottieAnimationData("againWiltedFlower"),
  goodOwl: () => fetchReviewReactionLottieAnimationData("goodOwl"),
  goodPoodle: () => fetchReviewReactionLottieAnimationData("goodPoodle"),
  goodWhale: () => fetchReviewReactionLottieAnimationData("goodWhale"),
  goodPeacock: () => fetchReviewReactionLottieAnimationData("goodPeacock"),
  hardOxCharge: () => fetchReviewReactionLottieAnimationData("hardOxCharge"),
  hardPawPrints: () => fetchReviewReactionLottieAnimationData("hardPawPrints"),
  hardRacehorseGallop: () => fetchReviewReactionLottieAnimationData("hardRacehorseGallop"),
  hardVolcanoEruption: () => fetchReviewReactionLottieAnimationData("hardVolcanoEruption"),
  easyRoseBloom: () => fetchReviewReactionLottieAnimationData("easyRoseBloom"),
  easyRainbowStreak: () => fetchReviewReactionLottieAnimationData("easyRainbowStreak"),
  easyPhoenixRise: () => fetchReviewReactionLottieAnimationData("easyPhoenixRise"),
  easyUnicornFlyby: () => fetchReviewReactionLottieAnimationData("easyUnicornFlyby"),
};

let reviewReactionLottiePlayerPromise: Promise<LottiePlayer> | null = null;
let reviewReactionLottiePlayerReady = false;
let reviewReactionLottieAnimationDataByVariant: ReviewReactionLottieAnimationDataByVariant = {
  againWormWiggle: null,
  againTornado: null,
  againSnailCrawl: null,
  againWiltedFlower: null,
  goodOwl: null,
  goodPoodle: null,
  goodWhale: null,
  goodPeacock: null,
  hardOxCharge: null,
  hardPawPrints: null,
  hardRacehorseGallop: null,
  hardVolcanoEruption: null,
  easyRoseBloom: null,
  easyRainbowStreak: null,
  easyPhoenixRise: null,
  easyUnicornFlyby: null,
};
let reviewReactionLottieAnimationPromiseByVariant: ReviewReactionLottieAnimationPromiseByVariant = {
  againWormWiggle: null,
  againTornado: null,
  againSnailCrawl: null,
  againWiltedFlower: null,
  goodOwl: null,
  goodPoodle: null,
  goodWhale: null,
  goodPeacock: null,
  hardOxCharge: null,
  hardPawPrints: null,
  hardRacehorseGallop: null,
  hardVolcanoEruption: null,
  easyRoseBloom: null,
  easyRainbowStreak: null,
  easyPhoenixRise: null,
  easyUnicornFlyby: null,
};

export const reviewReactionLottieFallbackVariant: ReviewReactionFallbackVariant = "fallbackCrownBounce";

export function isReviewReactionLottieVariant(
  variant: ReviewReactionRenderableVariant,
): variant is ReviewReactionLottieVariant {
  return reviewReactionLottieVariantSet.has(variant);
}

export function isReviewReactionLottieAssetReady(variant: ReviewReactionLottieVariant): boolean {
  return reviewReactionLottiePlayerReady && reviewReactionLottieAnimationDataByVariant[variant] !== null;
}

export function reviewReactionVariantWithReadyLottieFallback(
  variant: ReviewReactionRenderableVariant,
): ReviewReactionRenderableVariant {
  if (isReviewReactionLottieVariant(variant) && !isReviewReactionLottieAssetReady(variant)) {
    return reviewReactionLottieFallbackVariant;
  }

  return variant;
}

function loadReviewReactionLottiePlayer(): Promise<LottiePlayer> {
  if (reviewReactionLottiePlayerPromise !== null) {
    return reviewReactionLottiePlayerPromise;
  }

  reviewReactionLottiePlayerPromise = import("lottie-web/build/player/lottie_light")
    .then((lottieModule: ReviewReactionLottiePlayerModule): LottiePlayer => {
      reviewReactionLottiePlayerReady = true;
      return lottieModule.default;
    })
    .catch((error: unknown): never => {
      reviewReactionLottiePlayerReady = false;
      reviewReactionLottiePlayerPromise = null;
      throw error;
    });

  return reviewReactionLottiePlayerPromise;
}

function isReviewReactionLottieAnimationData(animationData: unknown): animationData is object {
  return typeof animationData === "object" && animationData !== null && !Array.isArray(animationData);
}

async function fetchReviewReactionLottieAnimationData(
  variant: ReviewReactionLottieVariant,
): Promise<object> {
  const url = reviewReactionLottieAnimationUrlByVariant[variant];
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error: unknown) {
    throw new Error(
      `Failed to fetch review reaction Lottie animation JSON for variant ${variant} from ${url}.`,
      { cause: error },
    );
  }

  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(
      `Failed to fetch review reaction Lottie animation JSON for variant ${variant} from ${url}. `
        + `Received status ${response.status} ${response.statusText}. Response body: ${responseBody}`,
    );
  }

  let animationData: unknown;
  try {
    animationData = await response.json();
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse review reaction Lottie animation JSON for variant ${variant} from ${url}.`,
      { cause: error },
    );
  }

  if (!isReviewReactionLottieAnimationData(animationData)) {
    throw new TypeError(
      `Review reaction Lottie animation JSON for variant ${variant} from ${url} must parse to an object.`,
    );
  }

  return animationData;
}

function loadReviewReactionLottieAnimationData(variant: ReviewReactionLottieVariant): Promise<object> {
  const cachedAnimationData = reviewReactionLottieAnimationDataByVariant[variant];
  if (cachedAnimationData !== null) {
    return Promise.resolve(cachedAnimationData);
  }

  const cachedAnimationPromise = reviewReactionLottieAnimationPromiseByVariant[variant];
  if (cachedAnimationPromise !== null) {
    return cachedAnimationPromise;
  }

  const animationDataPromise = reviewReactionLottieAnimationLoaderByVariant[variant]()
    .then((animationData: object): object => {
      reviewReactionLottieAnimationDataByVariant = {
        ...reviewReactionLottieAnimationDataByVariant,
        [variant]: animationData,
      };
      reviewReactionLottieAnimationPromiseByVariant = {
        ...reviewReactionLottieAnimationPromiseByVariant,
        [variant]: null,
      };
      return animationData;
    })
    .catch((error: unknown): never => {
      reviewReactionLottieAnimationDataByVariant = {
        ...reviewReactionLottieAnimationDataByVariant,
        [variant]: null,
      };
      reviewReactionLottieAnimationPromiseByVariant = {
        ...reviewReactionLottieAnimationPromiseByVariant,
        [variant]: null,
      };
      throw error;
    });

  reviewReactionLottieAnimationPromiseByVariant = {
    ...reviewReactionLottieAnimationPromiseByVariant,
    [variant]: animationDataPromise,
  };

  return animationDataPromise;
}

export async function loadReviewReactionLottieAsset(
  variant: ReviewReactionLottieVariant,
): Promise<ReviewReactionLottieAsset> {
  const [player, animationData] = await Promise.all([
    loadReviewReactionLottiePlayer(),
    loadReviewReactionLottieAnimationData(variant),
  ]);

  return {
    animationData,
    player,
  };
}

export async function loadReviewReactionLottieAssets(): Promise<ReviewReactionLottiePreloadResult> {
  await loadReviewReactionLottiePlayer();

  const settledAnimationData = await Promise.allSettled(
    reviewReactionLottieVariants.map((variant) => loadReviewReactionLottieAnimationData(variant)),
  );
  const failures: Array<ReviewReactionLottieAssetFailure> = [];

  for (const [index, settledAsset] of settledAnimationData.entries()) {
    if (settledAsset.status === "rejected") {
      const error: unknown = settledAsset.reason;
      failures.push({
        error,
        variant: reviewReactionLottieVariants[index],
      });
    }
  }

  return { failures };
}
