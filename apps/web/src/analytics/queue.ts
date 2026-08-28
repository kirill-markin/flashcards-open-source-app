import type { AnalyticsWireEvent } from "./events";

/**
 * Durable analytics queue. It lives in its own IndexedDB database rather than in
 * `flashcards-web-sync` so a flush can never contend with, block, or be blocked by the app's own
 * local data, its migrations, or its browser-data reset.
 */

const databaseName = "flashcards-analytics";
const databaseVersion = 1;
const eventsStoreName = "events";
const metaStoreName = "meta";
const totalsRecordKey = "totals";
const ownerRecordKey = "owner";

/** Shared with iOS and Android. */
export const analyticsQueueEventLimit = 5000;
export const analyticsQueueByteLimit = 5 * 1024 * 1024;
export const analyticsQueueTtlMs = 14 * 24 * 60 * 60 * 1000;

/**
 * `sessionId` is stored per event because the wire envelope carries one session id for the whole
 * batch: events created in different sessions must not be shipped together.
 */
export type AnalyticsQueueRecord = Readonly<{
  eventId: string;
  sessionId: string;
  createdAtMs: number;
  byteSize: number;
  wireEvent: AnalyticsWireEvent;
}>;

export type QueuedAnalyticsEvent = AnalyticsQueueRecord & Readonly<{
  sequence: number;
}>;

export type AnalyticsQueueReadResult = Readonly<{
  events: ReadonlyArray<QueuedAnalyticsEvent>;
  expiredCount: number;
  /**
   * The account the queued events were created under, read back in the same transaction that
   * produced them, or `null` while the queue has never been claimed. A caller compares it with the
   * account the current credential belongs to instead of reasoning about when its own reset runs.
   */
  ownerId: string | null;
}>;

export type AnalyticsQueueOwnerClaim = Readonly<{
  /** The queue held another account's events; they were discarded by the claim. */
  didReplaceForeignOwner: boolean;
  discardedEventCount: number;
}>;

type AnalyticsQueueTotals = {
  key: typeof totalsRecordKey;
  eventCount: number;
  byteCount: number;
};

type AnalyticsQueueOwner = Readonly<{
  key: typeof ownerRecordKey;
  ownerId: string;
}>;

export type AnalyticsQueueOperation = "open" | "append" | "read" | "remove" | "clear" | "claim";

export class AnalyticsQueueError extends Error {
  readonly operation: AnalyticsQueueOperation;
  readonly indexedDbErrorName: string | null;

  constructor(operation: AnalyticsQueueOperation, cause: unknown) {
    super(`Analytics queue ${operation} failed`);
    this.name = "AnalyticsQueueError";
    this.operation = operation;
    this.indexedDbErrorName = readErrorName(cause);
  }
}

function readErrorName(cause: unknown): string | null {
  if (typeof cause !== "object" || cause === null || "name" in cause === false) {
    return null;
  }

  const errorName = (cause as Readonly<{ name: unknown }>).name;
  return typeof errorName === "string" && errorName.trim() !== "" ? errorName : null;
}

function openAnalyticsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onerror = (): void => {
      reject(new AnalyticsQueueError("open", request.error));
    };

    request.onupgradeneeded = (): void => {
      const database = request.result;
      if (database.objectStoreNames.contains(eventsStoreName) === false) {
        database.createObjectStore(eventsStoreName, { keyPath: "sequence", autoIncrement: true });
      }
      if (database.objectStoreNames.contains(metaStoreName) === false) {
        database.createObjectStore(metaStoreName, { keyPath: "key" });
      }
    };

    request.onsuccess = (): void => {
      // Release the connection as soon as another tab needs to upgrade or delete this database.
      request.result.onversionchange = (): void => {
        request.result.close();
      };
      resolve(request.result);
    };
  });
}

function createEmptyTotals(): AnalyticsQueueTotals {
  return { key: totalsRecordKey, eventCount: 0, byteCount: 0 };
}

function toTotals(value: unknown): AnalyticsQueueTotals {
  if (typeof value !== "object" || value === null) {
    return createEmptyTotals();
  }

  const { eventCount, byteCount } = value as Readonly<{ eventCount?: unknown; byteCount?: unknown }>;
  if (
    typeof eventCount !== "number"
    || Number.isFinite(eventCount) === false
    || typeof byteCount !== "number"
    || Number.isFinite(byteCount) === false
  ) {
    return createEmptyTotals();
  }

  return { key: totalsRecordKey, eventCount, byteCount };
}

