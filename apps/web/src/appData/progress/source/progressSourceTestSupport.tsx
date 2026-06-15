import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import type {
  CloudSettings,
  DailyReviewPoint,
  ProgressLeaderboard,
  ProgressLeaderboardLocalViewerCounts,
  ProgressReviewSchedule,
  ProgressScopeKey,
  ProgressSeries,
  ProgressSeriesInput,
  ProgressSummary,
  ProgressSummaryPayload,
  WorkspaceSummary,
} from "../../../types";
import {
  resetProgressInvalidationStateForTests,
  useProgressInvalidationRefresh,
  useProgressInvalidationState,
} from "../invalidation/progressInvalidation";
import {
  buildProgressScopeKey,
  useProgressSource,
} from "../progressSource";
import {
  buildProgressDateContext,
  buildProgressSeriesInputForDateContext,
  buildProgressSummaryInputForDateContext,
} from "../../../progress/progressDates";
import {
  buildProgressLeaderboardScopeKey,
  buildProgressSummaryScopeKey,
} from "../state/progressScope";
import { resetProgressTimeContextStateForTests } from "../time/progressTimeContext";
import type { SessionVerificationState } from "../../session/workspaceSessionTypes";

const progressSourceMocks = vi.hoisted(() => ({
  loadProgressSummaryMock: vi.fn<(input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressSummaryPayload>>(),
  loadProgressSeriesMock: vi.fn<(input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ProgressSeries>>(),
  loadProgressReviewScheduleMock: vi.fn<(input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressReviewSchedule>>(),
  loadProgressLeaderboardMock: vi.fn<() => Promise<ProgressLeaderboard>>(),
  loadLocalLeaderboardViewerCountsMock: vi.fn<(workspaceIds: ReadonlyArray<string>, now: Date) => Promise<ProgressLeaderboardLocalViewerCounts>>(),
  hasPendingProgressReviewEventsMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<boolean>>(),
  loadLocalProgressActiveDatesMock: vi.fn<(workspaceIds: ReadonlyArray<string>, timeZone: string) => Promise<ReadonlyArray<string>>>(),
  loadLocalProgressSummaryMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressSummary>>(),
  loadLocalProgressDailyReviewsMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ReadonlyArray<DailyReviewPoint>>>(),
  loadPendingProgressDailyReviewsMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; from: string; to: string }>) => Promise<ReadonlyArray<DailyReviewPoint>>>(),
  hasCompleteLocalProgressReviewScheduleCoverageMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<boolean>>(),
  hasPendingProgressReviewScheduleCardChangesMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<boolean>>(),
  calculatePendingProgressReviewScheduleCardTotalDeltaMock: vi.fn<(workspaceIds: ReadonlyArray<string>) => Promise<number>>(),
  loadLocalProgressReviewScheduleMock: vi.fn<(workspaceIds: ReadonlyArray<string>, input: Readonly<{ timeZone: string; today: string }>) => Promise<ProgressReviewSchedule>>(),
  addWebBreadcrumbMock: vi.fn(),
  captureWebExceptionMock: vi.fn(),
  captureWebWarningMock: vi.fn(),
  setWebObservabilityUserMock: vi.fn(),
}));

const {
  loadProgressSummaryMock,
  loadProgressSeriesMock,
  loadProgressReviewScheduleMock,
  loadProgressLeaderboardMock,
  loadLocalLeaderboardViewerCountsMock,
  hasPendingProgressReviewEventsMock,
  loadLocalProgressActiveDatesMock,
  loadLocalProgressSummaryMock,
  loadLocalProgressDailyReviewsMock,
  loadPendingProgressDailyReviewsMock,
  hasCompleteLocalProgressReviewScheduleCoverageMock,
  hasPendingProgressReviewScheduleCardChangesMock,
  calculatePendingProgressReviewScheduleCardTotalDeltaMock,
  loadLocalProgressReviewScheduleMock,
  addWebBreadcrumbMock,
  captureWebExceptionMock,
  captureWebWarningMock,
  setWebObservabilityUserMock,
} = progressSourceMocks;

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api")>();

  return {
    ApiContractError: actual.ApiContractError,
    ApiNetworkError: actual.ApiNetworkError,
    loadProgressSummary: progressSourceMocks.loadProgressSummaryMock,
    loadProgressSeries: progressSourceMocks.loadProgressSeriesMock,
    loadProgressReviewSchedule: progressSourceMocks.loadProgressReviewScheduleMock,
    loadProgressLeaderboard: progressSourceMocks.loadProgressLeaderboardMock,
  };
});

