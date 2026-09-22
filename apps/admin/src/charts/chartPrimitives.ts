import * as d3 from "d3";
import {
  reviewEventCohorts,
  reviewEventPlatforms,
  type ReviewEventCohort,
  type ReviewEventPlatform,
} from "../adminApi";

export type ChartTooltipState = Readonly<{
  visible: boolean;
  html: string;
  left: number;
  top: number;
}>;

export type ChartTooltipHandlers = Readonly<{
  showTooltip: (html: string, clientX: number, clientY: number) => void;
  hideTooltip: () => void;
}>;

/** The identity fields every per-user chart tooltip renders, whichever report supplied the person. */
export type ChartUser = Readonly<{
  userId: string;
  email: string;
}>;

export type MatrixChartEntry = Readonly<{
  date: string;
  valuesByKey: Readonly<Record<string, number>>;
}>;

export type StackedChartRectEntry = Readonly<{
  key: string;
  date: string;
  value: number;
  y0: number;
  y1: number;
}>;

export type GroupedChartRectEntry = Readonly<{
  key: ReviewEventPlatform;
  date: string;
  value: number;
}>;

export const chartMargin = { top: 28, right: 68, bottom: 88, left: 68 } as const;
export const chartWidth = 1320;
export const simpleChartHeight = 300;
export const stackedChartHeight = 620;

export const platformLabels: Readonly<Record<ReviewEventPlatform, string>> = {
  web: "Web",
  android: "Android",
  ios: "iOS",
  agent: "Agent API",
  // A row lands here because its `platform` column is NULL, which means no resolved device fact:
  // either the actor behind it is not a device, or no device could be resolved for it. It is kept as
  // its own series so it can never be read as a device or summed into one.
  unattributed: "Unresolved",
};

const platformColors: Readonly<Record<ReviewEventPlatform, string>> = {
  web: "#4e79a7",
  android: "#59a14f",
  ios: "#f28e2b",
  agent: "#af7aa1",
  unattributed: "#8c8c8c",
};

export const uniqueUserCohortKeys = reviewEventCohorts;
export type UniqueUserCohortKey = ReviewEventCohort;

export const uniqueUserCohortLabels: Readonly<Record<UniqueUserCohortKey, string>> = {
  returning: "Returning",
  new: "New",
};

export const uniqueUserCohortColors: Readonly<Record<UniqueUserCohortKey, string>> = {
  returning: "var(--accent)",
  new: "#2e6f95",
};

export type PackageColorScale = d3.ScaleOrdinal<string, string, string>;
export type FunnelGroupColorScale = d3.ScaleOrdinal<string, string, string>;

const packageColorPalette: ReadonlyArray<string> = [...d3.schemeTableau10, ...d3.schemeSet2];

/** A series that is not a value of its dimension: an unknown deck, a folded or unresolved funnel group. */
export const neutralChartColor = "#8c8c8c";

// Both positional scales below outlive the render that reads them, and the `implicit` default of
// `d3.scaleOrdinal` appends an unknown key to the domain and hands back the next palette colour, so
// that key's colour would depend on which render asked for it first. An explicit unknown prevents that.

/**
 * Catalog decks are an open-ended set the dashboard only learns from the loaded range, so unlike the
 * fixed platform colours these are positional over the deduplicated, sorted slugs. Build the scale
 * from the decks of the loaded report rather than of the filtered one, or narrowing a filter shifts
 * the colour of every deck sorted after the one it removed.
 */
export function getPackageColorScale(packageSlugs: ReadonlyArray<string>): PackageColorScale {
  const sortedPackageSlugs = Array.from(new Set(packageSlugs))
    .sort((leftSlug, rightSlug) => leftSlug.localeCompare(rightSlug));

  return d3.scaleOrdinal<string, string>(sortedPackageSlugs, packageColorPalette)
    .unknown(neutralChartColor);
}

/**
 * The colours of one funnel group-by dimension whose values the dashboard only learns from the loaded
 * range - a connection country, a UI language - built the same positional way, over its sorted keys.
 * The platform dimension is the exception and takes the fixed platform colours instead, which
 * `buildFunnelGroupColor` in `../reports/funnels/funnelGroupBy.ts` decides.
 */
export function getFunnelGroupColorScale(groupKeys: ReadonlyArray<string>): FunnelGroupColorScale {
  const sortedGroupKeys = Array.from(new Set(groupKeys))
    .sort((leftKey, rightKey) => leftKey.localeCompare(rightKey));

  return d3.scaleOrdinal<string, string>(sortedGroupKeys, packageColorPalette)
    .unknown(neutralChartColor);
}

/**
 * Whether a key a report read out of a row is one of the fixed platforms.
 *
 * The two accessors below throw on anything else on purpose, because a chart of platforms drawing an
 * unnamed series is a bug in the query behind it. A caller that must survive a key it did not choose
 * - a funnel holding one render of the keys of the dimension it was grouped by a moment ago - asks
 * this first and falls back, rather than letting a render throw.
 */
export function isReviewEventPlatform(platform: string): platform is ReviewEventPlatform {
  return reviewEventPlatforms.includes(platform as ReviewEventPlatform);
}

export function getPlatformColor(platform: string): string {
  if (isReviewEventPlatform(platform) === false) {
    throw new Error(`Unsupported platform color key: ${platform}`);
  }

  return platformColors[platform];
}

/** The platform's name on screen, for a key a report read out of a row rather than out of the fixed list. */
export function getPlatformLabel(platform: string): string {
  if (isReviewEventPlatform(platform) === false) {
    throw new Error(`Unsupported platform label key: ${platform}`);
  }

  return platformLabels[platform];
}

export function createTickDates(dates: ReadonlyArray<string>): ReadonlyArray<string> {
  return dates.filter(
    (_date, index) => dates.length <= 22 || index % Math.ceil(dates.length / 16) === 0,
  );
}
