import { describe, expect, it } from "vitest";
import {
  selectReviewReactionVariant,
  type ReviewReactionRating,
  type ReviewReactionVariant,
} from "./reviewReaction";

type ReviewReactionBoundaryExpectation = Readonly<{
  rating: ReviewReactionRating;
  variants: ReadonlyArray<ReviewReactionVariant>;
}>;

const boundaryRolls: ReadonlyArray<number> = [0, 399, 400, 699, 700, 919, 920, 999];

const boundaryExpectations: ReadonlyArray<ReviewReactionBoundaryExpectation> = [
  {
    rating: "again",
    variants: [
      "againRedScribbleSlash",
      "againRedScribbleSlash",
      "againRewindVortex",
      "againRewindVortex",
      "againStampFlyby",
      "againStampFlyby",
      "againWarningTape",
      "againWarningTape",
    ],
  },
  {
    rating: "hard",
    variants: [
      "hardHourglassSand",
      "hardHourglassSand",
      "hardFallingWeight",
      "hardFallingWeight",
      "hardYellowCrack",
      "hardYellowCrack",
      "hardRollingBoulder",
      "hardRollingBoulder",
    ],
  },
  {
    rating: "good",
    variants: [
      "goodOwl",
      "goodOwl",
      "goodPoodle",
      "goodPoodle",
      "goodWhale",
      "goodWhale",
      "goodPeacock",
      "goodPeacock",
    ],
  },
  {
    rating: "easy",
    variants: [
      "easySparkleBurst",
      "easySparkleBurst",
      "easyRainbowStreak",
      "easyRainbowStreak",
      "easyCrownBounce",
      "easyCrownBounce",
      "easyUnicornFlyby",
      "easyUnicornFlyby",
    ],
  },
];

describe("selectReviewReactionVariant", () => {
  it("uses the exact review reaction boundary values for every rating", () => {
    for (const expectation of boundaryExpectations) {
      for (const [index, roll] of boundaryRolls.entries()) {
        expect(selectReviewReactionVariant(expectation.rating, roll)).toBe(expectation.variants[index]);
      }
    }
  });
});
