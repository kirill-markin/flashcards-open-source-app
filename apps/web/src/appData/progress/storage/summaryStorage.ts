import type {
  ProgressScopeKey,
  ProgressSummaryPayload,
} from "../../../types";
import {
  addProgressCacheMissBreadcrumb,
  isNonNegativeSafeIntegerValue,
  isRecord,
  parseJsonRecord,
  parsePersistedProgressReviewHistoryWatermarks,
  parsePersistedStreakFreeze,
  readLocalStorageValue,
  writeLocalStorageValue,
  type ProgressCacheReadResult,
} from "./progressStorageRuntime";

const progressSummaryStorageKeyPrefix = "flashcards-progress-server-summary";
const progressServerSummaryVersion = 4;

type PersistedProgressSummary = Readonly<{
  version: 4;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSummaryPayload;
}>;

function buildProgressSummaryStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressSummaryStorageKeyPrefix}:${scopeKey}`;
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
  if (parsedValue.version !== progressServerSummaryVersion) {
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
    || (parsedValue.serverBase.generatedAt !== null && typeof parsedValue.serverBase.generatedAt !== "string")
    || isRecord(parsedValue.serverBase.summary) === false
    || isNonNegativeSafeIntegerValue(parsedValue.serverBase.summary.currentStreakDays) === false
    || isNonNegativeSafeIntegerValue(parsedValue.serverBase.summary.longestStreakDays) === false
    || typeof parsedValue.serverBase.summary.hasReviewedToday !== "boolean"
    || (parsedValue.serverBase.summary.lastReviewedOn !== null && typeof parsedValue.serverBase.summary.lastReviewedOn !== "string")
    || isNonNegativeSafeIntegerValue(parsedValue.serverBase.summary.activeReviewDays) === false
  ) {
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

  const streakFreeze = parsePersistedStreakFreeze(parsedValue.serverBase.summary.streakFreeze);
  if (streakFreeze === null) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  if (parsedValue.serverBase.summary.longestStreakDays < parsedValue.serverBase.summary.currentStreakDays) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  return {
    status: "hit",
    value: {
      version: progressServerSummaryVersion,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase: {
        timeZone: parsedValue.serverBase.timeZone,
        generatedAt: parsedValue.serverBase.generatedAt,
        reviewHistoryWatermarks,
        summary: {
          currentStreakDays: parsedValue.serverBase.summary.currentStreakDays,
          longestStreakDays: parsedValue.serverBase.summary.longestStreakDays,
          hasReviewedToday: parsedValue.serverBase.summary.hasReviewedToday,
          lastReviewedOn: parsedValue.serverBase.summary.lastReviewedOn,
          activeReviewDays: parsedValue.serverBase.summary.activeReviewDays,
          streakFreeze,
        },
      },
    },
  };
}

export function loadPersistedProgressSummary(scopeKey: ProgressScopeKey): ProgressSummaryPayload | null {
  const storageKey = buildProgressSummaryStorageKey(scopeKey);
  const persistedValue = parsePersistedProgressSummary(readLocalStorageValue(storageKey));

  if (persistedValue.status === "miss") {
    if (persistedValue.reason !== "empty") {
      addProgressCacheMissBreadcrumb("summary", scopeKey, persistedValue.reason);
    }

    return null;
  }

  if (persistedValue.value.scopeKey !== scopeKey) {
    addProgressCacheMissBreadcrumb("summary", scopeKey, "scope_mismatch");
    return null;
  }

  return persistedValue.value.serverBase;
}

export function storePersistedProgressSummary(scopeKey: ProgressScopeKey, serverBase: ProgressSummaryPayload): void {
  const persistedValue: PersistedProgressSummary = {
    version: progressServerSummaryVersion,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(buildProgressSummaryStorageKey(scopeKey), JSON.stringify(persistedValue));
}