function toOwnerId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const { ownerId } = value as Readonly<{ ownerId?: unknown }>;
  return typeof ownerId === "string" && ownerId !== "" ? ownerId : null;
}

function subtractFromTotals(totals: AnalyticsQueueTotals, byteSize: number): void {
  totals.eventCount = Math.max(0, totals.eventCount - 1);
  totals.byteCount = Math.max(0, totals.byteCount - byteSize);
}

function runAnalyticsQueueTransaction<ResultType>(
  operation: AnalyticsQueueOperation,
  run: (transaction: IDBTransaction, resolveResult: (result: ResultType) => void) => void,
): Promise<ResultType> {
  return openAnalyticsDatabase().then((database): Promise<ResultType> => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction([eventsStoreName, metaStoreName], "readwrite");
    } catch (error) {
      database.close();
      return Promise.reject(new AnalyticsQueueError(operation, error));
    }

    const activeTransaction = transaction;
    return new Promise<ResultType>((resolve, reject) => {
      let result: ResultType | undefined = undefined;
      let hasResult = false;

      activeTransaction.onabort = (): void => {
        database.close();
        reject(new AnalyticsQueueError(operation, activeTransaction.error));
      };

      activeTransaction.oncomplete = (): void => {
        database.close();
        if (hasResult === false) {
          reject(new AnalyticsQueueError(operation, new Error("Transaction completed without a result")));
          return;
        }

        resolve(result as ResultType);
      };

      try {
        run(activeTransaction, (transactionResult: ResultType): void => {
          result = transactionResult;
          hasResult = true;
        });
      } catch (error) {
        activeTransaction.abort();
        reject(new AnalyticsQueueError(operation, error));
      }
    });
  });
}

/**
 * Appends events and enforces the queue caps by dropping the oldest records. Returns how many
 * records overflow removed so the loss can be counted into `analytics_events_dropped`.
 */
