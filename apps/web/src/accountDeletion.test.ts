// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginAccountDeletionRetryAttempt,
  clearAllLocalBrowserData,
  clearBrowserReauthRequired,
  hasAccountDeletionAttemptDispatched,
  isAccountDeletionPending,
  isAccountDeletionServerConfirmed,
  isBrowserReauthRequired,
  loadAccountDeletionAttemptId,
  loadAccountDeletionCsrfToken,
  markAccountDeletionAttemptDispatched,
  markAccountDeletionServerConfirmed,
  markBrowserReauthRequired,
  runWithAccountDeletionLock,
  setAccountDeletionPending,
  storeAccountDeletionCsrfToken,
} from "./accountDeletion";
import { AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY } from "./chat/preferences/AIChatPreferencesContext";
import { INSTALLATION_ID_STORAGE_KEY } from "./clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "./i18n/runtime";
import { loadCloudSettings, putCloudSettings } from "./localDb/sync/cloudSettings";
import { clearWebSyncCache } from "./localDb/cache";
import { SYNC_RESTORE_HISTORY_STORAGE_KEY } from "./appData/sync/restore/syncRestoreHistory";
import type { CloudSettings } from "./types";

const observabilityMocks = vi.hoisted(() => ({
  addWebBreadcrumbMock: vi.fn(),
}));

vi.mock("./observability/webObservability", () => ({
  addWebBreadcrumb: observabilityMocks.addWebBreadcrumbMock,
}));

const seededCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-10T00:00:00.000Z",
};

function ignoreIndexedDbOpenRecoveryFailure(): void {
}

function installSerialAccountDeletionLockMock(): void {
  let previousRequest: Promise<void> = Promise.resolve();
  Object.defineProperty(window.navigator, "locks", {
    configurable: true,
    value: {
      request<Result>(
        _name: string,
        _options: Readonly<{ signal: AbortSignal }>,
        action: () => Promise<Result>,
      ): Promise<Result> {
        const result = previousRequest.then(action);
        previousRequest = result.then(
          (): void => undefined,
          (): void => undefined,
        );
        return result;
      },
    },
  });
}

function createStorageMock(): Storage {
  const state = new Map<string, string>();

  return {
    get length(): number {
      return state.size;
    },
    clear(): void {
      state.clear();
    },
    getItem(key: string): string | null {
      return state.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...state.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      state.delete(key);
    },
    setItem(key: string, value: string): void {
      state.set(key, value);
    },
  };
}

function seedLocalBrowserState(): void {
  window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, "installation-1");
  window.localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, "ar");
  window.localStorage.setItem(AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY, "false");
  window.localStorage.setItem("flashcards-warm-start-snapshot", JSON.stringify({
    version: 1,
  }));
  window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
    version: 1,
  }));
  window.localStorage.setItem(SYNC_RESTORE_HISTORY_STORAGE_KEY, JSON.stringify({
    version: 1,
    entries: [],
  }));
  window.localStorage.setItem("selected-review-filter", JSON.stringify({ kind: "allCards" }));
  window.localStorage.setItem("selected-review-filter:workspace-1", JSON.stringify({
    kind: "tags",
    tags: ["grammar"],
  }));
  window.localStorage.setItem("flashcards-auth-reset-required", "1");
  markBrowserReauthRequired();
}

function expectLocalBrowserStateCleared(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  expect(window.localStorage.getItem(SYNC_RESTORE_HISTORY_STORAGE_KEY)).toBeNull();
  expect(window.localStorage.getItem("flashcards-auth-reset-required")).toBeNull();
  expect(window.localStorage.getItem("selected-review-filter")).toBeNull();
  expect(window.localStorage.getItem("selected-review-filter:workspace-1")).toBeNull();
  expect(isBrowserReauthRequired()).toBe(false);
  expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
  expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
  expect(window.localStorage.getItem(AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY)).toBe("false");
}

function createMockOpenDbRequest(fire: (request: IDBOpenDBRequest) => void): IDBOpenDBRequest {
  const request = {} as IDBOpenDBRequest;
  queueMicrotask(() => {
    fire(request);
  });
  return request;
}