vi.mock("../../../observability/webObservability", () => ({
  addWebBreadcrumb: progressSourceMocks.addWebBreadcrumbMock,
  captureWebException: progressSourceMocks.captureWebExceptionMock,
  captureWebWarning: progressSourceMocks.captureWebWarningMock,
  normalizeCaughtError: (error: unknown): Error => error instanceof Error ? error : new Error(`Caught non-Error value of type ${typeof error}`),
  setWebObservabilityUser: progressSourceMocks.setWebObservabilityUserMock,
}));

vi.mock("../../../localDb/progress/progress", () => ({
  hasPendingProgressReviewEvents: progressSourceMocks.hasPendingProgressReviewEventsMock,
  loadLocalLeaderboardViewerCounts: progressSourceMocks.loadLocalLeaderboardViewerCountsMock,
  loadLocalProgressActiveDates: progressSourceMocks.loadLocalProgressActiveDatesMock,
  loadLocalProgressSummary: progressSourceMocks.loadLocalProgressSummaryMock,
  loadLocalProgressDailyReviews: progressSourceMocks.loadLocalProgressDailyReviewsMock,
  loadPendingProgressDailyReviews: progressSourceMocks.loadPendingProgressDailyReviewsMock,
}));

vi.mock("../../../localDb/reviews/reviewSchedule", () => ({
  calculatePendingProgressReviewScheduleCardTotalDelta: progressSourceMocks.calculatePendingProgressReviewScheduleCardTotalDeltaMock,
  hasCompleteLocalProgressReviewScheduleCoverage: progressSourceMocks.hasCompleteLocalProgressReviewScheduleCoverageMock,
  hasPendingProgressReviewScheduleCardChanges: progressSourceMocks.hasPendingProgressReviewScheduleCardChangesMock,
  loadLocalProgressReviewSchedule: progressSourceMocks.loadLocalProgressReviewScheduleMock,
}));

export type ProgressSourceApi = ReturnType<typeof useProgressSource>;

export type HarnessProps = Readonly<{
  sessionVerificationState: SessionVerificationState;
  cloudSettings: CloudSettings | null;
  progressServerInvalidationVersion: number;
  sections: Readonly<{
    includeSummary: boolean;
    includeSeries: boolean;
    includeReviewSchedule: boolean;
    includeLeaderboard: boolean;
  }>;
}>;

export type DeferredPromise<T> = Readonly<{
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

export const workspace: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Workspace",
  createdAt: "2026-04-10T00:00:00.000Z",
  isSelected: true,
};

const availableWorkspaces: ReadonlyArray<WorkspaceSummary> = [workspace];

export const linkedCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-18T09:15:00.000Z",
};

export const linkingReadyCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linking-ready",
  linkedUserId: "user-1",
  linkedWorkspaceId: null,
  linkedEmail: "user@example.com",
  onboardingCompleted: false,
  updatedAt: "2026-04-18T09:15:00.000Z",
};

export const summaryAndSeriesSections = {
  includeSummary: true,
  includeSeries: true,
  includeReviewSchedule: false,
  includeLeaderboard: false,
} as const;

export const summaryOnlySections = {
  includeSummary: true,
  includeSeries: false,
  includeReviewSchedule: false,
  includeLeaderboard: false,
} as const;

export const seriesOnlySections = {
  includeSummary: false,
  includeSeries: true,
  includeReviewSchedule: false,
  includeLeaderboard: false,
} as const;

export const reviewScheduleOnlySections = {
  includeSummary: false,
  includeSeries: false,
  includeReviewSchedule: true,
  includeLeaderboard: false,
} as const;

