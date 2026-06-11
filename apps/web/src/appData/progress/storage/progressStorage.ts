import type {
  DailyReviewPoint,
  ProgressLeaderboard,
  ProgressLeaderboardMetric,
  ProgressLeaderboardRow,
  ProgressLeaderboardStatus,
  ProgressLeaderboardViewer,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
  ProgressReviewHistoryWatermark,
  ProgressReviewSchedule,
  ProgressReviewScheduleBucket,
  ProgressScopeKey,
  ProgressSeries,
  ProgressSummaryPayload,
} from "../../../types";
import { INSTALLATION_ID_STORAGE_KEY } from "../../../clientIdentity";
import { addWebBreadcrumb, type WebObservationScope } from "../../../observability/webObservability";
import {
  progressLeaderboardParticipantRowKinds,
  progressLeaderboardStatuses,
  progressLeaderboardWindowKeys,
  progressReviewScheduleBucketKeys,
} from "../../../types";
import { findProgressReviewScheduleValidationIssue } from "../../../progress/progressReviewScheduleValidation";
import { normalizeProgressSeries } from "../snapshots/progressSnapshots";

const progressSummaryStorageKeyPrefix = "flashcards-progress-server-summary";
const progressSeriesStorageKeyPrefix = "flashcards-progress-server-series";
const progressReviewScheduleStorageKeyPrefix = "flashcards-progress-server-review-schedule";
// Single fixed key: the leaderboard payload is account-scoped, so one cache slot
// is enough and lets settings clear it without knowing the active scope key.
const progressLeaderboardStorageKey = "flashcards-progress-server-leaderboard";
const progressServerSummaryVersion = 2;
const progressServerSeriesVersion = 2;
const progressServerReviewScheduleVersion = 2;
const progressServerLeaderboardVersion = 1;

type PersistedProgressSummary = Readonly<{
  version: 2;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSummaryPayload;
}>;

type PersistedProgressSeries = Readonly<{
  version: 2;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressSeries;
}>;

type PersistedProgressReviewSchedule = Readonly<{
  version: 2;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressReviewSchedule;
}>;

type PersistedProgressLeaderboard = Readonly<{
  version: 1;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressLeaderboard;
}>;

type LocalStorageLike = Storage & Record<string, string | undefined> & Readonly<{
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}>;

type ProgressCacheSection = "summary" | "series" | "review_schedule" | "leaderboard";
type ProgressCacheMissReason = "empty" | "invalid_json" | "invalid_shape" | "scope_mismatch" | "time_zone_mismatch";

type ProgressCacheReadResult<TValue> =
  | Readonly<{ status: "hit"; value: TValue }>
  | Readonly<{ status: "miss"; reason: ProgressCacheMissReason }>;

const fallbackLocalStorageState = new Map<string, string>();
const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function isValidProgressReviewHistoryWatermark(value: unknown): value is ProgressReviewHistoryWatermark {
  return isRecord(value)
    && typeof value.workspaceId === "string"
    && typeof value.reviewSequenceId === "number"
    && Number.isSafeInteger(value.reviewSequenceId)
    && value.reviewSequenceId >= 0;
}

function parsePersistedProgressReviewHistoryWatermarks(
  value: unknown,
): ReadonlyArray<ProgressReviewHistoryWatermark> | null {
  if (Array.isArray(value) === false) {
    return null;
  }

  const watermarks = value
    .map((watermark): ProgressReviewHistoryWatermark | null => {
      if (isValidProgressReviewHistoryWatermark(watermark) === false) {
        return null;
      }

      return {
        workspaceId: watermark.workspaceId,
        reviewSequenceId: watermark.reviewSequenceId,
      };
    })
    .filter((watermark): watermark is ProgressReviewHistoryWatermark => watermark !== null);

  if (watermarks.length !== value.length) {
    return null;
  }

  return watermarks;
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

function removeLocalStorageValue(key: string): void {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.removeItem === "function") {
    storage.removeItem(key);
    return;
  }

  fallbackLocalStorageState.delete(key);
}

