import { describe, expect, it } from "vitest";
import {
  reviewReactionVariantDistributionEntries,
  reviewReactionVariantProbabilityPercent,
  selectReviewReactionVariant,
  type ReviewReactionRating,
  type ReviewReactionVariant,
} from "./reviewReaction";

type ReviewReactionBoundaryExpectation = Readonly<{
  rating: ReviewReactionRating;
  distribution: ReadonlyArray<ReviewReactionExpectedDistributionEntry>;
}>;

type ReviewReactionExpectedDistributionEntry = Readonly<{
  variant: ReviewReactionVariant;
  weight: number;
}>;

const boundaryExpectations: ReadonlyArray<ReviewReactionBoundaryExpectation> = [
  {
    rating: "again",
    distribution: [
      { variant: "againRainCloud", weight: 32 },
      { variant: "againTornado", weight: 26 },
      { variant: "againWindFace", weight: 24 },
      { variant: "againSnowflake", weight: 18 },
      { variant: "againSnailCrawl", weight: 18 },
      { variant: "againTurtle", weight: 16 },
      { variant: "againWiltedFlower", weight: 12 },
      { variant: "againSpider", weight: 8 },
      { variant: "againRat", weight: 8 },
      { variant: "againWormWiggle", weight: 6 },
    ],
  },
  {
    rating: "hard",
    distribution: [
      { variant: "hardTiger", weight: 32 },
      { variant: "hardTRex", weight: 26 },
      { variant: "hardShark", weight: 22 },
      { variant: "hardOxCharge", weight: 20 },
      { variant: "hardRacehorseGallop", weight: 18 },
      { variant: "hardSnake", weight: 16 },
      { variant: "hardVolcanoEruption", weight: 14 },
      { variant: "hardScorpion", weight: 10 },
      { variant: "hardPawPrints", weight: 8 },
      { variant: "hardRooster", weight: 8 },
    ],
  },
  {
    rating: "good",
    distribution: [
      { variant: "goodOtter", weight: 32 },
      { variant: "goodOwl", weight: 28 },
      { variant: "goodRabbit", weight: 26 },
      { variant: "goodSeal", weight: 24 },
      { variant: "goodServiceDog", weight: 24 },
      { variant: "goodPoodle", weight: 20 },
      { variant: "goodChimpanzee", weight: 18 },
      { variant: "goodWhale", weight: 16 },
      { variant: "goodPeacock", weight: 12 },
      { variant: "goodPig", weight: 10 },
    ],
  },
  {
    rating: "easy",
    distribution: [
      { variant: "easySunrise", weight: 34 },
      { variant: "easySunriseOverMountains", weight: 34 },
      { variant: "easyRoseBloom", weight: 30 },
      { variant: "easyPeace", weight: 28 },
      { variant: "easyPlant", weight: 26 },
      { variant: "easyRainbowStreak", weight: 24 },
      { variant: "easyPhoenixRise", weight: 18 },
      { variant: "easyUnicornFlyby", weight: 12 },
    ],
  },
];

describe("selectReviewReactionVariant", () => {
  it("uses the exact review reaction boundary values for every rating", () => {
    for (const expectation of boundaryExpectations) {
      let startRoll = 0;
      for (const entry of expectation.distribution) {
        const endRoll = startRoll + entry.weight - 1;
        expect(selectReviewReactionVariant(expectation.rating, startRoll)).toBe(entry.variant);
        expect(selectReviewReactionVariant(expectation.rating, endRoll)).toBe(entry.variant);
        startRoll += entry.weight;
      }
    }
  });

  it("keeps review reaction weights and probability percentages in sync", () => {
    for (const expectation of boundaryExpectations) {
      const actualEntries = reviewReactionVariantDistributionEntries(expectation.rating);
      const totalWeight = expectation.distribution.reduce(
        (sum, entry) => sum + entry.weight,
        0,
      );

      expect(actualEntries.map((entry) => entry.variant)).toEqual(
        expectation.distribution.map((entry) => entry.variant),
      );
      expect(actualEntries.map((entry) => entry.weight)).toEqual(
        expectation.distribution.map((entry) => entry.weight),
      );
      expect(actualEntries.map((entry) => reviewReactionVariantProbabilityPercent(entry))).toEqual(
        expectation.distribution.map((entry) => entry.weight / totalWeight * 100),
      );
    }
  });
});
