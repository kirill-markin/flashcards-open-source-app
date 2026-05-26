export const reviewReactionMaximumActiveEvents = 3;
export const reducedReviewReactionMotionMediaQuery = "(prefers-reduced-motion: reduce)";

export type ReviewReactionMotionMode = "standard" | "reduced";

export type ReviewReactionRating =
  | "again"
  | "hard"
  | "good"
  | "easy";

export const reviewReactionRatings: ReadonlyArray<ReviewReactionRating> = [
  "again",
  "hard",
  "good",
  "easy",
];

export type ReviewReactionVariant =
  | "againRainCloud"
  | "againTornado"
  | "againWindFace"
  | "againSnowflake"
  | "againSnailCrawl"
  | "againTurtle"
  | "againWiltedFlower"
  | "againSpider"
  | "againRat"
  | "againWormWiggle"
  | "hardTiger"
  | "hardTRex"
  | "hardShark"
  | "hardOxCharge"
  | "hardRacehorseGallop"
  | "hardSnake"
  | "hardVolcanoEruption"
  | "hardScorpion"
  | "hardPawPrints"
  | "hardRooster"
  | "goodOtter"
  | "goodOwl"
  | "goodRabbit"
  | "goodSeal"
  | "goodServiceDog"
  | "goodPoodle"
  | "goodChimpanzee"
  | "goodWhale"
  | "goodPeacock"
  | "goodPig"
  | "easySunrise"
  | "easySunriseOverMountains"
  | "easyRoseBloom"
  | "easyPeace"
  | "easyPlant"
  | "easyRainbowStreak"
  | "easyPhoenixRise"
  | "easyUnicornFlyby";

export type ReviewReactionFallbackVariant = "fallbackCrownBounce";

export type ReviewReactionRenderableVariant = ReviewReactionVariant | ReviewReactionFallbackVariant;

export type ReviewReactionEvent = Readonly<{
  id: string;
  rating: ReviewReactionRating;
  variant: ReviewReactionRenderableVariant;
}>;

export type ReviewReactionVariantDistributionEntry = Readonly<{
  id: string;
  rating: ReviewReactionRating;
  variant: ReviewReactionVariant;
  weight: number;
}>;

function makeReviewReactionVariantDistributionEntry(
  rating: ReviewReactionRating,
  variant: ReviewReactionVariant,
  weight: number,
): ReviewReactionVariantDistributionEntry {
  if (!Number.isInteger(weight) || weight <= 0) {
    throw new RangeError(`Invalid review reaction weight for ${rating}.${variant}: ${weight}`);
  }

  return {
    id: `${rating}.${variant}`,
    rating,
    variant,
    weight,
  };
}

export const allReviewReactionVariantDistributionEntries: ReadonlyArray<ReviewReactionVariantDistributionEntry> = [
  makeReviewReactionVariantDistributionEntry("again", "againRainCloud", 32),
  makeReviewReactionVariantDistributionEntry("again", "againTornado", 26),
  makeReviewReactionVariantDistributionEntry("again", "againWindFace", 24),
  makeReviewReactionVariantDistributionEntry("again", "againSnowflake", 18),
  makeReviewReactionVariantDistributionEntry("again", "againSnailCrawl", 18),
  makeReviewReactionVariantDistributionEntry("again", "againTurtle", 16),
  makeReviewReactionVariantDistributionEntry("again", "againWiltedFlower", 12),
  makeReviewReactionVariantDistributionEntry("again", "againSpider", 8),
  makeReviewReactionVariantDistributionEntry("again", "againRat", 8),
  makeReviewReactionVariantDistributionEntry("again", "againWormWiggle", 6),
  makeReviewReactionVariantDistributionEntry("hard", "hardTiger", 32),
  makeReviewReactionVariantDistributionEntry("hard", "hardTRex", 26),
  makeReviewReactionVariantDistributionEntry("hard", "hardShark", 22),
  makeReviewReactionVariantDistributionEntry("hard", "hardOxCharge", 20),
  makeReviewReactionVariantDistributionEntry("hard", "hardRacehorseGallop", 18),
  makeReviewReactionVariantDistributionEntry("hard", "hardSnake", 16),
  makeReviewReactionVariantDistributionEntry("hard", "hardVolcanoEruption", 14),
  makeReviewReactionVariantDistributionEntry("hard", "hardScorpion", 10),
  makeReviewReactionVariantDistributionEntry("hard", "hardPawPrints", 8),
  makeReviewReactionVariantDistributionEntry("hard", "hardRooster", 8),
  makeReviewReactionVariantDistributionEntry("good", "goodOtter", 32),
  makeReviewReactionVariantDistributionEntry("good", "goodOwl", 28),
  makeReviewReactionVariantDistributionEntry("good", "goodRabbit", 26),
  makeReviewReactionVariantDistributionEntry("good", "goodSeal", 24),
  makeReviewReactionVariantDistributionEntry("good", "goodServiceDog", 24),
  makeReviewReactionVariantDistributionEntry("good", "goodPoodle", 20),
  makeReviewReactionVariantDistributionEntry("good", "goodChimpanzee", 18),
  makeReviewReactionVariantDistributionEntry("good", "goodWhale", 16),
  makeReviewReactionVariantDistributionEntry("good", "goodPeacock", 12),
  makeReviewReactionVariantDistributionEntry("good", "goodPig", 10),
  makeReviewReactionVariantDistributionEntry("easy", "easySunrise", 34),
  makeReviewReactionVariantDistributionEntry("easy", "easySunriseOverMountains", 34),
  makeReviewReactionVariantDistributionEntry("easy", "easyRoseBloom", 30),
  makeReviewReactionVariantDistributionEntry("easy", "easyPeace", 28),
  makeReviewReactionVariantDistributionEntry("easy", "easyPlant", 26),
  makeReviewReactionVariantDistributionEntry("easy", "easyRainbowStreak", 24),
  makeReviewReactionVariantDistributionEntry("easy", "easyPhoenixRise", 18),
  makeReviewReactionVariantDistributionEntry("easy", "easyUnicornFlyby", 12),
];

