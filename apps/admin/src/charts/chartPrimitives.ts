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

const packageColorPalette: ReadonlyArray<string> = [...d3.schemeTableau10, ...d3.schemeSet2];

// The scale outlives the render that reads it, and the `implicit` default of `d3.scaleOrdinal`
// appends an unknown deck to the domain and hands back the next palette colour, so that deck's
// colour would depend on which render asked for it first. An explicit unknown value prevents that.
const unknownPackageColor = "#8c8c8c";

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
    .unknown(unknownPackageColor);
}

export function getPlatformColor(platform: string): string {
  if (reviewEventPlatforms.includes(platform as ReviewEventPlatform) === false) {
    throw new Error(`Unsupported platform color key: ${platform}`);
  }

  return platformColors[platform as ReviewEventPlatform];
}

export function createTickDates(dates: ReadonlyArray<string>): ReadonlyArray<string> {
  return dates.filter(
    (_date, index) => dates.length <= 22 || index % Math.ceil(dates.length / 16) === 0,
  );
}
