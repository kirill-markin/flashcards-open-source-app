import type { StudyDepthCell } from "./query";

export const studyDepthReviewThresholds: ReadonlyArray<number> = [
  1, 2, 3, 4, 5, 7, 10, 15, 20, 30, 50, 75, 100, 150, 200, 300, 500, 1000,
];

export const studyDepthReviewDayThresholds: ReadonlyArray<number> = [
  1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 21, 30, 45, 60, 90,
];

/** Below this many people a bar, or the drop measured from it, is too few to read as a rate. */
export const minReliablePeopleCount = 30;

/** How many of the largest reliable drops are bold. */
const largestDropCount = 3;

export type ReachDrop = Readonly<{
  previousThreshold: number;
  lostCount: number;
  /** Of the previous bar; `null` when that bar is empty. */
  share: number | null;
  isReliable: boolean;
  isLargest: boolean;
}>;

/** The people who reached at least `threshold`, and how many of the previous bar did not. */
export type ReachBar = Readonly<{
  threshold: number;
  peopleCount: number;
  shareOfCohort: number;
  isReliable: boolean;
  /** `null` on the first bar. */
  drop: ReachDrop | null;
}>;

/** One bar per threshold, cumulative: a person at 12 reviews is in every bar up to `≥ 10`. */
export function buildReachBars(
  cells: ReadonlyArray<StudyDepthCell>,
  cohortPeopleCount: number,
  thresholds: ReadonlyArray<number>,
  readCellValue: (cell: StudyDepthCell) => number,
): ReadonlyArray<ReachBar> {
  const peopleCounts = thresholds.map((threshold) => cells
    .filter((cell) => readCellValue(cell) >= threshold)
    .reduce((sum, cell) => sum + cell.peopleCount, 0));
  const drops = peopleCounts.map((peopleCount, index): Omit<ReachDrop, "isLargest"> | null => {
    if (index === 0) {
      return null;
    }

    const previousCount = peopleCounts[index - 1];
    return {
      previousThreshold: thresholds[index - 1],
      lostCount: previousCount - peopleCount,
      share: previousCount === 0 ? null : (previousCount - peopleCount) / previousCount,
      isReliable: previousCount >= minReliablePeopleCount,
    };
  });
  const largestDropIndexes = new Set(drops
    .flatMap((drop, index) => (drop !== null && drop.isReliable && drop.share !== null && drop.share > 0
      ? [{ index, share: drop.share }]
      : []))
    .sort((left, right) => right.share - left.share)
    .slice(0, largestDropCount)
    .map((entry) => entry.index));

  return thresholds.map((threshold, index) => {
    const drop = drops[index];
    return {
      threshold,
      peopleCount: peopleCounts[index],
      shareOfCohort: cohortPeopleCount === 0 ? 0 : peopleCounts[index] / cohortPeopleCount,
      isReliable: peopleCounts[index] >= minReliablePeopleCount,
      drop: drop === null ? null : { ...drop, isLargest: largestDropIndexes.has(index) },
    };
  });
}

/** Whole percents from 10% up, one decimal below, so a small share does not read as zero. */
export function formatShare(share: number): string {
  const percent = share * 100;
  return `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

export function formatDropShare(share: number | null): string {
  return share === null ? "—" : `−${Math.round(share * 100)}%`;
}
