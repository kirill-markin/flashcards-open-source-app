// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { AppDataContextValue } from "../appData/types";
import type { ProgressSeriesSnapshot, ProgressSummarySnapshot } from "../types";

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

vi.mock("../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("../appData/progressInvalidation", () => ({
  useProgressInvalidationState: useProgressInvalidationStateMock,
}));

vi.mock("../appData/progressSource", async () => {
  const actualModule = await vi.importActual<typeof import("../appData/progressSource")>("../appData/progressSource");

  return {
    ...actualModule,
    useProgressSource: useProgressSourceMock,
  };
});

import { ProgressScreen } from "./ProgressScreen";

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
    { date: "2026-04-20", reviewCount: 3 },
    { date: "2026-04-21", reviewCount: 5 },
  ] as const;

  return {
    timeZone: "UTC",
    from: "2026-04-20",
    to: "2026-04-21",
    generatedAt: "2026-04-21T10:00:00.000Z",
    dailyReviews,
    chartData: {
      dailyReviews,
    },
    source: "server",
    isApproximate: false,
  };
}

describe("ProgressScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    HTMLElement.prototype.scrollIntoView = vi.fn();

    useAppDataMock.mockReturnValue(createAppData());
    useProgressInvalidationStateMock.mockReturnValue({
      progressLocalVersion: 0,
      progressServerInvalidationVersion: 0,
    });
    useProgressSourceMock.mockReturnValue({
      progressSourceState: {
        summary: {
          scopeKey: "progress::summary::UTC::2026-04-21",
          localFallback: null,
          serverBase: createProgressSummarySnapshot(),
          hasPendingLocalReviews: false,
          renderedSnapshot: createProgressSummarySnapshot(),
          isLoading: false,
          errorMessage: "",
        },
        series: {
          scopeKey: "progress::series::UTC::2026-04-20::2026-04-21",
          localFallback: null,
          serverBase: createProgressSeriesSnapshot(),
          pendingLocalOverlay: null,
          renderedSnapshot: createProgressSeriesSnapshot(),
          isLoading: false,
          errorMessage: "",
        },
      },
      refreshProgress: refreshProgressMock,
    });
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
        <I18nProvider>
          <ProgressScreen />
        </I18nProvider>,
      );
    });

    expect(container.textContent).not.toContain("🔥");

    const summaryBadgeIcon = container.querySelector(".progress-streak-summary .review-progress-badge-icon");
    if (!(summaryBadgeIcon instanceof SVGSVGElement)) {
      throw new Error("Progress summary badge SVG icon was not found");
    }

    const streakMarkerIcons = [...container.querySelectorAll(".progress-streak-marker .review-progress-badge-icon")];
    expect(streakMarkerIcons.length).toBeGreaterThan(0);
    expect(streakMarkerIcons.every((icon) => icon instanceof SVGSVGElement)).toBe(true);
  });
});
