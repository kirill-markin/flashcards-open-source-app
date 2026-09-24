import type { AnalyticsDateRange } from "../../filters/analyticsFilters";
import { formatCalendarDate, parseCalendarDate } from "../reportValues";

// The vocabulary of the Study-vs-AI area and the calendar arithmetic behind its panels. Nothing here
// knows about SQL, React or loading: it decides what a period is, how many of them a range holds and
// what the two controls may be set to, so the query, the chart and the URL codec all agree.

export const aiUsageReportLabel = "Study vs AI";

/**
 * The period lengths the area offers, in weeks.
 *
 * Presets only, and free day entry is deliberately absent: a period nobody else is using is a period
 * whose panels cannot be compared with anyone else's, and an odd length also stops the panels lining
 * up with the weekly rate both axes are expressed in.
 */
export const aiUsagePeriodWeekOptions = [1, 2, 4] as const;

export type AiUsagePeriodWeeks = (typeof aiUsagePeriodWeekOptions)[number];

/** Four weeks: long enough that a person with one study session a fortnight still places somewhere. */
export const defaultAiUsagePeriodWeeks: AiUsagePeriodWeeks = 4;

/**
 * Who the panels count, decided by the person's state NOW rather than inside each period.
 *
 * `registered` is the rule `buildSignedInActorSql` owns, which is also what the funnels' `signed-in`
 * mode asks, so the two areas cannot disagree about who is registered. The consequence is stated on
 * screen rather than hidden here: somebody who registered last week is registered in every earlier
 * panel too, so this axis cannot be read as a registration timeline.
 */
export const aiUsageAudiences = ["all", "registered", "guests"] as const;

export type AiUsageAudience = (typeof aiUsageAudiences)[number];

export const defaultAiUsageAudience: AiUsageAudience = "all";

export const aiUsageAudienceLabels: Readonly<Record<AiUsageAudience, string>> = {
  all: "Everyone",
  registered: "Registered",
  guests: "Guests",
};

export const aiUsageAudienceExplanations: Readonly<Record<AiUsageAudience, string>> = {
  all: "Every person with a review or a chat message in the period, registered or not.",
  registered: "Only people whose identity resolves to a real, non-guest account right now. Somebody who registered last week is counted as registered in every earlier panel too, so this is current state and not a registration timeline.",
  guests: "Only people with no account right now. Somebody who registered later is absent from every panel, including the ones from while they were still a guest.",
};

/**
 * The most panels drawn before the rest are dropped.
 *
 * Past roughly a dozen small multiples the panels are too small to compare, which is the entire
 * reason the report is drawn this way; more panels would defeat it rather than say more. The dropped
 * ones are the oldest and the section says plainly how many there were.
 */
export const maxAiUsagePanelCount = 12;

/**
 * The least exposure a person must have inside a period to be plotted in it.
 *
 * Both axes are per-week rates over a person's own exposure, and a person who existed for two days
 * carries a divisor of two sevenths: one review becomes three and a half reviews a week, from one
 * observation. A week is the shortest window on which a weekly rate is a measurement rather than an
 * extrapolation, so anybody with less is left out of that panel and stays in the ones where they
 * have enough.
 */
export const minAiUsageExposureDays = 7;

const millisecondsPerDay = 86_400_000;

/** One panel's span, inclusive at both ends. `index` runs oldest to newest, which is panel order. */
export type AiUsagePeriod = Readonly<{
  index: number;
  from: string;
  to: string;
}>;

export type AiUsagePeriodPlan = Readonly<{
  /** The panels to draw, oldest first. Empty when the range is shorter than one period. */
  periods: ReadonlyArray<AiUsagePeriod>;
  /** Whole periods the range held that the panel cap left out. They are the oldest ones. */
  droppedPeriodCount: number;
  /** Days at the old end of the range that do not fill a whole period and are therefore unused. */
  remainderDays: number;
}>;

/**
 * The periods a range is cut into, ANCHORED AT ITS RECENT END.
 *
 * The anchor is what makes the panels comparable at all. Cutting forward from the start would leave
 * the most recent period - the one every reading of this report is about - short by however many days
 * the range does not divide into, so the newest panel would show a fraction of the activity the
 * others show and read as a collapse. Anchoring at the end instead makes every drawn period whole and
 * pushes the leftover days off the old end, where they are simply not drawn.
 */
export function buildAiUsagePeriods(
  dateRange: AnalyticsDateRange,
  periodWeeks: AiUsagePeriodWeeks,
): AiUsagePeriodPlan {
  const fromDate = parseCalendarDate(dateRange.from, aiUsageReportLabel);
  const toDate = parseCalendarDate(dateRange.to, aiUsageReportLabel);
  const totalDays = Math.round((toDate.getTime() - fromDate.getTime()) / millisecondsPerDay) + 1;
  const periodDays = periodWeeks * 7;

  if (totalDays < periodDays) {
    return { periods: [], droppedPeriodCount: 0, remainderDays: Math.max(0, totalDays) };
  }

  const wholePeriodCount = Math.floor(totalDays / periodDays);
  const drawnPeriodCount = Math.min(wholePeriodCount, maxAiUsagePanelCount);
  const periods: Array<AiUsagePeriod> = [];

  for (let index = 0; index < drawnPeriodCount; index += 1) {
    const periodsBeforeNewest = drawnPeriodCount - 1 - index;
    const endsOn = new Date(toDate.getTime() - periodsBeforeNewest * periodDays * millisecondsPerDay);
    const startsOn = new Date(endsOn.getTime() - (periodDays - 1) * millisecondsPerDay);
    periods.push({ index, from: formatCalendarDate(startsOn), to: formatCalendarDate(endsOn) });
  }

  return {
    periods,
    droppedPeriodCount: wholePeriodCount - drawnPeriodCount,
    remainderDays: totalDays - wholePeriodCount * periodDays,
  };
}
