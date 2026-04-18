// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudSettings,
  ProgressSeries,
  ProgressSummary,
  ProgressSummaryPayload,
  WorkspaceSummary,
} from "../types";
import { useProgressSource } from "./progressSource";
import type { SessionVerificationState } from "./warmStart";

const {
  loadProgressSummaryMock,
  loadProgressSeriesMock,
  hasPendingProgressReviewEventsMock,
  loadLocalProgressSummaryMock,
  loadLocalProgressDailyReviewsMock,
  loadPendingProgressDailyReviewsMock,
} = vi.hoisted(() => ({
  loadProgressSummaryMock: vi.fn<(input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressSummaryPayload>>(),
  loadProgressSeriesMock: vi.fn<(input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ProgressSeries>>(),
  hasPendingProgressReviewEventsMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<boolean>>(),
  loadLocalProgressSummaryMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressSummary>>(),
  loadLocalProgressDailyReviewsMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ReadonlyArray<Readonly<{ date: string; reviewCount: number }>>>>(),
  loadPendingProgressDailyReviewsMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ReadonlyArray<Readonly<{ date: string; reviewCount: number }>>>>(),
}));

vi.mock("../api", () => ({
  loadProgressSummary: loadProgressSummaryMock,
  loadProgressSeries: loadProgressSeriesMock,
}));

vi.mock("../localDb/progress", () => ({
  hasPendingProgressReviewEvents: hasPendingProgressReviewEventsMock,
  loadLocalProgressSummary: loadLocalProgressSummaryMock,
  loadLocalProgressDailyReviews: loadLocalProgressDailyReviewsMock,
  loadPendingProgressDailyReviews: loadPendingProgressDailyReviewsMock,
}));

type ProgressSourceApi = ReturnType<typeof useProgressSource>;

type HarnessProps = Readonly<{
  sessionVerificationState: SessionVerificationState;
  cloudSettings: CloudSettings | null;
  progressServerInvalidationVersion: number;
}>;

type DeferredPromise<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}>;

type LocalStorageWithOptionalClear = Storage & Record<string, unknown> & Readonly<{
  clear?: () => void;
  removeItem?: (key: string) => void;
}>;

const workspace: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Workspace",
  createdAt: "2026-04-10T00:00:00.000Z",
  isSelected: true,
};

const linkedCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-18T09:15:00.000Z",
};

const linkingReadyCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linking-ready",
  linkedUserId: "user-1",
  linkedWorkspaceId: null,
  linkedEmail: "user@example.com",
  onboardingCompleted: false,
  updatedAt: "2026-04-18T09:15:00.000Z",
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderHarness(props: HarnessProps): Readonly<{
  getApi: () => ProgressSourceApi;
  rerender: (nextProps: HarnessProps) => void;
}> {
  let latestApi: ProgressSourceApi | null = null;

  function Harness(currentProps: HarnessProps): null {
    latestApi = useProgressSource({
      activeWorkspace: workspace,
      availableWorkspaces: [workspace],
      cloudSettings: currentProps.cloudSettings,
      sessionVerificationState: currentProps.sessionVerificationState,
      progressLocalVersion: 0,
      progressServerInvalidationVersion: currentProps.progressServerInvalidationVersion,
    });
    return null;
  }

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Harness {...props} />);
  });

  return {
    getApi(): ProgressSourceApi {
      if (latestApi === null) {
        throw new Error("Expected progress source api to be available.");
      }

      return latestApi;
    },
    rerender(nextProps: HarnessProps): void {
      act(() => {
        root?.render(<Harness {...nextProps} />);
      });
    },
  };
}

function createDeferredPromise<T>(): DeferredPromise<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  let rejectPromise: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  if (resolvePromise === null || rejectPromise === null) {
    throw new Error("Failed to create deferred promise.");
  }

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function buildServerSummary(activeReviewDays: number, generatedAt: string): ProgressSummaryPayload {
  return {
    timeZone: "Europe/Madrid",
    generatedAt,
    summary: {
      currentStreakDays: activeReviewDays,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-18",
      activeReviewDays,
    },
  };
}

function buildServerSeries(reviewCount: number, generatedAt: string): ProgressSeries {
  return {
    timeZone: "Europe/Madrid",
    from: "2026-04-01",
    to: "2026-04-03",
    generatedAt,
    dailyReviews: [
      {
        date: "2026-04-03",
        reviewCount,
      },
    ],
  };
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function clearWindowLocalStorage(): void {
  const storage = window.localStorage as LocalStorageWithOptionalClear;

  if (typeof storage.clear === "function") {
    storage.clear();
    return;
  }

  if (typeof storage.removeItem === "function") {
    for (const key of Object.keys(storage)) {
      storage.removeItem(key);
    }
    return;
  }

  for (const key of Object.keys(storage)) {
    delete storage[key];
  }
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearWindowLocalStorage();
  loadProgressSummaryMock.mockReset();
  loadProgressSeriesMock.mockReset();
  hasPendingProgressReviewEventsMock.mockReset();
  loadLocalProgressSummaryMock.mockReset();
  loadLocalProgressDailyReviewsMock.mockReset();
  loadPendingProgressDailyReviewsMock.mockReset();
  hasPendingProgressReviewEventsMock.mockResolvedValue(false);
  loadLocalProgressSummaryMock.mockResolvedValue({
    currentStreakDays: 0,
    hasReviewedToday: false,
    lastReviewedOn: null,
    activeReviewDays: 0,
  });
  loadLocalProgressDailyReviewsMock.mockResolvedValue([]);
  loadPendingProgressDailyReviewsMock.mockResolvedValue([]);
  loadProgressSummaryMock.mockResolvedValue(buildServerSummary(1, "2026-04-18T09:15:00.000Z"));
  loadProgressSeriesMock.mockResolvedValue(buildServerSeries(1, "2026-04-18T09:15:00.000Z"));
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  clearWindowLocalStorage();
  root = null;
  container = null;
});

describe("useProgressSource", () => {
  it("loads split server summary and series for linked verified sessions", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
    expect(harness.getApi().progressSourceState.summary.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: "2026-04-03",
      reviewCount: 1,
    });
  });

  it("keeps linking-ready sessions local-only and skips both remote progress endpoints", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkingReadyCloudSettings,
      progressServerInvalidationVersion: 0,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).not.toHaveBeenCalled();
    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.summary.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.series.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("local_only");
  });

  it("updates summary and series independently when remote responses arrive in different orders", async () => {
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockResolvedValueOnce(buildServerSeries(3, "2026-04-18T09:16:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.serverBase?.generatedAt).toBe("2026-04-18T09:16:00.000Z");
    expect(harness.getApi().progressSourceState.summary.serverBase?.generatedAt).not.toBe("2026-04-18T09:17:00.000Z");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: "2026-04-03",
      reviewCount: 3,
    });

    deferredSummary.resolve(buildServerSummary(4, "2026-04-18T09:17:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.generatedAt).toBe("2026-04-18T09:17:00.000Z");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(4);
  });

  it("keeps rendered summary local when pending review uploads make the server summary stale", async () => {
    hasPendingProgressReviewEventsMock.mockResolvedValue(true);
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 2,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-18",
      activeReviewDays: 8,
    });

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(8);
  });
});
