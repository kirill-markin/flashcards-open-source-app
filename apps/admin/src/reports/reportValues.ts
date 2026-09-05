import { reviewEventPlatforms, type AdminQueryValue, type ReviewEventPlatform } from "../adminApi";

// Runtime guards for the untyped rows `POST /v1/admin/reports/query` returns, plus the UTC calendar
// arithmetic every report needs to fill in the days its SQL returned no row for. `reportLabel` is the
// report naming itself, so a failure says which panel produced it.

function parseCalendarDate(date: string, reportLabel: string): Date {
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

function formatCalendarDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const defaultReportRangeLookbackDays = 30;

// The window the dashboard opens on: the available range's last day back `defaultReportRangeLookbackDays`
// days, both ends inclusive, clamped up to the available first day so the default can never fall
// outside the range the picker and the range validation allow.
export function buildDefaultReportRange(
  availableRange: Readonly<{ from: string; to: string }>,
  reportLabel: string,
): Readonly<{ from: string; to: string }> {
  const availableFromDate = parseCalendarDate(availableRange.from, reportLabel);
  const availableToDate = parseCalendarDate(availableRange.to, reportLabel);

  const defaultFromDate = new Date(availableToDate);
  defaultFromDate.setUTCDate(defaultFromDate.getUTCDate() - defaultReportRangeLookbackDays);

  return {
    from: formatCalendarDate(
      defaultFromDate.getTime() < availableFromDate.getTime() ? availableFromDate : defaultFromDate,
    ),
    to: formatCalendarDate(availableToDate),
  };
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
