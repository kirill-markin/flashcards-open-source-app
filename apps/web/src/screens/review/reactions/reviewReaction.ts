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
  | "againRewindVortex"
  | "againSnailCrawl"
  | "againWiltedFlower"
  | "hardHourglassSand"
  | "hardFallingWeight"
  | "hardYellowCrack"
  | "hardRollingBoulder"
  | "goodOwl"
  | "goodPoodle"
  | "goodWhale"
  | "goodPeacock"
  | "easySparkleBurst"
  | "easyRainbowStreak"
  | "easyCrownBounce"
  | "easyUnicornFlyby";

export type ReviewReactionEvent = Readonly<{
  id: string;
  rating: ReviewReactionRating;
  variant: ReviewReactionVariant;
}>;

export type ReviewReactionVariantDistributionEntry = Readonly<{
  id: string;
  rating: ReviewReactionRating;
  variant: ReviewReactionVariant;
  rollRange: Readonly<{
    lowerBound: number;
    upperBound: number;
  }>;
  rollCount: number;
  probabilityPercent: number;
}>;

function makeReviewReactionVariantDistributionEntry(
  rating: ReviewReactionRating,
  variant: ReviewReactionVariant,
  lowerBound: number,
  upperBound: number,
): ReviewReactionVariantDistributionEntry {
  if (
    !Number.isInteger(lowerBound)
    || !Number.isInteger(upperBound)
    || lowerBound < 0
    || upperBound > 999
    || upperBound < lowerBound
  ) {
    throw new RangeError(`Invalid review reaction roll range for ${rating}.${variant}: ${lowerBound}...${upperBound}`);
  }

  const rollCount = upperBound - lowerBound + 1;

  return {
    id: `${rating}.${variant}`,
    rating,
    variant,
    rollRange: {
      lowerBound,
      upperBound,
    },
    rollCount,
    probabilityPercent: rollCount / 10,
  };
}

export const allReviewReactionVariantDistributionEntries: ReadonlyArray<ReviewReactionVariantDistributionEntry> = [
  makeReviewReactionVariantDistributionEntry("again", "againWormWiggle", 0, 399),
  makeReviewReactionVariantDistributionEntry("again", "againRewindVortex", 400, 699),
  makeReviewReactionVariantDistributionEntry("again", "againSnailCrawl", 700, 919),
  makeReviewReactionVariantDistributionEntry("again", "againWiltedFlower", 920, 999),
  makeReviewReactionVariantDistributionEntry("hard", "hardHourglassSand", 0, 399),
  makeReviewReactionVariantDistributionEntry("hard", "hardFallingWeight", 400, 699),
  makeReviewReactionVariantDistributionEntry("hard", "hardYellowCrack", 700, 919),
  makeReviewReactionVariantDistributionEntry("hard", "hardRollingBoulder", 920, 999),
  makeReviewReactionVariantDistributionEntry("good", "goodOwl", 0, 399),
  makeReviewReactionVariantDistributionEntry("good", "goodPoodle", 400, 699),
  makeReviewReactionVariantDistributionEntry("good", "goodWhale", 700, 919),
  makeReviewReactionVariantDistributionEntry("good", "goodPeacock", 920, 999),
  makeReviewReactionVariantDistributionEntry("easy", "easySparkleBurst", 0, 399),
  makeReviewReactionVariantDistributionEntry("easy", "easyRainbowStreak", 400, 699),
  makeReviewReactionVariantDistributionEntry("easy", "easyCrownBounce", 700, 919),
  makeReviewReactionVariantDistributionEntry("easy", "easyUnicornFlyby", 920, 999),
];

export function reviewReactionVariantDistributionEntries(
  rating: ReviewReactionRating,
): ReadonlyArray<ReviewReactionVariantDistributionEntry> {
  return allReviewReactionVariantDistributionEntries.filter((entry) => entry.rating === rating);
}

function isRollInReviewReactionDistributionEntry(
  entry: ReviewReactionVariantDistributionEntry,
  roll: number,
): boolean {
  return roll >= entry.rollRange.lowerBound && roll <= entry.rollRange.upperBound;
}

export function selectReviewReactionVariant(
  rating: ReviewReactionRating,
  roll: number,
): ReviewReactionVariant {
  if (!Number.isInteger(roll) || roll < 0 || roll > 999) {
    throw new RangeError(`Review reaction roll must be an integer in 0...999, received ${roll}.`);
  }

  const entry = reviewReactionVariantDistributionEntries(rating).find((candidate) => (
    isRollInReviewReactionDistributionEntry(candidate, roll)
  ));
  if (entry === undefined) {
    throw new Error(`Review reaction distribution is missing rating ${rating} roll ${roll}.`);
  }

  return entry.variant;
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

export function reviewReactionAnimationDurationMillis(variant: ReviewReactionVariant): number {
  switch (variant) {
    case "hardYellowCrack":
      return 1200;
    case "easySparkleBurst":
      return 1250;
    case "goodPeacock":
      return 1333;
    case "againRewindVortex":
      return 1450;
    case "hardHourglassSand":
      return 1550;
    case "hardFallingWeight":
    case "easyCrownBounce":
      return 1650;
    case "easyRainbowStreak":
      return 2000;
    case "hardRollingBoulder":
      return 2050;
    case "againWiltedFlower":
      return 2400;
    case "goodWhale":
      return 2633;
    case "againSnailCrawl":
      return 2700;
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
  variant: ReviewReactionVariant,
  motionMode: ReviewReactionMotionMode,
): number {
  if (motionMode === "reduced") {
    return 400;
  }

  return reviewReactionAnimationDurationMillis(variant) + 80;
}
