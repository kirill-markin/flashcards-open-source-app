import {
  malformedDueAtBucketMillis,
  nullDueAtBucketMillis,
} from "../appData/dueAt";
import {
  progressReviewScheduleBucketKeys,
  type ProgressReviewSchedule,
  type ProgressReviewScheduleBucket,
  type ProgressReviewScheduleBucketKey,
  type ProgressReviewScheduleInput,
} from "../types";
import { shiftLocalDate } from "../progress/progressDates";
import {
  closeDatabaseAfter,
  describeIndexedDbError,
  type StoredCard,
} from "./core";
import { listOutboxRecordsForWorkspaces, type PersistedOutboxRecord } from "./outbox";
import { hasHydratedHotState } from "./workspace";

type LocalDateParts = Readonly<{
  year: number;
  month: number;
  day: number;
}>;

type ZonedDateTimeParts = LocalDateParts & Readonly<{
  hour: number;
  minute: number;
  second: number;
}>;

type ReviewScheduleBucketRange = Readonly<{
  key: ProgressReviewScheduleBucketKey;
  keyRange: IDBKeyRange;
  acceptsDueAtBucketMillis: (dueAtBucketMillis: number) => boolean;
}>;

type ReviewScheduleBoundaryMillis = Readonly<{
  startOfTomorrowMillis: number;
  startOfDay8Millis: number;
  startOfDay31Millis: number;
  startOfDay91Millis: number;
  startOfDay361Millis: number;
  startOfDay721Millis: number;
}>;

type PendingReviewScheduleCardOperation = Extract<
  PersistedOutboxRecord["operation"],
  Readonly<{ entityType: "card"; action: "upsert" }>
>;

type PendingReviewScheduleCardOutboxRecord = PersistedOutboxRecord & Readonly<{
  operation: PendingReviewScheduleCardOperation;
}>;

type PendingReviewScheduleCardTotalChange = Readonly<{
  hasLocalCreate: boolean;
  finalIsDeleted: boolean;
}>;

const localDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function parseIntegerPart(value: string): number {
  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue)) {
    throw new Error(`Local date part is not numeric: ${value}`);
  }

  return parsedValue;
}

function parseLocalDateParts(value: string): LocalDateParts {
  const match = localDatePattern.exec(value);
  if (match === null) {
    throw new Error(`Invalid review schedule local date: ${value}`);
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    throw new Error(`Review schedule local date parts are missing: ${value}`);
  }

  const parts: LocalDateParts = {
    year: parseIntegerPart(yearText),
    month: parseIntegerPart(monthText),
    day: parseIntegerPart(dayText),
  };
  const normalizedDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  normalizedDate.setUTCFullYear(parts.year);

  if (
    normalizedDate.getUTCFullYear() !== parts.year
    || normalizedDate.getUTCMonth() !== parts.month - 1
    || normalizedDate.getUTCDate() !== parts.day
  ) {
    throw new Error(`Invalid review schedule local date: ${value}`);
  }

  return parts;
}

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const existingFormatter = dateTimeFormatters.get(timeZone);
  if (existingFormatter !== undefined) {
    return existingFormatter;
  }

  const nextFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  dateTimeFormatters.set(timeZone, nextFormatter);
  return nextFormatter;
}

function getRequiredDateTimePart(
  parts: ReadonlyArray<Intl.DateTimeFormatPart>,
  partType: "year" | "month" | "day" | "hour" | "minute" | "second",
): string {
  const partValue = parts.find((part) => part.type === partType)?.value;
  if (partValue === undefined || partValue === "") {
    throw new Error(`Review schedule timezone date is missing ${partType}`);
  }

  return partValue;
}

function getZonedDateTimeParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const parts = getDateTimeFormatter(timeZone).formatToParts(date);

  return {
    year: parseIntegerPart(getRequiredDateTimePart(parts, "year")),
    month: parseIntegerPart(getRequiredDateTimePart(parts, "month")),
    day: parseIntegerPart(getRequiredDateTimePart(parts, "day")),
    hour: parseIntegerPart(getRequiredDateTimePart(parts, "hour")),
    minute: parseIntegerPart(getRequiredDateTimePart(parts, "minute")),
    second: parseIntegerPart(getRequiredDateTimePart(parts, "second")),
  };
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string): number {
  const parts = getZonedDateTimeParts(date, timeZone);
  const localAsUtcMillis = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  return localAsUtcMillis - date.getTime();
}

function formatZonedLocalDate(date: Date, timeZone: string): string {
  const parts = getZonedDateTimeParts(date, timeZone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

function calculateLocalDateStartMillis(localDate: string, timeZone: string): number {
  const parts = parseLocalDateParts(localDate);
  const localUtcMillis = Date.UTC(parts.year, parts.month - 1, parts.day);
  let candidateMillis = localUtcMillis;

  for (let attemptIndex = 0; attemptIndex < 4; attemptIndex += 1) {
    const offsetMillis = getTimeZoneOffsetMillis(new Date(candidateMillis), timeZone);
    const nextCandidateMillis = localUtcMillis - offsetMillis;
    if (nextCandidateMillis === candidateMillis) {
      if (formatZonedLocalDate(new Date(candidateMillis), timeZone) !== localDate) {
        throw new Error(`Could not resolve review schedule local date start: localDate=${localDate}, timeZone=${timeZone}`);
      }

      return candidateMillis;
    }

    candidateMillis = nextCandidateMillis;
  }

  if (formatZonedLocalDate(new Date(candidateMillis), timeZone) !== localDate) {
    throw new Error(`Could not resolve review schedule local date start: localDate=${localDate}, timeZone=${timeZone}`);
  }

  return candidateMillis;
}

function buildReviewScheduleBoundaryMillis(input: ProgressReviewScheduleInput): ReviewScheduleBoundaryMillis {
  return {
    startOfTomorrowMillis: calculateLocalDateStartMillis(shiftLocalDate(input.today, 1), input.timeZone),
    startOfDay8Millis: calculateLocalDateStartMillis(shiftLocalDate(input.today, 8), input.timeZone),
    startOfDay31Millis: calculateLocalDateStartMillis(shiftLocalDate(input.today, 31), input.timeZone),
    startOfDay91Millis: calculateLocalDateStartMillis(shiftLocalDate(input.today, 91), input.timeZone),
    startOfDay361Millis: calculateLocalDateStartMillis(shiftLocalDate(input.today, 361), input.timeZone),
    startOfDay721Millis: calculateLocalDateStartMillis(shiftLocalDate(input.today, 721), input.timeZone),
  };
}

function makeWorkspaceDueAtBucketExactRange(workspaceId: string, dueAtBucketMillis: number): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId, dueAtBucketMillis], [workspaceId, dueAtBucketMillis, []]);
}

function makeWorkspaceDueAtBucketBeforeRange(workspaceId: string, upperDueAtBucketMillisExclusive: number): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId], [workspaceId, upperDueAtBucketMillisExclusive], false, true);
}

function makeWorkspaceDueAtBucketHalfOpenRange(
  workspaceId: string,
  lowerDueAtBucketMillisInclusive: number,
  upperDueAtBucketMillisExclusive: number,
): IDBKeyRange {
  return IDBKeyRange.bound(
    [workspaceId, lowerDueAtBucketMillisInclusive],
    [workspaceId, upperDueAtBucketMillisExclusive],
    false,
    true,
  );
}

function makeWorkspaceDueAtBucketFromRange(
  workspaceId: string,
  lowerDueAtBucketMillisInclusive: number,
): IDBKeyRange {
  return IDBKeyRange.bound([workspaceId, lowerDueAtBucketMillisInclusive], [workspaceId, []]);
}

function isNullDueAtBucketMillis(dueAtBucketMillis: number): boolean {
  return dueAtBucketMillis === nullDueAtBucketMillis;
}

function isMalformedDueAtBucketMillis(dueAtBucketMillis: number): boolean {
  return dueAtBucketMillis === malformedDueAtBucketMillis;
}

