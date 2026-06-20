import type {
  DailyReviewPoint,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardWindowKey,
  ProgressSeriesInput,
  ProgressSummary,
  ProgressSummaryInput,
  ReviewRating,
  ReviewEvent,
  SyncPushOperation,
} from "../../types";
import {
  progressLeaderboardWindowKeys,
  progressLeaderboardWindowLowerBoundHours,
} from "../../types";
import type { ProgressCacheStateRecord, ProgressDailyCountRecord } from "../core/database";
import {
  closeDatabaseAfter,
  getAllFromStore,
  getFromStore,
  runReadonly,
  runReadwrite,
} from "../core/database";
import { listOutboxRecordsForWorkspaces } from "../sync/outbox";
import {
  formatDateAsLocalDate,
} from "../../progress/progressDates";
import {
  createDefaultStreakFreeze,
  evaluateProgressStreakFreeze,
} from "../../progress/streakFreeze";

const progressCacheStateKey = "progress_cache_state";
const progressRecordKeyHighValue = "\uffff";

export function mapReviewedAtClientToLocalDate(reviewedAtClient: string, timeZone: string): string {
  const reviewedAt = new Date(reviewedAtClient);

  if (Number.isNaN(reviewedAt.getTime())) {
    throw new Error(`Invalid reviewedAtClient timestamp: ${reviewedAtClient}`);
  }

  return formatDateAsLocalDate(reviewedAt, timeZone);
}

function isDateWithinRange(date: string, input: ProgressSeriesInput): boolean {
  return date >= input.from && date <= input.to;
}

function isPendingReviewEventOperation(
  operation: SyncPushOperation,
): operation is Extract<SyncPushOperation, Readonly<{ entityType: "review_event" }>> {
  return operation.entityType === "review_event" && operation.action === "append";
}

function createEmptyProgressSummary(): ProgressSummary {
  return {
    currentStreakDays: 0,
    longestStreakDays: 0,
    hasReviewedToday: false,
    lastReviewedOn: null,
    activeReviewDays: 0,
    streakFreeze: createDefaultStreakFreeze(),
  };
}