function getCurrentRoute(): string | null {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function loadExistingInstallationId(): string | null {
  const installationId = readLocalStorageValue(INSTALLATION_ID_STORAGE_KEY);
  if (installationId === null || installationId.trim() === "") {
    return null;
  }

  return installationId;
}

function extractWorkspaceIdsFromProgressScopeKey(scopeKey: ProgressScopeKey): ReadonlyArray<string> {
  const workspaceScopePart = scopeKey.split("::")[0] ?? "";
  if (workspaceScopePart === "") {
    return [];
  }

  return workspaceScopePart
    .split(",")
    .filter((workspaceId) => workspaceId !== "");
}

function buildProgressCacheMissScope(scopeKey: ProgressScopeKey): WebObservationScope {
  const workspaceIds = extractWorkspaceIdsFromProgressScopeKey(scopeKey);
  return {
    app: "web",
    feature: "progress",
    userId: null,
    workspaceId: workspaceIds.length === 1 ? workspaceIds[0] ?? null : null,
    installationId: loadExistingInstallationId(),
    route: getCurrentRoute(),
    requestId: null,
    statusCode: null,
    code: null,
  };
}

function addProgressCacheMissBreadcrumb(
  section: ProgressCacheSection,
  scopeKey: ProgressScopeKey,
  reason: Exclude<ProgressCacheMissReason, "empty">,
): void {
  addWebBreadcrumb({
    action: "progress_cache_miss",
    scope: buildProgressCacheMissScope(scopeKey),
    details: {
      eventName: "progress_cache_miss",
      section,
      reason,
      workspaceIds: extractWorkspaceIdsFromProgressScopeKey(scopeKey),
    },
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

  const reviewHistoryWatermarks = parsePersistedProgressReviewHistoryWatermarks(
    parsedValue.serverBase.reviewHistoryWatermarks,
  );
  if (reviewHistoryWatermarks === null) {
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
      serverBase: {
        timeZone: parsedValue.serverBase.timeZone,
        generatedAt: parsedValue.serverBase.generatedAt,
        reviewHistoryWatermarks,
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
      version: 2,
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

function isProgressLeaderboardStatusValue(value: unknown): value is ProgressLeaderboardStatus {
  return typeof value === "string" && progressLeaderboardStatuses.includes(value as ProgressLeaderboardStatus);
}

function isProgressLeaderboardWindowKeyValue(value: unknown): value is ProgressLeaderboardWindowKey {
  return typeof value === "string" && progressLeaderboardWindowKeys.includes(value as ProgressLeaderboardWindowKey);
}

function isNonNegativeSafeIntegerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parsePersistedProgressLeaderboardMetric(value: unknown): ProgressLeaderboardMetric | null {
  if (
    isRecord(value) === false
    || value.metricVersion !== "qualified_reviews_v1"
    || typeof value.title !== "string"
    || typeof value.description !== "string"
  ) {
    return null;
  }

  return {
    metricVersion: "qualified_reviews_v1",
    title: value.title,
    description: value.description,
  };
}

function parsePersistedProgressLeaderboardViewer(value: unknown): ProgressLeaderboardViewer | null {
  if (
    isRecord(value) === false
    || typeof value.publicProfileId !== "string"
    || typeof value.displayName !== "string"
    || isNonNegativeSafeIntegerValue(value.rank) === false
    || value.rank < 1
    || isNonNegativeSafeIntegerValue(value.qualifiedReviewCount) === false
  ) {
    return null;
  }

  return {
    publicProfileId: value.publicProfileId,
    displayName: value.displayName,
    rank: value.rank,
    qualifiedReviewCount: value.qualifiedReviewCount,
  };
}

function parsePersistedProgressLeaderboardRow(value: unknown): ProgressLeaderboardRow | null {
  if (isRecord(value) === false) {
    return null;
  }

  if (value.kind === "gap") {
    return { kind: "gap" };
  }

  if (
    progressLeaderboardParticipantRowKinds.includes(value.kind as typeof progressLeaderboardParticipantRowKinds[number]) === false
    || typeof value.publicProfileId !== "string"
    || typeof value.anonymousDisplayName !== "string"
    || isNonNegativeSafeIntegerValue(value.qualifiedReviewCount) === false
    || isNonNegativeSafeIntegerValue(value.rank) === false
    || value.rank < 1
  ) {
    return null;
  }

  return {
    kind: value.kind as typeof progressLeaderboardParticipantRowKinds[number],
    publicProfileId: value.publicProfileId,
    anonymousDisplayName: value.anonymousDisplayName,
    qualifiedReviewCount: value.qualifiedReviewCount,
    rank: value.rank,
  };
}

function parsePersistedProgressLeaderboardWindow(value: unknown): ProgressLeaderboardWindow | null {
  if (
    isRecord(value) === false
    || isProgressLeaderboardWindowKeyValue(value.windowKey) === false
    || typeof value.snapshotId !== "string"
    || typeof value.snapshotGeneratedAt !== "string"
    || typeof value.asOfServerHour !== "string"
    || typeof value.nextRefreshAfter !== "string"
    || isNonNegativeSafeIntegerValue(value.participantCount) === false
    || Array.isArray(value.rows) === false
  ) {
    return null;
  }

  const viewer = parsePersistedProgressLeaderboardViewer(value.viewer);
  if (viewer === null) {
    return null;
  }

  const rows = value.rows
    .map(parsePersistedProgressLeaderboardRow)
    .filter((row): row is ProgressLeaderboardRow => row !== null);

  if (rows.length !== value.rows.length) {
    return null;
  }

  return {
    windowKey: value.windowKey,
    snapshotId: value.snapshotId,
    snapshotGeneratedAt: value.snapshotGeneratedAt,
    asOfServerHour: value.asOfServerHour,
    nextRefreshAfter: value.nextRefreshAfter,
    participantCount: value.participantCount,
    viewer,
    rows,
  };
}

function parsePersistedProgressLeaderboard(
  rawValue: string | null,
): ProgressCacheReadResult<PersistedProgressLeaderboard> {
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
    parsedValue.version !== progressServerLeaderboardVersion
    || typeof parsedValue.scopeKey !== "string"
    || typeof parsedValue.savedAt !== "string"
    || isRecord(parsedValue.serverBase) === false
    || isProgressLeaderboardStatusValue(parsedValue.serverBase.status) === false
    || isProgressLeaderboardWindowKeyValue(parsedValue.serverBase.defaultWindowKey) === false
    || Array.isArray(parsedValue.serverBase.windows) === false
  ) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const metric = parsePersistedProgressLeaderboardMetric(parsedValue.serverBase.metric);
  if (metric === null) {
    return {
      status: "miss",
      reason: "invalid_shape",
    };
  }

  const windows = parsedValue.serverBase.windows
    .map(parsePersistedProgressLeaderboardWindow)
    .filter((window): window is ProgressLeaderboardWindow => window !== null);

  if (windows.length !== parsedValue.serverBase.windows.length) {
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
        status: parsedValue.serverBase.status,
        metric,
        defaultWindowKey: parsedValue.serverBase.defaultWindowKey,
        windows,
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

export function storePersistedProgressSummary(scopeKey: ProgressScopeKey, serverBase: ProgressSummaryPayload): void {
  const persistedValue: PersistedProgressSummary = {
    version: 2,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(buildProgressSummaryStorageKey(scopeKey), JSON.stringify(persistedValue));
}

export function storePersistedProgressSeries(scopeKey: ProgressScopeKey, serverBase: ProgressSeries): void {
  const persistedValue: PersistedProgressSeries = {
    version: 2,
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
    version: 2,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(buildProgressReviewScheduleStorageKey(scopeKey), JSON.stringify(persistedValue));
}

export function loadPersistedProgressLeaderboard(scopeKey: ProgressScopeKey): ProgressLeaderboard | null {
  const persistedValue = parsePersistedProgressLeaderboard(readLocalStorageValue(progressLeaderboardStorageKey));

  if (persistedValue.status === "miss") {
    if (persistedValue.reason !== "empty") {
      addProgressCacheMissBreadcrumb("leaderboard", scopeKey, persistedValue.reason);
    }

    return null;
  }

  if (persistedValue.value.scopeKey !== scopeKey) {
    addProgressCacheMissBreadcrumb("leaderboard", scopeKey, "scope_mismatch");
    return null;
  }

  return persistedValue.value.serverBase;
}

export function storePersistedProgressLeaderboard(scopeKey: ProgressScopeKey, serverBase: ProgressLeaderboard): void {
  const persistedValue: PersistedProgressLeaderboard = {
    version: 1,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(progressLeaderboardStorageKey, JSON.stringify(persistedValue));
}

export function clearPersistedProgressLeaderboard(): void {
  removeLocalStorageValue(progressLeaderboardStorageKey);
}
