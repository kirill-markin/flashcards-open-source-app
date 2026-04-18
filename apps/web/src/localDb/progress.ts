import type {
  DailyReviewPoint,
  ProgressSeriesInput,
  ProgressSummary,
  ProgressSummaryInput,
  ReviewEvent,
  SyncPushOperation,
} from "../types";
import type { ProgressCacheStateRecord, ProgressDailyCountRecord } from "./core";
import {
  closeDatabaseAfter,
  getAllFromStore,
  getFromStore,
  runReadonly,
  runReadwrite,
} from "./core";
import { listOutboxRecordsForWorkspaces } from "./outbox";

const progressCacheStateKey = "progress_cache_state";
const progressRecordKeyHighValue = "\uffff";

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

function formatDateAsLocalDate(date: Date, timeZone: string): string {
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

function parseLocalDate(value: string): Date {
  const [rawYear, rawMonth, rawDay] = value.split("-");
  const year = Number.parseInt(rawYear ?? "", 10);
  const month = Number.parseInt(rawMonth ?? "", 10);
  const day = Number.parseInt(rawDay ?? "", 10);

  if (Number.isInteger(year) === false || Number.isInteger(month) === false || Number.isInteger(day) === false) {
    throw new Error(`Invalid local date: ${value}`);
  }

  return new Date(Date.UTC(year, month - 1, day));
}

function shiftLocalDate(value: string, offsetDays: number): string {
  const nextDate = parseLocalDate(value);
  nextDate.setUTCDate(nextDate.getUTCDate() + offsetDays);
  return nextDate.toISOString().slice(0, 10);
}

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
    hasReviewedToday: false,
    lastReviewedOn: null,
    activeReviewDays: 0,
  };
}

function buildProgressSummary(
  today: string,
  dailyReviewCounts: ReadonlyMap<string, number>,
): ProgressSummary {
  const reviewDates = [...dailyReviewCounts.entries()]
    .filter(([, reviewCount]) => reviewCount > 0)
    .map(([date]) => date)
    .sort((leftDate, rightDate) => leftDate.localeCompare(rightDate));

  if (reviewDates.length === 0) {
    return createEmptyProgressSummary();
  }

  const reviewDateSet = new Set(reviewDates);
  const hasReviewedToday = reviewDateSet.has(today);
  let currentDate = hasReviewedToday ? today : shiftLocalDate(today, -1);
  let currentStreakDays = 0;

  while (reviewDateSet.has(currentDate)) {
    currentStreakDays += 1;
    currentDate = shiftLocalDate(currentDate, -1);
  }

  return {
    currentStreakDays,
    hasReviewedToday,
    lastReviewedOn: reviewDates.at(-1) ?? null,
    activeReviewDays: reviewDates.length,
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
  const counts = new Map<string, number>();

  for (const reviewEvent of reviewEvents) {
    const localDate = mapReviewedAtClientToLocalDate(reviewEvent.reviewedAtClient, timeZone);
    const countKey = `${reviewEvent.workspaceId}::${localDate}`;
    counts.set(countKey, (counts.get(countKey) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([countKey, reviewCount]): ProgressDailyCountRecord => {
      const separatorIndex = countKey.indexOf("::");

      if (separatorIndex === -1) {
        throw new Error(`Invalid progress aggregate key: ${countKey}`);
      }

      return {
        workspaceId: countKey.slice(0, separatorIndex),
        localDate: countKey.slice(separatorIndex + 2),
        reviewCount,
      };
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
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const progressDailyCount of progressDailyCounts) {
    counts.set(
      progressDailyCount.localDate,
      (counts.get(progressDailyCount.localDate) ?? 0) + progressDailyCount.reviewCount,
    );
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
      .map(([date, reviewCount]): DailyReviewPoint => ({
        date,
        reviewCount,
      }))
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
  const counts = new Map<string, number>();

  for (const outboxRecord of outboxRecords) {
    if (isPendingReviewEventOperation(outboxRecord.operation) === false) {
      continue;
    }

    const localDate = mapReviewedAtClientToLocalDate(outboxRecord.operation.payload.reviewedAtClient, input.timeZone);
    if (isDateWithinRange(localDate, input) === false) {
      continue;
    }

    counts.set(localDate, (counts.get(localDate) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([date, reviewCount]): DailyReviewPoint => ({
      date,
      reviewCount,
    }))
    .sort((leftDay, rightDay) => leftDay.date.localeCompare(rightDay.date));
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
