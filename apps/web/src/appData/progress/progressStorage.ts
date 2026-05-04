import type {
  DailyReviewPoint,
  ProgressReviewSchedule,
  ProgressReviewScheduleBucket,
  ProgressScopeKey,
  ProgressSeries,
  ProgressSummaryPayload,
} from "../../types";
import { progressReviewScheduleBucketKeys } from "../../types";
import { findProgressReviewScheduleValidationIssue } from "../../progress/progressReviewScheduleValidation";
import { normalizeProgressSeries } from "./progressSnapshots";

const progressSummaryStorageKeyPrefix = "flashcards-progress-server-summary";
const progressSeriesStorageKeyPrefix = "flashcards-progress-server-series";
const progressReviewScheduleStorageKeyPrefix = "flashcards-progress-server-review-schedule";
const progressServerSummaryVersion = 1;
const progressServerSeriesVersion = 1;
const progressServerReviewScheduleVersion = 1;

type PersistedProgressSummary = Readonly<{
  version: 1;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSummaryPayload;
}>;

type PersistedProgressSeries = Readonly<{
  version: 1;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSeries;
}>;

type PersistedProgressReviewSchedule = Readonly<{
  version: 1;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressReviewSchedule;
}>;

type LocalStorageLike = Storage & Record<string, string | undefined> & Readonly<{
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}>;

type ProgressCacheSection = "summary" | "series" | "review_schedule";
type ProgressCacheMissReason = "empty" | "invalid_json" | "invalid_shape" | "scope_mismatch" | "time_zone_mismatch";

type ProgressCacheReadResult<TValue> =
  | Readonly<{ status: "hit"; value: TValue }>
  | Readonly<{ status: "miss"; reason: ProgressCacheMissReason }>;

const fallbackLocalStorageState = new Map<string, string>();
const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isValidLocalDateValue(value: string): boolean {
  const match = localDatePattern.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const normalizedDate = new Date(Date.UTC(year, month - 1, day));
  normalizedDate.setUTCFullYear(year);

  return normalizedDate.getUTCFullYear() === year
    && normalizedDate.getUTCMonth() === month - 1
    && normalizedDate.getUTCDate() === day;
}

function normalizePersistedProgressSeries(
  serverBase: ProgressSeries,
): ProgressCacheReadResult<ProgressSeries> {
  if (
    isValidLocalDateValue(serverBase.from) === false
    || isValidLocalDateValue(serverBase.to) === false
    || serverBase.from > serverBase.to
    || serverBase.dailyReviews.some((day) => isValidLocalDateValue(day.date) === false)
  ) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  try {
    return {
      status: "hit",
      value: normalizeProgressSeries(serverBase),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith("Invalid local date:")) {
      return {
        status: "miss",
        reason: "invalid_shape",
      };
    }

    throw error;
  }
}

function buildProgressSummaryStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressSummaryStorageKeyPrefix}:${scopeKey}`;
}

function buildProgressSeriesStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressSeriesStorageKeyPrefix}:${scopeKey}`;
}

function buildProgressReviewScheduleStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressReviewScheduleStorageKeyPrefix}:${scopeKey}`;
}

function readLocalStorageValue(key: string): string | null {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.getItem === "function") {
    return storage.getItem(key);
  }

  return fallbackLocalStorageState.get(key) ?? null;
}

function writeLocalStorageValue(key: string, value: string): void {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.setItem === "function") {
    storage.setItem(key, value);
    return;
  }

  fallbackLocalStorageState.set(key, value);
}

function warnProgressCacheMiss(
  section: ProgressCacheSection,
  storageKey: string,
  scopeKey: ProgressScopeKey,
  reason: Exclude<ProgressCacheMissReason, "empty">,
): void {
  console.warn("progress_cache_miss", {
    section,
    storageKey,
    scopeKey,
    reason,
  });
}

function parseJsonRecord(rawValue: string): ProgressCacheReadResult<Record<string, unknown>> {
  try {
    const parsedValue = JSON.parse(rawValue) as unknown;
    if (isRecord(parsedValue) === false) {
      return {
        status: "miss",
        reason: "invalid_shape",
      };
    }

    return {
      status: "hit",
      value: parsedValue,
    };
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      return {
        status: "miss",
        reason: "invalid_json",
      };
    }

    throw error;
  }
}

function parsePersistedProgressSummary(rawValue: string | null): ProgressCacheReadResult<PersistedProgressSummary> {
  if (rawValue === null) {
    return {
      status: "miss",
      reason: "empty",
    };
  }

  const parsedRecord = parseJsonRecord(rawValue);
  if (parsedRecord.status === "miss") {
    return parsedRecord;
  }

  const parsedValue = parsedRecord.value;
  if (
    parsedValue.version !== progressServerSummaryVersion
    || typeof parsedValue.scopeKey !== "string"
    || typeof parsedValue.savedAt !== "string"
    || isRecord(parsedValue.serverBase) === false
    || typeof parsedValue.serverBase.timeZone !== "string"
    || (parsedValue.serverBase.generatedAt !== null && typeof parsedValue.serverBase.generatedAt !== "string")
    || isRecord(parsedValue.serverBase.summary) === false
    || typeof parsedValue.serverBase.summary.currentStreakDays !== "number"
    || typeof parsedValue.serverBase.summary.hasReviewedToday !== "boolean"
    || (parsedValue.serverBase.summary.lastReviewedOn !== null && typeof parsedValue.serverBase.summary.lastReviewedOn !== "string")
    || typeof parsedValue.serverBase.summary.activeReviewDays !== "number"
  ) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  return {
    status: "hit",
    value: {
      version: 1,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase: {
        timeZone: parsedValue.serverBase.timeZone,
        generatedAt: parsedValue.serverBase.generatedAt,
        summary: {
          currentStreakDays: parsedValue.serverBase.summary.currentStreakDays,
          hasReviewedToday: parsedValue.serverBase.summary.hasReviewedToday,
          lastReviewedOn: parsedValue.serverBase.summary.lastReviewedOn,
          activeReviewDays: parsedValue.serverBase.summary.activeReviewDays,
        },
      },
    },
  };
}

function parsePersistedProgressSeries(rawValue: string | null): ProgressCacheReadResult<PersistedProgressSeries> {
  if (rawValue === null) {
    return {
      status: "miss",
      reason: "empty",
    };
  }

  const parsedRecord = parseJsonRecord(rawValue);
  if (parsedRecord.status === "miss") {
    return parsedRecord;
  }

  const parsedValue = parsedRecord.value;
  if (
    parsedValue.version !== progressServerSeriesVersion
    || typeof parsedValue.scopeKey !== "string"
    || typeof parsedValue.savedAt !== "string"
    || isRecord(parsedValue.serverBase) === false
    || typeof parsedValue.serverBase.timeZone !== "string"
    || typeof parsedValue.serverBase.from !== "string"
    || typeof parsedValue.serverBase.to !== "string"
    || (parsedValue.serverBase.generatedAt !== null && typeof parsedValue.serverBase.generatedAt !== "string")
    || Array.isArray(parsedValue.serverBase.dailyReviews) === false
  ) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const dailyReviews = parsedValue.serverBase.dailyReviews
    .map((day): DailyReviewPoint | null => {
      if (isRecord(day) === false || typeof day.date !== "string" || typeof day.reviewCount !== "number") {
        return null;
      }

      return {
        date: day.date,
        reviewCount: day.reviewCount,
      };
    })
    .filter((day): day is DailyReviewPoint => day !== null);

  if (dailyReviews.length !== parsedValue.serverBase.dailyReviews.length) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const normalizedServerBase = normalizePersistedProgressSeries({
    timeZone: parsedValue.serverBase.timeZone,
    from: parsedValue.serverBase.from,
    to: parsedValue.serverBase.to,
    generatedAt: parsedValue.serverBase.generatedAt,
    dailyReviews,
  });
  if (normalizedServerBase.status === "miss") {
    return {
      status: "miss",
      reason: normalizedServerBase.reason,
    };
  }

  return {
    status: "hit",
    value: {
      version: 1,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase: normalizedServerBase.value,
    },
  };
}

function isProgressReviewScheduleBucketKey(value: unknown): value is ProgressReviewScheduleBucket["key"] {
  return typeof value === "string" && progressReviewScheduleBucketKeys.includes(value as ProgressReviewScheduleBucket["key"]);
}

function parsePersistedProgressReviewSchedule(
  rawValue: string | null,
): ProgressCacheReadResult<PersistedProgressReviewSchedule> {
  if (rawValue === null) {
    return {
      status: "miss",
      reason: "empty",
    };
  }

  const parsedRecord = parseJsonRecord(rawValue);
  if (parsedRecord.status === "miss") {
    return parsedRecord;
  }

  const parsedValue = parsedRecord.value;
  if (
    parsedValue.version !== progressServerReviewScheduleVersion
    || typeof parsedValue.scopeKey !== "string"
    || typeof parsedValue.savedAt !== "string"
    || isRecord(parsedValue.serverBase) === false
    || typeof parsedValue.serverBase.timeZone !== "string"
    || (parsedValue.serverBase.generatedAt !== null && typeof parsedValue.serverBase.generatedAt !== "string")
    || typeof parsedValue.serverBase.totalCards !== "number"
    || Array.isArray(parsedValue.serverBase.buckets) === false
  ) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const buckets = parsedValue.serverBase.buckets
    .map((bucket): ProgressReviewScheduleBucket | null => {
      if (
        isRecord(bucket) === false
        || isProgressReviewScheduleBucketKey(bucket.key) === false
        || typeof bucket.count !== "number"
      ) {
        return null;
      }

      return {
        key: bucket.key,
        count: bucket.count,
      };
    })
    .filter((bucket): bucket is ProgressReviewScheduleBucket => bucket !== null);

  if (buckets.length !== parsedValue.serverBase.buckets.length) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const serverBase: ProgressReviewSchedule = {
    timeZone: parsedValue.serverBase.timeZone,
    generatedAt: parsedValue.serverBase.generatedAt,
    totalCards: parsedValue.serverBase.totalCards,
    buckets,
  };
  const validationIssue = findProgressReviewScheduleValidationIssue(serverBase, "serverBase");

  if (validationIssue !== null) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  return {
    status: "hit",
    value: {
      version: 1,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase,
    },
  };
}

export function loadPersistedProgressSummary(scopeKey: ProgressScopeKey): ProgressSummaryPayload | null {
  const storageKey = buildProgressSummaryStorageKey(scopeKey);
  const persistedValue = parsePersistedProgressSummary(readLocalStorageValue(storageKey));

  if (persistedValue.status === "miss") {
    if (persistedValue.reason !== "empty") {
      warnProgressCacheMiss("summary", storageKey, scopeKey, persistedValue.reason);
    }

    return null;
  }

  if (persistedValue.value.scopeKey !== scopeKey) {
    warnProgressCacheMiss("summary", storageKey, scopeKey, "scope_mismatch");
    return null;
  }

  return persistedValue.value.serverBase;
}

export function loadPersistedProgressSeries(scopeKey: ProgressScopeKey): ProgressSeries | null {
  const storageKey = buildProgressSeriesStorageKey(scopeKey);
  const persistedValue = parsePersistedProgressSeries(readLocalStorageValue(storageKey));

  if (persistedValue.status === "miss") {
    if (persistedValue.reason !== "empty") {
      warnProgressCacheMiss("series", storageKey, scopeKey, persistedValue.reason);
    }

    return null;
  }

  if (persistedValue.value.scopeKey !== scopeKey) {
    warnProgressCacheMiss("series", storageKey, scopeKey, "scope_mismatch");
    return null;
  }

  return persistedValue.value.serverBase;
}

export function loadPersistedProgressReviewSchedule(
  scopeKey: ProgressScopeKey,
  expectedTimeZone: string,
): ProgressReviewSchedule | null {
  const storageKey = buildProgressReviewScheduleStorageKey(scopeKey);
  const persistedValue = parsePersistedProgressReviewSchedule(readLocalStorageValue(storageKey));

  if (persistedValue.status === "miss") {
    if (persistedValue.reason !== "empty") {
      warnProgressCacheMiss("review_schedule", storageKey, scopeKey, persistedValue.reason);
    }

    return null;
  }

  if (persistedValue.value.scopeKey !== scopeKey) {
    warnProgressCacheMiss("review_schedule", storageKey, scopeKey, "scope_mismatch");
    return null;
  }

  if (persistedValue.value.serverBase.timeZone !== expectedTimeZone) {
    warnProgressCacheMiss("review_schedule", storageKey, scopeKey, "time_zone_mismatch");
    return null;
  }

  return persistedValue.value.serverBase;
}

function assertProgressReviewScheduleTimeZone(
  serverBase: ProgressReviewSchedule,
  expectedTimeZone: string,
): void {
  if (serverBase.timeZone !== expectedTimeZone) {
    throw new Error(`Invalid progress review schedule cache write: timeZone must be ${JSON.stringify(expectedTimeZone)}`);
  }
}

export function storePersistedProgressSummary(scopeKey: ProgressScopeKey, serverBase: ProgressSummaryPayload): void {
  const persistedValue: PersistedProgressSummary = {
    version: 1,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(buildProgressSummaryStorageKey(scopeKey), JSON.stringify(persistedValue));
}

export function storePersistedProgressSeries(scopeKey: ProgressScopeKey, serverBase: ProgressSeries): void {
  const persistedValue: PersistedProgressSeries = {
    version: 1,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase: normalizeProgressSeries(serverBase),
  };

  writeLocalStorageValue(buildProgressSeriesStorageKey(scopeKey), JSON.stringify(persistedValue));
}

export function storePersistedProgressReviewSchedule(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressReviewSchedule,
  expectedTimeZone: string,
): void {
  assertProgressReviewScheduleTimeZone(serverBase, expectedTimeZone);

  const persistedValue: PersistedProgressReviewSchedule = {
    version: 1,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(buildProgressReviewScheduleStorageKey(scopeKey), JSON.stringify(persistedValue));
}
