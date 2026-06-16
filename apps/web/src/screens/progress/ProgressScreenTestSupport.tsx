import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, vi } from "vitest";
import type { AppDataContextValue } from "../../appData";
import {
  createEmptyProgressLeaderboardSourceState,
  createNextLeaderboardState,
  createProgressLeaderboardSnapshot,
} from "../../appData/progress/snapshots/progressSnapshots";
import { I18nProvider } from "../../i18n";
import { shiftLocalDate } from "../../progress/progressDates";
import type {
  CloudSettings,
  DailyReviewPoint,
  ProgressLeaderboard,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardRankingRow,
  ProgressLeaderboardSourceState,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
  ProgressReviewScheduleSnapshot,
  ProgressSeriesSnapshot,
  ProgressSummarySnapshot,
  StreakDay,
  StreakDayState,
} from "../../types";
import { progressLeaderboardWindowKeys } from "../../types";

const {
  refreshProgressMock,
  useAppDataMock,
  useProgressInvalidationStateMock,
  useProgressSourceMock,
} = vi.hoisted(() => ({
  refreshProgressMock: vi.fn(async (): Promise<void> => undefined),
  useAppDataMock: vi.fn(),
  useProgressInvalidationStateMock: vi.fn(),
  useProgressSourceMock: vi.fn(),
}));

export {
  createEmptyProgressLeaderboardSourceState,
  refreshProgressMock,
  useAppDataMock,
  useProgressInvalidationStateMock,
  useProgressSourceMock,
};

vi.mock("../../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("../../appData/progress/invalidation/progressInvalidation", () => ({
  useProgressInvalidationState: useProgressInvalidationStateMock,
}));

vi.mock("../../appData/progress/progressSource", async () => {
  const actualModule = await vi.importActual<typeof import("../../appData/progress/progressSource")>("../../appData/progress/progressSource");

  return {
    ...actualModule,
    useProgressSource: useProgressSourceMock,
  };
});

import { ProgressScreen } from "./ProgressScreen";

export const localePreferenceStorageKey = "flashcards-web-locale-preference";

export type ProgressScreenRenderTestContext = Readonly<{
  getContainer: () => HTMLDivElement;
  renderProgressScreen: () => Promise<void>;
  renderProgressScreenAtEntries: (initialEntries: Array<string>) => Promise<void>;
}>;

