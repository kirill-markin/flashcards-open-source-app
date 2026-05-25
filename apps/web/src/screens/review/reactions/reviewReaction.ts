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
  | "againWormWiggle"
  | "againTornado"
  | "againSnailCrawl"
  | "againWiltedFlower"
  | "hardOxCharge"
  | "hardPawPrints"
  | "hardRacehorseGallop"
  | "hardVolcanoEruption"
  | "goodOwl"
  | "goodPoodle"
  | "goodWhale"
  | "goodPeacock"
  | "easyRoseBloom"
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
  makeReviewReactionVariantDistributionEntry("again", "againWormWiggle", 40),
  makeReviewReactionVariantDistributionEntry("again", "againTornado", 30),
  makeReviewReactionVariantDistributionEntry("again", "againSnailCrawl", 22),
  makeReviewReactionVariantDistributionEntry("again", "againWiltedFlower", 8),
  makeReviewReactionVariantDistributionEntry("hard", "hardOxCharge", 40),
  makeReviewReactionVariantDistributionEntry("hard", "hardPawPrints", 30),
  makeReviewReactionVariantDistributionEntry("hard", "hardRacehorseGallop", 22),
  makeReviewReactionVariantDistributionEntry("hard", "hardVolcanoEruption", 8),
  makeReviewReactionVariantDistributionEntry("good", "goodOwl", 40),
  makeReviewReactionVariantDistributionEntry("good", "goodPoodle", 30),
  makeReviewReactionVariantDistributionEntry("good", "goodWhale", 22),
  makeReviewReactionVariantDistributionEntry("good", "goodPeacock", 8),
  makeReviewReactionVariantDistributionEntry("easy", "easyRoseBloom", 40),
  makeReviewReactionVariantDistributionEntry("easy", "easyRainbowStreak", 30),
  makeReviewReactionVariantDistributionEntry("easy", "easyPhoenixRise", 22),
  makeReviewReactionVariantDistributionEntry("easy", "easyUnicornFlyby", 8),
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
    case "hardRacehorseGallop":
      return 1200;
    case "easyRoseBloom":
      return 2400;
    case "goodPeacock":
      return 1333;
    case "againTornado":
      return 1450;
    case "hardOxCharge":
      return 1550;
    case "hardPawPrints":
    case "fallbackCrownBounce":
      return 1650;
    case "easyRainbowStreak":
      return 2000;
    case "hardVolcanoEruption":
      return 2050;
    case "againWiltedFlower":
      return 2400;
    case "goodWhale":
      return 2633;
    case "againSnailCrawl":
      return 2700;
    case "easyPhoenixRise":
      return 3933;
    case "goodPoodle":
      return 2800;
    case "goodOwl":
      return 2833;
    case "easyUnicornFlyby":
      return 3800;
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