function isValidTimedDueAtBucketMillis(dueAtBucketMillis: number): boolean {
  return isNullDueAtBucketMillis(dueAtBucketMillis) === false
    && isMalformedDueAtBucketMillis(dueAtBucketMillis) === false;
}

function isPendingReviewScheduleCardChange(outboxRecord: PersistedOutboxRecord): boolean {
  const operation = outboxRecord.operation;
  if (operation.entityType !== "card" || operation.action !== "upsert") {
    return false;
  }

  return outboxRecord.affectsReviewSchedule ?? true;
}

function isPendingReviewScheduleCardOutboxRecord(
  outboxRecord: PersistedOutboxRecord,
): outboxRecord is PendingReviewScheduleCardOutboxRecord {
  return outboxRecord.operation.entityType === "card"
    && outboxRecord.operation.action === "upsert"
    && (outboxRecord.affectsReviewSchedule ?? true);
}

function comparePendingReviewScheduleCardOutboxRecords(
  left: PendingReviewScheduleCardOutboxRecord,
  right: PendingReviewScheduleCardOutboxRecord,
): number {
  if (left.operation.clientUpdatedAt < right.operation.clientUpdatedAt) {
    return -1;
  }

  if (left.operation.clientUpdatedAt > right.operation.clientUpdatedAt) {
    return 1;
  }

  return left.operationId.localeCompare(right.operationId);
}

function parsePendingReviewScheduleCardTotalChange(
  outboxRecord: PendingReviewScheduleCardOutboxRecord,
): PendingReviewScheduleCardTotalChange {
  const operation = outboxRecord.operation;

  if (operation.payload.cardId !== operation.entityId) {
    throw new Error(
      `Pending card upsert operation entityId does not match payload cardId: operationId=${operation.operationId}, entityId=${operation.entityId}, cardId=${operation.payload.cardId}`,
    );
  }

  return {
    hasLocalCreate: operation.payload.createdAt === operation.clientUpdatedAt,
    finalIsDeleted: operation.payload.deletedAt !== null,
  };
}

function calculatePendingReviewScheduleCardTotalDelta(
  outboxRecords: ReadonlyArray<PersistedOutboxRecord>,
): number {
  const changesByCardId = new Map<string, PendingReviewScheduleCardTotalChange>();
  const cardOutboxRecords = outboxRecords
    .filter(isPendingReviewScheduleCardOutboxRecord)
    .sort(comparePendingReviewScheduleCardOutboxRecords);

  for (const outboxRecord of cardOutboxRecords) {
    const parsedChange = parsePendingReviewScheduleCardTotalChange(outboxRecord);
    const existingChange = changesByCardId.get(outboxRecord.operation.entityId);
    changesByCardId.set(outboxRecord.operation.entityId, {
      hasLocalCreate: existingChange?.hasLocalCreate === true || parsedChange.hasLocalCreate,
      finalIsDeleted: parsedChange.finalIsDeleted,
    });
  }

  return [...changesByCardId.values()].reduce((totalDelta, change) => {
    if (change.hasLocalCreate && change.finalIsDeleted) {
      return totalDelta;
    }

    if (change.hasLocalCreate) {
      return totalDelta + 1;
    }

    if (change.finalIsDeleted) {
      return totalDelta - 1;
    }

    return totalDelta;
  }, 0);
}