function mockBlockedThenSuccessfulDeleteDatabase(): void {
  vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => createMockOpenDbRequest((request) => {
    request.onblocked?.(new Event("blocked"));
    queueMicrotask(() => {
      request.onsuccess?.(new Event("success"));
    });
  }));
}

function mockFailingDeleteDatabase(): void {
  vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => createMockOpenDbRequest((request) => {
    request.onerror?.(new Event("error"));
  }));
}

function mockUnavailableIndexedDbOpen(): void {
  vi.spyOn(indexedDB, "open").mockImplementation(() => createMockOpenDbRequest((request) => {
    Object.assign(request, { error: new DOMException("IndexedDB unavailable", "UnknownError") });
    request.onerror?.(new Event("error"));
  }));
}

function mockOrdinaryIndexedDbOpenFailure(): void {
  vi.spyOn(indexedDB, "open").mockImplementation(() => createMockOpenDbRequest((request) => {
    Object.assign(request, { error: new DOMException("IndexedDB unavailable", "InvalidStateError") });
    request.onerror?.(new Event("error"));
  }));
}

beforeEach(async () => {
  await clearWebSyncCache();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
  clearBrowserReauthRequired();
  observabilityMocks.addWebBreadcrumbMock.mockReset();
});

afterEach(async () => {
  window.localStorage.clear();
  clearBrowserReauthRequired();
  Reflect.deleteProperty(window.navigator, "locks");
  vi.restoreAllMocks();
  await clearWebSyncCache();
});