export const leaderboardOnlySections = {
  includeSummary: false,
  includeSeries: false,
  includeReviewSchedule: false,
  includeLeaderboard: true,
} as const;

export const summaryAndSeriesWithInvalidationSections = {
  includeSummary: true,
  includeSeries: true,
  includeReviewSchedule: false,
  includeLeaderboard: false,
} as const;

export const noProgressSections = {
  includeSummary: false,
  includeSeries: false,
  includeReviewSchedule: false,
  includeLeaderboard: false,
} as const;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

export function renderHarness(props: HarnessProps): Readonly<{
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
      leaderboardAutoRefreshEnabled: true,
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

export function renderInvalidationHarness(props: HarnessProps): Readonly<{
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
      leaderboardAutoRefreshEnabled: true,
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

export function createDeferredPromise<T>(): DeferredPromise<T> {
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

export function buildServerSummary(activeReviewDays: number, generatedAt: string): ProgressSummaryPayload {
  return {
    timeZone: "Europe/Madrid",
    generatedAt,
    reviewHistoryWatermarks: [
      { workspaceId: workspace.workspaceId, reviewSequenceId: activeReviewDays },
    ],
    summary: {
      currentStreakDays: activeReviewDays,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-18",
      activeReviewDays,
    },
  };
}

export function buildDailyReviewPoint(
  date: string,
  reviewCount: number,
  againCount: number,
  hardCount: number,
  goodCount: number,
  easyCount: number,
): DailyReviewPoint {
  const ratingCountSum = againCount + hardCount + goodCount + easyCount;
  if (reviewCount !== ratingCountSum) {
    throw new Error(`Invalid progress daily review test fixture for ${date}: reviewCount ${reviewCount} must equal rating count sum ${ratingCountSum}`);
  }

  return {
    date,
    reviewCount,
    againCount,
    hardCount,
    goodCount,
    easyCount,
  };
}

export function buildGoodDailyReviewPoint(date: string, reviewCount: number): DailyReviewPoint {
  return buildDailyReviewPoint(date, reviewCount, 0, 0, reviewCount, 0);
}

export function buildServerSeries(reviewCount: number, generatedAt: string): ProgressSeries {
  const input: ProgressSeriesInput = buildCurrentSeriesInput();

  return {
    timeZone: input.timeZone,
    from: input.from,
    to: input.to,
    generatedAt,
    reviewHistoryWatermarks: [
      { workspaceId: workspace.workspaceId, reviewSequenceId: reviewCount },
    ],
    dailyReviews: [
      buildGoodDailyReviewPoint(input.to, reviewCount),
    ],
  };
}

export function buildServerReviewSchedule(newCount: number, generatedAt: string | null): ProgressReviewSchedule {
  return {
    timeZone: "Europe/Madrid",
    generatedAt,
    reviewHistoryWatermarks: [
      { workspaceId: workspace.workspaceId, reviewSequenceId: newCount },
    ],
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

export function replaceProgressReviewScheduleBucketCount(
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

export function swapFirstProgressReviewScheduleBuckets(schedule: ProgressReviewSchedule): ProgressReviewSchedule {
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

export function buildCurrentSeriesInput(): ProgressSeriesInput {
  return buildProgressSeriesInputForDateContext(buildCurrentProgressDateContext());
}

export function buildCurrentReviewScheduleInput(): Readonly<{ timeZone: string; today: string }> {
  return buildProgressSummaryInputForDateContext(buildCurrentProgressDateContext());
}

export function buildCurrentSummaryScopeKey(): ProgressScopeKey {
  return buildProgressSummaryScopeKey(
    [workspace.workspaceId],
    buildProgressSummaryInputForDateContext(buildCurrentProgressDateContext()),
  );
}

export function buildCurrentSeriesScopeKey(): ProgressScopeKey {
  return buildProgressScopeKey(
    [workspace.workspaceId],
    buildCurrentSeriesInput(),
  );
}

export function buildCurrentReviewScheduleScopeKey(): ProgressScopeKey {
  return buildProgressSummaryScopeKey(
    [workspace.workspaceId],
    buildProgressSummaryInputForDateContext(buildCurrentProgressDateContext()),
  );
}

export function buildCurrentLeaderboardScopeKey(): ProgressScopeKey {
  return buildProgressLeaderboardScopeKey([workspace.workspaceId]);
}

export function storePersistedProgressSummaryForTest(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressSummaryPayload,
): void {
  window.localStorage.setItem(`flashcards-progress-server-summary:${scopeKey}`, JSON.stringify({
    version: 2,
    scopeKey,
    savedAt: "2026-04-18T09:00:00.000Z",
    serverBase,
  }));
}

export function storePersistedProgressSeriesForTest(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressSeries,
): void {
  window.localStorage.setItem(`flashcards-progress-server-series:${scopeKey}`, JSON.stringify({
    version: 3,
    scopeKey,
    savedAt: "2026-04-18T09:00:00.000Z",
    serverBase,
  }));
}

export function storePersistedProgressReviewScheduleForTest(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressReviewSchedule,
): void {
  window.localStorage.setItem(`flashcards-progress-server-review-schedule:${scopeKey}`, JSON.stringify({
    version: 2,
    scopeKey,
    savedAt: "2026-04-18T09:00:00.000Z",
    serverBase,
  }));
}

export function storePersistedProgressLeaderboardForTest(
  scopeKey: ProgressScopeKey,
  serverBase: ProgressLeaderboard,
): void {
  window.localStorage.setItem("flashcards-progress-server-leaderboard", JSON.stringify({
    version: 2,
    scopeKey,
    savedAt: "2026-04-18T09:00:00.000Z",
    serverBase,
  }));
}

export async function flushEffects(): Promise<void> {
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
  loadProgressLeaderboardMock.mockReset();
  loadLocalLeaderboardViewerCountsMock.mockReset();
  hasPendingProgressReviewEventsMock.mockReset();
  loadLocalProgressActiveDatesMock.mockReset();
  loadLocalProgressSummaryMock.mockReset();
  loadLocalProgressDailyReviewsMock.mockReset();
  loadPendingProgressDailyReviewsMock.mockReset();
  hasCompleteLocalProgressReviewScheduleCoverageMock.mockReset();
  hasPendingProgressReviewScheduleCardChangesMock.mockReset();
  calculatePendingProgressReviewScheduleCardTotalDeltaMock.mockReset();
  loadLocalProgressReviewScheduleMock.mockReset();
  addWebBreadcrumbMock.mockReset();
  captureWebExceptionMock.mockReset();
  captureWebWarningMock.mockReset();
  setWebObservabilityUserMock.mockReset();
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
  loadLocalProgressActiveDatesMock.mockResolvedValue([]);
  loadLocalProgressDailyReviewsMock.mockResolvedValue([]);
  loadPendingProgressDailyReviewsMock.mockResolvedValue([]);
  loadLocalProgressReviewScheduleMock.mockResolvedValue(buildServerReviewSchedule(0, null));
  loadLocalLeaderboardViewerCountsMock.mockResolvedValue({
    last_24_hours: 0,
    last_3_days: 0,
    last_7_days: 0,
    last_30_days: 0,
    all_time: 0,
  });
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

export {
  addWebBreadcrumbMock,
  calculatePendingProgressReviewScheduleCardTotalDeltaMock,
  captureWebExceptionMock,
  captureWebWarningMock,
  hasCompleteLocalProgressReviewScheduleCoverageMock,
  hasPendingProgressReviewEventsMock,
  hasPendingProgressReviewScheduleCardChangesMock,
  loadLocalLeaderboardViewerCountsMock,
  loadLocalProgressActiveDatesMock,
  loadLocalProgressDailyReviewsMock,
  loadLocalProgressReviewScheduleMock,
  loadLocalProgressSummaryMock,
  loadPendingProgressDailyReviewsMock,
  loadProgressLeaderboardMock,
  loadProgressReviewScheduleMock,
  loadProgressSeriesMock,
  loadProgressSummaryMock,
  setWebObservabilityUserMock,
};
