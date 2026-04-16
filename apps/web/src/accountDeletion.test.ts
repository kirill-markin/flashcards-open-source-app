// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAuthResetRequired,
  clearAllLocalBrowserData,
  isAuthResetRequired,
  markAuthResetRequired,
  runPendingAuthResetCleanup,
} from "./accountDeletion";
import { INSTALLATION_ID_STORAGE_KEY } from "./clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "./i18n/runtime";
import { loadCloudSettings, putCloudSettings } from "./localDb/cloudSettings";
import { clearWebSyncCache } from "./localDb/cache";
import type { CloudSettings } from "./types";

const seededCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-10T00:00:00.000Z",
};

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
  window.localStorage.setItem("flashcards-warm-start-snapshot", JSON.stringify({
    version: 1,
  }));
  window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
    version: 1,
  }));
}

function expectLocalBrowserStateCleared(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
  expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
}

function mockBlockedDeleteDatabase(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => {
      request.onblocked?.(new Event("blocked"));
    });
    return request;
  });
}

beforeEach(async () => {
  await clearWebSyncCache();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
  clearAuthResetRequired();
});

afterEach(async () => {
  window.localStorage.clear();
  clearAuthResetRequired();
  vi.restoreAllMocks();
  await clearWebSyncCache();
});

describe("account deletion local cleanup helpers", () => {
  it("clears browser-local state before rethrowing a blocked IndexedDB deletion", async () => {
    seedLocalBrowserState();
    mockBlockedDeleteDatabase();

    await expect(clearAllLocalBrowserData()).rejects.toThrow("Failed to delete IndexedDB: delete request was blocked");
    expectLocalBrowserStateCleared();
  });

  it("completes a pending auth reset cleanup and clears the marker after full success", async () => {
    seedLocalBrowserState();
    await putCloudSettings(seededCloudSettings);
    markAuthResetRequired();

    await expect(runPendingAuthResetCleanup()).resolves.toEqual({
      completed: true,
      error: null,
    });

    expectLocalBrowserStateCleared();
    expect(isAuthResetRequired()).toBe(false);
    await expect(loadCloudSettings()).resolves.toBeNull();
  });

  it("preserves the pending auth reset marker when IndexedDB cleanup is blocked", async () => {
    seedLocalBrowserState();
    markAuthResetRequired();
    mockBlockedDeleteDatabase();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const cleanupResult = await runPendingAuthResetCleanup();

    expect(cleanupResult.completed).toBe(false);
    expect(cleanupResult.error?.message).toBe("Failed to delete IndexedDB: delete request was blocked");
    expectLocalBrowserStateCleared();
    expect(isAuthResetRequired()).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledWith("auth_reset_cleanup_deferred", {
      errorMessage: "Failed to delete IndexedDB: delete request was blocked",
    });
  });
});
