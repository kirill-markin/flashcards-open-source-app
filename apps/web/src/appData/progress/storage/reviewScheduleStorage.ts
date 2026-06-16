import type {
  ProgressReviewSchedule,
  ProgressReviewScheduleBucket,
  ProgressScopeKey,
} from "../../../types";
import { progressReviewScheduleBucketKeys } from "../../../types";
import { findProgressReviewScheduleValidationIssue } from "../../../progress/progressReviewScheduleValidation";
import {
  addProgressCacheMissBreadcrumb,
  isRecord,
  parseJsonRecord,
  parsePersistedProgressReviewHistoryWatermarks,
  readLocalStorageValue,
  writeLocalStorageValue,
  type ProgressCacheReadResult,
} from "./progressStorageRuntime";

const progressReviewScheduleStorageKeyPrefix = "flashcards-progress-server-review-schedule";
const progressServerReviewScheduleVersion = 2;

type PersistedProgressReviewSchedule = Readonly<{
  version: 2;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressReviewSchedule;
}>;

function buildProgressReviewScheduleStorageKey(scopeKey: ProgressScopeKey): string {
  return `${progressReviewScheduleStorageKeyPrefix}:${scopeKey}`;
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

  const reviewHistoryWatermarks = parsePersistedProgressReviewHistoryWatermarks(
    parsedValue.serverBase.reviewHistoryWatermarks,
  );
  if (reviewHistoryWatermarks === null) {
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
    reviewHistoryWatermarks,
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
      version: 2,
      scopeKey: parsedValue.scopeKey,
      savedAt: parsedValue.savedAt,
      serverBase,
    },
  };
}

export function loadPersistedProgressReviewSchedule(
  scopeKey: ProgressScopeKey,
  expectedTimeZone: string,
): ProgressReviewSchedule | null {
  const storageKey = buildProgressReviewScheduleStorageKey(scopeKey);
  const persistedValue = parsePersistedProgressReviewSchedule(readLocalStorageValue(storageKey));

  if (persistedValue.status === "miss") {
    if (persistedValue.reason !== "empty") {
      addProgressCacheMissBreadcrumb("review_schedule", scopeKey, persistedValue.reason);
    }

    return null;
  }

  if (persistedValue.value.scopeKey !== scopeKey) {
    addProgressCacheMissBreadcrumb("review_schedule", scopeKey, "scope_mismatch");
    return null;
  }

  if (persistedValue.value.serverBase.timeZone !== expectedTimeZone) {
    addProgressCacheMissBreadcrumb("review_schedule", scopeKey, "time_zone_mismatch");
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

export function storePersistedProgressReviewSchedule(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressReviewSchedule,
  expectedTimeZone: string,
): void {
  assertProgressReviewScheduleTimeZone(serverBase, expectedTimeZone);

  const persistedValue: PersistedProgressReviewSchedule = {
    version: 2,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(buildProgressReviewScheduleStorageKey(scopeKey), JSON.stringify(persistedValue));
}