function buildReviewScheduleBucketRanges(
  workspaceId: string,
  boundaries: ReviewScheduleBoundaryMillis,
): ReadonlyArray<ReviewScheduleBucketRange> {
  return [
    {
      key: "new",
      keyRange: makeWorkspaceDueAtBucketExactRange(workspaceId, nullDueAtBucketMillis),
      acceptsDueAtBucketMillis: isNullDueAtBucketMillis,
    },
    {
      key: "today",
      keyRange: makeWorkspaceDueAtBucketBeforeRange(workspaceId, boundaries.startOfTomorrowMillis),
      acceptsDueAtBucketMillis: isValidTimedDueAtBucketMillis,
    },
    {
      key: "days1To7",
      keyRange: makeWorkspaceDueAtBucketHalfOpenRange(
        workspaceId,
        boundaries.startOfTomorrowMillis,
        boundaries.startOfDay8Millis,
      ),
      acceptsDueAtBucketMillis: isValidTimedDueAtBucketMillis,
    },
    {
      key: "days8To30",
      keyRange: makeWorkspaceDueAtBucketHalfOpenRange(
        workspaceId,
        boundaries.startOfDay8Millis,
        boundaries.startOfDay31Millis,
      ),
      acceptsDueAtBucketMillis: isValidTimedDueAtBucketMillis,
    },
    {
      key: "days31To90",
      keyRange: makeWorkspaceDueAtBucketHalfOpenRange(
        workspaceId,
        boundaries.startOfDay31Millis,
        boundaries.startOfDay91Millis,
      ),
      acceptsDueAtBucketMillis: isValidTimedDueAtBucketMillis,
    },
    {
      key: "days91To360",
      keyRange: makeWorkspaceDueAtBucketHalfOpenRange(
        workspaceId,
        boundaries.startOfDay91Millis,
        boundaries.startOfDay361Millis,
      ),
      acceptsDueAtBucketMillis: isValidTimedDueAtBucketMillis,
    },
    {
      key: "years1To2",
      keyRange: makeWorkspaceDueAtBucketHalfOpenRange(
        workspaceId,
        boundaries.startOfDay361Millis,
        boundaries.startOfDay721Millis,
      ),
      acceptsDueAtBucketMillis: isValidTimedDueAtBucketMillis,
    },
    {
      key: "later",
      keyRange: makeWorkspaceDueAtBucketFromRange(workspaceId, boundaries.startOfDay721Millis),
      acceptsDueAtBucketMillis: isValidTimedDueAtBucketMillis,
    },
  ];
}

function readStoredDueAtBucketMillis(record: StoredCard): number {
  if (typeof record.dueAtBucketMillis !== "number" || Number.isFinite(record.dueAtBucketMillis) === false) {
    throw new Error(`Stored card dueAtBucketMillis must be finite: workspaceId=${record.workspaceId}, cardId=${record.cardId}`);
  }

  return record.dueAtBucketMillis;
}

function isActiveCard(record: StoredCard): boolean {
  return record.deletedAt === null;
}

type WorkspaceReviewScheduleBucketCounts = ReadonlyMap<ProgressReviewScheduleBucketKey, number>;

type ReviewScheduleBucketCountsByWorkspace = ReadonlyMap<string, WorkspaceReviewScheduleBucketCounts>;

type ReviewScheduleSnapshot = Readonly<{
  bucketCountsByWorkspace: ReviewScheduleBucketCountsByWorkspace;
}>;

function makeEmptyBucketCounts(): Map<ProgressReviewScheduleBucketKey, number> {
  const counts = new Map<ProgressReviewScheduleBucketKey, number>();
  for (const bucketKey of progressReviewScheduleBucketKeys) {
    counts.set(bucketKey, 0);
  }

  return counts;
}

function readBucketCount(
  counts: WorkspaceReviewScheduleBucketCounts,
  bucketKey: ProgressReviewScheduleBucketKey,
  workspaceId: string,
): number {
  const value = counts.get(bucketKey);
  if (value === undefined) {
    throw new Error(`Review schedule bucket count is missing: workspaceId=${workspaceId}, bucketKey=${bucketKey}`);
  }

  return value;
}

