// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { shiftLocalDate } from "../../progress/progressDates";
import { progressLeaderboardHash, progressStreakHash } from "../../routes";
import type { AppDataContextValue } from "../../appData";
import {
  createEmptyProgressLeaderboardSourceState,
  createNextLeaderboardState,
  createProgressLeaderboardSnapshot,
} from "../../appData/progress/snapshots/progressSnapshots";
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

const localePreferenceStorageKey = "flashcards-web-locale-preference";

function createNativeWeekRangeLabel(locale: string, startDate: string, endDate: string): string {
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

function createAppData(): AppDataContextValue {
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
  nextCreditProgressUnits: number;
  nextCreditRequiredUnits: number;
}> {
  return {
    availableCredits: 1,
    capacity: 2,
    balanceUnits: 11,
    unitsPerCredit: 10,
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

function createProgressSummarySnapshot(): ProgressSummarySnapshot {
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

function createDailyReviewPoint(
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

function createProgressSeriesSnapshot(): ProgressSeriesSnapshot {
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

function createReviewScheduleSnapshot(): ProgressReviewScheduleSnapshot {
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

const linkedCloudSettings: CloudSettings = {
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

function createLeaderboardRankingRows(): ReadonlyArray<ProgressLeaderboardRankingRow> {
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

function addFriendDisplayNameToRankingRows(
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

function addFriendDisplayNamesToRankingRows(
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

function createLeaderboardWithWindowRankingRows(
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

function createLeaderboard(status: ProgressLeaderboard["status"]): ProgressLeaderboard {
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

function createLeaderboardWithViewerRanks(
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

function createLeaderboardSourceState(
  status: ProgressLeaderboard["status"],
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
): ProgressLeaderboardSourceState {
  return createLeaderboardSourceStateFromLeaderboard(createLeaderboard(status), localViewerCounts);
}

function createLeaderboardSourceStateFromLeaderboard(
  leaderboard: ProgressLeaderboard,
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
): ProgressLeaderboardSourceState {
  return createNextLeaderboardState(createEmptyProgressLeaderboardSourceState(), {
    scopeKey: "workspace-1::leaderboard",
    serverBase: createProgressLeaderboardSnapshot(leaderboard, false),
    localViewerCounts,
  }, true);
}

function mockProgressSourceStateWithLeaderboard(leaderboard: ProgressLeaderboardSourceState): void {
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

describe("ProgressScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
      root.unmount();
    });
    container.remove();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("renders shared flame SVGs on progress without emoji text", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("🔥");

    const summaryBadgeIcon = container.querySelector(".progress-streak-summary .review-progress-badge-icon");
    if (!(summaryBadgeIcon instanceof SVGSVGElement)) {
      throw new Error("Progress summary badge SVG icon was not found");
    }

    const streakMarkerIcons = [...container.querySelectorAll(".progress-streak-marker-flame .review-progress-badge-icon")];
    expect(streakMarkerIcons.length).toBeGreaterThan(0);
    expect(streakMarkerIcons.every((icon) => icon instanceof SVGSVGElement)).toBe(true);

    const frozenMarkerIcons = [...container.querySelectorAll(".progress-streak-marker-freeze .review-progress-badge-icon")];
    expect(frozenMarkerIcons.length).toBeGreaterThan(0);
    expect(frozenMarkerIcons.every((icon) => icon instanceof SVGSVGElement)).toBe(true);
  });

  it("uses the schedule-specific progress version for review schedule refreshes", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      localReadVersion: 7,
    });
    useProgressInvalidationStateMock.mockReturnValue({
      progressLocalVersion: 2,
      progressScheduleLocalVersion: 3,
      progressServerInvalidationVersion: 5,
    });

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    expect(useProgressSourceMock).toHaveBeenCalledWith(expect.objectContaining({
      progressLocalVersion: 2,
      progressScheduleLocalVersion: 3,
      progressServerInvalidationVersion: 5,
    }));
  });

  it("uses the active week local maximum for y-axis labels and bar heights", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const activeWeekMaxLabel = container.querySelector("[data-testid='progress-chart-y-label-max']");
    if (!(activeWeekMaxLabel instanceof HTMLSpanElement)) {
      throw new Error("Progress chart max y-axis label was not found");
    }
    expect(activeWeekMaxLabel.textContent).toBe("10");

    const latestWeekBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-21']");
    if (!(latestWeekBar instanceof HTMLSpanElement)) {
      throw new Error("Latest week bar was not found");
    }
    expect(latestWeekBar.style.height).toBe("90%");

    const previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Previous week button was not found");
    }

    await act(async () => {
      previousWeekButton.click();
    });

    const previousWeekMaxLabel = container.querySelector("[data-testid='progress-chart-y-label-max']");
    if (!(previousWeekMaxLabel instanceof HTMLSpanElement)) {
      throw new Error("Updated progress chart max y-axis label was not found");
    }
    expect(previousWeekMaxLabel.textContent).toBe("44");

    const previousWeekBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-14']");
    if (!(previousWeekBar instanceof HTMLSpanElement)) {
      throw new Error("Previous week bar was not found");
    }
    expect(previousWeekBar.style.height).toContain("90.909");
  });

  it("renders stacked review ratings and supports day and rating selection", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const goodSegment = container.querySelector("[data-testid='progress-chart-segment-2026-04-21-good']");
    if (!(goodSegment instanceof HTMLSpanElement)) {
      throw new Error("Good rating segment was not found");
    }
    expect(goodSegment.style.backgroundColor).toBe("rgb(43, 182, 115)");

    const day20Bar = container.querySelector("[data-testid='progress-chart-bar-2026-04-20']");
    if (!(day20Bar instanceof HTMLSpanElement)) {
      throw new Error("Day 20 progress bar was not found");
    }

    await act(async () => {
      day20Bar.click();
    });

    const chartRange = container.querySelector("[data-testid='progress-chart-range']");
    if (!(chartRange instanceof HTMLParagraphElement)) {
      throw new Error("Progress chart range was not found");
    }
    expect(chartRange.textContent).toBe("Apr 20, 2026");

    const againButton = container.querySelector("[data-testid='progress-chart-rating-again']");
    if (!(againButton instanceof HTMLButtonElement)) {
      throw new Error("Again rating legend button was not found");
    }
    expect(againButton.disabled).toBe(true);
    expect(againButton.textContent).toBe("Again0 (0%)");

    const hardButton = container.querySelector("[data-testid='progress-chart-rating-hard']");
    if (!(hardButton instanceof HTMLButtonElement)) {
      throw new Error("Hard rating legend button was not found");
    }
    expect(hardButton.textContent).toBe("Hard3 (100%)");

    const dimmedHardSegment = container.querySelector("[data-testid='progress-chart-segment-2026-04-21-hard']");
    if (!(dimmedHardSegment instanceof HTMLSpanElement)) {
      throw new Error("Dimmed hard rating segment was not found");
    }
    expect(dimmedHardSegment.style.backgroundColor).toBe("rgb(122, 128, 136)");

    await act(async () => {
      hardButton.click();
    });

    expect(hardButton.closest("li")?.className).toContain("is-selected");
    expect(againButton.closest("li")?.className).toContain("is-dimmed");
    expect(container.querySelector("[data-testid='progress-chart-segment-2026-04-21-good']")).toBeNull();

    const filteredLatestWeekBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-21']");
    if (!(filteredLatestWeekBar instanceof HTMLSpanElement)) {
      throw new Error("Filtered latest week bar was not found");
    }
    expect(filteredLatestWeekBar.style.height).toBe("50%");

    const enabledAgainButton = container.querySelector("[data-testid='progress-chart-rating-again']");
    if (!(enabledAgainButton instanceof HTMLButtonElement)) {
      throw new Error("Enabled again rating legend button was not found");
    }

    await act(async () => {
      enabledAgainButton.click();
    });

    const filteredDayWithoutAgainBar = container.querySelector("[data-testid='progress-chart-bar-2026-04-20']");
    if (!(filteredDayWithoutAgainBar instanceof HTMLSpanElement)) {
      throw new Error("Filtered day without again bar was not found");
    }
    expect(filteredDayWithoutAgainBar.style.height).toBe("0%");
    expect(filteredDayWithoutAgainBar.className).not.toContain("progress-chart-bar-active");
  });

  it("renders the week header with native locale interval formatting", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const chartRange = container.querySelector("[data-testid='progress-chart-range']");
    if (!(chartRange instanceof HTMLParagraphElement)) {
      throw new Error("Progress chart range was not found");
    }

    expect(chartRange.textContent).toBe(createNativeWeekRangeLabel("en", "2026-04-19", "2026-04-25"));
  });

  it("renders the review schedule donut and ordered bucket list", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const reviewScheduleCard = container.querySelector("[data-testid='progress-review-schedule-card']");
    if (!(reviewScheduleCard instanceof HTMLElement)) {
      throw new Error("Review schedule card was not found");
    }

    expect(reviewScheduleCard.textContent).toContain("Review schedule");
    expect(reviewScheduleCard.textContent).toContain("Total cards: 10");

    const bucketRows = [...reviewScheduleCard.querySelectorAll(".progress-review-schedule-row")];
    expect(bucketRows.map((row) => row.textContent)).toEqual([
      "New220%",
      "Today330%",
      "1-7 days110%",
      "8-30 days110%",
      "31-90 days110%",
      "91-360 days110%",
      "1-2 years00%",
      "Later110%",
    ]);

    const donut = reviewScheduleCard.querySelector(".progress-review-schedule-donut");
    if (!(donut instanceof SVGSVGElement)) {
      throw new Error("Review schedule donut was not found");
    }
    expect(donut.getAttribute("role")).toBe("img");
    expect(donut.getAttribute("aria-label")).toBe("Review schedule");

    const donutSegments = [...donut.querySelectorAll("[data-testid^='progress-review-schedule-segment-']")];
    expect(donutSegments.map((segment) => segment.getAttribute("data-testid"))).toEqual([
      "progress-review-schedule-segment-new",
      "progress-review-schedule-segment-today",
      "progress-review-schedule-segment-days1To7",
      "progress-review-schedule-segment-days8To30",
      "progress-review-schedule-segment-days31To90",
      "progress-review-schedule-segment-days91To360",
      "progress-review-schedule-segment-later",
    ]);
    expect(donutSegments[0]?.getAttribute("fill")).toBe("#F4C430");
    expect(donutSegments[0]?.getAttribute("d")).toContain("A 100 100");
  });

  it("mirrors week navigation arrows for rtl locales", async () => {
    window.localStorage.setItem(localePreferenceStorageKey, "ar");

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Previous week button was not found");
    }

    const nextWeekButton = container.querySelector("[data-testid='progress-chart-next-week']");
    if (!(nextWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Next week button was not found");
    }

    expect(document.documentElement.dir).toBe("rtl");
    expect(previousWeekButton.textContent).toBe(">");
    expect(nextWeekButton.textContent).toBe("<");
  });

  it("renders a full seven-column chart even when the week has no review activity", async () => {
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
          serverBase: {
            ...createProgressSeriesSnapshot(),
            from: "2026-04-06",
            dailyReviews: [
              createDailyReviewPoint("2026-04-06", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-07", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-08", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-09", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-10", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-11", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-12", 0, 0, 0, 0, 0),
              ...createProgressSeriesSnapshot().dailyReviews,
            ],
            chartData: {
              dailyReviews: [
                createDailyReviewPoint("2026-04-06", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-07", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-08", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-09", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-10", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-11", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-12", 0, 0, 0, 0, 0),
                ...createProgressSeriesSnapshot().dailyReviews,
              ],
            },
          },
          pendingLocalOverlay: null,
          renderedSnapshot: {
            ...createProgressSeriesSnapshot(),
            from: "2026-04-06",
            dailyReviews: [
              createDailyReviewPoint("2026-04-06", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-07", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-08", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-09", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-10", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-11", 0, 0, 0, 0, 0),
              createDailyReviewPoint("2026-04-12", 0, 0, 0, 0, 0),
              ...createProgressSeriesSnapshot().dailyReviews,
            ],
            chartData: {
              dailyReviews: [
                createDailyReviewPoint("2026-04-06", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-07", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-08", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-09", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-10", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-11", 0, 0, 0, 0, 0),
                createDailyReviewPoint("2026-04-12", 0, 0, 0, 0, 0),
                ...createProgressSeriesSnapshot().dailyReviews,
              ],
            },
          },
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

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    let previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Previous week button was not found");
    }

    await act(async () => {
      previousWeekButton.click();
    });

    previousWeekButton = container.querySelector("[data-testid='progress-chart-previous-week']");
    if (!(previousWeekButton instanceof HTMLButtonElement)) {
      throw new Error("Updated previous week button was not found");
    }

    await act(async () => {
      previousWeekButton.click();
    });

    expect(container.textContent).not.toContain("No reviews yet in this week.");
    expect(container.querySelector("[data-testid='progress-chart-y-label-max']")).not.toBeNull();
    const inactiveWeekBars = container.querySelectorAll("[data-testid^='progress-chart-bar-']");
    expect(inactiveWeekBars).toHaveLength(7);
  });

  it("renders the leaderboard guest placeholder with a sign-in link for unlinked accounts", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const guestPlaceholder = container.querySelector("[data-testid='progress-leaderboard-guest']");
    if (!(guestPlaceholder instanceof HTMLElement)) {
      throw new Error("Leaderboard guest placeholder was not found");
    }

    expect(guestPlaceholder.textContent).toContain("Sign in to see how your reviews rank alongside other learners.");
    const signInLink = guestPlaceholder.querySelector("a");
    if (!(signInLink instanceof HTMLAnchorElement)) {
      throw new Error("Leaderboard guest sign-in link was not found");
    }
    expect(signInLink.textContent).toBe("Sign in");
    expect(container.querySelector("[data-testid='progress-leaderboard-row-viewer']")).toBeNull();
  });

  it("renders the invite sign-in prompt for unlinked accounts", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const inviteOpenButton = container.querySelector("[data-testid='progress-leaderboard-invite-open']");
    if (!(inviteOpenButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard invite button was not found");
    }

    await act(async () => {
      inviteOpenButton.click();
    });

    const signInPrompt = document.body.querySelector("[data-testid='progress-leaderboard-invite-sign-in']");
    if (!(signInPrompt instanceof HTMLElement)) {
      throw new Error("Leaderboard invite sign-in prompt was not found");
    }

    expect(signInPrompt.querySelector("a")).not.toBeNull();
  });

  it("requires a friend name before creating a leaderboard invite", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const inviteOpenButton = container.querySelector("[data-testid='progress-leaderboard-invite-open']");
    if (!(inviteOpenButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard invite button was not found");
    }

    await act(async () => {
      inviteOpenButton.click();
    });

    const createButton = document.body.querySelector("[data-testid='progress-leaderboard-invite-create']");
    if (!(createButton instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard invite create button was not found");
    }

    await act(async () => {
      createButton.click();
    });

    expect(document.body.querySelector("[data-testid='progress-leaderboard-invite-name-error']")?.textContent).not.toBe("");
  });

  it("scrolls to the leaderboard card when the route hash targets it", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/progress#${progressLeaderboardHash}`]}>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const leaderboardCard = container.querySelector("[data-testid='progress-leaderboard-card']");
    if (!(leaderboardCard instanceof HTMLElement)) {
      throw new Error("Leaderboard card was not found");
    }

    expect(leaderboardCard.id).toBe(progressLeaderboardHash);
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView)).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("scrolls to the streak card when the route hash targets it", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/progress#${progressStreakHash}`]}>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const streakCard = container.querySelector("[data-testid='progress-streak-card']");
    if (!(streakCard instanceof HTMLElement)) {
      throw new Error("Streak card was not found");
    }

    expect(streakCard.id).toBe(progressStreakHash);
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView)).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "start",
    });
  });

  it("renders the leaderboard participation-disabled placeholder with a settings link", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("participation_disabled", null));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const participationPlaceholder = container.querySelector("[data-testid='progress-leaderboard-participation-disabled']");
    if (!(participationPlaceholder instanceof HTMLElement)) {
      throw new Error("Leaderboard participation-disabled placeholder was not found");
    }

    expect(participationPlaceholder.textContent).toContain("Rankings are hidden while leaderboard participation is off.");
    const settingsLink = participationPlaceholder.querySelector("a");
    if (!(settingsLink instanceof HTMLAnchorElement)) {
      throw new Error("Leaderboard participation settings link was not found");
    }
    expect(settingsLink.getAttribute("href")).toBe("/settings/leaderboard-participation");
    expect(container.querySelector("[data-testid='progress-leaderboard-row-viewer']")).toBeNull();
  });

  it("renders the ready leaderboard compact rows in server order with the top three before the gap", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const rows = [...container.querySelectorAll(".progress-leaderboard-row")];
    expect(rows.map((row) => row.getAttribute("data-kind"))).toEqual([
      "top",
      "top",
      "top",
      "gap",
      "neighbor",
      "viewer",
      "neighbor",
      "gap",
      "neighbor",
    ]);

    const rowTexts = rows.map((row) => row.textContent);
    expect(rowTexts[0]).toContain("Silver Bright Harbor");
    expect(rowTexts[0]).toContain("#1");
    expect(rowTexts[1]).toContain("Amber Calm Meadow");
    expect(rowTexts[2]).toContain("Coral Keen Valley");
    expect(rowTexts[4]).toContain("Jade Swift River");
    expect(rowTexts[5]).toContain("You");
    expect(rowTexts[5]).toContain("#42");
    expect(rowTexts[6]).toContain("Bold Cedar Crest");
    expect(rowTexts[8]).toContain("Blue Final Harbor");
    expect(rowTexts[8]).toContain("#128");
    expect(rowTexts[8]).toContain("0");

    const topGapRow = rows[3];
    const bottomGapRow = rows[7];
    if (topGapRow === undefined || bottomGapRow === undefined) {
      throw new Error("Leaderboard gap rows were not found");
    }
    expect(topGapRow.querySelector("button")).toBeNull();
    expect(topGapRow.querySelector("a")).toBeNull();
    expect(bottomGapRow.querySelector("button")).toBeNull();
    expect(bottomGapRow.querySelector("a")).toBeNull();
  });

  it("renders friend rows from ranking rows and dedupes already visible friends", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    const friendRankingRows = addFriendDisplayNamesToRankingRows(
      createLeaderboardRankingRows(),
      new Map([
        [2, "Mina"],
        [12, "Ari"],
        [41, "Kai"],
      ]),
    );
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceStateFromLeaderboard(
      createLeaderboardWithWindowRankingRows("last_24_hours", friendRankingRows),
      null,
    ));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const rows = [...container.querySelectorAll(".progress-leaderboard-row:not(.progress-leaderboard-row-padding)")];
    const rowTexts = rows.map((row) => row.textContent ?? "");

    expect(rowTexts.filter((text) => text.includes("Mina"))).toHaveLength(1);
    expect(rowTexts.filter((text) => text.includes("Kai"))).toHaveLength(1);
    expect(rowTexts).toEqual(expect.arrayContaining([
      expect.stringContaining("Ari"),
    ]));
    expect(container.textContent).not.toContain("Hidden Rank 12");
    expect(rowTexts.findIndex((text) => text.includes("#12"))).toBeLessThan(
      rowTexts.findIndex((text) => text.includes("#41")),
    );
  });

  it("pads the selected leaderboard period to the largest friend-expanded row count", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    const allTimeFriendRows = addFriendDisplayNameToRankingRows(
      addFriendDisplayNameToRankingRows(createLeaderboardRankingRows(), 12, "Ari"),
      20,
      "Noor",
    );
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceStateFromLeaderboard(
      createLeaderboardWithWindowRankingRows("all_time", allTimeFriendRows),
      null,
    ));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelectorAll("[data-testid='progress-leaderboard-row-padding']")).toHaveLength(4);
    expect(container.textContent).not.toContain("Ari");
    expect(container.textContent).not.toContain("Noor");
  });

  it("reveals the leaderboard info text explaining that Again reviews are excluded", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:35:05.000Z"));
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    expect(container.querySelector("[data-testid='progress-leaderboard-info']")).toBeNull();
    expect(container.querySelector("[data-testid='progress-leaderboard-freshness']")).toBeNull();

    const infoToggle = container.querySelector("[data-testid='progress-leaderboard-info-toggle']");
    if (!(infoToggle instanceof HTMLButtonElement)) {
      throw new Error("Leaderboard info toggle was not found");
    }

    await act(async () => {
      infoToggle.click();
    });

    const infoText = container.querySelector("[data-testid='progress-leaderboard-info']");
    if (!(infoText instanceof HTMLParagraphElement)) {
      throw new Error("Leaderboard info text was not found");
    }
    expect(infoText.textContent).toContain("Hard, Good, or Easy count");
    expect(infoText.textContent).toContain("Again reviews are not counted.");
    expect(infoText.textContent).toContain("Updated 35 min ago");
    expect(container.querySelector("[data-testid='progress-leaderboard-freshness']")).toBeNull();
  });

  it("reranks the viewer and renders new neighbors when the local qualified review count moves higher", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", {
      last_24_hours: 9,
      last_3_days: 9,
      last_7_days: 9,
      last_30_days: 9,
      all_time: 9,
    }));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const viewerRow = container.querySelector("[data-testid='progress-leaderboard-row-viewer']");
    if (!(viewerRow instanceof HTMLElement)) {
      throw new Error("Leaderboard viewer row was not found");
    }

    expect(viewerRow.querySelector("[data-testid='progress-leaderboard-count-viewer']")?.textContent).toBe("9");
    expect(viewerRow.textContent).toContain("#41");

    const rows = [...container.querySelectorAll(".progress-leaderboard-row")];
    const rowTexts = rows.map((row) => row.textContent);
    expect(rowTexts[4]).toContain("Hidden Rank 40");
    expect(rowTexts[4]).toContain("#40");
    expect(rowTexts[5]).toContain("You");
    expect(rowTexts[5]).toContain("#41");
    expect(rowTexts[6]).toContain("Jade Swift River");
    expect(rowTexts[6]).toContain("#42");
    expect(container.textContent).not.toContain("Bold Cedar Crest");

    const neighborCounts = [...container.querySelectorAll("[data-testid='progress-leaderboard-count-neighbor']")]
      .map((count) => count.textContent);
    expect(neighborCounts).toEqual(["10", "8", "0"]);

    const topCounts = [...container.querySelectorAll("[data-testid='progress-leaderboard-count-top']")]
      .map((count) => count.textContent);
    expect(topCounts).toEqual(["51", "44", "30"]);
  });

  it("auto-selects the leaderboard window where the viewer has the best rank", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceStateFromLeaderboard(
      createLeaderboardWithViewerRanks({
        last_24_hours: 9,
        last_3_days: 8,
        last_7_days: 3,
        last_30_days: 11,
        all_time: 4,
      }),
      null,
    ));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const bestPeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-last_7_days']");
    if (!(bestPeriodButton instanceof HTMLButtonElement)) {
      throw new Error("Best leaderboard period button was not found");
    }
    const fallbackPeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-last_24_hours']");
    if (!(fallbackPeriodButton instanceof HTMLButtonElement)) {
      throw new Error("Fallback leaderboard period button was not found");
    }

    expect(bestPeriodButton.getAttribute("aria-pressed")).toBe("true");
    expect(fallbackPeriodButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches the visible leaderboard window with the period control", async () => {
    useAppDataMock.mockReturnValue({
      ...createAppData(),
      cloudSettings: linkedCloudSettings,
    });
    mockProgressSourceStateWithLeaderboard(createLeaderboardSourceState("ready", null));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <I18nProvider>
            <ProgressScreen />
          </I18nProvider>
        </MemoryRouter>,
      );
    });

    const defaultPeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-last_24_hours']");
    if (!(defaultPeriodButton instanceof HTMLButtonElement)) {
      throw new Error("Default leaderboard period button was not found");
    }
    expect(defaultPeriodButton.getAttribute("aria-pressed")).toBe("true");

    const allTimePeriodButton = container.querySelector("[data-testid='progress-leaderboard-period-all_time']");
    if (!(allTimePeriodButton instanceof HTMLButtonElement)) {
      throw new Error("All-time leaderboard period button was not found");
    }

    await act(async () => {
      allTimePeriodButton.click();
    });

    expect(allTimePeriodButton.getAttribute("aria-pressed")).toBe("true");
    expect(defaultPeriodButton.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("[data-testid='progress-leaderboard-row-viewer']")).not.toBeNull();
  });
});
