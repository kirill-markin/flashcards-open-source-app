import type { AiUsageCohortsReport, AiUsageDot } from "./query";
import type { AiUsagePeriod } from "./reportModel";

// Turns the rows the query returns into what a panel and a summary row need: the two per-week rates,
// and the three statistics each panel carries in its own caption.
//
// The arithmetic lives here rather than in SQL so that every statistic is taken over exactly the dots
// that are drawn. A median computed in the query over a separately filtered population could disagree
// with the cloud beneath it, and the reader would have no way to tell which one was wrong.

const daysPerWeek = 7;

/** One person in one period, with the rates both axes read. */
export type AiUsagePoint = Readonly<{
  dot: AiUsageDot;
  /** Reviews per week of this person's own exposure inside the period. */
  reviewRate: number;
  /** Characters of chat text per week of the same exposure. */
  charRate: number;
}>;

export type AiUsagePanel = Readonly<{
  period: AiUsagePeriod;
  points: ReadonlyArray<AiUsagePoint>;
  peopleCount: number;
  neverReviewedCount: number;
  /**
   * The median review rate among the people who reviewed at all, or `null` when nobody did.
   *
   * It is deliberately not the median over everyone: that is zero in every period measured so far, so
   * the line would sit in the zero strip of every panel and say nothing about how the people who do
   * study are studying. The panel caption says which population it is over, because a median with an
   * unstated population is not a number a reader can use.
   */
  medianReviewRateAmongReviewers: number | null;
  /** The median character rate over everyone in the panel, zeros included, or `null` when it is empty. */
  medianCharRate: number | null;
}>;

/** Exposure is guaranteed positive by the query's own minimum, so this never divides by zero. */
function buildPoint(dot: AiUsageDot): AiUsagePoint {
  const weeks = dot.exposureDays / daysPerWeek;
  return {
    dot,
    reviewRate: dot.reviews / weeks,
    charRate: dot.chatChars / weeks,
  };
}

function median(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) {
    return null;
  }

  const sortedValues = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 === 1
    ? sortedValues[middleIndex]
    : (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
}

export function buildAiUsagePanels(report: AiUsageCohortsReport): ReadonlyArray<AiUsagePanel> {
  // Seeded with every period first, so a period nobody was active in still produces an empty panel
  // rather than disappearing from the row and silently shortening the timeline.
  const pointsByPeriod = new Map<number, Array<AiUsagePoint>>();
  report.periods.forEach((period) => {
    pointsByPeriod.set(period.index, []);
  });
  report.dots.forEach((dot) => {
    pointsByPeriod.get(dot.periodIndex)?.push(buildPoint(dot));
  });

  return report.periods.map((period) => {
    const points = pointsByPeriod.get(period.index) ?? [];
    return {
      period,
      points,
      peopleCount: points.length,
      neverReviewedCount: points.filter((point) => point.dot.reviews === 0).length,
      medianReviewRateAmongReviewers: median(
        points.filter((point) => point.dot.reviews > 0).map((point) => point.reviewRate),
      ),
      medianCharRate: median(points.map((point) => point.charRate)),
    };
  });
}
