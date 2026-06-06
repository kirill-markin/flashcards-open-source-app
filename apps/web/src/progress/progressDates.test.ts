// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INSTALLATION_ID_STORAGE_KEY } from "../clientIdentity";
import type { WebWarningEvent } from "../observability/webObservability";

const progressTimezoneWarningHistoryStorageKey = "flashcards-progress-timezone-warning-history-v1";

const observabilityMocks = vi.hoisted(() => ({
  captureWebWarningMock: vi.fn(),
}));

vi.mock("../observability/webObservability", () => ({
  captureWebWarning: observabilityMocks.captureWebWarningMock,
}));

type ProgressDatesModule = typeof import("./progressDates");

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

async function loadProgressDatesModule(): Promise<ProgressDatesModule> {
  return await import("./progressDates");
}

function mockBrowserTimeZone(timeZone: string): void {
  const resolvedOptions = new Intl.DateTimeFormat().resolvedOptions();
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
    ...resolvedOptions,
    timeZone,
  });
}

function readCapturedWarning(callIndex: number): WebWarningEvent {
  const event = observabilityMocks.captureWebWarningMock.mock.calls[callIndex]?.[0] as WebWarningEvent | undefined;
  if (event === undefined) {
    throw new Error(`Expected captured warning at index ${callIndex}`);
  }

  return event;
}

describe("progress date context", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    vi.resetModules();
    window.localStorage.clear();
    observabilityMocks.captureWebWarningMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    observabilityMocks.captureWebWarningMock.mockReset();
  });

  it("falls back to UTC when the browser timezone is invalid", async () => {
    mockBrowserTimeZone("Etc/Unknown");
    const { buildProgressDateContext } = await loadProgressDatesModule();

    expect(buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"))).toEqual({
      timeZone: "UTC",
      today: "2026-06-04",
    });
  });

  it("emits progress_timezone_invalid for the first invalid timezone", async () => {
    mockBrowserTimeZone("Etc/Unknown");
    const { buildProgressDateContext } = await loadProgressDatesModule();

    buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"));

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledTimes(1);
    expect(readCapturedWarning(0)).toEqual(expect.objectContaining({
      action: "progress_timezone_invalid",
      details: {
        eventName: "progress_timezone_invalid",
        observedTimeZone: "Etc/Unknown",
        fallbackTimeZone: "UTC",
        errorName: "RangeError",
      },
    }));
  });

  it("does not emit a second invalid timezone warning within the throttle window after reload", async () => {
    mockBrowserTimeZone("Etc/Unknown");
    const firstModule = await loadProgressDatesModule();
    firstModule.buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"));

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(progressTimezoneWarningHistoryStorageKey)).not.toBeNull();

    observabilityMocks.captureWebWarningMock.mockReset();
    vi.resetModules();
    const secondModule = await loadProgressDatesModule();
    secondModule.buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"));

    expect(observabilityMocks.captureWebWarningMock).not.toHaveBeenCalled();
  });

  it("emits a new first warning after localStorage is cleared across reloads", async () => {
    mockBrowserTimeZone("Etc/Unknown");
    const firstModule = await loadProgressDatesModule();
    firstModule.buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"));

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledTimes(1);

    observabilityMocks.captureWebWarningMock.mockReset();
    vi.resetModules();
    window.localStorage.clear();
    const secondModule = await loadProgressDatesModule();
    secondModule.buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"));

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledTimes(1);
  });

  it("includes installationId in the warning scope when localStorage is available", async () => {
    window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, "installation-1");
    mockBrowserTimeZone("Etc/Unknown");
    const { buildProgressDateContext } = await loadProgressDatesModule();

    buildProgressDateContext(new Date("2026-06-04T12:00:00.000Z"));

    expect(readCapturedWarning(0)).toEqual(expect.objectContaining({
      scope: expect.objectContaining({
        userId: null,
        workspaceId: null,
        installationId: "installation-1",
      }),
    }));
  });
});
