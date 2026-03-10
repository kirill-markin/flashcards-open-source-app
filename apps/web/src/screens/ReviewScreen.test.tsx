// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "./ReviewScreen";
import type { Card, WorkspaceSchedulerSettings } from "../types";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    cards: [] as Array<Card>,
    cardsState: {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    },
    reviewQueue: [] as Array<Card>,
    reviewQueueState: {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    },
    workspaceSettings: null as WorkspaceSchedulerSettings | null,
    ensureCardsLoaded: vi.fn(async () => undefined),
    ensureReviewQueueLoaded: vi.fn(async () => undefined),
    refreshReviewQueue: vi.fn(async () => undefined),
    submitReviewItem: vi.fn(async () => {
      throw new Error("not used");
    }),
    updateCardItem: vi.fn(async () => {
      throw new Error("not used");
    }),
    deleteCardItem: vi.fn(async () => {
      throw new Error("not used");
    }),
    setErrorMessage: vi.fn(),
  },
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

function createCard(overrides?: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: [],
    effortLevel: "fast",
    dueAt: "2026-03-10T11:30:00.000Z",
    reps: 3,
    lapses: 1,
    fsrsCardState: "review",
    fsrsStepIndex: null,
    fsrsStability: 6,
    fsrsDifficulty: 5,
    fsrsLastReviewedAt: "2026-03-09T11:30:00.000Z",
    fsrsScheduledDays: 2,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function createWorkspaceSchedulerSettings(): WorkspaceSchedulerSettings {
  return {
    algorithm: "fsrs-6",
    desiredRetention: 0.9,
    learningStepsMinutes: [1, 10],
    relearningStepsMinutes: [10],
    maximumIntervalDays: 36500,
    enableFuzz: false,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "settings-operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
  };
}

function clickElement(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("ReviewScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.cards = [];
    mockAppData.cardsState = {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    };
    mockAppData.reviewQueue = [];
    mockAppData.reviewQueueState = {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    };
    mockAppData.workspaceSettings = createWorkspaceSchedulerSettings();
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.ensureReviewQueueLoaded.mockClear();
    mockAppData.refreshReviewQueue.mockClear();
    mockAppData.submitReviewItem.mockClear();
    mockAppData.updateCardItem.mockClear();
    mockAppData.deleteCardItem.mockClear();
    mockAppData.setErrorMessage.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renders review answer buttons in the iOS two-column order", async () => {
    const card = createCard();
    mockAppData.cards = [card];
    mockAppData.cardsState = {
      status: "ready",
      items: [card],
      errorMessage: "",
      hasLoaded: true,
    };
    mockAppData.reviewQueue = [card];
    mockAppData.reviewQueueState = {
      status: "ready",
      items: [card],
      errorMessage: "",
      hasLoaded: true,
    };

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const revealButton = container.querySelector(".review-reveal-btn");

    expect(revealButton).not.toBeNull();

    await act(async () => {
      clickElement(revealButton as HTMLButtonElement);
    });

    const ratingColumns = Array.from(container.querySelectorAll(".rating-bar-column"));
    const titlesByColumn = ratingColumns.map((column) => (
      Array.from(column.querySelectorAll(".rating-btn-title")).map((element) => element.textContent)
    ));
    const allTitles = Array.from(container.querySelectorAll(".rating-btn-title")).map((element) => element.textContent);

    expect(ratingColumns).toHaveLength(2);
    expect(titlesByColumn).toEqual([
      ["Easy", "Good"],
      ["Hard", "Again"],
    ]);
    expect(allTitles).toEqual(["Easy", "Good", "Hard", "Again"]);
  });
});