// Reads bucket counts for every workspace and asserts there are no active
// cards with malformed dueAt sentinels. ALL cursor requests are issued inside a
// single readonly transaction so the resulting snapshot is internally
// consistent: a concurrent readwrite transaction cannot interleave between the
// per-(workspace, bucket) reads, which would otherwise let a moved card be
// counted twice (or zero times) and break the contract `totalCards == sum(buckets)`.
function readReviewScheduleSnapshot(
  database: IDBDatabase,
  workspaceIds: ReadonlyArray<string>,
  input: ProgressReviewScheduleInput,
): Promise<ReviewScheduleSnapshot> {
  return new Promise((resolve, reject) => {
    const boundaries = buildReviewScheduleBoundaryMillis(input);
    const transaction = database.transaction(["cards"], "readonly");
    const cardsIndex = transaction.objectStore("cards").index("workspaceId_dueAtBucketMillis_cardId");
    const bucketCountsByWorkspace = new Map<string, Map<ProgressReviewScheduleBucketKey, number>>();
    let pendingMalformedRejection: Error | null = null;

    function failTransaction(error: Error): void {
      if (pendingMalformedRejection !== null) {
        return;
      }

      pendingMalformedRejection = error;
      // Best-effort abort so oncomplete does not also resolve. Errors here are
      // surfaced via reject below.
      try {
        transaction.abort();
      } catch (abortError: unknown) {
        // Ignore: the transaction may already be inactive; the saved error is
        // returned via reject regardless.
        void abortError;
      }
    }

    transaction.onerror = () => {
      if (pendingMalformedRejection !== null) {
        reject(pendingMalformedRejection);
        return;
      }

      reject(describeIndexedDbError("IndexedDB review schedule transaction failed", transaction.error));
    };

    transaction.onabort = () => {
      if (pendingMalformedRejection !== null) {
        reject(pendingMalformedRejection);
        return;
      }

      reject(describeIndexedDbError("IndexedDB review schedule transaction aborted", transaction.error));
    };

    transaction.oncomplete = () => {
      if (pendingMalformedRejection !== null) {
        reject(pendingMalformedRejection);
        return;
      }

      resolve({ bucketCountsByWorkspace });
    };

    for (const workspaceId of workspaceIds) {
      const workspaceCounts = makeEmptyBucketCounts();
      bucketCountsByWorkspace.set(workspaceId, workspaceCounts);

      // Active-card bucket counts.
      for (const bucketRange of buildReviewScheduleBucketRanges(workspaceId, boundaries)) {
        const cursorRequest = cardsIndex.openCursor(bucketRange.keyRange, "next");
        cursorRequest.onerror = () => {
          failTransaction(describeIndexedDbError(
            `IndexedDB review schedule cursor failed: workspaceId=${workspaceId}, bucketKey=${bucketRange.key}`,
            cursorRequest.error,
          ));
        };
        cursorRequest.onsuccess = () => {
          try {
            const cursor = cursorRequest.result;
            if (cursor === null) {
              return;
            }

            const record = cursor.value as StoredCard;
            const dueAtBucketMillis = readStoredDueAtBucketMillis(record);
            if (isActiveCard(record) && bucketRange.acceptsDueAtBucketMillis(dueAtBucketMillis)) {
              workspaceCounts.set(bucketRange.key, readBucketCount(workspaceCounts, bucketRange.key, workspaceId) + 1);
            }

            cursor.continue();
          } catch (error: unknown) {
            failTransaction(error instanceof Error ? error : new Error(String(error)));
          }
        };
      }

      // Malformed-dueAt sentinel scan: any active card here means upstream
      // logic produced an unparseable dueAt and we must refuse to build the
      // schedule rather than silently miscount.
      const malformedRequest = cardsIndex.openCursor(
        makeWorkspaceDueAtBucketExactRange(workspaceId, malformedDueAtBucketMillis),
        "next",
      );
      malformedRequest.onerror = () => {
        failTransaction(describeIndexedDbError(
          `IndexedDB malformed due schedule cursor failed: workspaceId=${workspaceId}`,
          malformedRequest.error,
        ));
      };
      malformedRequest.onsuccess = () => {
        try {
          const cursor = malformedRequest.result;
          if (cursor === null) {
            return;
          }

          const record = cursor.value as StoredCard;
          if (isActiveCard(record)) {
            failTransaction(new Error(
              `Cannot build review schedule: card has invalid dueAt: workspaceId=${record.workspaceId}, cardId=${record.cardId}`,
            ));
            return;
          }

          cursor.continue();
        } catch (error: unknown) {
          failTransaction(error instanceof Error ? error : new Error(String(error)));
        }
      };
    }
  });
}

