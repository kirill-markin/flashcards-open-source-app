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
      "againWormWiggle",
      "againWormWiggle",
      "againTornado",
      "againTornado",
      "againSnailCrawl",
      "againSnailCrawl",
      "againWiltedFlower",
      "againWiltedFlower",
    ],
  },
  {
    rating: "hard",
    variants: [
      "hardOxCharge",
      "hardOxCharge",
      "hardPawPrints",
      "hardPawPrints",
      "hardRacehorseGallop",
      "hardRacehorseGallop",
      "hardVolcanoEruption",
      "hardVolcanoEruption",
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
      "easyRoseBloom",
      "easyRoseBloom",
      "easyRainbowStreak",
      "easyRainbowStreak",
      "easyPhoenixRise",
      "easyPhoenixRise",
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