export function createNativeWeekRangeLabel(locale: string, startDate: string, endDate: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatRange(new Date(`${startDate}T00:00:00.000Z`), new Date(`${endDate}T00:00:00.000Z`));
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

export function createProgressScreenRenderTestContext(): ProgressScreenRenderTestContext {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  function getContainer(): HTMLDivElement {
    if (container === null) {
      throw new Error("ProgressScreen test container was read before setup");
    }

    return container;
  }

  function getRoot(): ReactDOM.Root {
    if (root === null) {
      throw new Error("ProgressScreen test root was read before setup");
    }

    return root;
  }

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    window.localStorage.clear();

    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    window.cancelAnimationFrame = vi.fn((_animationFrameId: number): void => undefined);

    useAppDataMock.mockReturnValue(createAppData());
    useProgressInvalidationStateMock.mockReturnValue({
      progressLocalVersion: 0,
      progressScheduleLocalVersion: 0,
      progressServerInvalidationVersion: 0,
    });
    mockProgressSourceStateWithLeaderboard(createEmptyProgressLeaderboardSourceState());
  });

  afterEach(async () => {
    await act(async () => {
      getRoot().unmount();
    });
    getContainer().remove();
    root = null;
    container = null;
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  async function renderProgressScreen(): Promise<void> {
    await act(async () => {
      getRoot().render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });
  }

  async function renderProgressScreenAtEntries(initialEntries: Array<string>): Promise<void> {
    await act(async () => {
      getRoot().render(
        <MemoryRouter initialEntries={initialEntries}>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });
  }

  return {
    getContainer,
    renderProgressScreen,
    renderProgressScreenAtEntries,
  };
}

export function createAppData(): AppDataContextValue {
  return {
    sessionLoadState: "ready",
    sessionVerificationState: "verified",
    isSessionVerified: true,
    sessionErrorMessage: "",
    session: null,
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary",
      createdAt: "2026-04-01T00:00:00.000Z",
      isSelected: true,
    },
    availableWorkspaces: [],
    isChoosingWorkspace: false,
    workspaceSettings: null,
    cloudSettings: null,
    localReadVersion: 0,
    localCardCount: 0,
    isSyncing: false,
    selectedReviewFilter: { kind: "allCards" },
    errorMessage: "",
    setErrorMessage: vi.fn(),
    setAccountPreferences: vi.fn(),
    refreshAccountPreferences: vi.fn(async () => ({
      reviewReactionAnimationsEnabled: true,
    })),
    initialize: vi.fn(async (): Promise<void> => undefined),
    chooseWorkspace: vi.fn(async (_workspaceId: string): Promise<void> => undefined),
    createWorkspace: vi.fn(async (_name: string): Promise<void> => undefined),
    renameWorkspace: vi.fn(async (_workspaceId: string, _name: string): Promise<void> => undefined),
    deleteWorkspace: vi.fn(async (_workspaceId: string, _confirmationText: string): Promise<void> => undefined),
    loadWorkspaceResetProgressPreview: vi.fn(async (_workspaceId: string) => ({
      workspaceId: "workspace-1",
      workspaceName: "Primary",
      cardsToResetCount: 0,
      confirmationText: "",
    })),
    resetWorkspaceProgress: vi.fn(async (_workspaceId: string, _confirmationText: string) => ({
      ok: true,
      workspaceId: "workspace-1",
      cardsResetCount: 0,
    })),
    runSync: vi.fn(async (): Promise<void> => undefined),
    refreshLocalData: vi.fn(async (): Promise<void> => undefined),
    getCardById: vi.fn(async (_cardId: string) => {
      throw new Error("getCardById was not expected in ProgressScreen test");
    }),
    getDeckById: vi.fn(async (_deckId: string) => {
      throw new Error("getDeckById was not expected in ProgressScreen test");
    }),
    createCardItem: vi.fn(async (_input) => {
      throw new Error("createCardItem was not expected in ProgressScreen test");
    }),
    createDeckItem: vi.fn(async (_input) => {
      throw new Error("createDeckItem was not expected in ProgressScreen test");
    }),
    updateCardItem: vi.fn(async (_cardId: string, _input) => {
      throw new Error("updateCardItem was not expected in ProgressScreen test");
    }),
    updateDeckItem: vi.fn(async (_deckId: string, _input) => {
      throw new Error("updateDeckItem was not expected in ProgressScreen test");
    }),
    deleteCardItem: vi.fn(async (_cardId: string) => {
      throw new Error("deleteCardItem was not expected in ProgressScreen test");
    }),
    deleteDeckItem: vi.fn(async (_deckId: string) => {
      throw new Error("deleteDeckItem was not expected in ProgressScreen test");
    }),
    selectReviewFilter: vi.fn(),
    openReview: vi.fn(),
    submitReviewItem: vi.fn(async (_cardId: string, _rating: 0 | 1 | 2 | 3) => {
      throw new Error("submitReviewItem was not expected in ProgressScreen test");
    }),
  };
}

function createPartialStreakFreeze(): Readonly<{
  availableCredits: number;
  capacity: number;
  balanceUnits: number;
  unitsPerCredit: number;
  earnedUnitsPerStreakDay: number;
  nextCreditProgressUnits: number;
  nextCreditRequiredUnits: number;
}> {
  return {
    availableCredits: 1,
    capacity: 3,
    balanceUnits: 11,
    unitsPerCredit: 10,
    earnedUnitsPerStreakDay: 1,
    nextCreditProgressUnits: 1,
    nextCreditRequiredUnits: 10,
  };
}

function createProgressStreakDaysForTest(from: string, to: string): ReadonlyArray<StreakDay> {
  const reviewedDates = new Set(["2026-04-14", "2026-04-21"]);
  const frozenDates = new Set(["2026-04-15", "2026-04-16"]);
  const streakDays: Array<StreakDay> = [];

  for (let currentDate = from; currentDate <= to; currentDate = shiftLocalDate(currentDate, 1)) {
    const state: StreakDayState = reviewedDates.has(currentDate)
      ? "reviewed"
      : frozenDates.has(currentDate)
        ? "frozen"
        : "missed";

    streakDays.push({
      date: currentDate,
      state,
    });
  }

  return streakDays;
}

export function createProgressSummarySnapshot(): ProgressSummarySnapshot {
  return {
    timeZone: "UTC",
    generatedAt: "2026-04-21T10:00:00.000Z",
    reviewHistoryWatermarks: [],
    summary: {
      currentStreakDays: 2,
      longestStreakDays: 3,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-21",
      activeReviewDays: 2,
      streakFreeze: createPartialStreakFreeze(),
    },
    source: "server",
    isApproximate: false,
  };
}

export function createDailyReviewPoint(
  date: string,
  reviewCount: number,
  againCount: number,
  hardCount: number,
  goodCount: number,
  easyCount: number,
): DailyReviewPoint {
  const ratingCountSum = againCount + hardCount + goodCount + easyCount;
  if (reviewCount !== ratingCountSum) {
    throw new Error(`Invalid progress screen test fixture for ${date}: reviewCount ${reviewCount} must equal rating count sum ${ratingCountSum}`);
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

export function createProgressSeriesSnapshot(): ProgressSeriesSnapshot {
  const dailyReviews = [
    createDailyReviewPoint("2026-04-13", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-14", 40, 5, 10, 20, 5),
    createDailyReviewPoint("2026-04-15", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-16", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-17", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-18", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-19", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-20", 3, 0, 3, 0, 0),
    createDailyReviewPoint("2026-04-21", 9, 1, 2, 4, 2),
  ] as const;

  return {
    timeZone: "UTC",
    from: "2026-04-13",
    to: "2026-04-21",
    generatedAt: "2026-04-21T10:00:00.000Z",
    reviewHistoryWatermarks: [],
    dailyReviews,
    streakDays: createProgressStreakDaysForTest("2026-03-21", "2026-04-21"),
    chartData: {
      dailyReviews,
    },
    source: "server",
    isApproximate: false,
  };
}

function createInactivePreviousWeekDailyReviews(): ReadonlyArray<DailyReviewPoint> {
  return [
    createDailyReviewPoint("2026-04-06", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-07", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-08", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-09", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-10", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-11", 0, 0, 0, 0, 0),
    createDailyReviewPoint("2026-04-12", 0, 0, 0, 0, 0),
  ];
}

export function createProgressSeriesSnapshotWithInactivePreviousWeek(): ProgressSeriesSnapshot {
  const baseSnapshot = createProgressSeriesSnapshot();
  const dailyReviews = [
    ...createInactivePreviousWeekDailyReviews(),
    ...baseSnapshot.dailyReviews,
  ];

  return {
    ...baseSnapshot,
    from: "2026-04-06",
    dailyReviews,
    chartData: {
      dailyReviews,
    },
  };
}

export function createReviewScheduleSnapshot(): ProgressReviewScheduleSnapshot {
  return {
    timeZone: "UTC",
    generatedAt: "2026-04-21T10:00:00.000Z",
    reviewHistoryWatermarks: [],
    totalCards: 10,
    buckets: [
      { key: "new", count: 2 },
      { key: "today", count: 3 },
      { key: "days1To7", count: 1 },
      { key: "days8To30", count: 1 },
      { key: "days31To90", count: 1 },
      { key: "days91To360", count: 1 },
      { key: "years1To2", count: 0 },
      { key: "later", count: 1 },
    ],
    source: "server",
    isApproximate: false,
  };
}

export const linkedCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-18T09:15:00.000Z",
};

function createRankingParticipantRow(
  rank: number,
  publicProfileId: string,
  anonymousDisplayName: string,
  qualifiedReviewCount: number,
): ProgressLeaderboardRankingRow {
  return {
    kind: "participant",
    publicProfileId,
    anonymousDisplayName,
    qualifiedReviewCount,
    rank,
  };
}

function createHiddenRankingParticipantRow(rank: number, qualifiedReviewCount: number): ProgressLeaderboardRankingRow {
  return createRankingParticipantRow(
    rank,
    `profile-${rank}`,
    `Hidden Rank ${rank}`,
    qualifiedReviewCount,
  );
}

export function createLeaderboardRankingRows(): ReadonlyArray<ProgressLeaderboardRankingRow> {
  const hiddenRowsAboveViewer = Array.from(
    { length: 37 },
    (_value, index): ProgressLeaderboardRankingRow => createHiddenRankingParticipantRow(index + 4, 10),
  );
  const hiddenRowsBelowViewer = Array.from(
    { length: 84 },
    (_value, index): ProgressLeaderboardRankingRow => createHiddenRankingParticipantRow(index + 44, 1),
  );

  return [
    createRankingParticipantRow(1, "profile-1", "Silver Bright Harbor", 51),
    createRankingParticipantRow(2, "profile-2", "Amber Calm Meadow", 44),
    createRankingParticipantRow(3, "profile-3", "Coral Keen Valley", 30),
    ...hiddenRowsAboveViewer,
    createRankingParticipantRow(41, "profile-41", "Jade Swift River", 8),
    {
      kind: "viewer",
      publicProfileId: "viewer-profile",
      anonymousDisplayName: "Quiet Maple Grove",
      qualifiedReviewCount: 7,
      rank: 42,
    },
    createRankingParticipantRow(43, "profile-43", "Bold Cedar Crest", 7),
    ...hiddenRowsBelowViewer,
    createRankingParticipantRow(128, "profile-128", "Blue Final Harbor", 0),
  ];
}

export function addFriendDisplayNameToRankingRows(
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>,
  rank: number,
  friendDisplayName: string,
): ReadonlyArray<ProgressLeaderboardRankingRow> {
  return rankingRows.map((row): ProgressLeaderboardRankingRow => (
    row.rank === rank
      ? {
        ...row,
        friendDisplayName,
      }
      : row
  ));
}

export function addFriendDisplayNamesToRankingRows(
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>,
  friendDisplayNamesByRank: ReadonlyMap<number, string>,
): ReadonlyArray<ProgressLeaderboardRankingRow> {
  return rankingRows.map((row): ProgressLeaderboardRankingRow => {
    const friendDisplayName = friendDisplayNamesByRank.get(row.rank);
    if (friendDisplayName === undefined) {
      return row;
    }

    return {
      ...row,
      friendDisplayName,
    };
  });
}

function createLeaderboardWindow(windowKey: ProgressLeaderboardWindowKey): ProgressLeaderboardWindow {
  return {
    windowKey,
    snapshotId: "0cc86d10-18cb-4d64-a2f2-a5fd960b45b2",
    snapshotGeneratedAt: "2026-04-21T10:00:05.000Z",
    asOfServerHour: "2026-04-21T10:00:00.000Z",
    nextRefreshAfter: "2026-04-21T11:00:00.000Z",
    participantCount: 128,
    viewer: {
      publicProfileId: "viewer-profile",
      displayName: "You",
      rank: 42,
      qualifiedReviewCount: 7,
    },
    rows: [
      { kind: "top", publicProfileId: "profile-1", anonymousDisplayName: "Silver Bright Harbor", qualifiedReviewCount: 51, rank: 1 },
      { kind: "top", publicProfileId: "profile-2", anonymousDisplayName: "Amber Calm Meadow", qualifiedReviewCount: 44, rank: 2 },
      { kind: "top", publicProfileId: "profile-3", anonymousDisplayName: "Coral Keen Valley", qualifiedReviewCount: 30, rank: 3 },
      { kind: "gap" },
      { kind: "neighbor", publicProfileId: "profile-41", anonymousDisplayName: "Jade Swift River", qualifiedReviewCount: 8, rank: 41 },
      { kind: "viewer", publicProfileId: "viewer-profile", anonymousDisplayName: "Quiet Maple Grove", qualifiedReviewCount: 7, rank: 42 },
      { kind: "neighbor", publicProfileId: "profile-43", anonymousDisplayName: "Bold Cedar Crest", qualifiedReviewCount: 7, rank: 43 },
      { kind: "gap" },
      { kind: "neighbor", publicProfileId: "profile-128", anonymousDisplayName: "Blue Final Harbor", qualifiedReviewCount: 0, rank: 128 },
    ],
    rankingRows: createLeaderboardRankingRows(),
  };
}

export function createLeaderboardWithWindowRankingRows(
  windowKey: ProgressLeaderboardWindowKey,
  rankingRows: ReadonlyArray<ProgressLeaderboardRankingRow>,
): ProgressLeaderboard {
  const leaderboard = createLeaderboard("ready");

  return {
    ...leaderboard,
    windows: leaderboard.windows.map((window): ProgressLeaderboardWindow => (
      window.windowKey === windowKey
        ? {
          ...window,
          rankingRows,
        }
        : window
    )),
  };
}

export function createLeaderboard(status: ProgressLeaderboard["status"]): ProgressLeaderboard {
  return {
    status,
    metric: {
      metricVersion: "qualified_reviews_v1",
      title: "Qualified reviews",
      description: "Hard, Good, and Easy reviews count toward your rank. Again does not.",
    },
    defaultWindowKey: "last_24_hours",
    windows: status === "ready" ? progressLeaderboardWindowKeys.map(createLeaderboardWindow) : [],
  };
}

export function createLeaderboardWithViewerRanks(
  viewerRanks: Readonly<Partial<Record<ProgressLeaderboardWindowKey, number>>>,
): ProgressLeaderboard {
  const leaderboard = createLeaderboard("ready");

  return {
    ...leaderboard,
    windows: leaderboard.windows.map((window) => ({
      ...window,
      viewer: {
        ...window.viewer,
        rank: viewerRanks[window.windowKey] ?? window.viewer.rank,
      },
    })),
  };
}

export function createLeaderboardSourceState(
  status: ProgressLeaderboard["status"],
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
): ProgressLeaderboardSourceState {
  return createLeaderboardSourceStateFromLeaderboard(createLeaderboard(status), localViewerCounts);
}

export function createLeaderboardSourceStateFromLeaderboard(
  leaderboard: ProgressLeaderboard,
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
): ProgressLeaderboardSourceState {
  return createNextLeaderboardState(createEmptyProgressLeaderboardSourceState(), {
    scopeKey: "workspace-1::leaderboard",
    serverBase: createProgressLeaderboardSnapshot(leaderboard, false),
    localViewerCounts,
  }, true);
}

export function mockProgressSourceStateWithLeaderboard(leaderboard: ProgressLeaderboardSourceState): void {
  useProgressSourceMock.mockReturnValue({
    progressSourceState: {
      summary: {
        scopeKey: "progress::summary::UTC::2026-04-21",
        referenceLocalDate: "2026-04-21",
        localFallback: null,
        localFallbackActiveDates: [],
        serverBase: createProgressSummarySnapshot(),
        hasPendingLocalReviews: false,
        renderedSeriesContext: null,
        renderedSnapshot: createProgressSummarySnapshot(),
        isLoading: false,
        errorMessage: "",
      },
      series: {
        scopeKey: "progress::series::UTC::2026-04-13::2026-04-21",
        localFallback: null,
        localFallbackActiveDates: [],
        serverBase: createProgressSeriesSnapshot(),
        pendingLocalOverlay: null,
        renderedSnapshot: createProgressSeriesSnapshot(),
        isLoading: false,
        errorMessage: "",
      },
      reviewSchedule: {
        scopeKey: "progress::review-schedule::UTC::2026-04-21",
        localFallback: null,
        serverBase: createReviewScheduleSnapshot(),
        progressScheduleLocalVersion: 0,
        serverBaseProgressScheduleLocalVersion: 0,
        serverBaseLocalCardTotalDelta: 0,
        hasPendingLocalCardChanges: false,
        hasCompleteLocalCardState: false,
        pendingLocalCardTotalDelta: 0,
        renderedSnapshot: createReviewScheduleSnapshot(),
        isLoading: false,
        errorMessage: "",
      },
      leaderboard,
    },
    refreshProgress: refreshProgressMock,
  });
}

export function mockProgressSourceStateWithInactivePreviousWeek(): void {
  const seriesSnapshot = createProgressSeriesSnapshotWithInactivePreviousWeek();

  useProgressSourceMock.mockReturnValue({
    progressSourceState: {
      summary: {
        scopeKey: "progress::summary::UTC::2026-04-21",
        referenceLocalDate: "2026-04-21",
        localFallback: null,
        localFallbackActiveDates: [],
        serverBase: createProgressSummarySnapshot(),
        hasPendingLocalReviews: false,
        renderedSeriesContext: null,
        renderedSnapshot: createProgressSummarySnapshot(),
        isLoading: false,
        errorMessage: "",
      },
      series: {
        scopeKey: "progress::series::UTC::2026-04-06::2026-04-21",
        localFallback: null,
        localFallbackActiveDates: [],
        serverBase: seriesSnapshot,
        pendingLocalOverlay: null,
        renderedSnapshot: seriesSnapshot,
        isLoading: false,
        errorMessage: "",
      },
      reviewSchedule: {
        scopeKey: "progress::review-schedule::UTC::2026-04-21",
        localFallback: null,
        serverBase: createReviewScheduleSnapshot(),
        progressScheduleLocalVersion: 0,
        serverBaseProgressScheduleLocalVersion: 0,
        serverBaseLocalCardTotalDelta: 0,
        hasPendingLocalCardChanges: false,
        hasCompleteLocalCardState: false,
        pendingLocalCardTotalDelta: 0,
        renderedSnapshot: createReviewScheduleSnapshot(),
        isLoading: false,
        errorMessage: "",
      },
      leaderboard: createEmptyProgressLeaderboardSourceState(),
    },
    refreshProgress: refreshProgressMock,
  });
}
