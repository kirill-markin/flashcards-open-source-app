import type {
  ProgressLeaderboard,
  ProgressLeaderboardMetric,
  ProgressLeaderboardRankingRow,
  ProgressLeaderboardRow,
  ProgressLeaderboardStatus,
  ProgressLeaderboardViewer,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
  ProgressScopeKey,
} from "../../../types";
import {
  progressLeaderboardParticipantRowKinds,
  progressLeaderboardRankingRowKinds,
  progressLeaderboardStatuses,
  progressLeaderboardWindowKeys,
} from "../../../types";
import {
  addProgressCacheMissBreadcrumb,
  isNonNegativeSafeIntegerValue,
  isRecord,
  parseJsonRecord,
  readLocalStorageValue,
  removeLocalStorageValue,
  writeLocalStorageValue,
  type ProgressCacheReadResult,
} from "./progressStorageRuntime";

// Single fixed key: the leaderboard payload is account-scoped, so one cache slot
// is enough and lets settings clear it without knowing the active scope key.
const progressLeaderboardStorageKey = "flashcards-progress-server-leaderboard";
const progressServerLeaderboardVersion = 2;

type PersistedProgressLeaderboard = Readonly<{
  version: 2;
  scopeKey: ProgressScopeKey;
  savedAt: string;
  serverBase: ProgressLeaderboard;
}>;

function isProgressLeaderboardStatusValue(value: unknown): value is ProgressLeaderboardStatus {
  return typeof value === "string" && progressLeaderboardStatuses.includes(value as ProgressLeaderboardStatus);
}

function isProgressLeaderboardWindowKeyValue(value: unknown): value is ProgressLeaderboardWindowKey {
  return typeof value === "string" && progressLeaderboardWindowKeys.includes(value as ProgressLeaderboardWindowKey);
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

  if (value.friendDisplayName !== undefined && typeof value.friendDisplayName !== "string") {
    return null;
  }

  return {
    kind: value.kind as typeof progressLeaderboardParticipantRowKinds[number],
    publicProfileId: value.publicProfileId,
    anonymousDisplayName: value.anonymousDisplayName,
    friendDisplayName: value.friendDisplayName,
    qualifiedReviewCount: value.qualifiedReviewCount,
    rank: value.rank,
  };
}

function parsePersistedProgressLeaderboardRankingRow(value: unknown): ProgressLeaderboardRankingRow | null {
  if (
    isRecord(value) === false
    || progressLeaderboardRankingRowKinds.includes(value.kind as typeof progressLeaderboardRankingRowKinds[number]) === false
    || typeof value.publicProfileId !== "string"
    || typeof value.anonymousDisplayName !== "string"
    || (value.friendDisplayName !== undefined && typeof value.friendDisplayName !== "string")
    || isNonNegativeSafeIntegerValue(value.qualifiedReviewCount) === false
    || isNonNegativeSafeIntegerValue(value.rank) === false
    || value.rank < 1
  ) {
    return null;
  }

  return {
    kind: value.kind as typeof progressLeaderboardRankingRowKinds[number],
    publicProfileId: value.publicProfileId,
    anonymousDisplayName: value.anonymousDisplayName,
    friendDisplayName: value.friendDisplayName,
    qualifiedReviewCount: value.qualifiedReviewCount,
    rank: value.rank,
  };
}

function isValidPersistedProgressLeaderboardRankingRows(
  participantCount: number,
  viewer: ProgressLeaderboardViewer,
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>,
): boolean {
  if (rankingRows.length !== participantCount) {
    return false;
  }

  let viewerRowCount = 0;
  let previousQualifiedReviewCount: number | null = null;

  for (let index = 0; index < rankingRows.length; index += 1) {
    const row = rankingRows[index];
    if (row === undefined) {
      return false;
    }

    if (row.rank !== index + 1) {
      return false;
    }

    if (previousQualifiedReviewCount !== null && row.qualifiedReviewCount > previousQualifiedReviewCount) {
      return false;
    }

    previousQualifiedReviewCount = row.qualifiedReviewCount;

    if (row.kind === "viewer") {
      viewerRowCount += 1;

      if (
        row.publicProfileId !== viewer.publicProfileId
        || row.rank !== viewer.rank
        || row.qualifiedReviewCount !== viewer.qualifiedReviewCount
      ) {
        return false;
      }
    } else if (row.publicProfileId === viewer.publicProfileId) {
      return false;
    }
  }

  return viewerRowCount === 1;
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
    || Array.isArray(value.rankingRows) === false
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

  const rankingRows = value.rankingRows
    .map(parsePersistedProgressLeaderboardRankingRow)
    .filter((row): row is ProgressLeaderboardRankingRow => row !== null);

  if (rankingRows.length !== value.rankingRows.length) {
    return null;
  }

  if (isValidPersistedProgressLeaderboardRankingRows(value.participantCount, viewer, rankingRows) === false) {
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
    rankingRows,
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
      version: 2,
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
    version: 2,
    scopeKey,
    savedAt: new Date().toISOString(),
    serverBase,
  };

  writeLocalStorageValue(progressLeaderboardStorageKey, JSON.stringify(persistedValue));
}

export function clearPersistedProgressLeaderboard(): void {
  removeLocalStorageValue(progressLeaderboardStorageKey);
}
