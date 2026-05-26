import type { LottiePlayer } from "lottie-web";
import againRainCloudAnimationUrl from "../../../assets/review_again_rain_cloud.json?url";
import againSnailCrawlAnimationUrl from "../../../assets/review_again_snail.json?url";
import againSnowflakeAnimationUrl from "../../../assets/review_again_snowflake.json?url";
import againSpiderAnimationUrl from "../../../assets/review_again_spider.json?url";
import againTornadoAnimationUrl from "../../../assets/review_again_tornado.json?url";
import againTurtleAnimationUrl from "../../../assets/review_again_turtle.json?url";
import againWiltedFlowerAnimationUrl from "../../../assets/review_again_wilted_flower.json?url";
import againWindFaceAnimationUrl from "../../../assets/review_again_wind_face.json?url";
import againWormWiggleAnimationUrl from "../../../assets/review_again_worm.json?url";
import againRatAnimationUrl from "../../../assets/review_again_rat.json?url";
import easyPeaceAnimationUrl from "../../../assets/review_easy_peace.json?url";
import easyPlantAnimationUrl from "../../../assets/review_easy_plant.json?url";
import easyPhoenixRiseAnimationUrl from "../../../assets/review_easy_phoenix.json?url";
import easyRainbowStreakAnimationUrl from "../../../assets/review_easy_rainbow.json?url";
import easyRoseBloomAnimationUrl from "../../../assets/review_easy_rose.json?url";
import easySunriseAnimationUrl from "../../../assets/review_easy_sunrise.json?url";
import easySunriseOverMountainsAnimationUrl from "../../../assets/review_easy_sunrise_over_mountains.json?url";
import easyUnicornFlybyAnimationUrl from "../../../assets/review_easy_unicorn.json?url";
import goodChimpanzeeAnimationUrl from "../../../assets/review_good_chimpanzee.json?url";
import goodOwlAnimationUrl from "../../../assets/review_good_owl.json?url";
import goodPeacockAnimationUrl from "../../../assets/review_good_peacock.json?url";
import goodPigAnimationUrl from "../../../assets/review_good_pig.json?url";
import goodPoodleAnimationUrl from "../../../assets/review_good_poodle.json?url";
import goodRabbitAnimationUrl from "../../../assets/review_good_rabbit.json?url";
import goodSealAnimationUrl from "../../../assets/review_good_seal.json?url";
import goodServiceDogAnimationUrl from "../../../assets/review_good_service_dog.json?url";
import goodOtterAnimationUrl from "../../../assets/review_good_otter.json?url";
import goodWhaleAnimationUrl from "../../../assets/review_good_whale.json?url";
import hardScorpionAnimationUrl from "../../../assets/review_hard_scorpion.json?url";
import hardRoosterAnimationUrl from "../../../assets/review_hard_rooster.json?url";
import hardOxChargeAnimationUrl from "../../../assets/review_hard_ox.json?url";
import hardPawPrintsAnimationUrl from "../../../assets/review_hard_paw_prints.json?url";
import hardRacehorseGallopAnimationUrl from "../../../assets/review_hard_racehorse.json?url";
import hardSharkAnimationUrl from "../../../assets/review_hard_shark.json?url";
import hardSnakeAnimationUrl from "../../../assets/review_hard_snake.json?url";
import hardTRexAnimationUrl from "../../../assets/review_hard_t_rex.json?url";
import hardTigerAnimationUrl from "../../../assets/review_hard_tiger.json?url";
import hardVolcanoEruptionAnimationUrl from "../../../assets/review_hard_volcano.json?url";
import type { ReviewReactionFallbackVariant, ReviewReactionRenderableVariant } from "./reviewReaction";

type ReviewReactionLottiePlayerModule = Readonly<{
  default: LottiePlayer;
}>;

type ReviewReactionLottieAnimationLoader = () => Promise<object>;
type ReviewReactionLottieAnimationDataByVariant = Record<ReviewReactionLottieVariant, object | null>;
type ReviewReactionLottieAnimationPromiseByVariant = Record<ReviewReactionLottieVariant, Promise<object> | null>;

