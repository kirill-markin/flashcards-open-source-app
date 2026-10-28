import {
  reviewEventPlatforms,
  type AdminQueryValue,
  type ReviewEventPlatform,
} from "../adminApi";

// Runtime guards for the untyped rows `POST /v1/admin/reports/query` returns, plus the UTC calendar
// arithmetic every report needs to fill in the days its SQL returned no row for. `reportLabel` is the
// report naming itself, so a failure says which panel produced it.

export function parseCalendarDate(date: string, reportLabel: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (match === null) {
    throw new Error(`${reportLabel} date must use YYYY-MM-DD: ${date}`);
  }

  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  const day = Number.parseInt(match[3], 10);
  const parsedDate = new Date(Date.UTC(year, monthIndex, day));

  if (
    Number.isNaN(parsedDate.getTime())
    || parsedDate.getUTCFullYear() !== year
    || parsedDate.getUTCMonth() !== monthIndex
    || parsedDate.getUTCDate() !== day
  ) {
    throw new Error(`${reportLabel} date is invalid: ${date}`);
  }

  return parsedDate;
}

/** The later of two `YYYY-MM-DD` dates, which sort lexically. */
export function laterCalendarDate(left: string, right: string): string {
  return left > right ? left : right;
}

export function formatCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The UTC calendar date `now` falls on, which is the date every available range ends on. */
export function todayUtcCalendarDate(now: Date): string {
  return formatCalendarDate(now);
}

export const defaultReportRangeLookbackDays = 30;

/** `to` back `lookbackDays` days, both ends inclusive. */
export function buildLookbackReportRangeEndingOn(
  to: string,
  lookbackDays: number,
  reportLabel: string,
): Readonly<{ from: string; to: string }> {
  const toDate = parseCalendarDate(to, reportLabel);
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - lookbackDays);

  return { from: formatCalendarDate(fromDate), to: formatCalendarDate(toDate) };
}

// A lookback window anchored on the last day that carries data rather than on today, clamped up to
// the available first day so the window can never fall outside the range the picker and the range
// validation allow.
export function buildLookbackReportRange(
  availableRange: Readonly<{ from: string; to: string }>,
  lookbackDays: number,
  reportLabel: string,
): Readonly<{ from: string; to: string }> {
  const availableFrom = formatCalendarDate(parseCalendarDate(availableRange.from, reportLabel));
  const lookbackRange = buildLookbackReportRangeEndingOn(availableRange.to, lookbackDays, reportLabel);

  return { from: laterCalendarDate(lookbackRange.from, availableFrom), to: lookbackRange.to };
}

type LookbackReportRangePreset = Readonly<{ id: string; label: string; kind: "lookback"; lookbackDays: number }>;

export type ReportRangePreset =
  | LookbackReportRangePreset
  | Readonly<{ id: string; label: string; kind: "all-time" }>;

const lastThreeDaysReportRangePreset: ReportRangePreset = {
  id: "last-3-days",
  label: "Last 3 days",
  kind: "lookback",
  lookbackDays: 3,
};

/** Also the window Level 1 metrics opens on. */
export const lastSixtyDaysReportRangePreset: LookbackReportRangePreset = {
  id: "last-60-days",
  label: "Last 60 days",
  kind: "lookback",
  lookbackDays: 60,
};

/** Also the window Journeys opens on. */
export const lastNinetyDaysReportRangePreset: LookbackReportRangePreset = {
  id: "last-90-days",
  label: "Last 90 days",
  kind: "lookback",
  lookbackDays: 90,
};

/** Also the window Study depth opens on. */
export const allTimeReportRangePreset: ReportRangePreset = { id: "all-time", label: "All time", kind: "all-time" };

// The one-click ranges every time filter offers, in row order.
export const reportRangePresets: ReadonlyArray<ReportRangePreset> = [
  lastThreeDaysReportRangePreset,
  { id: "last-7-days", label: "Last 7 days", kind: "lookback", lookbackDays: 7 },
  { id: "last-30-days", label: "Last 30 days", kind: "lookback", lookbackDays: 30 },
  lastSixtyDaysReportRangePreset,
  lastNinetyDaysReportRangePreset,
  { id: "last-130-days", label: "Last 130 days", kind: "lookback", lookbackDays: 130 },
  { id: "last-360-days", label: "Last 360 days", kind: "lookback", lookbackDays: 360 },
  allTimeReportRangePreset,
];

export const reportRangePresetLabel = "Report range preset";

export function buildPresetReportRange(
  preset: ReportRangePreset,
  availableRange: Readonly<{ from: string; to: string }>,
  reportLabel: string,
): Readonly<{ from: string; to: string }> {
  if (preset.kind === "all-time") {
    return {
      from: formatCalendarDate(parseCalendarDate(availableRange.from, reportLabel)),
      to: formatCalendarDate(parseCalendarDate(availableRange.to, reportLabel)),
    };
  }

  return buildLookbackReportRange(availableRange, preset.lookbackDays, reportLabel);
}

export function buildRequestedDateRange(
  from: string,
  to: string,
  reportLabel: string,
): ReadonlyArray<string> {
  const startDate = parseCalendarDate(from, reportLabel);
  const endDate = parseCalendarDate(to, reportLabel);
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error(`${reportLabel} date range is invalid: ${from} > ${to}`);
  }

  const dates: Array<string> = [];
  const currentDate = new Date(startDate);
  while (currentDate.getTime() <= endDate.getTime()) {
    dates.push(formatCalendarDate(currentDate));
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dates;
}

export function assertValidDateRange<Range extends Readonly<{ from: string; to: string }>>(
  range: Range,
  reportLabel: string,
): Range {
  const fromDate = parseCalendarDate(range.from, reportLabel);
  const toDate = parseCalendarDate(range.to, reportLabel);
  if (fromDate.getTime() > toDate.getTime()) {
    throw new Error(`${reportLabel} date range is invalid: ${range.from} > ${range.to}`);
  }

  return range;
}

export function assertIsString(
  value: AdminQueryValue,
  reportLabel: string,
  fieldName: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${reportLabel} field "${fieldName}" must be a string.`);
  }

  return value;
}

export function toInteger(
  value: AdminQueryValue,
  reportLabel: string,
  fieldName: string,
): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && /^-?\d+$/u.test(value)) {
    return Number.parseInt(value, 10);
  }

  throw new Error(`${reportLabel} field "${fieldName}" must be an integer.`);
}

export function parseActivityDate(value: AdminQueryValue, label: string, field: string): string {
  const date = assertIsString(value, label, field);
  parseCalendarDate(date, label);
  return date;
}

export function parseActivityCount(value: AdminQueryValue, label: string, field: string): number | null {
  if (value === null) return null;
  const count = toInteger(value, label, field);
  if (count < 0 || !Number.isSafeInteger(count)) {
    throw new Error(`${label} field "${field}" must be a non-negative safe integer.`);
  }
  return count;
}

export function assertPlatform(
  value: AdminQueryValue,
  reportLabel: string,
  fieldName: string,
): ReviewEventPlatform {
  const platform = assertIsString(value, reportLabel, fieldName);
  if (reviewEventPlatforms.includes(platform as ReviewEventPlatform) === false) {
    throw new Error(`${reportLabel} field "${fieldName}" must be a supported platform.`);
  }

  return platform as ReviewEventPlatform;
}
