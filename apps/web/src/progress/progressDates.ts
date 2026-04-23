import type {
  ProgressSeriesInput,
  ProgressSummaryInput,
} from "../types";

export const progressRangeDayCount: number = 140;
export const progressRangeStartOffsetDays: number = 1 - progressRangeDayCount;

export type ProgressDateContext = Readonly<{
  timeZone: string;
  today: string;
}>;

function getRequiredDatePart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day",
): string {
  const partValue = parts.find((part) => part.type === partType)?.value;

  if (partValue === undefined || partValue === "") {
    throw new Error(`Browser timezone date is missing ${partType}`);
  }

  return partValue;
}

function getBrowserTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new Error("Browser timezone is unavailable");
  }

  return timeZone;
}

export function formatDateAsLocalDate(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = getRequiredDatePart(parts, "year");
  const month = getRequiredDatePart(parts, "month");
  const day = getRequiredDatePart(parts, "day");

  return `${year}-${month}-${day}`;
}

export function buildProgressDateContext(now: Date): ProgressDateContext {
  const timeZone = getBrowserTimeZone();

  return {
    timeZone,
    today: formatDateAsLocalDate(now, timeZone),
  };
}

export function parseLocalDate(value: string): Date {
  const [rawYear, rawMonth, rawDay] = value.split("-");
  const year = Number.parseInt(rawYear ?? "", 10);
  const month = Number.parseInt(rawMonth ?? "", 10);
  const day = Number.parseInt(rawDay ?? "", 10);

  if (Number.isInteger(year) === false || Number.isInteger(month) === false || Number.isInteger(day) === false) {
    throw new Error(`Invalid local date: ${value}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

export function shiftLocalDate(value: string, offsetDays: number): string {
  const nextDate = parseLocalDate(value);
  nextDate.setUTCDate(nextDate.getUTCDate() + offsetDays);
  return nextDate.toISOString().slice(0, 10);
}

export function buildProgressSummaryInputForDateContext(
  timeContext: ProgressDateContext,
): ProgressSummaryInput {
  return {
    timeZone: timeContext.timeZone,
    today: timeContext.today,
  };
}

export function buildProgressSeriesInputForDateContext(
  timeContext: ProgressDateContext,
): ProgressSeriesInput {
  return {
    timeZone: timeContext.timeZone,
    from: shiftLocalDate(timeContext.today, progressRangeStartOffsetDays),
    to: timeContext.today,
  };
}

export function buildProgressSeriesInput(now: Date): ProgressSeriesInput {
  return buildProgressSeriesInputForDateContext(buildProgressDateContext(now));
}
