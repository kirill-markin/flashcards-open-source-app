// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CloudSettings,
  ProgressReviewSchedule,
  ProgressScopeKey,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSummary,
  ProgressSummaryPayload,
  WorkspaceSummary,
} from "../../types";
import {
  invalidateLocalReviewSchedule,
  resetProgressInvalidationStateForTests,
  useProgressInvalidationRefresh,
  useProgressInvalidationState,
} from "./progressInvalidation";
import {
  buildProgressScopeKey,
  useProgressSource,
} from "./progressSource";
import {
  buildProgressDateContext,
  buildProgressSeriesInputForDateContext,
  buildProgressSummaryInputForDateContext,
} from "../../progress/progressDates";
import { buildProgressSummaryScopeKey } from "./progressScope";
import { resetProgressTimeContextStateForTests } from "./progressTimeContext";
import type { SessionVerificationState } from "../warmStart";

const {
  loadProgressSummaryMock,
  loadProgressSeriesMock,
  loadProgressReviewScheduleMock,
  hasPendingProgressReviewEventsMock,
  loadLocalProgressSummaryMock,
  loadLocalProgressDailyReviewsMock,
  loadPendingProgressDailyReviewsMock,
  hasCompleteLocalProgressReviewScheduleCoverageMock,
  hasPendingProgressReviewScheduleCardChangesMock,
  calculatePendingProgressReviewScheduleCardTotalDeltaMock,
  loadLocalProgressReviewScheduleMock,
} = vi.hoisted(() => ({
  loadProgressSummaryMock: vi.fn<(input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressSummaryPayload>>(),
  loadProgressSeriesMock: vi.fn<(input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ProgressSeries>>(),
  loadProgressReviewScheduleMock: vi.fn<(input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressReviewSchedule>>(),
  hasPendingProgressReviewEventsMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<boolean>>(),
  loadLocalProgressSummaryMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressSummary>>(),
  loadLocalProgressDailyReviewsMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ReadonlyArray<Readonly<{ date: string; reviewCount: number }>>>>(),
  loadPendingProgressDailyReviewsMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ReadonlyArray<Readonly<{ date: string; reviewCount: number }>>>>(),
  hasCompleteLocalProgressReviewScheduleCoverageMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<boolean>>(),
  hasPendingProgressReviewScheduleCardChangesMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<boolean>>(),
  calculatePendingProgressReviewScheduleCardTotalDeltaMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<number>>(),
  loadLocalProgressReviewScheduleMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressReviewSchedule>>(),
}));

vi.mock("../../api", () => ({
  loadProgressSummary: loadProgressSummaryMock,
  loadProgressSeries: loadProgressSeriesMock,
  loadProgressReviewSchedule: loadProgressReviewScheduleMock,
}));

vi.mock("../../localDb/progress", () => ({
  hasPendingProgressReviewEvents: hasPendingProgressReviewEventsMock,
  loadLocalProgressSummary: loadLocalProgressSummaryMock,
  loadLocalProgressDailyReviews: loadLocalProgressDailyReviewsMock,
  loadPendingProgressDailyReviews: loadPendingProgressDailyReviewsMock,
}));

vi.mock("../../localDb/reviewSchedule", () => ({
  calculatePendingProgressReviewScheduleCardTotalDelta: calculatePendingProgressReviewScheduleCardTotalDeltaMock,
  hasCompleteLocalProgressReviewScheduleCoverage: hasCompleteLocalProgressReviewScheduleCoverageMock,
  hasPendingProgressReviewScheduleCardChanges: hasPendingProgressReviewScheduleCardChangesMock,
  loadLocalProgressReviewSchedule: loadLocalProgressReviewScheduleMock,
}));

type ProgressSourceApi = ReturnType<typeof useProgressSource>;

type HarnessProps = Readonly<{
  sessionVerificationState: SessionVerificationState;
  cloudSettings: CloudSettings | null;
  progressServerInvalidationVersion: number;
  sections: Readonly<{
    includeSummary: boolean;
    includeSeries: boolean;
    includeReviewSchedule: boolean;
  }>;
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

const workspace: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Workspace",
  createdAt: "2026-04-10T00:00:00.000Z",
  isSelected: true,
};
const availableWorkspaces: ReadonlyArray<WorkspaceSummary> = [workspace];

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

const summaryAndSeriesSections = {
  includeSummary: true,
  includeSeries: true,
  includeReviewSchedule: false,
} as const;

const summaryOnlySections = {
  includeSummary: true,
  includeSeries: false,
  includeReviewSchedule: false,
} as const;
const seriesOnlySections = {
  includeSummary: false,
  includeSeries: true,
  includeReviewSchedule: false,
} as const;
const reviewScheduleOnlySections = {
  includeSummary: false,
  includeSeries: false,
  includeReviewSchedule: true,
} as const;
const summaryAndSeriesWithInvalidationSections = {
  includeSummary: true,
  includeSeries: true,
  includeReviewSchedule: false,
} as const;
const noProgressSections = {
  includeSummary: false,
  includeSeries: false,
  includeReviewSchedule: false,
} as const;

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
      availableWorkspaces,
      cloudSettings: currentProps.cloudSettings,
      sessionVerificationState: currentProps.sessionVerificationState,
      progressLocalVersion: 0,
      progressScheduleLocalVersion: 0,
      progressServerInvalidationVersion: currentProps.progressServerInvalidationVersion,
      sections: currentProps.sections,
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

function renderInvalidationHarness(props: HarnessProps): Readonly<{
  getApi: () => ProgressSourceApi;
}> {
  let latestApi: ProgressSourceApi | null = null;

  function Harness(currentProps: HarnessProps): null {
    useProgressInvalidationRefresh();
    const {
      progressLocalVersion,
      progressScheduleLocalVersion,
      progressServerInvalidationVersion,
    } = useProgressInvalidationState();
    latestApi = useProgressSource({
      activeWorkspace: workspace,
      availableWorkspaces,
      cloudSettings: currentProps.cloudSettings,
      sessionVerificationState: currentProps.sessionVerificationState,
      progressLocalVersion,
      progressScheduleLocalVersion,
      progressServerInvalidationVersion,
      sections: currentProps.sections,
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
        throw new Error("Expected invalidation progress source api to be available.");
      }

      return latestApi;
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
  const input: ProgressSeriesInput = buildCurrentSeriesInput();

  return {
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
    generatedAt,
    dailyReviews: [
      {
        date: input.to,
        reviewCount,
      },
    ],
  };
}

function buildServerReviewSchedule(newCount: number, generatedAt: string | null): ProgressReviewSchedule {
  return {
    timeZone: "Europe/Madrid",
    generatedAt,
    totalCards: newCount + 3,
    buckets: [
      { key: "new", count: newCount },
      { key: "today", count: 1 },
      { key: "days1To7", count: 1 },
      { key: "days8To30", count: 1 },
      { key: "days31To90", count: 0 },
      { key: "days91To360", count: 0 },
      { key: "years1To2", count: 0 },
      { key: "later", count: 0 },
    ],
  };
}

function replaceProgressReviewScheduleBucketCount(
  schedule: ProgressReviewSchedule,
  bucketIndex: number,
  count: number,
): ProgressReviewSchedule {
  return {
    ...schedule,
    buckets: schedule.buckets.map((bucket, index) => index === bucketIndex ? {
      ...bucket,
      count,
    } : bucket),
  };
}

function swapFirstProgressReviewScheduleBuckets(schedule: ProgressReviewSchedule): ProgressReviewSchedule {
  const firstBucket = schedule.buckets[0];
  const secondBucket = schedule.buckets[1];
  if (firstBucket === undefined || secondBucket === undefined) {
    throw new Error("Progress review schedule test fixture must include at least two buckets");
  }

  return {
    ...schedule,
    buckets: [
      secondBucket,
      firstBucket,
      ...schedule.buckets.slice(2),
    ],
  };
}

function buildCurrentProgressDateContext(): ReturnType<typeof buildProgressDateContext> {
  return buildProgressDateContext(new Date("2026-04-20T12:00:00.000Z"));
}

function buildCurrentSeriesInput(): ProgressSeriesInput {
  return buildProgressSeriesInputForDateContext(buildCurrentProgressDateContext());
}

function buildCurrentReviewScheduleInput(): Readonly<{ timeZone: string; today: string }> {
  return buildProgressSummaryInputForDateContext(buildCurrentProgressDateContext());
}

function buildCurrentSummaryScopeKey(): ProgressScopeKey {
  return buildProgressSummaryScopeKey(
    [workspace.workspaceId],
    buildProgressSummaryInputForDateContext(buildCurrentProgressDateContext()),
  );
}

function buildCurrentSeriesScopeKey(): ProgressScopeKey {
  return buildProgressScopeKey(
    [workspace.workspaceId],
    buildCurrentSeriesInput(),
  );
}

function buildCurrentReviewScheduleScopeKey(): ProgressScopeKey {
  return buildProgressSummaryScopeKey(
    [workspace.workspaceId],
    buildProgressSummaryInputForDateContext(buildCurrentProgressDateContext()),
  );
}

function storePersistedProgressSummaryForTest(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressSummaryPayload,
): void {
  window.localStorage.setItem(`flashcards-progress-server-summary:${scopeKey}`, JSON.stringify({
    version: 1,
    scopeKey,
    savedAt: "2026-04-18T09:00:00.000Z",
    serverBase,
  }));
}

function storePersistedProgressSeriesForTest(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressSeries,
): void {
  window.localStorage.setItem(`flashcards-progress-server-series:${scopeKey}`, JSON.stringify({
    version: 1,
    scopeKey,
    savedAt: "2026-04-18T09:00:00.000Z",
    serverBase,
  }));
}

function storePersistedProgressReviewScheduleForTest(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressReviewSchedule,
): void {
  window.localStorage.setItem(`flashcards-progress-server-review-schedule:${scopeKey}`, JSON.stringify({
    version: 1,
    scopeKey,
    savedAt: "2026-04-18T09:00:00.000Z",
    serverBase,
  }));
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
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  clearWindowLocalStorage();
  resetProgressInvalidationStateForTests();
  resetProgressTimeContextStateForTests(new Date("2026-04-20T12:00:00.000Z"));
  loadProgressSummaryMock.mockReset();
  loadProgressSeriesMock.mockReset();
  loadProgressReviewScheduleMock.mockReset();
  hasPendingProgressReviewEventsMock.mockReset();
  loadLocalProgressSummaryMock.mockReset();
  loadLocalProgressDailyReviewsMock.mockReset();
  loadPendingProgressDailyReviewsMock.mockReset();
  hasCompleteLocalProgressReviewScheduleCoverageMock.mockReset();
  hasPendingProgressReviewScheduleCardChangesMock.mockReset();
  calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockReset();
  loadLocalProgressReviewScheduleMock.mockReset();
  hasPendingProgressReviewEventsMock.mockResolvedValue(false);
  hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(false);
  hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(false);
  calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(0);
  loadLocalProgressSummaryMock.mockResolvedValue({
    currentStreakDays: 0,
    hasReviewedToday: false,
    lastReviewedOn: null,
    activeReviewDays: 0,
  });
  loadLocalProgressDailyReviewsMock.mockResolvedValue([]);
  loadPendingProgressDailyReviewsMock.mockResolvedValue([]);
  loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(0, null));
  loadProgressSummaryMock.mockResolvedValue(buildServerSummary(1, "2026-04-18T09:15:00.000Z"));
  loadProgressSeriesMock.mockResolvedValue(buildServerSeries(1, "2026-04-18T09:15:00.000Z"));
  loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, "2026-04-18T09:15:00.000Z"));
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  vi.useRealTimers();
  container?.remove();
  clearWindowLocalStorage();
  root = null;
  container = null;
  resetProgressInvalidationStateForTests();
  resetProgressTimeContextStateForTests(new Date("2026-04-20T12:00:00.000Z"));
});

describe("useProgressSource", () => {
  it("loads split server summary and series for linked verified sessions", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
    expect(harness.getApi().progressSourceState.summary.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 1,
    });
  });

  it("hydrates matching server cache before remote refresh completes", async () => {
    const cachedSummary = buildServerSummary(6, "2026-04-18T09:10:00.000Z");
    const cachedSeries = buildServerSeries(6, "2026-04-18T09:10:00.000Z");
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    storePersistedProgressSummaryForTest(buildCurrentSummaryScopeKey(), cachedSummary);
    storePersistedProgressSeriesForTest(buildCurrentSeriesScopeKey(), cachedSeries);
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.generatedAt).toBe("2026-04-18T09:10:00.000Z");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(6);
    expect(harness.getApi().progressSourceState.series.serverBase?.generatedAt).toBe("2026-04-18T09:10:00.000Z");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 6,
    });

    deferredSummary.resolve(buildServerSummary(7, "2026-04-18T09:11:00.000Z"));
    deferredSeries.resolve(buildServerSeries(7, "2026-04-18T09:11:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(7);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 7,
    });
  });

  it("treats corrupt and mismatched cache entries as misses", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    const summaryScopeKey = buildCurrentSummaryScopeKey();
    const seriesScopeKey = buildCurrentSeriesScopeKey();
    storePersistedProgressSummaryForTest("other-scope", buildServerSummary(6, "2026-04-18T09:10:00.000Z"));
    window.localStorage.setItem(`flashcards-progress-server-summary:${summaryScopeKey}`, window.localStorage.getItem("flashcards-progress-server-summary:other-scope") ?? "");
    window.localStorage.setItem(`flashcards-progress-server-series:${seriesScopeKey}`, "{not-json");
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.series.serverBase).toBeNull();
    expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
      reason: "scope_mismatch",
      section: "summary",
    }));
    expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
      reason: "invalid_json",
      section: "series",
    }));

    warningSpy.mockRestore();
  });

  it("treats malformed cached series dates as invalid-shape misses before loading remote series", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const currentSeriesInput = buildCurrentSeriesInput();
    const seriesScopeKey = buildCurrentSeriesScopeKey();
    const malformedCachedSeries = {
      version: 1,
      scopeKey: seriesScopeKey,
      savedAt: "2026-04-18T09:00:00.000Z",
      serverBase: {
        timeZone: currentSeriesInput.timeZone,
        from: "not-a-local-date",
        to: currentSeriesInput.to,
        generatedAt: "2026-04-18T09:10:00.000Z",
        dailyReviews: [
          {
            date: currentSeriesInput.to,
            reviewCount: 12,
          },
        ],
      },
    } as const;
    loadProgressSeriesMock.mockResolvedValueOnce(buildServerSeries(8, "2026-04-18T09:23:00.000Z"));
    window.localStorage.setItem(
      `flashcards-progress-server-series:${seriesScopeKey}`,
      JSON.stringify(malformedCachedSeries),
    );

    try {
      const harness = renderHarness({
        sessionVerificationState: "verified",
        cloudSettings: linkedCloudSettings,
        progressServerInvalidationVersion: 0,
        sections: seriesOnlySections,
      });

      await flushEffects();

      expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
        reason: "invalid_shape",
        section: "series",
      }));
      expect(loadProgressSeriesMock).toHaveBeenCalledWith(currentSeriesInput);
      expect(harness.getApi().progressSourceState.series.serverBase?.generatedAt).toBe("2026-04-18T09:23:00.000Z");
      expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
        date: currentSeriesInput.to,
        reviewCount: 8,
      });
    } finally {
      warningSpy.mockRestore();
    }
  });

  const invalidProgressReviewScheduleCacheCases: ReadonlyArray<Readonly<{
    name: string;
    serverBase: ProgressReviewSchedule;
  }>> = [
    {
      name: "negative bucket count",
      serverBase: replaceProgressReviewScheduleBucketCount(buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"), 0, -1),
    },
    {
      name: "fractional bucket count",
      serverBase: replaceProgressReviewScheduleBucketCount(buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"), 0, 1.5),
    },
    {
      name: "negative totalCards",
      serverBase: {
        ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
        totalCards: -1,
      },
    },
    {
      name: "fractional totalCards",
      serverBase: {
        ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
        totalCards: 7.5,
      },
    },
    {
      name: "totalCards mismatch",
      serverBase: {
        ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
        totalCards: 99,
      },
    },
    {
      name: "unstable bucket order",
      serverBase: swapFirstProgressReviewScheduleBuckets(buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z")),
    },
  ];

  for (const invalidCase of invalidProgressReviewScheduleCacheCases) {
    it(`treats cached review schedule with ${invalidCase.name} as an invalid-shape miss before loading remote schedule`, async () => {
      const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const deferredReviewSchedule = createDeferredPromise<ProgressReviewSchedule>();
      const reviewScheduleScopeKey = buildCurrentReviewScheduleScopeKey();
      storePersistedProgressReviewScheduleForTest(reviewScheduleScopeKey, invalidCase.serverBase);
      loadProgressReviewScheduleMock.mockImplementation(() => deferredReviewSchedule.promise);

      try {
        const harness = renderHarness({
          sessionVerificationState: "verified",
          cloudSettings: linkedCloudSettings,
          progressServerInvalidationVersion: 0,
          sections: reviewScheduleOnlySections,
        });

        await flushEffects();

        expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
          reason: "invalid_shape",
          section: "review_schedule",
        }));
        expect(loadProgressReviewScheduleMock).toHaveBeenCalledWith(buildCurrentReviewScheduleInput());
        expect(harness.getApi().progressSourceState.reviewSchedule.serverBase).toBeNull();

        deferredReviewSchedule.resolve(buildServerReviewSchedule(8, "2026-04-18T09:24:00.000Z"));
        await flushEffects();

        expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.generatedAt).toBe("2026-04-18T09:24:00.000Z");
        expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(8);
      } finally {
        warningSpy.mockRestore();
      }
    });
  }

  it("treats cached review schedules for another timezone as misses before loading remote schedule", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const deferredReviewSchedule = createDeferredPromise<ProgressReviewSchedule>();
    const reviewScheduleScopeKey = buildCurrentReviewScheduleScopeKey();
    storePersistedProgressReviewScheduleForTest(reviewScheduleScopeKey, {
      ...buildServerReviewSchedule(4, "2026-04-18T09:10:00.000Z"),
      timeZone: "UTC",
    });
    loadProgressReviewScheduleMock.mockImplementation(() => deferredReviewSchedule.promise);

    try {
      const harness = renderHarness({
        sessionVerificationState: "verified",
        cloudSettings: linkedCloudSettings,
        progressServerInvalidationVersion: 0,
        sections: reviewScheduleOnlySections,
      });

      await flushEffects();

      expect(warningSpy).toHaveBeenCalledWith("progress_cache_miss", expect.objectContaining({
        reason: "time_zone_mismatch",
        section: "review_schedule",
      }));
      expect(harness.getApi().progressSourceState.reviewSchedule.serverBase).toBeNull();

      deferredReviewSchedule.resolve(buildServerReviewSchedule(8, "2026-04-18T09:24:00.000Z"));
      await flushEffects();

      expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.timeZone).toBe("Europe/Madrid");
      expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(8);
    } finally {
      warningSpy.mockRestore();
    }
  });

  it("keeps linking-ready sessions local-only and skips both remote progress endpoints", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkingReadyCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).not.toHaveBeenCalled();
    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.summary.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.series.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("local_only");
  });

  it("loads review schedule independently and renders local counts when pending totals reconcile with server", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(5);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(7, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, "2026-04-18T09:18:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).not.toHaveBeenCalled();
    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(loadLocalProgressReviewScheduleMock).toHaveBeenCalledWith(
      [workspace.workspaceId],
      buildCurrentReviewScheduleInput(),
    );
    expect(calculatePendingProgressReviewScheduleCardTotalDeltaMock).toHaveBeenCalledWith([workspace.workspaceId]);
    expect(loadProgressReviewScheduleMock).toHaveBeenCalledWith(buildCurrentReviewScheduleInput());
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(2);
    expect(harness.getApi().progressSourceState.reviewSchedule.pendingLocalCardTotalDelta).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(7);
  });

  it("keeps user-wide server review schedule totals when covered local workspaces are only partial", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(0);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(8, "2026-04-18T09:18:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasCompleteLocalCardState).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.pendingLocalCardTotalDelta).toBe(0);
    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(11);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(8);
  });

  it("keeps server review schedule totals while pending card hot-state coverage is partial", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(false);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(7, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, "2026-04-18T09:18:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(loadLocalProgressReviewScheduleMock).toHaveBeenCalledWith(
      [workspace.workspaceId],
      buildCurrentReviewScheduleInput(),
    );
    expect(hasCompleteLocalProgressReviewScheduleCoverageMock).toHaveBeenCalledWith([workspace.workspaceId]);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasCompleteLocalCardState).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.buckets[0]?.count).toBe(7);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.buckets[0]?.count).toBe(2);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(2);
  });

  it("keeps local review schedule fallback when server schedule is unavailable", async () => {
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(false);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(7, null));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkingReadyCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(loadProgressReviewScheduleMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.buckets[0]?.count).toBe(7);
  });

  it("keeps complete local review schedule rendered after pending sync clears before server refresh succeeds", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(4);

    const firstRefresh = createDeferredPromise<ProgressReviewSchedule>();
    const secondRefresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock
      .mockImplementationOnce(() => firstRefresh.promise)
      .mockImplementationOnce(() => secondRefresh.promise);
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(1);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(loadProgressReviewScheduleMock).toHaveBeenCalledTimes(1);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);

    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(false);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(0);

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.pendingLocalCardTotalDelta).toBe(0);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    firstRefresh.reject(new Error("Stale review schedule refresh failed"));
    await flushEffects();

    expect(loadProgressReviewScheduleMock).toHaveBeenCalledTimes(2);

    secondRefresh.reject(new Error("Latest review schedule refresh failed"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.errorMessage).toBe("Latest review schedule refresh failed");
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
  });

  it("keeps local review schedule after ack when the previous server refresh completed during pending changes", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    const pendingRefresh = createDeferredPromise<ProgressReviewSchedule>();
    const ackRefresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock
      .mockImplementationOnce(() => pendingRefresh.promise)
      .mockImplementationOnce(() => ackRefresh.promise);
    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(true);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(1);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    pendingRefresh.resolve(buildServerReviewSchedule(1, "2026-04-18T09:19:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    hasPendingProgressReviewScheduleCardChangesMock.mockResolvedValue(false);
    calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockResolvedValue(0);

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(loadProgressReviewScheduleMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    ackRefresh.resolve(buildServerReviewSchedule(2, "2026-04-18T09:20:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
  });

  it("keeps complete local review schedule after pull invalidation when the server refresh fails", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(4);

    const refresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock.mockImplementation(() => refresh.promise);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.hasPendingLocalCardChanges).toBe(false);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);

    refresh.reject(new Error("Pulled review schedule refresh failed"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.errorMessage).toBe("Pulled review schedule refresh failed");
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(5);
  });

  it("keeps stale server review schedule when local totals never reconciled with server totals", async () => {
    hasCompleteLocalProgressReviewScheduleCoverageMock.mockResolvedValue(true);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(1, null));
    loadProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(8, "2026-04-18T09:18:00.000Z"));

    const harness = renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: reviewScheduleOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.totalCards).toBe(4);
    expect(harness.getApi().progressSourceState.reviewSchedule.serverBase?.totalCards).toBe(11);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);

    const refresh = createDeferredPromise<ProgressReviewSchedule>();
    loadProgressReviewScheduleMock.mockReset();
    loadProgressReviewScheduleMock.mockImplementation(() => refresh.promise);
    loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(2, null));

    act(() => {
      invalidateLocalReviewSchedule();
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.localFallback?.totalCards).toBe(5);
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);

    refresh.reject(new Error("Review schedule refresh failed"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.reviewSchedule.errorMessage).toBe("Review schedule refresh failed");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.reviewSchedule.renderedSnapshot?.totalCards).toBe(11);
  });

  it("keeps local progress visible when server eligibility turns off during an in-flight refresh", async () => {
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);
    loadLocalProgressSummaryMock.mockResolvedValue({
      currentStreakDays: 3,
      hasReviewedToday: true,
      lastReviewedOn: currentSeriesInput.to,
      activeReviewDays: 4,
    });
    loadLocalProgressDailyReviewsMock.mockResolvedValue([
      {
        date: currentSeriesInput.to,
        reviewCount: 2,
      },
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
    expect(harness.getApi().progressSourceState.summary.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.series.isLoading).toBe(false);

    harness.rerender({
      sessionVerificationState: "verified",
      cloudSettings: linkingReadyCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
    expect(loadLocalProgressSummaryMock).toHaveBeenCalledTimes(2);
    expect(loadLocalProgressDailyReviewsMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.summary.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.series.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(4);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 2,
    });

    deferredSummary.resolve(buildServerSummary(9, "2026-04-18T09:19:00.000Z"));
    deferredSeries.resolve(buildServerSeries(9, "2026-04-18T09:19:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.series.serverBase).toBeNull();
    expect(harness.getApi().progressSourceState.summary.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.series.isLoading).toBe(false);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(4);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 2,
    });
  });

  it("ignores server responses after sections disable their scopes", async () => {
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    const deferredSeries = createDeferredPromise<ProgressSeries>();
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockImplementation(() => deferredSeries.promise);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    harness.rerender({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: noProgressSections,
    });

    deferredSummary.resolve(buildServerSummary(9, "2026-04-18T09:19:00.000Z"));
    deferredSeries.resolve(buildServerSeries(9, "2026-04-18T09:19:00.000Z"));
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      hasPendingLocalReviews: false,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
    expect(harness.getApi().progressSourceState.series).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      pendingLocalOverlay: null,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
    expect(harness.getApi().progressSourceState.reviewSchedule).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      progressScheduleLocalVersion: 0,
      serverBaseProgressScheduleLocalVersion: null,
      serverBaseLocalCardTotalDelta: 0,
      hasPendingLocalCardChanges: false,
      hasCompleteLocalCardState: false,
      pendingLocalCardTotalDelta: 0,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
  });

  it("updates summary and series independently when remote responses arrive in different orders", async () => {
    const deferredSummary = createDeferredPromise<ProgressSummaryPayload>();
    loadProgressSummaryMock.mockImplementation(() => deferredSummary.promise);
    loadProgressSeriesMock.mockResolvedValueOnce(buildServerSeries(3, "2026-04-18T09:16:00.000Z"));

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.serverBase?.generatedAt).toBe("2026-04-18T09:16:00.000Z");
    expect(harness.getApi().progressSourceState.summary.serverBase?.generatedAt).not.toBe("2026-04-18T09:17:00.000Z");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
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
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.serverBase?.source).toBe("server");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.source).toBe("local_only");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(8);
  });

  it("renders server series with pending local review overlay as approximate", async () => {
    const currentSeriesInput = buildCurrentSeriesInput();
    loadProgressSeriesMock.mockResolvedValue(buildServerSeries(4, "2026-04-18T09:18:00.000Z"));
    loadPendingProgressDailyReviewsMock.mockResolvedValue([
      {
        date: currentSeriesInput.to,
        reviewCount: 3,
      },
    ]);

    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: seriesOnlySections,
    });

    await flushEffects();

    expect(harness.getApi().progressSourceState.series.serverBase?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 4,
    });
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.source).toBe("server");
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.isApproximate).toBe(true);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 7,
    });
  });

  it("supports summary-only ownership without loading the progress series pipeline", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryOnlySections,
    });

    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadLocalProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(hasPendingProgressReviewEventsMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).not.toHaveBeenCalled();
    expect(loadLocalProgressDailyReviewsMock).not.toHaveBeenCalled();
    expect(loadPendingProgressDailyReviewsMock).not.toHaveBeenCalled();
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);
    expect(harness.getApi().progressSourceState.series).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      pendingLocalOverlay: null,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
    expect(harness.getApi().progressSourceState.reviewSchedule).toEqual({
      scopeKey: null,
      localFallback: null,
      serverBase: null,
      progressScheduleLocalVersion: 0,
      serverBaseProgressScheduleLocalVersion: null,
      serverBaseLocalCardTotalDelta: 0,
      hasPendingLocalCardChanges: false,
      hasCompleteLocalCardState: false,
      pendingLocalCardTotalDelta: 0,
      renderedSnapshot: null,
      isLoading: false,
      errorMessage: "",
    });
  });

  it("coalesces rapid manual refreshes without rendering or caching stale responses", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    const firstSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const secondSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const firstSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const secondSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const refreshPromises: Array<Promise<void>> = [];
    const currentSeriesInput = buildCurrentSeriesInput();
    const summaryCacheKey = `flashcards-progress-server-summary:${buildCurrentSummaryScopeKey()}`;
    const seriesCacheKey = `flashcards-progress-server-series:${buildCurrentSeriesScopeKey()}`;
    loadProgressSummaryMock.mockClear();
    loadProgressSeriesMock.mockClear();
    loadProgressSummaryMock
      .mockImplementationOnce(() => firstSummaryRefresh.promise)
      .mockImplementationOnce(() => secondSummaryRefresh.promise);
    loadProgressSeriesMock
      .mockImplementationOnce(() => firstSeriesRefresh.promise)
      .mockImplementationOnce(() => secondSeriesRefresh.promise);

    act(() => {
      refreshPromises.push(harness.getApi().refreshProgress());
      refreshPromises.push(harness.getApi().refreshProgress());
    });
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);

    firstSummaryRefresh.resolve(buildServerSummary(2, "2026-04-18T09:20:00.000Z"));
    firstSeriesRefresh.resolve(buildServerSeries(2, "2026-04-18T09:20:00.000Z"));
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(2);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 1,
    });
    expect(window.localStorage.getItem(summaryCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");
    expect(window.localStorage.getItem(seriesCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");

    secondSummaryRefresh.resolve(buildServerSummary(9, "2026-04-18T09:21:00.000Z"));
    secondSeriesRefresh.resolve(buildServerSeries(9, "2026-04-18T09:21:00.000Z"));
    await act(async () => {
      await Promise.all(refreshPromises);
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(9);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: currentSeriesInput.to,
      reviewCount: 9,
    });
    expect(window.localStorage.getItem(summaryCacheKey)).toContain("2026-04-18T09:21:00.000Z");
    expect(window.localStorage.getItem(summaryCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");
    expect(window.localStorage.getItem(seriesCacheKey)).toContain("2026-04-18T09:21:00.000Z");
    expect(window.localStorage.getItem(seriesCacheKey)).not.toContain("2026-04-18T09:20:00.000Z");
  });

  it("ignores stale manual refresh errors while continuing to latest progress responses", async () => {
    const harness = renderHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesSections,
    });

    await flushEffects();

    const firstSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const secondSummaryRefresh = createDeferredPromise<ProgressSummaryPayload>();
    const firstSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const secondSeriesRefresh = createDeferredPromise<ProgressSeries>();
    const refreshPromises: Array<Promise<void>> = [];
    loadProgressSummaryMock.mockClear();
    loadProgressSeriesMock.mockClear();
    loadProgressSummaryMock
      .mockImplementationOnce(() => firstSummaryRefresh.promise)
      .mockImplementationOnce(() => secondSummaryRefresh.promise);
    loadProgressSeriesMock
      .mockImplementationOnce(() => firstSeriesRefresh.promise)
      .mockImplementationOnce(() => secondSeriesRefresh.promise);

    act(() => {
      refreshPromises.push(harness.getApi().refreshProgress());
      refreshPromises.push(harness.getApi().refreshProgress());
    });
    await flushEffects();

    firstSummaryRefresh.reject(new Error("Stale summary failure"));
    firstSeriesRefresh.reject(new Error("Stale series failure"));
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(2);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(2);
    expect(harness.getApi().progressSourceState.summary.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.series.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(1);

    secondSummaryRefresh.resolve(buildServerSummary(5, "2026-04-18T09:22:00.000Z"));
    secondSeriesRefresh.resolve(buildServerSeries(5, "2026-04-18T09:22:00.000Z"));
    await act(async () => {
      await Promise.all(refreshPromises);
    });
    await flushEffects();

    expect(harness.getApi().progressSourceState.summary.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.series.errorMessage).toBe("");
    expect(harness.getApi().progressSourceState.summary.renderedSnapshot?.summary.activeReviewDays).toBe(5);
    expect(harness.getApi().progressSourceState.series.renderedSnapshot?.dailyReviews).toContainEqual({
      date: buildCurrentSeriesInput().to,
      reviewCount: 5,
    });
  });

  it("refreshes only once per endpoint when the local day rolls over", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));

    renderInvalidationHarness({
      sessionVerificationState: "verified",
      cloudSettings: linkedCloudSettings,
      progressServerInvalidationVersion: 0,
      sections: summaryAndSeriesWithInvalidationSections,
    });

    await flushEffects();

    loadProgressSummaryMock.mockClear();
    loadProgressSeriesMock.mockClear();

    act(() => {
      vi.setSystemTime(new Date("2026-04-21T12:00:00.000Z"));
      vi.advanceTimersByTime(60_000);
    });
    await flushEffects();

    expect(loadProgressSummaryMock).toHaveBeenCalledTimes(1);
    expect(loadProgressSeriesMock).toHaveBeenCalledTimes(1);
  });
});
