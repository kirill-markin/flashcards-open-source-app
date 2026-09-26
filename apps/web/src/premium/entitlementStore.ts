import { useCallback, useSyncExternalStore } from "react";
import { ApiContractError } from "../apiContracts/core";
import { parseEntitlementSnapshot } from "../apiContracts/entitlement";
import { captureAppOperationError } from "../observability/appOperationObservation";
import type { EntitlementSnapshot } from "../types/entitlement";

const storageKeyPrefix = "flashcards-entitlement:";
const resetStorageKey = "flashcards-entitlement-reset";
const changeEventName = "flashcards-entitlement-change";
let activeUserId: string | null = null;
let identityGeneration = 0;
let snapshot: EntitlementSnapshot | null = null;

function storageKey(userId: string): string {
  return `${storageKeyPrefix}${userId}`;
}

function reportCacheError(error: unknown, userId: string | null, stage: string): void {
  console.error("Entitlement cache operation failed", { userId, stage, error });
  captureAppOperationError(error, {
    feature: "settings",
    operation: "entitlement_cache",
    userId,
    workspaceId: null,
    installationId: null,
    entityId: stage,
  });
}

function readPersistedSnapshot(userId: string): EntitlementSnapshot | null | undefined {
  let rawValue: string | null;
  try {
    rawValue = window.localStorage.getItem(storageKey(userId));
  } catch (error) {
    reportCacheError(error, userId, "read");
    return undefined;
  }
  if (rawValue === null) {
    return null;
  }

  try {
    return parseEntitlementSnapshot(JSON.parse(rawValue) as unknown, "localStorage", "entitlement");
  } catch (error) {
    if (error instanceof SyntaxError) {
      // JSON syntax errors can quote stored content; report the field without that content.
      reportCacheError(new Error("Stored entitlement is not valid JSON"), userId, "decode");
    } else if (error instanceof ApiContractError) {
      reportCacheError(error, userId, "decode");
    } else {
      throw error;
    }
    return undefined;
  }
}

function notifySubscribers(): void {
  window.dispatchEvent(new Event(changeEventName));
}

export function readEntitlementIdentityGeneration(): number {
  return identityGeneration;
}

export function setEntitlementIdentity(userId: string | null, generation: number): boolean {
  if (generation !== identityGeneration) {
    return false;
  }
  if (activeUserId === userId) {
    return true;
  }
  activeUserId = userId;
  snapshot = userId === null ? null : readPersistedSnapshot(userId) ?? null;
  notifySubscribers();
  return true;
}

function resetEntitlementIdentity(): void {
  identityGeneration += 1;
  activeUserId = null;
  snapshot = null;
  notifySubscribers();
}

export function clearEntitlementState(): void {
  const previousUserId = activeUserId;
  resetEntitlementIdentity();
  try {
    // A pending first pull has no snapshot key whose removal could notify another tab.
    window.localStorage.setItem(resetStorageKey, crypto.randomUUID());
  } catch (error) {
    reportCacheError(error, previousUserId, "broadcast_reset");
  }
  if (previousUserId !== null) {
    try {
      window.localStorage.removeItem(storageKey(previousUserId));
    } catch (error) {
      reportCacheError(error, previousUserId, "remove");
    }
  }
  // The shared browser cleanup also removes every flashcards- key, including other identities.
}

export function publishEntitlementSnapshot(
  userId: string,
  nextSnapshot: EntitlementSnapshot | undefined,
  generation: number,
): void {
  if (generation !== identityGeneration || userId !== activeUserId || nextSnapshot === undefined) {
    return;
  }
  snapshot = nextSnapshot;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(nextSnapshot));
  } catch (error) {
    // Keep the server answer in memory even when this browser cannot persist its cache.
    reportCacheError(error, userId, "write");
  }
  notifySubscribers();
}

export function readEntitlementSnapshot(userId: string | null): EntitlementSnapshot | null {
  return userId !== null && userId === activeUserId ? snapshot : null;
}

function subscribeToEntitlement(listener: () => void): () => void {
  window.addEventListener(changeEventName, listener);
  return (): void => window.removeEventListener(changeEventName, listener);
}

// Listen even before the first UI subscriber mounts: another tab may log out during a sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event: StorageEvent): void => {
    if (event.key === resetStorageKey) {
      if (event.newValue !== null) {
        resetEntitlementIdentity();
      }
      return;
    }
    if (event.key !== null && (
      activeUserId === null
        ? event.key.startsWith(storageKeyPrefix) === false
        : event.key !== storageKey(activeUserId)
    )) {
      return;
    }
    if (event.newValue === null) {
      resetEntitlementIdentity();
      return;
    } else if (activeUserId !== null) {
      const persistedSnapshot = readPersistedSnapshot(activeUserId);
      if (persistedSnapshot !== undefined) {
        snapshot = persistedSnapshot;
      }
    }
    notifySubscribers();
  });
}

/** Pass the session user ID; null means unknown, never a free-tier default. No offline expiry. */
export function useEntitlementSnapshot(userId: string | null): EntitlementSnapshot | null {
  const getSnapshot = useCallback((): EntitlementSnapshot | null => readEntitlementSnapshot(userId), [userId]);
  return useSyncExternalStore(subscribeToEntitlement, getSnapshot);
}