function addBucketCounts(
  left: ReadonlyArray<ProgressReviewScheduleBucket>,
  right: ReadonlyArray<ProgressReviewScheduleBucket>,
): ReadonlyArray<ProgressReviewScheduleBucket> {
  return progressReviewScheduleBucketKeys.map((bucketKey): ProgressReviewScheduleBucket => ({
    key: bucketKey,
    count: (left.find((bucket) => bucket.key === bucketKey)?.count ?? 0)
      + (right.find((bucket) => bucket.key === bucketKey)?.count ?? 0),
  }));
}

function sumBucketCounts(buckets: ReadonlyArray<ProgressReviewScheduleBucket>): number {
  return buckets.reduce((totalCards, bucket) => totalCards + bucket.count, 0);
}

function mergeWorkspaceBucketCounts(
  bucketCountsByWorkspace: ReviewScheduleBucketCountsByWorkspace,
): ReadonlyArray<ProgressReviewScheduleBucket> {
  let mergedBuckets: ReadonlyArray<ProgressReviewScheduleBucket> = progressReviewScheduleBucketKeys
    .map((bucketKey): ProgressReviewScheduleBucket => ({ key: bucketKey, count: 0 }));

  for (const [workspaceId, workspaceCounts] of bucketCountsByWorkspace) {
    const workspaceBuckets = progressReviewScheduleBucketKeys.map((bucketKey): ProgressReviewScheduleBucket => ({
      key: bucketKey,
      count: readBucketCount(workspaceCounts, bucketKey, workspaceId),
    }));
    mergedBuckets = addBucketCounts(mergedBuckets, workspaceBuckets);
  }

  return mergedBuckets;
}

export async function loadLocalProgressReviewSchedule(
  workspaceIds: ReadonlyArray<string>,
  input: ProgressReviewScheduleInput,
): Promise<ProgressReviewSchedule> {
  if (workspaceIds.length === 0) {
    const buckets = progressReviewScheduleBucketKeys.map((bucketKey): ProgressReviewScheduleBucket => ({
      key: bucketKey,
      count: 0,
    }));

    return {
      timeZone: input.timeZone,
      generatedAt: null,
      totalCards: 0,
      buckets,
    };
  }

  return closeDatabaseAfter(async (database) => {
    const snapshot = await readReviewScheduleSnapshot(database, workspaceIds, input);
    const buckets = mergeWorkspaceBucketCounts(snapshot.bucketCountsByWorkspace);

    return {
      timeZone: input.timeZone,
      generatedAt: null,
      totalCards: sumBucketCounts(buckets),
      buckets,
    };
  });
}

export async function hasPendingProgressReviewScheduleCardChanges(
  workspaceIds: ReadonlyArray<string>,
): Promise<boolean> {
  if (workspaceIds.length === 0) {
    return false;
  }

  const outboxRecords = await listOutboxRecordsForWorkspaces(workspaceIds);
  return outboxRecords.some(isPendingReviewScheduleCardChange);
}

export async function calculatePendingProgressReviewScheduleCardTotalDelta(
  workspaceIds: ReadonlyArray<string>,
): Promise<number> {
  if (workspaceIds.length === 0) {
    return 0;
  }

  const outboxRecords = await listOutboxRecordsForWorkspaces(workspaceIds);
  return calculatePendingReviewScheduleCardTotalDelta(outboxRecords);
}

export async function hasCompleteLocalProgressReviewScheduleCoverage(
  workspaceIds: ReadonlyArray<string>,
): Promise<boolean> {
  const hydrationStates: ReadonlyArray<boolean> = await Promise.all(
    workspaceIds.map((workspaceId) => hasHydratedHotState(workspaceId)),
  );

  return hydrationStates.every((hasHydratedWorkspaceHotState) => hasHydratedWorkspaceHotState);
}
