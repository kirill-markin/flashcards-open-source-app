export const reviewReactionMaximumActiveEvents = 3;

export type ReviewReactionMotionMode = "standard" | "reduced";

export type ReviewReactionRating =
  | "again"
  | "hard"
  | "good"
  | "easy";

export type ReviewReactionVariant =
  | "againRedScribbleSlash"
  | "againRewindVortex"
  | "againStampFlyby"
  | "againWarningTape"
  | "hardHourglassSand"
  | "hardFallingWeight"
  | "hardYellowCrack"
  | "hardRollingBoulder"
  | "goodHandDrawnCheck"
  | "goodLightSweep"
  | "goodPaperPlaneCheck"
  | "goodCheckSealBounce"
  | "easySparkleBurst"
  | "easyRainbowStreak"
  | "easyCrownBounce"
  | "easyUnicornFlyby";

export type ReviewReactionEvent = Readonly<{
  id: string;
  rating: ReviewReactionRating;
  variant: ReviewReactionVariant;
}>;

export function selectReviewReactionVariant(
  rating: ReviewReactionRating,
  roll: number,
): ReviewReactionVariant {
  if (!Number.isInteger(roll) || roll < 0 || roll > 999) {
    throw new RangeError(`Review reaction roll must be an integer in 0...999, received ${roll}.`);
  }

  if (rating === "again") {
    if (roll <= 399) {
      return "againRedScribbleSlash";
    }
    if (roll <= 699) {
      return "againRewindVortex";
    }
    if (roll <= 919) {
      return "againStampFlyby";
    }
    return "againWarningTape";
  }

  if (rating === "hard") {
    if (roll <= 399) {
      return "hardHourglassSand";
    }
    if (roll <= 699) {
      return "hardFallingWeight";
    }
    if (roll <= 919) {
      return "hardYellowCrack";
    }
    return "hardRollingBoulder";
  }

  if (rating === "good") {
    if (roll <= 399) {
      return "goodHandDrawnCheck";
    }
    if (roll <= 699) {
      return "goodLightSweep";
    }
    if (roll <= 919) {
      return "goodPaperPlaneCheck";
    }
    return "goodCheckSealBounce";
  }

  if (roll <= 399) {
    return "easySparkleBurst";
  }
  if (roll <= 699) {
    return "easyRainbowStreak";
  }
  if (roll <= 919) {
    return "easyCrownBounce";
  }
  return "easyUnicornFlyby";
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

export function reviewReactionAnimationDurationMillis(variant: ReviewReactionVariant): number {
  switch (variant) {
    case "goodHandDrawnCheck":
      return 1150;
    case "againRedScribbleSlash":
    case "hardYellowCrack":
      return 1200;
    case "easySparkleBurst":
      return 1250;
    case "againRewindVortex":
    case "goodLightSweep":
    case "goodCheckSealBounce":
      return 1450;
    case "hardHourglassSand":
    case "againWarningTape":
    case "easyRainbowStreak":
      return 1550;
    case "hardFallingWeight":
    case "easyCrownBounce":
      return 1650;
    case "goodPaperPlaneCheck":
      return 1750;
    case "againStampFlyby":
      return 1900;
    case "hardRollingBoulder":
      return 2050;
    case "easyUnicornFlyby":
      return 2150;
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