describe("account deletion local cleanup helpers", () => {
  it("completes cleanup when the database delete is blocked before succeeding", async () => {
    seedLocalBrowserState();
    await putCloudSettings(seededCloudSettings);
    mockBlockedThenSuccessfulDeleteDatabase();

    await expect(clearAllLocalBrowserData("logout_marker", ignoreIndexedDbOpenRecoveryFailure)).resolves.toBeUndefined();

    expectLocalBrowserStateCleared();
    await expect(loadCloudSettings()).resolves.toBeNull();
    expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "local_browser_data_cleanup",
      details: expect.objectContaining({
        eventName: "local_browser_data_cleanup_succeeded",
        reason: "logout_marker",
        indexedDbCleared: true,
        localStorageCleared: true,
      }),
    }));
  });

  it("completes cleanup when the database delete fails after stores were wiped", async () => {
    seedLocalBrowserState();
    await putCloudSettings(seededCloudSettings);
    mockFailingDeleteDatabase();

    await expect(clearAllLocalBrowserData("logout_marker", ignoreIndexedDbOpenRecoveryFailure)).resolves.toBeUndefined();

    expectLocalBrowserStateCleared();
    await expect(loadCloudSettings()).resolves.toBeNull();
    expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "indexed_db_operation",
      details: expect.objectContaining({
        eventName: "indexed_db_delete_lifecycle",
        indexedDbDeleteOutcome: "delete_error",
      }),
    }));
  });

  it("keeps the reauth guard when the database cannot be wiped or deleted", async () => {
    seedLocalBrowserState();
    await putCloudSettings(seededCloudSettings);
    mockUnavailableIndexedDbOpen();
    mockFailingDeleteDatabase();

    await expect(clearAllLocalBrowserData("logout_marker", ignoreIndexedDbOpenRecoveryFailure)).rejects.toThrow("Failed to open IndexedDB");
    expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).not.toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).not.toBeNull();
    expect(window.localStorage.getItem(SYNC_RESTORE_HISTORY_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem("flashcards-browser-reauth-required")).toBe("1");
    expect(window.localStorage.getItem("flashcards-auth-reset-required")).toBe("1");
    expect(isBrowserReauthRequired()).toBe(true);
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
    expect(window.localStorage.getItem(AI_CHAT_COMPOSER_SUGGESTIONS_STORAGE_KEY)).toBe("false");
    expect(observabilityMocks.addWebBreadcrumbMock).not.toHaveBeenCalledWith(expect.objectContaining({
      action: "local_browser_data_cleanup",
      details: expect.objectContaining({
        eventName: "local_browser_data_cleanup_failed",
      }),
    }));
  });

  it("clears reauth markers and IndexedDB only during explicit local data cleanup", async () => {
    seedLocalBrowserState();
    await putCloudSettings(seededCloudSettings);

    await expect(clearAllLocalBrowserData("confirmed_account_switch", ignoreIndexedDbOpenRecoveryFailure)).resolves.toBeUndefined();

    expectLocalBrowserStateCleared();
    await expect(loadCloudSettings()).resolves.toBeNull();
    expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "local_browser_data_cleanup",
      details: expect.objectContaining({
        eventName: "local_browser_data_cleanup_succeeded",
        reason: "confirmed_account_switch",
        indexedDbCleared: true,
        localStorageCleared: true,
      }),
    }));
  });

  it("preserves pending account deletion proof until successful cleanup is handed off", async () => {
    seedLocalBrowserState();
    setAccountDeletionPending(true);
    storeAccountDeletionCsrfToken("csrf-token");
    markAccountDeletionServerConfirmed();
    markAccountDeletionAttemptDispatched();
    await putCloudSettings(seededCloudSettings);

    await expect(clearAllLocalBrowserData("account_deletion_submit", ignoreIndexedDbOpenRecoveryFailure)).resolves.toBeUndefined();

    expect(isAccountDeletionPending()).toBe(true);
    expect(loadAccountDeletionCsrfToken()).toBe("csrf-token");
    expect(isAccountDeletionServerConfirmed()).toBe(true);
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);

    setAccountDeletionPending(false);

    expect(isAccountDeletionPending()).toBe(false);
    expect(loadAccountDeletionCsrfToken()).toBeNull();
    expect(isAccountDeletionServerConfirmed()).toBe(false);
    expect(loadAccountDeletionAttemptId()).toBeNull();
    expect(hasAccountDeletionAttemptDispatched()).toBe(false);
  });

  it("preserves pending account deletion proof after ordinary IndexedDB cleanup failure", async () => {
    seedLocalBrowserState();
    setAccountDeletionPending(true);
    storeAccountDeletionCsrfToken("csrf-token");
    markAccountDeletionServerConfirmed();
    markAccountDeletionAttemptDispatched();
    await putCloudSettings(seededCloudSettings);
    mockOrdinaryIndexedDbOpenFailure();
    mockFailingDeleteDatabase();

    await expect(clearAllLocalBrowserData("account_deletion_submit", ignoreIndexedDbOpenRecoveryFailure)).rejects.toThrow("Failed to open IndexedDB");

    expect(isAccountDeletionPending()).toBe(true);
    expect(loadAccountDeletionCsrfToken()).toBe("csrf-token");
    expect(isAccountDeletionServerConfirmed()).toBe(true);
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);
  });

  it("preserves pending account deletion proof after canonical IndexedDB recovery", async () => {
    seedLocalBrowserState();
    setAccountDeletionPending(true);
    storeAccountDeletionCsrfToken("csrf-token");
    markAccountDeletionServerConfirmed();
    markAccountDeletionAttemptDispatched();
    await putCloudSettings(seededCloudSettings);
    mockUnavailableIndexedDbOpen();
    mockFailingDeleteDatabase();

    await expect(clearAllLocalBrowserData("account_deletion_submit", ignoreIndexedDbOpenRecoveryFailure)).rejects.toThrow("Failed to open IndexedDB");

    expect(isAccountDeletionPending()).toBe(true);
    expect(loadAccountDeletionCsrfToken()).toBe("csrf-token");
    expect(isAccountDeletionServerConfirmed()).toBe(true);
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);
  });

  it("does not infer server confirmation from a new pending deletion", () => {
    markAccountDeletionServerConfirmed();
    storeAccountDeletionCsrfToken("csrf-token");

    setAccountDeletionPending(true);

    expect(isAccountDeletionPending()).toBe(true);
    expect(loadAccountDeletionCsrfToken()).toBe("csrf-token");
    expect(isAccountDeletionServerConfirmed()).toBe(false);
  });

  it("resets and clears the dispatch claim with pending attempt lifecycle", () => {
    setAccountDeletionPending(true);
    const firstAttemptId = loadAccountDeletionAttemptId();
    markAccountDeletionAttemptDispatched();

    expect(firstAttemptId).not.toBeNull();
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);

    setAccountDeletionPending(true);

    expect(loadAccountDeletionAttemptId()).not.toBe(firstAttemptId);
    expect(hasAccountDeletionAttemptDispatched()).toBe(false);

    markAccountDeletionAttemptDispatched();
    setAccountDeletionPending(false);

    expect(loadAccountDeletionAttemptId()).toBeNull();
    expect(hasAccountDeletionAttemptDispatched()).toBe(false);
  });

  it("keeps server confirmation when the following recovery checkpoint throws", () => {
    setAccountDeletionPending(true);
    const recoveryError = new Error("IndexedDB recovery required");

    expect(() => {
      markAccountDeletionServerConfirmed();
      throw recoveryError;
    }).toThrow(recoveryError);

    expect(isAccountDeletionPending()).toBe(true);
    expect(isAccountDeletionServerConfirmed()).toBe(true);
  });

  it("prevents automatic waiters from dispatching after an ordinary owner failure", async () => {
    installSerialAccountDeletionLockMock();
    setAccountDeletionPending(true);
    let deleteRequestCount = 0;
    const recoveryController = new AbortController();
    const ordinaryDeleteError = new Error("Account deletion request failed");

    const completePendingDeletion = (): Promise<void> => runWithAccountDeletionLock(
      recoveryController.signal,
      async (): Promise<void> => {
        if (
          isAccountDeletionPending() === false
          || isAccountDeletionServerConfirmed()
          || hasAccountDeletionAttemptDispatched()
        ) {
          return;
        }

        markAccountDeletionAttemptDispatched();
        deleteRequestCount += 1;
        throw ordinaryDeleteError;
      },
    );

    const results = await Promise.allSettled([
      completePendingDeletion(),
      completePendingDeletion(),
      completePendingDeletion(),
    ]);

    expect(deleteRequestCount).toBe(1);
    expect(results[0]).toEqual({ status: "rejected", reason: ordinaryDeleteError });
    expect(results[1]).toEqual({ status: "fulfilled", value: undefined });
    expect(results[2]).toEqual({ status: "fulfilled", value: undefined });
    expect(isAccountDeletionPending()).toBe(true);
    expect(isAccountDeletionServerConfirmed()).toBe(false);
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);
  });

  it("collapses simultaneous explicit retries into one new dispatched attempt", async () => {
    installSerialAccountDeletionLockMock();
    setAccountDeletionPending(true);
    markAccountDeletionAttemptDispatched();
    let deleteRequestCount = 0;
    const recoveryController = new AbortController();

    const completePendingDeletion = (): Promise<void> => runWithAccountDeletionLock(
      recoveryController.signal,
      async (): Promise<void> => {
        if (
          isAccountDeletionPending() === false
          || isAccountDeletionServerConfirmed()
          || hasAccountDeletionAttemptDispatched()
        ) {
          return;
        }

        markAccountDeletionAttemptDispatched();
        deleteRequestCount += 1;
        markAccountDeletionServerConfirmed();
      },
    );
    const retryPendingDeletion = async (): Promise<void> => {
      const expectedAttemptId = loadAccountDeletionAttemptId();
      if (expectedAttemptId === null) {
        return;
      }

      const didBeginRetryAttempt = await runWithAccountDeletionLock(
        recoveryController.signal,
        async (): Promise<boolean> => beginAccountDeletionRetryAttempt(expectedAttemptId),
      );
      if (didBeginRetryAttempt) {
        await completePendingDeletion();
      }
    };

    await Promise.all([retryPendingDeletion(), retryPendingDeletion()]);

    expect(deleteRequestCount).toBe(1);
    expect(isAccountDeletionPending()).toBe(true);
    expect(isAccountDeletionServerConfirmed()).toBe(true);
    expect(hasAccountDeletionAttemptDispatched()).toBe(true);
  });

  it("treats the legacy auth reset marker as reauth required", () => {
    window.localStorage.setItem("flashcards-auth-reset-required", "1");

    expect(isBrowserReauthRequired()).toBe(true);
  });
});
