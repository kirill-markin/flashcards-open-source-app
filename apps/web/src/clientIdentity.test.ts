// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStableInstallationId,
  INSTALLATION_ID_STORAGE_KEY,
  LEGACY_DEVICE_ID_STORAGE_KEY,
} from "./clientIdentity";

const LEGACY_DEVICE_ID_MAP_STORAGE_KEY = "flashcards-sync-device-ids";

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

describe("client identity", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("returns the stored installation id and clears retired legacy keys", () => {
    window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, "installation-1");
    window.localStorage.setItem(LEGACY_DEVICE_ID_STORAGE_KEY, "legacy-device-1");
    window.localStorage.setItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY, JSON.stringify({
      "user-1": "legacy-map-1",
    }));

    expect(getStableInstallationId()).toBe("installation-1");
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY)).toBeNull();
  });

  it("migrates the first legacy mapped installation id before generating a new one", () => {
    window.localStorage.setItem(LEGACY_DEVICE_ID_STORAGE_KEY, "legacy-device-1");
    window.localStorage.setItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY, JSON.stringify({
      "user-1": "legacy-map-1",
      "user-2": "legacy-map-2",
    }));

    expect(getStableInstallationId()).toBe("legacy-map-1");
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("legacy-map-1");
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY)).toBeNull();
  });

  it("migrates the legacy device id when the legacy map is unavailable", () => {
    window.localStorage.setItem(LEGACY_DEVICE_ID_STORAGE_KEY, "legacy-device-1");

    expect(getStableInstallationId()).toBe("legacy-device-1");
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("legacy-device-1");
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY)).toBeNull();
  });

  it("creates a new installation id only when no stored or legacy id exists", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue("A0B1C2D3-E4F5-6789-ABCD-EF0123456789");

    expect(getStableInstallationId()).toBe("a0b1c2d3-e4f5-6789-abcd-ef0123456789");
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("a0b1c2d3-e4f5-6789-abcd-ef0123456789");
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(LEGACY_DEVICE_ID_MAP_STORAGE_KEY)).toBeNull();
  });
});
