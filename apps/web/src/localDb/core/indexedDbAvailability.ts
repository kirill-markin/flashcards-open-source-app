/**
 * Access to the `indexedDB` global that never throws on a browser withholding it.
 *
 * Some browsers (private windows, blocked site data) expose no `indexedDB` binding at all, and
 * reading an undeclared global is a `ReferenceError` in JavaScriptCore rather than `undefined`.
 * Every entry point into IndexedDB therefore reads the factory through `getIndexedDbFactory()` and
 * turns its absence into a typed error the app can present, instead of an engine-level crash.
 *
 * This is a different failure from `isIndexedDbOpenRecoveryError`: there the factory exists and a
 * real open request fails, which is recoverable by reloading. A missing factory never recovers, so
 * retrying is pointless and the app must say so.
 */

export type IndexedDbUnavailableError = Error & Readonly<{
  indexedDbUnavailable: true;
}>;

/**
 * The `name` this error carries. Consumers that keep only an error name — the analytics queue
 * stores `indexedDbErrorName`, not the cause — recognize the condition through this constant instead
 * of a literal spelled out again at the call site.
 */
export const indexedDbUnavailableErrorName = "IndexedDbUnavailableError";

export function createIndexedDbUnavailableError(): IndexedDbUnavailableError {
  const error = new Error("IndexedDB is unavailable in this browser");
  error.name = indexedDbUnavailableErrorName;
  return Object.assign(error, { indexedDbUnavailable: true as const });
}

export function isIndexedDbUnavailableError(error: unknown): error is IndexedDbUnavailableError {
  return error instanceof Error
    && "indexedDbUnavailable" in error
    && error.indexedDbUnavailable === true;
}

/**
 * Returns the usable `indexedDB` factory, or `null` when this browser exposes none.
 *
 * The factory is read on every call rather than captured once so a browser that hands it out late,
 * and test doubles that replace it, both keep working.
 */
export function getIndexedDbFactory(): IDBFactory | null {
  try {
    const factory: IDBFactory | undefined = globalThis.indexedDB;
    if (factory === undefined || typeof factory.open !== "function") {
      return null;
    }

    return factory;
  } catch {
    // Browsers with blocked site data throw on the `indexedDB` getter itself; treat that the same
    // way as a missing global.
    return null;
  }
}
