import type {
  DailyReviewPoint,
  ProgressScopeKey,
  ProgressSeries,
} from "../../../types";
import { normalizeProgressSeries } from "../snapshots/progressSnapshots";
import {
  addProgressCacheMissBreadcrumb,
  isNonNegativeSafeIntegerValue,
  isRecord,
  isValidLocalDateValue,
  parseJsonRecord,
  parsePersistedProgressReviewHistoryWatermarks,
  parsePersistedStreakDays,
  readLocalStorageValue,
  writeLocalStorageValue,
  type ProgressCacheReadResult,
} from "./progressStorageRuntime";

const progressSeriesStorageKeyPrefix = "flashcards-progress-server-series";
const progressServerSeriesVersion = 3;

type PersistedProgressSeries = Readonly<{
  version: 3;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSeries;
}>;

function buildProgressSeriesStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressSeriesStorageKeyPrefix}:${scopeKey}`;
}

function normalizePersistedProgressSeries(
  serverBase: ProgressSeries,
): ProgressCacheReadResult<ProgressSeries> {
  if (
    isValidLocalDateValue(serverBase.from) === false
    || isValidLocalDateValue(serverBase.to) === false
    || serverBase.from > serverBase.to
    || serverBase.dailyReviews.some((day) => isValidLocalDateValue(day.date) === false)
    || serverBase.streakDays.some((day) => isValidLocalDateValue(day.date) === false)
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
    if (
      error instanceof Error
      && (
        error.message.startsWith("Invalid local date:")
        || error.message.startsWith("Progress series streakDays")
      )
    ) {
      return {
        status: "miss",
        reason: "invalid_shape",
      };
    }

    throw error;
  }
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
  if (parsedValue.version !== progressServerSeriesVersion) {
    return {
      status: "miss",
      reason: "version_mismatch",
    };
  }

  if (
    typeof parsedValue.scopeKey !== "string"
    || typeof parsedValue.savedAt !== "string"
    || isRecord(parsedValue.serverBase) === false
    || typeof parsedValue.serverBase.timeZone !== "string"
    || typeof parsedValue.serverBase.from !== "string"
    || typeof parsedValue.serverBase.to !== "string"
    || (parsedValue.serverBase.generatedAt !== null && typeof parsedValue.serverBase.generatedAt !== "string")
    || Array.isArray(parsedValue.serverBase.dailyReviews) === false
    || Array.isArray(parsedValue.serverBase.streakDays) === false
  ) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const dailyReviews = parsedValue.serverBase.dailyReviews
    .map((day): DailyReviewPoint | null => {
      if (isRecord(day) === false || typeof day.date !== "string") {
        return null;
      }

      const reviewCount = day.reviewCount;
      const againCount = day.againCount;
      const hardCount = day.hardCount;
      const goodCount = day.goodCount;
      const easyCount = day.easyCount;
      if (
        isNonNegativeSafeIntegerValue(reviewCount) === false
        || isNonNegativeSafeIntegerValue(againCount) === false
        || isNonNegativeSafeIntegerValue(hardCount) === false
        || isNonNegativeSafeIntegerValue(goodCount) === false
        || isNonNegativeSafeIntegerValue(easyCount) === false
      ) {
        return null;
      }

      const ratingCountSum = againCount + hardCount + goodCount + easyCount;
      if (reviewCount !== ratingCountSum) {
        return null;
      }

      return {
        date: day.date,
        reviewCount,
        againCount,
        hardCount,
        goodCount,
        easyCount,
      };
    })
    .filter((day): day is DailyReviewPoint => day !== null);

  if (dailyReviews.length !== parsedValue.serverBase.dailyReviews.length) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const streakDays = parsePersistedStreakDays(parsedValue.serverBase.streakDays);
  if (streakDays === null) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const reviewHistoryWatermarks = parsePersistedProgressReviewHistoryWatermarks(
    parsedValue.serverBase.reviewHistoryWatermarks,
  );
  if (reviewHistoryWatermarks === null) {
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
    reviewHistoryWatermarks,
    dailyReviews,
    streakDays,
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
      version: progressServerSeriesVersion,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase: normalizedServerBase.value,
    },
  };
}

export function loadPersistedProgressSeries(scopeKey: ProgressScopeKey): ProgressSeries | null {
  const storageKey = buildProgressSeriesStorageKey(scopeKey);
  const persistedValue = parsePersistedProgressSeries(readLocalStorageValue(storageKey));

  if (persistedValue.status === "miss") {
    if (persistedValue.reason !== "empty") {
      addProgressCacheMissBreadcrumb("series", scopeKey, persistedValue.reason);
    }

    return null;
  }

  if (persistedValue.value.scopeKey !== scopeKey) {
    addProgressCacheMissBreadcrumb("series", scopeKey, "scope_mismatch");
    return null;
  }

  return persistedValue.value.serverBase;
}

export function storePersistedProgressSeries(scopeKey: ProgressScopeKey, serverBase: ProgressSeries): void {
  const persistedValue: PersistedProgressSeries = {
    version: progressServerSeriesVersion,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase: normalizeProgressSeries(serverBase),
  };

  writeLocalStorageValue(buildProgressSeriesStorageKey(scopeKey), JSON.stringify(persistedValue));
}