export function reviewReactionVariantDistributionEntries(
  rating: ReviewReactionRating,
): ReadonlyArray<ReviewReactionVariantDistributionEntry> {
  return allReviewReactionVariantDistributionEntries.filter((entry) => entry.rating === rating);
}

function reviewReactionVariantTotalWeightFromEntries(
  rating: ReviewReactionRating,
  entries: ReadonlyArray<ReviewReactionVariantDistributionEntry>,
): number {
  if (entries.length === 0) {
    throw new Error(`Review reaction distribution is missing rating ${rating}.`);
  }

  let totalWeight = 0;
  for (const entry of entries) {
    if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
      throw new RangeError(`Invalid review reaction weight for ${entry.id}: ${entry.weight}`);
    }
    totalWeight += entry.weight;
  }

  return totalWeight;
}

export function reviewReactionVariantTotalWeight(rating: ReviewReactionRating): number {
  return reviewReactionVariantTotalWeightFromEntries(
    rating,
    reviewReactionVariantDistributionEntries(rating),
  );
}

export function reviewReactionVariantProbabilityPercent(
  entry: ReviewReactionVariantDistributionEntry,
): number {
  return (entry.weight / reviewReactionVariantTotalWeight(entry.rating)) * 100;
}

export function selectReviewReactionVariant(
  rating: ReviewReactionRating,
  roll: number,
): ReviewReactionVariant {
  const entries = reviewReactionVariantDistributionEntries(rating);
  const totalWeight = reviewReactionVariantTotalWeightFromEntries(rating, entries);

  if (!Number.isInteger(roll) || roll < 0 || roll >= totalWeight) {
    throw new RangeError(`Review reaction roll must be an integer in 0...${totalWeight - 1}, received ${roll}.`);
  }

  let cumulativeWeight = 0;
  for (const entry of entries) {
    cumulativeWeight += entry.weight;
    if (roll < cumulativeWeight) {
      return entry.variant;
    }
  }

  throw new Error(`Review reaction distribution is missing rating ${rating} roll ${roll}.`);
}

export function makeReviewReactionRating(rating: 0 | 1 | 2 | 3): ReviewReactionRating {
  if (rating === 0) {
    return "again";
  }

  if (rating === 1) {
    return "hard";
  }

  if (rating === 2) {
    return "good";
  }

  return "easy";
}

export function appendReviewReactionEvent(
  events: ReadonlyArray<ReviewReactionEvent>,
  event: ReviewReactionEvent,
  maximumActiveEvents: number,
): ReadonlyArray<ReviewReactionEvent> {
  if (!Number.isInteger(maximumActiveEvents) || maximumActiveEvents <= 0) {
    throw new RangeError(`Review reactions require a positive active event limit, received ${maximumActiveEvents}.`);
  }

  const nextEvents = [...events, event];
  if (nextEvents.length <= maximumActiveEvents) {
    return nextEvents;
  }

  return nextEvents.slice(nextEvents.length - maximumActiveEvents);
}

export function matchesReducedReviewReactionMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia(reducedReviewReactionMotionMediaQuery).matches;
}

export function reviewReactionAnimationDurationMillis(variant: ReviewReactionRenderableVariant): number {
  switch (variant) {
    case "againWindFace":
      return 1600;
    case "hardTRex":
      return 1550;
    case "hardRacehorseGallop":
      return 1200;
    case "easySunriseOverMountains":
      return 1200;
    case "goodRabbit":
      return 1333;
    case "easyRoseBloom":
      return 2400;
    case "againSpider":
      return 2400;
    case "goodPeacock":
      return 1333;
    case "againTornado":
      return 1450;
    case "hardOxCharge":
      return 1550;
    case "hardScorpion":
      return 1800;
    case "hardPawPrints":
    case "fallbackCrownBounce":
      return 1650;
    case "easyRainbowStreak":
      return 2000;
    case "hardVolcanoEruption":
      return 2050;
    case "againWiltedFlower":
      return 2400;
    case "goodSeal":
      return 2567;
    case "goodWhale":
      return 2633;
    case "againRat":
      return 2633;
    case "againSnailCrawl":
      return 2700;
    case "hardRooster":
      return 2850;
    case "easyPhoenixRise":
      return 3933;
    case "goodPoodle":
      return 2800;
    case "goodOwl":
      return 2833;
    case "goodOtter":
    case "goodServiceDog":
      return 3000;
    case "easyPeace":
      return 3167;
    case "hardShark":
      return 3200;
    case "againRainCloud":
    case "hardSnake":
      return 3267;
    case "againTurtle":
      return 3400;
    case "goodPig":
      return 3567;
    case "goodChimpanzee":
      return 3833;
    case "easyUnicornFlyby":
      return 3800;
    case "againSnowflake":
    case "hardTiger":
    case "easySunrise":
    case "easyPlant":
      return 4200;
    case "againWormWiggle":
      return 4267;
  }
}

export function reviewReactionCleanupDelayMillis(
  variant: ReviewReactionRenderableVariant,
  motionMode: ReviewReactionMotionMode,
): number {
  if (motionMode === "reduced") {
    return 400;
  }

  return reviewReactionAnimationDurationMillis(variant) + 80;
}
