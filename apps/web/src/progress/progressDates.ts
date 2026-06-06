import type {
  ProgressReviewScheduleInput,
  ProgressSeriesInput,
  ProgressSummaryInput,
} from "../types";
import {
  captureWebWarning,
  type WebObservationScope,
} from "../observability/webObservability";
import { getStableInstallationId } from "../clientIdentity";

export const progressRangeDayCount: number = 140;
export const progressRangeStartOffsetDays: number = 1 - progressRangeDayCount;
const fallbackProgressTimeZone = "UTC";
const progressTimezoneWarningHistoryStorageKey = "flashcards-progress-timezone-warning-history-v1";
const progressTimezoneWarningHistoryEntryLimit: number = 20;
const progressTimezoneWarningThrottleMs: number = 7 * 24 * 60 * 60 * 1000;
const observedInvalidProgressTimeZoneWarnings = new Set<string>();

export type ProgressDateContext = Readonly<{
  timeZone: string;
  today: string;
}>;

type ProgressTimezoneWarningHistoryEntry = Readonly<{
  observedTimeZone: string | null;
  errorName: string;
  lastObservedAt: string;
}>;

type ProgressTimezoneWarningHistoryEnvelope = Readonly<{
  entries: ReadonlyArray<ProgressTimezoneWarningHistoryEntry>;
}>;

type UnknownRecord = Readonly<Record<string, unknown>>;

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

function getBrowserLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadProgressObservationInstallationId(): string | null {
  if (getBrowserLocalStorage() === null) {
    return null;
  }

  try {
    return getStableInstallationId();
  } catch {
    return null;
  }
}

function buildProgressObservationScope(): WebObservationScope {
  return {
    app: "web",
    feature: "progress",
    userId: null,
    workspaceId: null,
    installationId: loadProgressObservationInstallationId(),
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

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object"
    && value !== null
    && Array.isArray(value) === false;
}

function isProgressTimezoneWarningHistoryEntry(value: unknown): value is ProgressTimezoneWarningHistoryEntry {
  if (isUnknownRecord(value) === false) {
    return false;
  }

  const observedTimeZone = value.observedTimeZone;
  const errorName = value.errorName;
  const lastObservedAt = value.lastObservedAt;

  return (typeof observedTimeZone === "string" || observedTimeZone === null)
    && typeof errorName === "string"
    && errorName.trim() !== ""
    && typeof lastObservedAt === "string"
    && Number.isFinite(Date.parse(lastObservedAt));
}

function isProgressTimezoneWarningHistoryEnvelope(value: unknown): value is ProgressTimezoneWarningHistoryEnvelope {
  if (isUnknownRecord(value) === false || Array.isArray(value.entries) === false) {
    return false;
  }

  return value.entries.every((entry: unknown): boolean => {
    return isProgressTimezoneWarningHistoryEntry(entry);
  });
}

function readProgressTimezoneWarningHistory(storage: Storage): ReadonlyArray<ProgressTimezoneWarningHistoryEntry> | null {
  try {
    const rawValue = storage.getItem(progressTimezoneWarningHistoryStorageKey);
    if (rawValue === null) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue) as unknown;
    if (isProgressTimezoneWarningHistoryEnvelope(parsedValue) === false) {
      return null;
    }

    return parsedValue.entries;
  } catch {
    return null;
  }
}

function matchesProgressTimezoneWarningHistoryEntry(
  entry: ProgressTimezoneWarningHistoryEntry,
  observedTimeZone: string | null,
  errorName: string,
): boolean {
  return entry.observedTimeZone === observedTimeZone && entry.errorName === errorName;
}

function hasRecentProgressTimezoneWarning(
  entries: ReadonlyArray<ProgressTimezoneWarningHistoryEntry>,
  observedTimeZone: string | null,
  errorName: string,
  nowMs: number,
): boolean {
  return entries.some((entry: ProgressTimezoneWarningHistoryEntry): boolean => {
    if (matchesProgressTimezoneWarningHistoryEntry(entry, observedTimeZone, errorName) === false) {
      return false;
    }

    const lastObservedMs = Date.parse(entry.lastObservedAt);
    const elapsedMs = nowMs - lastObservedMs;
    return elapsedMs >= 0 && elapsedMs < progressTimezoneWarningThrottleMs;
  });
}

function upsertProgressTimezoneWarningHistoryEntry(
  entries: ReadonlyArray<ProgressTimezoneWarningHistoryEntry>,
  observedTimeZone: string | null,
  errorName: string,
  nowMs: number,
): ReadonlyArray<ProgressTimezoneWarningHistoryEntry> {
  const nextEntry: ProgressTimezoneWarningHistoryEntry = {
    observedTimeZone,
    errorName,
    lastObservedAt: new Date(nowMs).toISOString(),
  };
  const previousEntries = entries.filter((entry: ProgressTimezoneWarningHistoryEntry): boolean => {
    return matchesProgressTimezoneWarningHistoryEntry(entry, observedTimeZone, errorName) === false;
  });

  return [nextEntry, ...previousEntries].slice(0, progressTimezoneWarningHistoryEntryLimit);
}

function writeProgressTimezoneWarningHistory(
  storage: Storage,
  entries: ReadonlyArray<ProgressTimezoneWarningHistoryEntry>,
): void {
  const envelope: ProgressTimezoneWarningHistoryEnvelope = { entries };

  try {
    storage.setItem(progressTimezoneWarningHistoryStorageKey, JSON.stringify(envelope));
  } catch {
    return;
  }
}

function observeInvalidProgressTimeZone(
  observedTimeZone: string | null,
  errorName: string,
): void {
  const warningKey = `${observedTimeZone ?? "null"}:${errorName}`;
  if (observedInvalidProgressTimeZoneWarnings.has(warningKey)) {
    return;
  }

  const storage = getBrowserLocalStorage();
  const nowMs = Date.now();
  const storedHistory = storage === null ? null : readProgressTimezoneWarningHistory(storage);
  if (
    storedHistory !== null
    && hasRecentProgressTimezoneWarning(storedHistory, observedTimeZone, errorName, nowMs)
  ) {
    observedInvalidProgressTimeZoneWarnings.add(warningKey);
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

  if (storage !== null) {
    const nextHistory = upsertProgressTimezoneWarningHistoryEntry(
      storedHistory ?? [],
      observedTimeZone,
      errorName,
      nowMs,
    );
    writeProgressTimezoneWarningHistory(storage, nextHistory);
  }
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
