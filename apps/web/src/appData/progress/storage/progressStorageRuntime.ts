import type {
  ProgressReviewHistoryWatermark,
  ProgressScopeKey,
  StreakDay,
  StreakFreeze,
} from "../../../types";
import { INSTALLATION_ID_STORAGE_KEY } from "../../../clientIdentity";
import { addWebBreadcrumb, type WebObservationScope } from "../../../observability/webObservability";
import { streakDayStates } from "../../../types";
import { isCoherentStreakFreeze } from "../../../progress/streakFreeze";

type LocalStorageLike = Storage & Record<string, string | undefined> & Readonly<{
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}>;

export type ProgressCacheSection = "summary" | "series" | "review_schedule" | "leaderboard";
export type ProgressCacheMissReason = "empty" | "invalid_json" | "invalid_shape" | "scope_mismatch" | "time_zone_mismatch" | "version_mismatch";

export type ProgressCacheReadResult<TValue> =
  | Readonly<{ status: "hit"; value: TValue }>
  | Readonly<{ status: "miss"; reason: ProgressCacheMissReason }>;

const fallbackLocalStorageState = new Map<string, string>();
const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

export function isNonNegativeSafeIntegerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isValidProgressReviewHistoryWatermark(value: unknown): value is ProgressReviewHistoryWatermark {
  return isRecord(value)
    && typeof value.workspaceId === "string"
    && typeof value.reviewSequenceId === "number"
    && Number.isSafeInteger(value.reviewSequenceId)
    && value.reviewSequenceId >= 0;
}

export function parsePersistedProgressReviewHistoryWatermarks(
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

export function isValidLocalDateValue(value: string): boolean {
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

export function readLocalStorageValue(key: string): string | null {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.getItem === "function") {
    return storage.getItem(key);
  }

  return fallbackLocalStorageState.get(key) ?? null;
}

export function writeLocalStorageValue(key: string, value: string): void {
  const storage = window.localStorage as LocalStorageLike;
  if (typeof storage.setItem === "function") {
    storage.setItem(key, value);
    return;
  }

  fallbackLocalStorageState.set(key, value);
}

export function removeLocalStorageValue(key: string): void {
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

export function addProgressCacheMissBreadcrumb(
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

export function parseJsonRecord(rawValue: string): ProgressCacheReadResult<Record<string, unknown>> {
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

export function parsePersistedStreakFreeze(value: unknown): StreakFreeze | null {
  if (
    isRecord(value) === false
    || isNonNegativeSafeIntegerValue(value.availableCredits) === false
    || isNonNegativeSafeIntegerValue(value.capacity) === false
    || isNonNegativeSafeIntegerValue(value.balanceUnits) === false
    || isNonNegativeSafeIntegerValue(value.unitsPerCredit) === false
    || isNonNegativeSafeIntegerValue(value.earnedUnitsPerStreakDay) === false
    || isNonNegativeSafeIntegerValue(value.nextCreditProgressUnits) === false
    || isNonNegativeSafeIntegerValue(value.nextCreditRequiredUnits) === false
  ) {
    return null;
  }

  const streakFreeze: StreakFreeze = {
    availableCredits: value.availableCredits,
    capacity: value.capacity,
    balanceUnits: value.balanceUnits,
    unitsPerCredit: value.unitsPerCredit,
    earnedUnitsPerStreakDay: value.earnedUnitsPerStreakDay,
    nextCreditProgressUnits: value.nextCreditProgressUnits,
    nextCreditRequiredUnits: value.nextCreditRequiredUnits,
  };

  if (isCoherentStreakFreeze(streakFreeze) === false) {
    return null;
  }

  return streakFreeze;
}

function isStreakDayStateValue(value: unknown): value is StreakDay["state"] {
  return typeof value === "string" && streakDayStates.includes(value as StreakDay["state"]);
}

export function parsePersistedStreakDays(value: unknown): ReadonlyArray<StreakDay> | null {
  if (Array.isArray(value) === false) {
    return null;
  }

  const streakDays = value
    .map((day): StreakDay | null => {
      if (
        isRecord(day) === false
        || typeof day.date !== "string"
        || isStreakDayStateValue(day.state) === false
      ) {
        return null;
      }

      return {
        date: day.date,
        state: day.state,
      };
    })
    .filter((day): day is StreakDay => day !== null);

  if (streakDays.length !== value.length) {
    return null;
  }

  return streakDays;
}