export const reviewReactionLottieVariants = [
  "againRainCloud",
  "againTornado",
  "againWindFace",
  "againSnowflake",
  "againSnailCrawl",
  "againTurtle",
  "againWiltedFlower",
  "againSpider",
  "againRat",
  "againWormWiggle",
  "hardTiger",
  "hardTRex",
  "hardShark",
  "hardOxCharge",
  "hardRacehorseGallop",
  "hardSnake",
  "hardVolcanoEruption",
  "hardScorpion",
  "hardPawPrints",
  "hardRooster",
  "goodOtter",
  "goodOwl",
  "goodRabbit",
  "goodSeal",
  "goodServiceDog",
  "goodPoodle",
  "goodChimpanzee",
  "goodWhale",
  "goodPeacock",
  "goodPig",
  "easySunrise",
  "easySunriseOverMountains",
  "easyRoseBloom",
  "easyPeace",
  "easyPlant",
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
  againRainCloud: againRainCloudAnimationUrl,
  againTornado: againTornadoAnimationUrl,
  againWindFace: againWindFaceAnimationUrl,
  againSnowflake: againSnowflakeAnimationUrl,
  againSnailCrawl: againSnailCrawlAnimationUrl,
  againTurtle: againTurtleAnimationUrl,
  againWiltedFlower: againWiltedFlowerAnimationUrl,
  againSpider: againSpiderAnimationUrl,
  againRat: againRatAnimationUrl,
  againWormWiggle: againWormWiggleAnimationUrl,
  hardTiger: hardTigerAnimationUrl,
  hardTRex: hardTRexAnimationUrl,
  hardShark: hardSharkAnimationUrl,
  hardOxCharge: hardOxChargeAnimationUrl,
  hardRacehorseGallop: hardRacehorseGallopAnimationUrl,
  hardSnake: hardSnakeAnimationUrl,
  hardVolcanoEruption: hardVolcanoEruptionAnimationUrl,
  hardScorpion: hardScorpionAnimationUrl,
  hardPawPrints: hardPawPrintsAnimationUrl,
  hardRooster: hardRoosterAnimationUrl,
  goodOtter: goodOtterAnimationUrl,
  goodOwl: goodOwlAnimationUrl,
  goodRabbit: goodRabbitAnimationUrl,
  goodSeal: goodSealAnimationUrl,
  goodServiceDog: goodServiceDogAnimationUrl,
  goodPoodle: goodPoodleAnimationUrl,
  goodChimpanzee: goodChimpanzeeAnimationUrl,
  goodWhale: goodWhaleAnimationUrl,
  goodPeacock: goodPeacockAnimationUrl,
  goodPig: goodPigAnimationUrl,
  easySunrise: easySunriseAnimationUrl,
  easySunriseOverMountains: easySunriseOverMountainsAnimationUrl,
  easyRoseBloom: easyRoseBloomAnimationUrl,
  easyPeace: easyPeaceAnimationUrl,
  easyPlant: easyPlantAnimationUrl,
  easyRainbowStreak: easyRainbowStreakAnimationUrl,
  easyPhoenixRise: easyPhoenixRiseAnimationUrl,
  easyUnicornFlyby: easyUnicornFlybyAnimationUrl,
};

const reviewReactionLottieAnimationLoaderByVariant: Readonly<Record<ReviewReactionLottieVariant, ReviewReactionLottieAnimationLoader>> = {
  againRainCloud: () => fetchReviewReactionLottieAnimationData("againRainCloud"),
  againTornado: () => fetchReviewReactionLottieAnimationData("againTornado"),
  againWindFace: () => fetchReviewReactionLottieAnimationData("againWindFace"),
  againSnowflake: () => fetchReviewReactionLottieAnimationData("againSnowflake"),
  againSnailCrawl: () => fetchReviewReactionLottieAnimationData("againSnailCrawl"),
  againTurtle: () => fetchReviewReactionLottieAnimationData("againTurtle"),
  againWiltedFlower: () => fetchReviewReactionLottieAnimationData("againWiltedFlower"),
  againSpider: () => fetchReviewReactionLottieAnimationData("againSpider"),
  againRat: () => fetchReviewReactionLottieAnimationData("againRat"),
  againWormWiggle: () => fetchReviewReactionLottieAnimationData("againWormWiggle"),
  hardTiger: () => fetchReviewReactionLottieAnimationData("hardTiger"),
  hardTRex: () => fetchReviewReactionLottieAnimationData("hardTRex"),
  hardShark: () => fetchReviewReactionLottieAnimationData("hardShark"),
  hardOxCharge: () => fetchReviewReactionLottieAnimationData("hardOxCharge"),
  hardRacehorseGallop: () => fetchReviewReactionLottieAnimationData("hardRacehorseGallop"),
  hardSnake: () => fetchReviewReactionLottieAnimationData("hardSnake"),
  hardVolcanoEruption: () => fetchReviewReactionLottieAnimationData("hardVolcanoEruption"),
  hardScorpion: () => fetchReviewReactionLottieAnimationData("hardScorpion"),
  hardPawPrints: () => fetchReviewReactionLottieAnimationData("hardPawPrints"),
  hardRooster: () => fetchReviewReactionLottieAnimationData("hardRooster"),
  goodOtter: () => fetchReviewReactionLottieAnimationData("goodOtter"),
  goodOwl: () => fetchReviewReactionLottieAnimationData("goodOwl"),
  goodRabbit: () => fetchReviewReactionLottieAnimationData("goodRabbit"),
  goodSeal: () => fetchReviewReactionLottieAnimationData("goodSeal"),
  goodServiceDog: () => fetchReviewReactionLottieAnimationData("goodServiceDog"),
  goodPoodle: () => fetchReviewReactionLottieAnimationData("goodPoodle"),
  goodChimpanzee: () => fetchReviewReactionLottieAnimationData("goodChimpanzee"),
  goodWhale: () => fetchReviewReactionLottieAnimationData("goodWhale"),
  goodPeacock: () => fetchReviewReactionLottieAnimationData("goodPeacock"),
  goodPig: () => fetchReviewReactionLottieAnimationData("goodPig"),
  easySunrise: () => fetchReviewReactionLottieAnimationData("easySunrise"),
  easySunriseOverMountains: () => fetchReviewReactionLottieAnimationData("easySunriseOverMountains"),
  easyRoseBloom: () => fetchReviewReactionLottieAnimationData("easyRoseBloom"),
  easyPeace: () => fetchReviewReactionLottieAnimationData("easyPeace"),
  easyPlant: () => fetchReviewReactionLottieAnimationData("easyPlant"),
  easyRainbowStreak: () => fetchReviewReactionLottieAnimationData("easyRainbowStreak"),
  easyPhoenixRise: () => fetchReviewReactionLottieAnimationData("easyPhoenixRise"),
  easyUnicornFlyby: () => fetchReviewReactionLottieAnimationData("easyUnicornFlyby"),
};

