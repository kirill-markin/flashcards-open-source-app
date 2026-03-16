// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearAllLocalBrowserData } from "./accountDeletion";
import { DEVICE_ID_MAP_STORAGE_KEY, LEGACY_DEVICE_ID_STORAGE_KEY } from "./clientIdentity";

const { clearWebSyncCacheMock } = vi.hoisted(() => ({
  clearWebSyncCacheMock: vi.fn(),
}));

const localStorageState = new Map<string, string>();

vi.mock("./localDb/cache", () => ({
  clearWebSyncCache: clearWebSyncCacheMock,
}));

describe("accountDeletion", () => {
  beforeEach(() => {
    localStorageState.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem(key: string): string | null {
          return localStorageState.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          localStorageState.set(key, value);
        },
        removeItem(key: string): void {
          localStorageState.delete(key);
        },
        clear(): void {
          localStorageState.clear();
        },
      } satisfies Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear">,
    });
    clearWebSyncCacheMock.mockReset();
    clearWebSyncCacheMock.mockResolvedValue(undefined);
  });

  it("clears indexeddb and all app localStorage keys including user-scoped device ids", async () => {
    window.localStorage.setItem(LEGACY_DEVICE_ID_STORAGE_KEY, "legacy-device");
    window.localStorage.setItem(DEVICE_ID_MAP_STORAGE_KEY, JSON.stringify({ "user-1": "device-1" }));
    window.localStorage.setItem("selected-review-filter", "all");
    window.localStorage.setItem("flashcards-chat-open", "1");

    await clearAllLocalBrowserData();

    expect(clearWebSyncCacheMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEVICE_ID_MAP_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("selected-review-filter")).toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-open")).toBeNull();
  });
});
