// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_ID_MAP_STORAGE_KEY,
  getStableDeviceIdForUser,
  LEGACY_DEVICE_ID_STORAGE_KEY,
} from "./clientIdentity";

const localStorageState = new Map<string, string>();

describe("clientIdentity", () => {
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
    vi.restoreAllMocks();
  });

  it("returns a stable device id for the same user", () => {
    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000001");

    expect(getStableDeviceIdForUser("user-1")).toBe("00000000-0000-4000-8000-000000000001");
    expect(getStableDeviceIdForUser("user-1")).toBe("00000000-0000-4000-8000-000000000001");
    expect(randomUuidSpy).toHaveBeenCalledTimes(1);
  });

  it("returns different device ids for different users in the same browser", () => {
    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002");

    expect(getStableDeviceIdForUser("user-1")).toBe("00000000-0000-4000-8000-000000000001");
    expect(getStableDeviceIdForUser("user-2")).toBe("00000000-0000-4000-8000-000000000002");
    expect(randomUuidSpy).toHaveBeenCalledTimes(2);
  });

  it("migrates the legacy global device id only into the active user entry", () => {
    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000002");
    window.localStorage.setItem(LEGACY_DEVICE_ID_STORAGE_KEY, "legacy-device");

    expect(getStableDeviceIdForUser("user-1")).toBe("legacy-device");
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEVICE_ID_MAP_STORAGE_KEY)).toBe(JSON.stringify({
      "user-1": "legacy-device",
    }));

    expect(getStableDeviceIdForUser("user-2")).toBe("00000000-0000-4000-8000-000000000002");
    expect(window.localStorage.getItem(DEVICE_ID_MAP_STORAGE_KEY)).toBe(JSON.stringify({
      "user-1": "legacy-device",
      "user-2": "00000000-0000-4000-8000-000000000002",
    }));
    expect(randomUuidSpy).toHaveBeenCalledTimes(1);
  });
});