function makeEmptyReviewReactionLottieAnimationDataByVariant(): ReviewReactionLottieAnimationDataByVariant {
  return {
    againRainCloud: null,
    againTornado: null,
    againWindFace: null,
    againSnowflake: null,
    againSnailCrawl: null,
    againTurtle: null,
    againWiltedFlower: null,
    againSpider: null,
    againRat: null,
    againWormWiggle: null,
    hardTiger: null,
    hardTRex: null,
    hardShark: null,
    hardOxCharge: null,
    hardRacehorseGallop: null,
    hardSnake: null,
    hardVolcanoEruption: null,
    hardScorpion: null,
    hardPawPrints: null,
    hardRooster: null,
    goodOtter: null,
    goodOwl: null,
    goodRabbit: null,
    goodSeal: null,
    goodServiceDog: null,
    goodPoodle: null,
    goodChimpanzee: null,
    goodWhale: null,
    goodPeacock: null,
    goodPig: null,
    easySunrise: null,
    easySunriseOverMountains: null,
    easyRoseBloom: null,
    easyPeace: null,
    easyPlant: null,
    easyRainbowStreak: null,
    easyPhoenixRise: null,
    easyUnicornFlyby: null,
  };
}

function makeEmptyReviewReactionLottieAnimationPromiseByVariant(): ReviewReactionLottieAnimationPromiseByVariant {
  return {
    againRainCloud: null,
    againTornado: null,
    againWindFace: null,
    againSnowflake: null,
    againSnailCrawl: null,
    againTurtle: null,
    againWiltedFlower: null,
    againSpider: null,
    againRat: null,
    againWormWiggle: null,
    hardTiger: null,
    hardTRex: null,
    hardShark: null,
    hardOxCharge: null,
    hardRacehorseGallop: null,
    hardSnake: null,
    hardVolcanoEruption: null,
    hardScorpion: null,
    hardPawPrints: null,
    hardRooster: null,
    goodOtter: null,
    goodOwl: null,
    goodRabbit: null,
    goodSeal: null,
    goodServiceDog: null,
    goodPoodle: null,
    goodChimpanzee: null,
    goodWhale: null,
    goodPeacock: null,
    goodPig: null,
    easySunrise: null,
    easySunriseOverMountains: null,
    easyRoseBloom: null,
    easyPeace: null,
    easyPlant: null,
    easyRainbowStreak: null,
    easyPhoenixRise: null,
    easyUnicornFlyby: null,
  };
}

let reviewReactionLottiePlayerPromise: Promise<LottiePlayer> | null = null;
let reviewReactionLottiePlayerReady = false;
let reviewReactionLottieAnimationDataByVariant: ReviewReactionLottieAnimationDataByVariant = (
  makeEmptyReviewReactionLottieAnimationDataByVariant()
);
let reviewReactionLottieAnimationPromiseByVariant: ReviewReactionLottieAnimationPromiseByVariant = (
  makeEmptyReviewReactionLottieAnimationPromiseByVariant()
);

export const reviewReactionLottieFallbackVariant: ReviewReactionFallbackVariant = "fallbackCrownBounce";

export function isReviewReactionLottieVariant(
  variant: ReviewReactionRenderableVariant,
): variant is ReviewReactionLottieVariant {
  return reviewReactionLottieVariantSet.has(variant);
}

export function isReviewReactionLottieAssetReady(variant: ReviewReactionLottieVariant): boolean {
  return reviewReactionLottiePlayerReady && reviewReactionLottieAnimationDataByVariant[variant] !== null;
}

export function resetReviewReactionLottieStateForTests(): void {
  reviewReactionLottiePlayerPromise = null;
  reviewReactionLottiePlayerReady = false;
  reviewReactionLottieAnimationDataByVariant = makeEmptyReviewReactionLottieAnimationDataByVariant();
  reviewReactionLottieAnimationPromiseByVariant = makeEmptyReviewReactionLottieAnimationPromiseByVariant();
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
