import * as d3 from "d3";
import {
  reviewEventPlatforms,
  type ReviewEventPlatform,
  type ReviewEventsByDateReport,
  type ReviewEventsByDateUniqueUserCohort,
  type ReviewEventsByDateUser,
} from "../../adminApi";

export type ChartTooltipState = Readonly<{
  visible: boolean;
  html: string;
  left: number;
  top: number;
}>;

export type DailyValueEntry = Readonly<{
  date: string;
  value: number;
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

export type ReviewEventsByDateChartModel = Readonly<{
  dates: ReadonlyArray<string>;
  tickDates: ReadonlyArray<string>;
  userIds: ReadonlyArray<string>;
  userColorScale: d3.ScaleOrdinal<string, string>;
  dailyUniqueUserCohortMatrix: ReadonlyArray<MatrixChartEntry>;
  userMatrix: ReadonlyArray<MatrixChartEntry>;
  platformActiveUsersMatrix: ReadonlyArray<MatrixChartEntry>;
  platformReviewEventsMatrix: ReadonlyArray<MatrixChartEntry>;
  totalReviewEventsByDate: ReadonlyMap<string, number>;
  dailyUniqueUsersByDate: ReadonlyMap<string, number>;
  totalPlatformReviewEventsByDate: ReadonlyMap<string, number>;
  peakDailyUniqueUsers: number;
  peakDailyVolume: number;
  peakDailyPlatformUsers: number;
  peakDailyPlatformReviewEvents: number;
}>;

export const chartMargin = { top: 28, right: 68, bottom: 88, left: 68 } as const;
export const chartWidth = 1320;
export const simpleChartHeight = 300;
export const stackedChartHeight = 620;

export const platformLabels: Readonly<Record<ReviewEventPlatform, string>> = {
  web: "Web",
  android: "Android",
  ios: "iOS",
};

const platformColors: Readonly<Record<ReviewEventPlatform, string>> = {
  web: "#4e79a7",
  android: "#59a14f",
  ios: "#f28e2b",
};

export const uniqueUserCohortKeys = ["returning", "new"] as const;
export type UniqueUserCohortKey = (typeof uniqueUserCohortKeys)[number];

export const uniqueUserCohortLabels: Readonly<Record<UniqueUserCohortKey, string>> = {
  returning: "Returning",
  new: "New",
};

export const uniqueUserCohortColors: Readonly<Record<UniqueUserCohortKey, string>> = {
  returning: "var(--accent)",
  new: "#2e6f95",
};

const userColorPalette: ReadonlyArray<string> = [
  ...d3.schemeTableau10,
  ...d3.schemeSet2,
  ...d3.schemeDark2,
  "#e15759",
  "#76b7b2",
  "#f28e2b",
  "#59a14f",
];

export function buildReviewEventsByDateChartModel(
  report: ReviewEventsByDateReport,
  stableUsers: ReadonlyArray<ReviewEventsByDateUser>,
): ReviewEventsByDateChartModel {
  const dates = report.dateTotals.map((item) => item.date);
  const tickDates = createTickDates(dates);
  const allUserIds = getStableUserColorDomain(stableUsers);
  const userIds = report.users.map((user) => user.userId);
  const userColorScale = getUserColorScale(allUserIds);
  const dailyUniqueUserCohortMatrix = buildDailyUniqueUserCohortMatrix(report.dailyUniqueUserCohorts);
  const dailyUniqueUserTotals = report.dailyUniqueUserCohorts.map((item) => ({
    date: item.date,
    value: item.newReviewingUsers + item.returningReviewingUsers,
  }));
  const userMatrix = buildUserMatrix(report);
  const platformActiveUsersMatrix = buildPlatformMatrix(
    report.platformActiveUserTotals,
    (item) => item.activeUserCount,
    dates,
  );
  const platformReviewEventsMatrix = buildPlatformMatrix(
    report.platformReviewEventTotals,
    (item) => item.reviewEventCount,
    dates,
  );
  const totalReviewEventsByDate = new Map(report.dateTotals.map((item) => [item.date, item.totalReviewEvents]));
  const dailyUniqueUsersByDate = new Map(dailyUniqueUserTotals.map((item) => [item.date, item.value]));
  const totalPlatformReviewEventsByDate = buildTotalsByDate(platformReviewEventsMatrix);
  const peakDailyUniqueUsers = getPeakDailyValue(dailyUniqueUserTotals);
  const peakDailyVolume = d3.max(report.dateTotals, (item) => item.totalReviewEvents) ?? 0;
  const peakDailyPlatformUsers = getPeakGroupedValue(platformActiveUsersMatrix);
  const peakDailyPlatformReviewEvents = getPeakStackedValue(platformReviewEventsMatrix);

  return {
    dates,
    tickDates,
    userIds,
    userColorScale,
    dailyUniqueUserCohortMatrix,
    userMatrix,
    platformActiveUsersMatrix,
    platformReviewEventsMatrix,
    totalReviewEventsByDate,
    dailyUniqueUsersByDate,
    totalPlatformReviewEventsByDate,
    peakDailyUniqueUsers,
    peakDailyVolume,
    peakDailyPlatformUsers,
    peakDailyPlatformReviewEvents,
  };
}

export function getPlatformColor(platform: string): string {
  if (reviewEventPlatforms.includes(platform as ReviewEventPlatform) === false) {
    throw new Error(`Unsupported platform color key: ${platform}`);
  }

  return platformColors[platform as ReviewEventPlatform];
}

function buildDailyUniqueUserCohortMatrix(
  cohorts: ReadonlyArray<ReviewEventsByDateUniqueUserCohort>,
): ReadonlyArray<MatrixChartEntry> {
  return cohorts.map((cohort) => ({
    date: cohort.date,
    valuesByKey: {
      returning: cohort.returningReviewingUsers,
      new: cohort.newReviewingUsers,
    },
  }));
}

function buildUserMatrix(report: ReviewEventsByDateReport): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const row of report.rows) {
    const currentValues = valuesByDate.get(row.date) ?? {};
    currentValues[row.userId] = (currentValues[row.userId] ?? 0) + row.reviewEventCount;
    valuesByDate.set(row.date, currentValues);
  }

  return report.dateTotals.map((item) => ({
    date: item.date,
    valuesByKey: valuesByDate.get(item.date) ?? {},
  }));
}

