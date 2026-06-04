import type {
  ProgressReviewScheduleInput,
  ProgressSeriesInput,
  ProgressSummaryInput,
} from "../types";
import {
  captureWebWarning,
  type WebObservationScope,
} from "../observability/webObservability";

export const progressRangeDayCount: number = 140;
export const progressRangeStartOffsetDays: number = 1 - progressRangeDayCount;
const fallbackProgressTimeZone = "UTC";
const observedInvalidProgressTimeZoneWarnings = new Set<string>();

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

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildProgressObservationScope(): WebObservationScope {
  return {
    app: "web",
    feature: "progress",
    userId: null,
    workspaceId: null,
    installationId: null,
    route: getCurrentRoute(),
    requestId: null,
    statusCode: null,
    code: null,
  };
}

function readErrorName(error: unknown): string {
  if (typeof error !== "object" || error === null || "name" in error === false) {
    return "Error";
  }

  const errorName = (error as Readonly<{ name: unknown }>).name;
  return typeof errorName === "string" && errorName.trim() !== "" ? errorName : "Error";
}

function observeInvalidProgressTimeZone(
  observedTimeZone: string | null,
  errorName: string,
): void {
  const warningKey = `${observedTimeZone ?? "null"}:${errorName}`;
  if (observedInvalidProgressTimeZoneWarnings.has(warningKey)) {
    return;
  }

  observedInvalidProgressTimeZoneWarnings.add(warningKey);
  captureWebWarning({
    action: "progress_timezone_invalid",
    scope: buildProgressObservationScope(),
    details: {
      eventName: "progress_timezone_invalid",
      observedTimeZone,
      fallbackTimeZone: fallbackProgressTimeZone,
      errorName,
    },
  });
}

function assertUsableTimeZone(timeZone: string): void {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  formatter.formatToParts(new Date(0));
}

function getBrowserTimeZone(): string {
  let timeZone: string | null = null;
  try {
    const observedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    timeZone = typeof observedTimeZone === "string" && observedTimeZone.trim() !== ""
      ? observedTimeZone
      : null;
  } catch (error) {
    observeInvalidProgressTimeZone(null, readErrorName(error));
    return fallbackProgressTimeZone;
  }

  if (timeZone === null) {
    observeInvalidProgressTimeZone(null, "Error");
    return fallbackProgressTimeZone;
  }

  try {
    assertUsableTimeZone(timeZone);
  } catch (error) {
    observeInvalidProgressTimeZone(timeZone, readErrorName(error));
    return fallbackProgressTimeZone;
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

export function buildProgressReviewScheduleInputForDateContext(
  timeContext: ProgressDateContext,
): ProgressReviewScheduleInput {
  return {
    timeZone: timeContext.timeZone,
    today: timeContext.today,
  };
}

export function buildProgressSeriesInput(now: Date): ProgressSeriesInput {
  return buildProgressSeriesInputForDateContext(buildProgressDateContext(now));
}
