import type { StudyDepthCell } from "./query";
import { minReliablePeopleCount } from "./reachBars";
import type { StudyDepthMatrixMode } from "./studyDepthUrl";

/** Rows of the matrix; each is also a threshold of the reviews chart, so the left column matches it. */
export const studyDepthMatrixReviewEdges: ReadonlyArray<number> = [1, 2, 3, 5, 10, 20, 50, 100, 200, 500, 1000];

/** Columns of the matrix; each is also a threshold of the review-days chart, so the top row matches it. */
export const studyDepthMatrixReviewDayEdges: ReadonlyArray<number> = [1, 2, 3, 4, 5, 7, 14, 30, 60, 90];

/** At or below this share of the cohort a cell takes the palest fill, so one person stays visible. */
export const minMatrixFillShare = 0.002;

/** The values a row or a column holds: from `min`, up to `max` or without end when it is `null`. */
export type MatrixBand = Readonly<{
  min: number;
  max: number | null;
  label: string;
}>;

export type MatrixCell = Readonly<{
  reviewDayBand: MatrixBand;
  peopleCount: number;
  shareOfCohort: number;
  isReliable: boolean;
}>;

export type MatrixRow = Readonly<{
  reviewBand: MatrixBand;
  cells: ReadonlyArray<MatrixCell>;
}>;

export type StudyDepthMatrix = Readonly<{
  reviewDayBands: ReadonlyArray<MatrixBand>;
  rows: ReadonlyArray<MatrixRow>;
}>;

/** In `at-least` every edge opens a band without end; in `exactly` a band runs to the next edge. */
function buildMatrixBands(edges: ReadonlyArray<number>, mode: StudyDepthMatrixMode): ReadonlyArray<MatrixBand> {
  return edges.map((edge, index): MatrixBand => {
    if (mode === "at-least") {
      return { min: edge, max: null, label: `≥ ${edge}` };
    }

    const max = index + 1 < edges.length ? edges[index + 1] - 1 : null;
    return {
      min: edge,
      max,
      label: max === null ? `${edge}+` : max === edge ? `${edge}` : `${edge}–${max}`,
    };
  });
}

function isInBand(value: number, band: MatrixBand): boolean {
  return value >= band.min && (band.max === null || value <= band.max);
}

/** The people of each reviews band and review-days band, read off the area's joint counts. */
export function buildStudyDepthMatrix(
  cells: ReadonlyArray<StudyDepthCell>,
  cohortPeopleCount: number,
  mode: StudyDepthMatrixMode,
): StudyDepthMatrix {
  const reviewDayBands = buildMatrixBands(studyDepthMatrixReviewDayEdges, mode);
  const rows = buildMatrixBands(studyDepthMatrixReviewEdges, mode).map((reviewBand): MatrixRow => ({
    reviewBand,
    cells: reviewDayBands.map((reviewDayBand): MatrixCell => {
      const peopleCount = cells
        .filter((cell) => isInBand(cell.reviewCount, reviewBand) && isInBand(cell.reviewDayCount, reviewDayBand))
        .reduce((sum, cell) => sum + cell.peopleCount, 0);
      return {
        reviewDayBand,
        peopleCount,
        shareOfCohort: cohortPeopleCount === 0 ? 0 : peopleCount / cohortPeopleCount,
        isReliable: peopleCount >= minReliablePeopleCount,
      };
    }),
  }));

  return { reviewDayBands, rows };
}

/**
 * How much of the accent a non-empty cell is filled with, in percent: the share on a log scale from
 * `minMatrixFillShare` (palest) to the whole cohort (full), fixed so two selections compare.
 */
export function getMatrixCellFillPercent(shareOfCohort: number): number {
  const position = Math.log(shareOfCohort / minMatrixFillShare) / Math.log(1 / minMatrixFillShare);
  return Math.round(12 + 88 * Math.min(1, Math.max(0, position)));
}