function buildPlatformMatrix<Item extends Readonly<{ date: string; platform: ReviewEventPlatform }>>(
  items: ReadonlyArray<Item>,
  getValue: (item: Item) => number,
  dates: ReadonlyArray<string>,
): ReadonlyArray<MatrixChartEntry> {
  const valuesByDate = new Map<string, Record<string, number>>();

  for (const item of items) {
    const currentValues = valuesByDate.get(item.date) ?? {};
    currentValues[item.platform] = getValue(item);
    valuesByDate.set(item.date, currentValues);
  }

  return dates.map((date) => ({
    date,
    valuesByKey: valuesByDate.get(date) ?? {},
  }));
}

function buildTotalsByDate(items: ReadonlyArray<DailyValueEntry | MatrixChartEntry>): ReadonlyMap<string, number> {
  const totalsByDate = new Map<string, number>();

  for (const item of items) {
    if ("value" in item) {
      totalsByDate.set(item.date, item.value);
      continue;
    }

    const nextTotal = Object.values(item.valuesByKey).reduce((sum, value) => sum + value, 0);
    totalsByDate.set(item.date, nextTotal);
  }

  return totalsByDate;
}

function getPeakDailyValue(items: ReadonlyArray<DailyValueEntry>): number {
  return d3.max(items, (item) => item.value) ?? 0;
}

function getPeakStackedValue(items: ReadonlyArray<MatrixChartEntry>): number {
  return d3.max(items, (item) => Object.values(item.valuesByKey).reduce((sum, value) => sum + value, 0)) ?? 0;
}

function getPeakGroupedValue(items: ReadonlyArray<MatrixChartEntry>): number {
  return d3.max(items, (item) => d3.max(reviewEventPlatforms, (platform) => item.valuesByKey[platform] ?? 0) ?? 0) ?? 0;
}

function getUserColorScale(userIds: ReadonlyArray<string>): d3.ScaleOrdinal<string, string> {
  const colors = userIds.map((userId) => userColorPalette[getUserColorPaletteIndex(userId)]);

  return d3.scaleOrdinal<string, string>(userIds, colors);
}

function getUserColorPaletteIndex(userId: string): number {
  let hash = 0;

  for (const character of userId) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }

  return Math.abs(hash) % userColorPalette.length;
}

function getStableUserColorDomain(users: ReadonlyArray<ReviewEventsByDateUser>): ReadonlyArray<string> {
  return users.map((user) => user.userId).sort((leftUserId, rightUserId) => leftUserId.localeCompare(rightUserId));
}

function createTickDates(dates: ReadonlyArray<string>): ReadonlyArray<string> {
  return dates.filter(
    (_date, index) => dates.length <= 22 || index % Math.ceil(dates.length / 16) === 0,
  );
}
