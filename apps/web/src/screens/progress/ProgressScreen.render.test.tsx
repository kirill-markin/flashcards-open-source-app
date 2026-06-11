// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import type { AppDataContextValue } from "../../appData";
import {
  createEmptyProgressLeaderboardSourceState,
  createNextLeaderboardState,
  createProgressLeaderboardSnapshot,
} from "../../appData/progress/snapshots/progressSnapshots";
import type {
  CloudSettings,
  ProgressLeaderboard,
  ProgressLeaderboardLocalViewerCounts,
  ProgressLeaderboardSourceState,
  ProgressLeaderboardWindow,
  ProgressLeaderboardWindowKey,
  ProgressReviewScheduleSnapshot,
  ProgressSeriesSnapshot,
  ProgressSummarySnapshot,
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

function createProgressSummarySnapshot(): ProgressSummarySnapshot {
  return {
    timeZone: "UTC",
    generatedAt: "2026-04-21T10:00:00.000Z",
    reviewHistoryWatermarks: [],
    summary: {
      currentStreakDays: 2,
      hasReviewedToday: true,
      lastReviewedOn: "2026-04-21",
      activeReviewDays: 2,
    },
    source: "server",
    isApproximate: false,
  };
}

function createProgressSeriesSnapshot(): ProgressSeriesSnapshot {
  const dailyReviews = [
    { date: "2026-04-13", reviewCount: 0 },
    { date: "2026-04-14", reviewCount: 40 },
    { date: "2026-04-15", reviewCount: 0 },
    { date: "2026-04-16", reviewCount: 0 },
    { date: "2026-04-17", reviewCount: 0 },
    { date: "2026-04-18", reviewCount: 0 },
    { date: "2026-04-19", reviewCount: 0 },
    { date: "2026-04-20", reviewCount: 0 },
    { date: "2026-04-21", reviewCount: 9 },
  ] as const;

  return {
    timeZone: "UTC",
    from: "2026-04-13",
    to: "2026-04-21",
    generatedAt: "2026-04-21T10:00:00.000Z",
    reviewHistoryWatermarks: [],
    dailyReviews,
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
    ],
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

function createLeaderboardSourceState(
  status: ProgressLeaderboard["status"],
  localViewerCounts: ProgressLeaderboardLocalViewerCounts | null,
): ProgressLeaderboardSourceState {
  return createNextLeaderboardState(createEmptyProgressLeaderboardSourceState(), {
    scopeKey: "workspace-1::leaderboard",
    serverBase: createProgressLeaderboardSnapshot(createLeaderboard(status), false),
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
          serverBase: {
            ...createProgressSeriesSnapshot(),
            from: "2026-04-06",
            dailyReviews: [
              { date: "2026-04-06", reviewCount: 0 },
              { date: "2026-04-07", reviewCount: 0 },
              { date: "2026-04-08", reviewCount: 0 },
              { date: "2026-04-09", reviewCount: 0 },
              { date: "2026-04-10", reviewCount: 0 },
              { date: "2026-04-11", reviewCount: 0 },
              { date: "2026-04-12", reviewCount: 0 },
              ...createProgressSeriesSnapshot().dailyReviews,
            ],
            chartData: {
              dailyReviews: [
                { date: "2026-04-06", reviewCount: 0 },
                { date: "2026-04-07", reviewCount: 0 },
                { date: "2026-04-08", reviewCount: 0 },
                { date: "2026-04-09", reviewCount: 0 },
                { date: "2026-04-10", reviewCount: 0 },
                { date: "2026-04-11", reviewCount: 0 },
                { date: "2026-04-12", reviewCount: 0 },
                ...createProgressSeriesSnapshot().dailyReviews,
              ],
            },
          },
          pendingLocalOverlay: null,
          renderedSnapshot: {
            ...createProgressSeriesSnapshot(),
            from: "2026-04-06",
            dailyReviews: [
              { date: "2026-04-06", reviewCount: 0 },
              { date: "2026-04-07", reviewCount: 0 },
              { date: "2026-04-08", reviewCount: 0 },
              { date: "2026-04-09", reviewCount: 0 },
              { date: "2026-04-10", reviewCount: 0 },
              { date: "2026-04-11", reviewCount: 0 },
              { date: "2026-04-12", reviewCount: 0 },
              ...createProgressSeriesSnapshot().dailyReviews,
            ],
            chartData: {
              dailyReviews: [
                { date: "2026-04-06", reviewCount: 0 },
                { date: "2026-04-07", reviewCount: 0 },
                { date: "2026-04-08", reviewCount: 0 },
                { date: "2026-04-09", reviewCount: 0 },
                { date: "2026-04-10", reviewCount: 0 },
                { date: "2026-04-11", reviewCount: 0 },
                { date: "2026-04-12", reviewCount: 0 },
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
    expect(settingsLink.getAttribute("href")).toBe("/settings/account-status");
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

    const gapRow = rows[3];
    if (gapRow === undefined) {
      throw new Error("Leaderboard gap row was not found");
    }
    expect(gapRow.querySelector("button")).toBeNull();
    expect(gapRow.querySelector("a")).toBeNull();
  });

  it("reveals the leaderboard info text explaining that Again reviews are excluded", async () => {
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
  });

  it("overlays only the viewer count when the local qualified review count differs", async () => {
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
    expect(viewerRow.textContent).toContain("#42");

    const neighborCounts = [...container.querySelectorAll("[data-testid='progress-leaderboard-count-neighbor']")]
      .map((count) => count.textContent);
    expect(neighborCounts).toEqual(["8", "7"]);

    const topCounts = [...container.querySelectorAll("[data-testid='progress-leaderboard-count-top']")]
      .map((count) => count.textContent);
    expect(topCounts).toEqual(["51", "44", "30"]);
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