function createEmptyDailyReviewPoint(date: string): DailyReviewPoint {
  return {
    date,
    reviewCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
}

export function createEmptyProgressDailyCountRecord(
  workspaceId: string,
  localDate: string,
): ProgressDailyCountRecord {
  return {
    workspaceId,
    localDate,
    reviewCount: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
}

function addReviewRatingToDailyReviewPoint(
  dailyReviewPoint: DailyReviewPoint,
  rating: ReviewRating,
): DailyReviewPoint {
  if (rating === 0) {
    return {
      ...dailyReviewPoint,
      reviewCount: dailyReviewPoint.reviewCount + 1,
      againCount: dailyReviewPoint.againCount + 1,
    };
  }

  if (rating === 1) {
    return {
      ...dailyReviewPoint,
      reviewCount: dailyReviewPoint.reviewCount + 1,
      hardCount: dailyReviewPoint.hardCount + 1,
    };
  }

  if (rating === 2) {
    return {
      ...dailyReviewPoint,
      reviewCount: dailyReviewPoint.reviewCount + 1,
      goodCount: dailyReviewPoint.goodCount + 1,
    };
  }

  if (rating === 3) {
    return {
      ...dailyReviewPoint,
      reviewCount: dailyReviewPoint.reviewCount + 1,
      easyCount: dailyReviewPoint.easyCount + 1,
    };
  }

  throw new Error(`Invalid review rating for progress aggregation: ${String(rating)}`);
}

export function addReviewRatingToProgressDailyCountRecord(
  progressDailyCount: ProgressDailyCountRecord,
  rating: ReviewRating,
): ProgressDailyCountRecord {
  const dailyReviewPoint = addReviewRatingToDailyReviewPoint({
    date: progressDailyCount.localDate,
    reviewCount: progressDailyCount.reviewCount,
    againCount: progressDailyCount.againCount,
    hardCount: progressDailyCount.hardCount,
    goodCount: progressDailyCount.goodCount,
    easyCount: progressDailyCount.easyCount,
  }, rating);

  return {
    workspaceId: progressDailyCount.workspaceId,
    localDate: progressDailyCount.localDate,
    reviewCount: dailyReviewPoint.reviewCount,
    againCount: dailyReviewPoint.againCount,
    hardCount: dailyReviewPoint.hardCount,
    goodCount: dailyReviewPoint.goodCount,
    easyCount: dailyReviewPoint.easyCount,
  };
}

function buildProgressActiveDates(
  dailyReviewCounts: ReadonlyMap<string, DailyReviewPoint>,
): ReadonlyArray<string> {
  return [...dailyReviewCounts.entries()]
    .filter(([, dailyReviewPoint]) => dailyReviewPoint.reviewCount > 0)
    .map(([date]) => date)
    .sort((leftDate, rightDate) => leftDate.localeCompare(rightDate));
}

function buildProgressSummary(
  today: string,
  dailyReviewCounts: ReadonlyMap<string, DailyReviewPoint>,
): ProgressSummary {
  const reviewDates = buildProgressActiveDates(dailyReviewCounts);

  if (reviewDates.length === 0) {
    return createEmptyProgressSummary();
  }

  const reviewDateSet = new Set(reviewDates);
  const streakFreezeEvaluation = evaluateProgressStreakFreeze(reviewDates, today);
  const hasReviewedToday = reviewDateSet.has(today);

  return {
    currentStreakDays: streakFreezeEvaluation.currentStreakDays,
    longestStreakDays: streakFreezeEvaluation.longestStreakDays,
    hasReviewedToday,
    lastReviewedOn: reviewDates.at(-1) ?? null,
    activeReviewDays: reviewDates.length,
    streakFreeze: streakFreezeEvaluation.streakFreeze,
  };
}

function buildProgressCacheState(
  timeZone: string,
  needsRebuild: boolean,
): ProgressCacheStateRecord {
  return {
    key: "progress_cache_state",
    timeZone,
    needsRebuild,
    updatedAt: new Date().toISOString(),
  };
}

function aggregateReviewEventsByWorkspaceAndLocalDate(
  reviewEvents: ReadonlyArray<ReviewEvent>,
  timeZone: string,
): ReadonlyArray<ProgressDailyCountRecord> {
  const counts = new Map<string, ProgressDailyCountRecord>();

  for (const reviewEvent of reviewEvents) {
    const localDate = mapReviewedAtClientToLocalDate(
      reviewEvent.reviewedAtClient,
      reviewEvent.reviewedTimeZone ?? timeZone,
    );
    const countKey = `${reviewEvent.workspaceId}::${localDate}`;
    const currentCount = counts.get(countKey) ?? createEmptyProgressDailyCountRecord(
      reviewEvent.workspaceId,
      localDate,
    );
    counts.set(countKey, addReviewRatingToProgressDailyCountRecord(currentCount, reviewEvent.rating));
  }

  return [...counts.entries()]
    .map(([countKey, progressDailyCount]): ProgressDailyCountRecord => {
      const separatorIndex = countKey.indexOf("::");

      if (separatorIndex === -1) {
        throw new Error(`Invalid progress aggregate key: ${countKey}`);
      }

      return progressDailyCount;
    })
    .sort((leftRecord, rightRecord) => {
      const workspaceDifference = leftRecord.workspaceId.localeCompare(rightRecord.workspaceId);
      if (workspaceDifference !== 0) {
        return workspaceDifference;
      }

      return leftRecord.localDate.localeCompare(rightRecord.localDate);
    });
}

export async function loadProgressCacheState(database: IDBDatabase): Promise<ProgressCacheStateRecord | null> {
  return (await getFromStore<ProgressCacheStateRecord>(database, "meta", progressCacheStateKey)) ?? null;
}

async function ensureLocalProgressCacheReady(
  database: IDBDatabase,
  timeZone: string,
): Promise<void> {
  const cacheState = await loadProgressCacheState(database);

  if (cacheState !== null && cacheState.timeZone === timeZone && cacheState.needsRebuild === false) {
    return;
  }

  const reviewEvents = await getAllFromStore<ReviewEvent>(database, "reviewEvents");
  const progressDailyCounts = aggregateReviewEventsByWorkspaceAndLocalDate(reviewEvents, timeZone);

  await runReadwrite(database, ["progressDailyCounts", "meta"], (transaction) => {
    const progressDailyCountsStore = transaction.objectStore("progressDailyCounts");
    progressDailyCountsStore.clear();

    for (const progressDailyCount of progressDailyCounts) {
      progressDailyCountsStore.put(progressDailyCount);
    }

    transaction.objectStore("meta").put(buildProgressCacheState(timeZone, false));
    return null;
  });
}

function buildMergedDailyReviewMap(
  progressDailyCounts: ReadonlyArray<ProgressDailyCountRecord>,
): Map<string, DailyReviewPoint> {
  const counts = new Map<string, DailyReviewPoint>();

  for (const progressDailyCount of progressDailyCounts) {
    const currentCount = counts.get(progressDailyCount.localDate) ?? createEmptyDailyReviewPoint(progressDailyCount.localDate);
    counts.set(progressDailyCount.localDate, {
      date: progressDailyCount.localDate,
      reviewCount: currentCount.reviewCount + progressDailyCount.reviewCount,
      againCount: currentCount.againCount + progressDailyCount.againCount,
      hardCount: currentCount.hardCount + progressDailyCount.hardCount,
      goodCount: currentCount.goodCount + progressDailyCount.goodCount,
      easyCount: currentCount.easyCount + progressDailyCount.easyCount,
    });
  }

  return counts;
}

async function loadWorkspaceProgressDailyCounts(
  database: IDBDatabase,
  workspaceId: string,
  range: Readonly<{ from: string; to: string }> | null,
): Promise<ReadonlyArray<ProgressDailyCountRecord>> {
  const keyRange = range === null
    ? IDBKeyRange.bound([workspaceId, ""], [workspaceId, progressRecordKeyHighValue])
    : IDBKeyRange.bound([workspaceId, range.from], [workspaceId, range.to]);

  return runReadonly(
    database,
    "progressDailyCounts",
    (store) => store.getAll(keyRange),
  ) as Promise<ReadonlyArray<ProgressDailyCountRecord>>;
}

export async function loadLocalProgressSummary(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressSummaryInput,
): Promise<ProgressSummary> {
  if (workspaceIds.length === 0) {
    return createEmptyProgressSummary();
  }

  return closeDatabaseAfter(async (database) => {
    await ensureLocalProgressCacheReady(database, input.timeZone);
    const progressDailyCounts = (
      await Promise.all(
        workspaceIds.map((workspaceId) => loadWorkspaceProgressDailyCounts(database, workspaceId, null)),
      )
    ).flat();

    return buildProgressSummary(input.today, buildMergedDailyReviewMap(progressDailyCounts));
  });
}

export async function loadLocalProgressActiveDates(
  workspaceIds: ReadonlyArray<string>,
  timeZone: string,
): Promise<ReadonlyArray<string>> {
  if (workspaceIds.length === 0) {
    return [];
  }

  return closeDatabaseAfter(async (database) => {
    await ensureLocalProgressCacheReady(database, timeZone);
    const progressDailyCounts = (
      await Promise.all(
        workspaceIds.map((workspaceId) => loadWorkspaceProgressDailyCounts(database, workspaceId, null)),
      )
    ).flat();

    return buildProgressActiveDates(buildMergedDailyReviewMap(progressDailyCounts));
  });
}

export async function loadLocalProgressDailyReviews(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressSeriesInput,
): Promise<ReadonlyArray<DailyReviewPoint>> {
  if (workspaceIds.length === 0) {
    return [];
  }

  return closeDatabaseAfter(async (database) => {
    await ensureLocalProgressCacheReady(database, input.timeZone);
    const progressDailyCounts = (
      await Promise.all(
        workspaceIds.map((workspaceId) => loadWorkspaceProgressDailyCounts(database, workspaceId, input)),
      )
    ).flat();
    const mergedDailyReviewMap = buildMergedDailyReviewMap(progressDailyCounts);

    return [...mergedDailyReviewMap.entries()]
      .filter(([date]) => isDateWithinRange(date, input))
      .map(([, dailyReviewPoint]): DailyReviewPoint => dailyReviewPoint)
      .sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
  });
}

export async function loadPendingProgressDailyReviews(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressSeriesInput,
): Promise<ReadonlyArray<DailyReviewPoint>> {
  if (workspaceIds.length === 0) {
    return [];
  }

  const outboxRecords = await listOutboxRecordsForWorkspaces(workspaceIds);
  const counts = new Map<string, DailyReviewPoint>();

  for (const outboxRecord of outboxRecords) {
    if (isPendingReviewEventOperation(outboxRecord.operation) === false) {
      continue;
    }

    const payload = outboxRecord.operation.payload;
    const localDate = mapReviewedAtClientToLocalDate(
      payload.reviewedAtClient,
      payload.reviewedTimeZone ?? input.timeZone,
    );
    if (isDateWithinRange(localDate, input) === false) {
      continue;
    }

    const currentCount = counts.get(localDate) ?? createEmptyDailyReviewPoint(localDate);
    counts.set(localDate, addReviewRatingToDailyReviewPoint(currentCount, payload.rating));
  }

  return [...counts.entries()]
    .map(([, dailyReviewPoint]): DailyReviewPoint => dailyReviewPoint)
    .sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
}

const millisecondsPerHour = 3_600_000;

function parseReviewedAtClientTimestamp(reviewedAtClient: string): number {
  const reviewedAtTimestamp = new Date(reviewedAtClient).getTime();

  if (Number.isNaN(reviewedAtTimestamp)) {
    throw new Error(`Invalid reviewedAtClient timestamp: ${reviewedAtClient}`);
  }

  return reviewedAtTimestamp;
}

function createEmptyLeaderboardViewerCounts(): Record<ProgressLeaderboardWindowKey, number> {
  return {
    last_24_hours: 0,
    last_3_days: 0,
    last_7_days: 0,
    last_30_days: 0,
    all_time: 0,
  };
}

function addQualifiedReviewToViewerCounts(
  viewerCounts: Record<ProgressLeaderboardWindowKey, number>,
  reviewedAtClient: string,
  nowTimestamp: number,
): void {
  const reviewedAtTimestamp = parseReviewedAtClientTimestamp(reviewedAtClient);

  if (reviewedAtTimestamp > nowTimestamp) {
    return;
  }

  for (const windowKey of progressLeaderboardWindowKeys) {
    const lowerBoundHours = progressLeaderboardWindowLowerBoundHours[windowKey];

    if (lowerBoundHours === null || reviewedAtTimestamp > nowTimestamp - lowerBoundHours * millisecondsPerHour) {
      viewerCounts[windowKey] += 1;
    }
  }
}

async function loadWorkspaceReviewEvents(
  database: IDBDatabase,
  workspaceId: string,
): Promise<ReadonlyArray<ReviewEvent>> {
  const keyRange = IDBKeyRange.bound([workspaceId, ""], [workspaceId, progressRecordKeyHighValue]);

  return runReadonly(
    database,
    "reviewEvents",
    (store) => store.getAll(keyRange),
  ) as Promise<ReadonlyArray<ReviewEvent>>;
}

/**
 * Counts the viewer's local qualified reviews (rating !== 0, Again excluded) per
 * leaderboard window using rolling `(now - lowerBoundHours, now]` bounds on
 * `reviewedAtClient`, mirroring apps/backend/src/community/leaderboard/leaderboardWindows.ts.
 * Pending outbox review events are deduplicated against the local review event
 * store by `(workspaceId, reviewEventId)` because review submission writes both.
 */
export async function loadLocalLeaderboardViewerCounts(
  workspaceIds: ReadonlyArray<string>,
  now: Date,
): Promise<ProgressLeaderboardLocalViewerCounts> {
  const viewerCounts = createEmptyLeaderboardViewerCounts();

  if (workspaceIds.length === 0) {
    return viewerCounts;
  }

  const nowTimestamp = now.getTime();
  const storedQualifiedEventKeys = new Set<string>();

  await closeDatabaseAfter(async (database) => {
    const reviewEvents = (
      await Promise.all(
        workspaceIds.map((workspaceId) => loadWorkspaceReviewEvents(database, workspaceId)),
      )
    ).flat();

    for (const reviewEvent of reviewEvents) {
      if (reviewEvent.rating === 0) {
        continue;
      }

      storedQualifiedEventKeys.add(`${reviewEvent.workspaceId}::${reviewEvent.reviewEventId}`);
      addQualifiedReviewToViewerCounts(viewerCounts, reviewEvent.reviewedAtClient, nowTimestamp);
    }

    return null;
  });

  const outboxRecords = await listOutboxRecordsForWorkspaces(workspaceIds);

  for (const outboxRecord of outboxRecords) {
    if (isPendingReviewEventOperation(outboxRecord.operation) === false) {
      continue;
    }

    const pendingPayload = outboxRecord.operation.payload;
    if (pendingPayload.rating === 0) {
      continue;
    }

    if (storedQualifiedEventKeys.has(`${outboxRecord.workspaceId}::${pendingPayload.reviewEventId}`)) {
      continue;
    }

    addQualifiedReviewToViewerCounts(viewerCounts, pendingPayload.reviewedAtClient, nowTimestamp);
  }

  return viewerCounts;
}

export async function hasPendingProgressReviewEvents(
  workspaceIds: ReadonlyArray<string>,
): Promise<boolean> {
  if (workspaceIds.length === 0) {
    return false;
  }

  const outboxRecords = await listOutboxRecordsForWorkspaces(workspaceIds);
  return outboxRecords.some((outboxRecord) => isPendingReviewEventOperation(outboxRecord.operation));
}

export function markProgressCacheDirtyInTransaction(
  transaction: IDBTransaction,
  progressCacheTimeZone: string | null,
): void {
  if (progressCacheTimeZone === null) {
    return;
  }

  transaction.objectStore("meta").put(buildProgressCacheState(progressCacheTimeZone, true));
}
