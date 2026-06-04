// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAllLocalBrowserData,
  clearBrowserReauthRequired,
  isBrowserReauthRequired,
  markBrowserReauthRequired,
} from "./accountDeletion";
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
  window.localStorage.setItem(SYNC_RESTORE_HISTORY_STORAGE_KEY, JSON.stringify({
    version: 1,
    entries: [],
  }));
  window.localStorage.setItem("flashcards-auth-reset-required", "1");
  markBrowserReauthRequired();
}

function expectLocalBrowserStateCleared(): void {
  expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).toBeNull();
  expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
  expect(window.localStorage.getItem(SYNC_RESTORE_HISTORY_STORAGE_KEY)).toBeNull();
  expect(window.localStorage.getItem("flashcards-auth-reset-required")).toBeNull();
  expect(isBrowserReauthRequired()).toBe(false);
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
  clearBrowserReauthRequired();
  observabilityMocks.addWebBreadcrumbMock.mockReset();
});

afterEach(async () => {
  window.localStorage.clear();
  clearBrowserReauthRequired();
  vi.restoreAllMocks();
  await clearWebSyncCache();
});

describe("account deletion local cleanup helpers", () => {
  it("keeps the reauth guard when IndexedDB cleanup is blocked", async () => {
    seedLocalBrowserState();
    mockBlockedDeleteDatabase();

    await expect(clearAllLocalBrowserData("logout_marker")).rejects.toThrow("Failed to delete IndexedDB: delete request was blocked");
    expect(window.localStorage.getItem("flashcards-warm-start-snapshot")).toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
    expect(window.localStorage.getItem(SYNC_RESTORE_HISTORY_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("flashcards-browser-reauth-required")).toBe("1");
    expect(window.localStorage.getItem("flashcards-auth-reset-required")).toBe("1");
    expect(isBrowserReauthRequired()).toBe(true);
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("ar");
  });

  it("clears reauth markers and IndexedDB only during explicit local data cleanup", async () => {
    seedLocalBrowserState();
    await putCloudSettings(seededCloudSettings);

    await expect(clearAllLocalBrowserData("confirmed_account_switch")).resolves.toBeUndefined();

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

  it("treats the legacy auth reset marker as reauth required", () => {
    window.localStorage.setItem("flashcards-auth-reset-required", "1");

    expect(isBrowserReauthRequired()).toBe(true);
  });
});
