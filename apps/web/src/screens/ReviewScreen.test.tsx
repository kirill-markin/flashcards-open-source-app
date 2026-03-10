// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "./ReviewScreen";
import type { Card, Deck, ReviewFilter } from "../types";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    cards: [] as Array<Card>,
    cardsState: {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    },
    decks: [] as Array<Deck>,
    reviewQueue: [] as Array<Card>,
    reviewTimeline: [] as Array<Card>,
    reviewQueueState: {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    },
    selectedReviewFilter: {
      kind: "allCards",
    } as ReviewFilter,
    selectedReviewFilterTitle: "All cards",
    workspaceSettings: {
      algorithm: "fsrs-6",
      desiredRetention: 0.9,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [10],
      maximumIntervalDays: 36500,
      enableFuzz: true,
      clientUpdatedAt: "2026-03-10T09:00:00.000Z",
      lastModifiedByDeviceId: "device-1",
      lastOperationId: "settings-operation-1",
      updatedAt: "2026-03-10T09:00:00.000Z",
    },
    ensureCardsLoaded: vi.fn(async () => undefined),
    ensureDecksLoaded: vi.fn(async () => undefined),
    ensureReviewQueueLoaded: vi.fn(async () => undefined),
    refreshReviewQueue: vi.fn(async () => undefined),
    selectReviewFilter: vi.fn(),
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
    dueAt: null,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function createDeck(overrides?: Partial<Deck>): Deck {
  return {
    deckId: "deck-1",
    workspaceId: "workspace-1",
    name: "Grammar",
    filterDefinition: {
      version: 2,
      effortLevels: ["fast"],
      tags: ["grammar"],
    },
    createdAt: "2026-03-10T09:00:00.000Z",
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "deck-operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function setSelectValue(select: HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  descriptor?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("ReviewScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.cards = [];
    mockAppData.decks = [];
    mockAppData.reviewQueue = [];
    mockAppData.reviewTimeline = [];
    mockAppData.selectedReviewFilter = { kind: "allCards" } as ReviewFilter;
    mockAppData.selectedReviewFilterTitle = "All cards";
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.ensureDecksLoaded.mockClear();
    mockAppData.ensureReviewQueueLoaded.mockClear();
    mockAppData.refreshReviewQueue.mockClear();
    mockAppData.selectReviewFilter.mockClear();
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

  it("renders the selected deck-specific queue and timeline", async () => {
    const grammarCard = createCard({
      cardId: "grammar-card",
      frontText: "Grammar front",
      tags: ["grammar"],
    });
    mockAppData.decks = [createDeck()];
    mockAppData.cards = [grammarCard];
    mockAppData.reviewQueue = [grammarCard];
    mockAppData.reviewTimeline = [grammarCard];
    mockAppData.selectedReviewFilter = { kind: "deck", deckId: "deck-1" } as ReviewFilter;
    mockAppData.selectedReviewFilterTitle = "Grammar";

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Grammar");
    expect(container.textContent).toContain("Grammar front");
    expect(container.textContent).not.toContain("No cards to review right now.");
  });

  it("lists All cards and deck filters and dispatches the selected deck filter", async () => {
    mockAppData.decks = [createDeck()];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const select = container.querySelector(".review-filter-select");
    const options = Array.from(container.querySelectorAll(".review-filter-select option")).map((option) => option.textContent);

    expect(select).not.toBeNull();
    expect(options).toEqual(["All cards", "Grammar"]);

    await act(async () => {
      setSelectValue(select as HTMLSelectElement, "deck-1");
    });

    expect(mockAppData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-1" });
  });
});
