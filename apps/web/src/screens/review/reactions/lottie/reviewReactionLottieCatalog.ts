import againRainCloudAnimationUrl from "./assets/review_again_rain_cloud.json?url";
import againSnailCrawlAnimationUrl from "./assets/review_again_snail.json?url";
import againSnowflakeAnimationUrl from "./assets/review_again_snowflake.json?url";
import againSpiderAnimationUrl from "./assets/review_again_spider.json?url";
import againTornadoAnimationUrl from "./assets/review_again_tornado.json?url";
import againTurtleAnimationUrl from "./assets/review_again_turtle.json?url";
import againWiltedFlowerAnimationUrl from "./assets/review_again_wilted_flower.json?url";
import againWindFaceAnimationUrl from "./assets/review_again_wind_face.json?url";
import againWormWiggleAnimationUrl from "./assets/review_again_worm.json?url";
import againRatAnimationUrl from "./assets/review_again_rat.json?url";
import easyPeaceAnimationUrl from "./assets/review_easy_peace.json?url";
import easyPlantAnimationUrl from "./assets/review_easy_plant.json?url";
import easyPhoenixRiseAnimationUrl from "./assets/review_easy_phoenix.json?url";
import easyRainbowStreakAnimationUrl from "./assets/review_easy_rainbow.json?url";
import easyRoseBloomAnimationUrl from "./assets/review_easy_rose.json?url";
import easySunriseAnimationUrl from "./assets/review_easy_sunrise.json?url";
import easySunriseOverMountainsAnimationUrl from "./assets/review_easy_sunrise_over_mountains.json?url";
import easyUnicornFlybyAnimationUrl from "./assets/review_easy_unicorn.json?url";
import goodChimpanzeeAnimationUrl from "./assets/review_good_chimpanzee.json?url";
import goodOwlAnimationUrl from "./assets/review_good_owl.json?url";
import goodPeacockAnimationUrl from "./assets/review_good_peacock.json?url";
import goodPigAnimationUrl from "./assets/review_good_pig.json?url";
import goodPoodleAnimationUrl from "./assets/review_good_poodle.json?url";
import goodRabbitAnimationUrl from "./assets/review_good_rabbit.json?url";
import goodSealAnimationUrl from "./assets/review_good_seal.json?url";
import goodServiceDogAnimationUrl from "./assets/review_good_service_dog.json?url";
import goodOtterAnimationUrl from "./assets/review_good_otter.json?url";
import goodWhaleAnimationUrl from "./assets/review_good_whale.json?url";
import hardScorpionAnimationUrl from "./assets/review_hard_scorpion.json?url";
import hardRoosterAnimationUrl from "./assets/review_hard_rooster.json?url";
import hardOxChargeAnimationUrl from "./assets/review_hard_ox.json?url";
import hardPawPrintsAnimationUrl from "./assets/review_hard_paw_prints.json?url";
import hardRacehorseGallopAnimationUrl from "./assets/review_hard_racehorse.json?url";
import hardSharkAnimationUrl from "./assets/review_hard_shark.json?url";
import hardSnakeAnimationUrl from "./assets/review_hard_snake.json?url";
import hardTRexAnimationUrl from "./assets/review_hard_t_rex.json?url";
import hardTigerAnimationUrl from "./assets/review_hard_tiger.json?url";
import hardVolcanoEruptionAnimationUrl from "./assets/review_hard_volcano.json?url";
import type { ReviewReactionRenderableVariant } from "../reviewReaction";

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
export type ReviewReactionLottieAnimationUrlByVariant = Readonly<
  Record<ReviewReactionLottieVariant, string>
>;

const reviewReactionLottieVariantSet: ReadonlySet<ReviewReactionRenderableVariant> = new Set(
  reviewReactionLottieVariants,
);

const reviewReactionLottieAnimationUrlByVariant: ReviewReactionLottieAnimationUrlByVariant = {
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

export function isReviewReactionLottieVariant(
  variant: ReviewReactionRenderableVariant,
): variant is ReviewReactionLottieVariant {
  return reviewReactionLottieVariantSet.has(variant);
}

export function reviewReactionLottieAnimationUrl(variant: ReviewReactionLottieVariant): string {
  return reviewReactionLottieAnimationUrlByVariant[variant];
}