export function appendAnalyticsEvents(
  records: ReadonlyArray<AnalyticsQueueRecord>,
): Promise<number> {
  return runAnalyticsQueueTransaction<number>("append", (transaction, resolveResult) => {
    const eventsStore = transaction.objectStore(eventsStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const totalsRequest = metaStore.get(totalsRecordKey);

    totalsRequest.onsuccess = (): void => {
      const totals = toTotals(totalsRequest.result);
      for (const record of records) {
        eventsStore.add(record);
        totals.eventCount += 1;
        totals.byteCount += record.byteSize;
      }

      let overflowCount = 0;
      const cursorRequest = eventsStore.openCursor();
      cursorRequest.onsuccess = (): void => {
        const cursor = cursorRequest.result;
        const isOverCap = totals.eventCount > analyticsQueueEventLimit
          || totals.byteCount > analyticsQueueByteLimit;
        if (cursor === null || isOverCap === false) {
          metaStore.put(totals);
          resolveResult(overflowCount);
          return;
        }

        const droppedEvent = cursor.value as QueuedAnalyticsEvent;
        cursor.delete();
        subtractFromTotals(totals, droppedEvent.byteSize);
        overflowCount += 1;
        cursor.continue();
      };
    };
  });
}

/**
 * Reads the oldest events, dropping any that outlived the queue TTL on the way. Expired records are
 * removed here rather than on a timer so every flush attempt keeps the queue bounded.
 */
export function readOldestAnalyticsEvents(limit: number, nowMs: number): Promise<AnalyticsQueueReadResult> {
  return runAnalyticsQueueTransaction<AnalyticsQueueReadResult>("read", (transaction, resolveResult) => {
    const eventsStore = transaction.objectStore(eventsStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const ownerRequest = metaStore.get(ownerRecordKey);

    ownerRequest.onsuccess = (): void => {
      const ownerId = toOwnerId(ownerRequest.result);
      const totalsRequest = metaStore.get(totalsRecordKey);

      totalsRequest.onsuccess = (): void => {
        const totals = toTotals(totalsRequest.result);
        const expiresBeforeMs = nowMs - analyticsQueueTtlMs;
        const events: Array<QueuedAnalyticsEvent> = [];
        let expiredCount = 0;

        const cursorRequest = eventsStore.openCursor();
        cursorRequest.onsuccess = (): void => {
          const cursor = cursorRequest.result;
          if (cursor === null) {
            metaStore.put(totals);
            resolveResult({ events, expiredCount, ownerId });
            return;
          }

          const queuedEvent = cursor.value as QueuedAnalyticsEvent;
          if (queuedEvent.createdAtMs < expiresBeforeMs) {
            cursor.delete();
            subtractFromTotals(totals, queuedEvent.byteSize);
            expiredCount += 1;
            cursor.continue();
            return;
          }

          events.push(queuedEvent);
          if (events.length >= limit) {
            metaStore.put(totals);
            resolveResult({ events, expiredCount, ownerId });
            return;
          }

          cursor.continue();
        };
      };
    };
  });
}

export function removeAnalyticsEvents(events: ReadonlyArray<QueuedAnalyticsEvent>): Promise<void> {
  if (events.length === 0) {
    return Promise.resolve();
  }

  const sequences = new Set(events.map((event) => event.sequence));
  const lowestSequence = Math.min(...sequences);
  const highestSequence = Math.max(...sequences);

  return runAnalyticsQueueTransaction<null>("remove", (transaction, resolveResult) => {
    const eventsStore = transaction.objectStore(eventsStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const totalsRequest = metaStore.get(totalsRecordKey);

    totalsRequest.onsuccess = (): void => {
      const totals = toTotals(totalsRequest.result);
      const cursorRequest = eventsStore.openCursor(IDBKeyRange.bound(lowestSequence, highestSequence));
      cursorRequest.onsuccess = (): void => {
        const cursor = cursorRequest.result;
        if (cursor === null) {
          metaStore.put(totals);
          resolveResult(null);
          return;
        }

        const queuedEvent = cursor.value as QueuedAnalyticsEvent;
        if (sequences.has(queuedEvent.sequence)) {
          cursor.delete();
          subtractFromTotals(totals, queuedEvent.byteSize);
        }

        cursor.continue();
      };
    };
  }).then((): void => undefined);
}

/**
 * Empties the queue and returns how many undelivered events it discarded, so the loss is reportable.
 * Releasing the owner leaves the queue unclaimed, which is what a logout wants: the next account
 * confirmed on this browser adopts an empty queue instead of inheriting one.
 */
export function clearAnalyticsQueue(shouldReleaseOwner: boolean): Promise<number> {
  return runAnalyticsQueueTransaction<number>("clear", (transaction, resolveResult) => {
    const eventsStore = transaction.objectStore(eventsStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const totalsRequest = metaStore.get(totalsRecordKey);

    totalsRequest.onsuccess = (): void => {
      const discardedEventCount = toTotals(totalsRequest.result).eventCount;
      eventsStore.clear();
      metaStore.put(createEmptyTotals());
      if (shouldReleaseOwner) {
        metaStore.delete(ownerRecordKey);
      }

      resolveResult(discardedEventCount);
    };
  });
}

/**
 * Records `ownerId` as the owner of everything in the queue, emptying it first when it was filled
 * under a different account. Both halves run in one transaction, so the queue is never readable while
 * its stored owner already names the account that just signed in.
 */
export function claimAnalyticsQueueOwner(ownerId: string): Promise<AnalyticsQueueOwnerClaim> {
  return runAnalyticsQueueTransaction<AnalyticsQueueOwnerClaim>("claim", (transaction, resolveResult) => {
    const eventsStore = transaction.objectStore(eventsStoreName);
    const metaStore = transaction.objectStore(metaStoreName);
    const ownerRequest = metaStore.get(ownerRecordKey);

    ownerRequest.onsuccess = (): void => {
      const storedOwnerId = toOwnerId(ownerRequest.result);
      const nextOwner: AnalyticsQueueOwner = { key: ownerRecordKey, ownerId };
      metaStore.put(nextOwner);
      // An unclaimed queue holds events created before any credential existed. Those belong to the
      // account signing in now, so it adopts them rather than discarding them.
      if (storedOwnerId === null || storedOwnerId === ownerId) {
        resolveResult({ didReplaceForeignOwner: false, discardedEventCount: 0 });
        return;
      }

      const totalsRequest = metaStore.get(totalsRecordKey);
      totalsRequest.onsuccess = (): void => {
        const discardedEventCount = toTotals(totalsRequest.result).eventCount;
        eventsStore.clear();
        metaStore.put(createEmptyTotals());
        resolveResult({ didReplaceForeignOwner: true, discardedEventCount });
      };
    };
  });
}
