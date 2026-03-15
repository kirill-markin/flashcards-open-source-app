// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeReviewMarkdownForWeb, ReviewScreen } from "./ReviewScreen";
import type { Card, Deck, ReviewFilter } from "../types";
import { cardsRoute, chatRoute } from "../routes";

const {
  loadDecksListSnapshotMock,
  loadReviewQueueChunkMock,
  loadReviewQueueSnapshotMock,
  loadReviewTimelinePageMock,
  loadWorkspaceTagsSummaryMock,
  mockAppData,
} = vi.hoisted(() => ({
  loadDecksListSnapshotMock: vi.fn(),
  loadReviewQueueChunkMock: vi.fn(),
  loadReviewQueueSnapshotMock: vi.fn(),
  loadReviewTimelinePageMock: vi.fn(),
  loadWorkspaceTagsSummaryMock: vi.fn(),
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
    localReadVersion: 0,
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

vi.mock("../localDb/decks", () => ({
  loadDecksListSnapshot: loadDecksListSnapshotMock,
}));

vi.mock("../localDb/reviews", () => ({
  loadReviewQueueChunk: loadReviewQueueChunkMock,
  loadReviewQueueSnapshot: loadReviewQueueSnapshotMock,
  loadReviewTimelinePage: loadReviewTimelinePageMock,
}));

vi.mock("../localDb/workspace", () => ({
  loadWorkspaceTagsSummary: loadWorkspaceTagsSummaryMock,
}));

function createCard(overrides?: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: [],
    effortLevel: "fast",
    dueAt: null,
    createdAt: "2026-03-10T09:00:00.000Z",
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

function clickElement(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function createDecks(names: ReadonlyArray<string>): Array<Deck> {
  return names.map((name, index) => createDeck({
    deckId: `deck-${index + 1}`,
    name,
    updatedAt: `2026-03-10T${String(index).padStart(2, "0")}:00:00.000Z`,
  }));
}

const reviewStylesheet = readFileSync(resolve(process.cwd(), "src/styles/features/review.css"), "utf8");

function reviewStylesContain(...fragments: ReadonlyArray<string>): boolean {
  return fragments.every((fragment) => reviewStylesheet.includes(fragment));
}

describe("normalizeReviewMarkdownForWeb", () => {
  it("escapes symbol-only unordered list items that reopen markdown", () => {
    const source = [
      "- +",
      "- *",
      "- -",
      "- >",
      "- #",
    ].join("\n");

    expect(normalizeReviewMarkdownForWeb(source)).toBe([
      "- \\+",
      "- \\*",
      "- \\-",
      "- \\>",
      "- \\#",
    ].join("\n"));
  });

  it("keeps ordinary unordered list items unchanged", () => {
    const source = [
      "- A-Z",
      "- 0-9",
    ].join("\n");

    expect(normalizeReviewMarkdownForWeb(source)).toBe(source);
  });

  it("does not normalize symbol-only list items inside fenced code blocks", () => {
    const source = [
      "```md",
      "- +",
      "```",
      "- +",
    ].join("\n");

    expect(normalizeReviewMarkdownForWeb(source)).toBe([
      "```md",
      "- +",
      "```",
      "- \\+",
    ].join("\n"));
  });
});

describe("ReviewScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    loadDecksListSnapshotMock.mockReset();
    loadReviewQueueChunkMock.mockReset();
    loadReviewQueueSnapshotMock.mockReset();
    loadReviewTimelinePageMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockReset();
    mockAppData.cards = [];
    mockAppData.decks = [];
    mockAppData.reviewQueue = [];
    mockAppData.reviewTimeline = [];
    mockAppData.selectedReviewFilter = { kind: "allCards" } as ReviewFilter;
    mockAppData.selectedReviewFilterTitle = "All cards";
    mockAppData.localReadVersion = 0;
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.ensureDecksLoaded.mockClear();
    mockAppData.ensureReviewQueueLoaded.mockClear();
    mockAppData.refreshReviewQueue.mockClear();
    mockAppData.selectReviewFilter.mockClear();
    mockAppData.setErrorMessage.mockClear();
    loadDecksListSnapshotMock.mockImplementation(async () => ({
      deckSummaries: mockAppData.decks.map((deck) => ({
        deckId: deck.deckId,
        name: deck.name,
        filterDefinition: deck.filterDefinition,
        createdAt: deck.createdAt,
        totalCards: 0,
        dueCards: 0,
        newCards: 0,
        reviewedCards: 0,
      })),
      allCardsStats: {
        totalCards: mockAppData.cards.length,
        dueCards: mockAppData.reviewQueue.length,
        newCards: mockAppData.cards.filter((card) => card.reps === 0 && card.lapses === 0).length,
        reviewedCards: mockAppData.cards.filter((card) => card.reps > 0 || card.lapses > 0).length,
      },
    }));
    loadReviewQueueSnapshotMock.mockImplementation(async () => ({
      resolvedReviewFilter: mockAppData.selectedReviewFilter,
      cards: mockAppData.reviewQueue,
      nextCursor: null,
      reviewCounts: {
        dueCount: mockAppData.reviewQueue.length,
        totalCount: mockAppData.reviewQueue.length,
      },
    }));
    loadReviewQueueChunkMock.mockResolvedValue({
      cards: [],
      nextCursor: null,
    });
    loadReviewTimelinePageMock.mockImplementation(async () => ({
      cards: mockAppData.reviewTimeline,
      hasMoreCards: false,
    }));
    loadWorkspaceTagsSummaryMock.mockImplementation(async () => {
      const counts = new Map<string, number>();
      for (const card of mockAppData.cards) {
        for (const tag of card.tags) {
          counts.set(tag, (counts.get(tag) ?? 0) + 1);
        }
      }

      return {
        tags: [...counts.entries()].map(([tag, cardsCount]) => ({ tag, cardsCount })),
        totalCards: mockAppData.cards.length,
      };
    });
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

    expect(container.querySelector(".review-screen-panel")).not.toBeNull();
    expect(container.querySelector(".review-queue-subtitle")).toBeNull();
    expect(container.textContent).toContain("Grammar");
    expect(container.textContent).toContain("Grammar front");
    expect(container.textContent).not.toContain("No cards to review right now.");
  });

  it("fits review into the desktop viewport with internal pane and queue scrolling", () => {
    expect(reviewStylesContain(
      ".review-screen-panel {",
      "grid-template-rows: auto minmax(0, 1fr);",
      "max-height: calc(100dvh - 156px);",
      "overflow: hidden;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-layout {",
      "align-items: stretch;",
      "min-height: 0;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-pane {",
      "overflow-y: auto;",
      "scrollbar-gutter: stable;",
      "scroll-padding-bottom: 152px;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-queue-panel {",
      "grid-template-rows: auto minmax(0, 1fr);",
      "overflow: hidden;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-queue-head {",
      "position: sticky;",
      "top: 0;",
      "background: transparent;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-queue-list {",
      "overflow-y: auto;",
      "overscroll-behavior: contain;",
      "scrollbar-gutter: stable;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-surface {",
      "min-height: 132px;",
      "grid-template-rows: auto minmax(76px, 1fr);",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-surface-front {",
      "min-height: auto;",
      "grid-template-rows: auto auto;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-surface-front .review-card-body {",
      "min-height: 0;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-body {",
      "min-height: 76px;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-actions-dock {",
      "position: sticky;",
      "background: transparent;",
      "border: none;",
      "box-shadow: none;",
    )).toBe(true);
    expect(reviewStylesContain(
      "@media (max-width: 1024px) {",
      "max-height: none;",
      "overflow: visible;",
      "grid-template-columns: 1fr;",
      "scroll-padding-bottom: 0;",
      "position: static;",
      "scrollbar-gutter: auto;",
    )).toBe(true);
  });

  it("shows all empty-state review actions for non-All-cards filters", async () => {
    mockAppData.decks = [createDeck()];
    mockAppData.selectedReviewFilter = { kind: "deck", deckId: "deck-1" } as ReviewFilter;
    mockAppData.selectedReviewFilterTitle = "Grammar";

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const links = Array.from(container.querySelectorAll(".review-empty-actions a"));
    const switchButton = Array.from(container.querySelectorAll(".review-empty-actions button"))
      .find((element) => element.textContent?.trim() === "switch to all cards deck");

    expect(container.textContent).toContain("No Cards Yet");
    expect(container.textContent).toContain("Create card");
    expect(container.textContent).toContain("Create with AI");
    expect(container.textContent).toContain("switch to all cards deck");
    expect(links.map((element) => element.getAttribute("href"))).toEqual([`${cardsRoute}/new`, chatRoute]);
    expect(switchButton).not.toBeUndefined();

    await act(async () => {
      clickElement(switchButton as HTMLButtonElement);
    });

    expect(mockAppData.selectReviewFilter).toHaveBeenCalledWith({ kind: "allCards" });
  });

  it("shows only creation empty-state review actions for All cards", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("No Cards Yet");
    expect(container.textContent).toContain("Create card");
    expect(container.textContent).toContain("Create with AI");
    expect(container.textContent).not.toContain("switch to all cards deck");
  });

  it("lists review filter rows in order and dispatches the selected deck filter", async () => {
    mockAppData.decks = [createDeck()];
    mockAppData.cards = [
      createCard({
        cardId: "grammar-card",
        tags: ["grammar", "verbs"],
      }),
      createCard({
        cardId: "grammar-card-2",
        tags: ["grammar"],
        updatedAt: "2026-03-10T10:00:00.000Z",
      }),
      createCard({
        cardId: "travel-card",
        tags: ["travel"],
        updatedAt: "2026-03-10T11:00:00.000Z",
      }),
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector(".review-filter-trigger");

    expect(trigger).not.toBeNull();

    await act(async () => {
      clickElement(trigger as HTMLButtonElement);
    });

    const menuChildren = Array.from(container.querySelector(".review-filter-menu")?.children ?? []).map((element) => {
      if (element.classList.contains("review-filter-menu-divider")) {
        return "divider";
      }

      return element.textContent?.trim();
    });

    expect(menuChildren).toEqual(["All cards", "Grammar", "Edit decks", "divider", "grammar (2)", "verbs (1)", "travel (1)"]);

    const grammarButton = container.querySelector('[data-review-filter-key="deck:deck-1"]');

    expect(grammarButton).not.toBeNull();

    await act(async () => {
      clickElement(grammarButton as HTMLButtonElement);
    });

    expect(mockAppData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-1" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("does not show filter search when there are 7 or fewer deck and tag choices total", async () => {
    mockAppData.decks = createDecks([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Epsilon",
      "Zeta",
    ]);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      clickElement(container.querySelector(".review-filter-trigger") as HTMLButtonElement);
    });

    expect(container.querySelector('input[name="review-filter-search"]')).toBeNull();
  });

  it("shows filter search and autofocuses it when deck and tag choices total more than 7", async () => {
    mockAppData.decks = createDecks([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    mockAppData.cards = [
      createCard({ cardId: "card-1", tags: ["grammar", "verbs"] }),
      createCard({ cardId: "card-2", tags: ["travel", "database"] }),
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      clickElement(container.querySelector(".review-filter-trigger") as HTMLButtonElement);
    });

    const searchInput = container.querySelector('input[name="review-filter-search"]');

    expect(searchInput).not.toBeNull();
    expect(document.activeElement).toBe(searchInput);
  });

  it("filters review filter entries case-insensitively and still matches All cards", async () => {
    mockAppData.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      clickElement(container.querySelector(".review-filter-trigger") as HTMLButtonElement);
    });

    const searchInput = container.querySelector('input[name="review-filter-search"]');

    expect(searchInput).not.toBeNull();

    await act(async () => {
      setInputValue(searchInput as HTMLInputElement, "ALL");
    });

    expect(container.querySelector('[data-review-filter-key="allCards"]')).not.toBeNull();
    expect(container.querySelector('[data-review-filter-key="deck:deck-1"]')).toBeNull();

    await act(async () => {
      setInputValue(searchInput as HTMLInputElement, "py");
    });

    expect(container.querySelector('[data-review-filter-key="allCards"]')).toBeNull();
    expect(container.querySelector('[data-review-filter-key="deck:deck-1"]')).not.toBeNull();
    expect(container.querySelector('[data-review-filter-key="deck:deck-2"]')).toBeNull();
  });

  it("filters tags too when search is active", async () => {
    mockAppData.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);
    mockAppData.cards = [
      createCard({
        cardId: "grammar-card",
        tags: ["grammar", "verbs"],
      }),
      createCard({
        cardId: "travel-card",
        tags: ["travel"],
        updatedAt: "2026-03-10T11:00:00.000Z",
      }),
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      clickElement(container.querySelector(".review-filter-trigger") as HTMLButtonElement);
    });

    const searchInput = container.querySelector('input[name="review-filter-search"]');

    await act(async () => {
      setInputValue(searchInput as HTMLInputElement, "travel");
    });

    const travelDeckButton = container.querySelector('[data-review-filter-key="deck:deck-7"]');
    const travelTagButton = container.querySelector('[data-review-filter-key="tag:travel"]');

    expect(travelDeckButton).not.toBeNull();
    expect(travelTagButton).not.toBeNull();
    expect(container.querySelector('[data-review-filter-key="tag:grammar"]')).toBeNull();
    expect(container.textContent).toContain("Edit decks");

    await act(async () => {
      clickElement(travelTagButton as HTMLButtonElement);
    });

    expect(mockAppData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tag", tag: "travel" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("shows a no-match filter state while keeping Edit decks visible", async () => {
    mockAppData.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);
    mockAppData.cards = [
      createCard({
        cardId: "grammar-card",
        tags: ["grammar"],
      }),
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      clickElement(container.querySelector(".review-filter-trigger") as HTMLButtonElement);
    });

    const searchInput = container.querySelector('input[name="review-filter-search"]');

    await act(async () => {
      setInputValue(searchInput as HTMLInputElement, "zzz");
    });

    expect(container.querySelector(".review-filter-menu-empty")?.textContent).toContain("No decks or tags found");
    expect(container.textContent).toContain("Edit decks");
    expect(container.querySelector('[data-review-filter-key="allCards"]')).toBeNull();
    expect(container.querySelector('[data-review-filter-key="tag:grammar"]')).toBeNull();
  });

  it("starts filter search empty each time the menu is reopened", async () => {
    mockAppData.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector(".review-filter-trigger");

    await act(async () => {
      clickElement(trigger as HTMLButtonElement);
    });

    const firstSearchInput = container.querySelector('input[name="review-filter-search"]');

    await act(async () => {
      setInputValue(firstSearchInput as HTMLInputElement, "python");
    });

    await act(async () => {
      clickElement(trigger as HTMLButtonElement);
    });

    await act(async () => {
      clickElement(trigger as HTMLButtonElement);
    });

    const secondSearchInput = container.querySelector('input[name="review-filter-search"]') as HTMLInputElement;

    expect(secondSearchInput.value).toBe("");
  });

  it("dispatches the selected filtered deck and closes the menu", async () => {
    mockAppData.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      clickElement(container.querySelector(".review-filter-trigger") as HTMLButtonElement);
    });

    const searchInput = container.querySelector('input[name="review-filter-search"]');

    await act(async () => {
      setInputValue(searchInput as HTMLInputElement, "python");
    });

    const pythonButton = container.querySelector('[data-review-filter-key="deck:deck-1"]');

    expect(pythonButton).not.toBeNull();

    await act(async () => {
      clickElement(pythonButton as HTMLButtonElement);
    });

    expect(mockAppData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-1" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("dispatches the selected tag filter", async () => {
    mockAppData.cards = [
      createCard({
        cardId: "grammar-card",
        tags: ["grammar", "verbs"],
      }),
      createCard({
        cardId: "travel-card",
        tags: ["travel"],
        updatedAt: "2026-03-10T11:00:00.000Z",
      }),
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const trigger = container.querySelector(".review-filter-trigger");

    await act(async () => {
      clickElement(trigger as HTMLButtonElement);
    });

    const tagButton = container.querySelector('[data-review-filter-key="tag:grammar"]');

    expect(tagButton).not.toBeNull();

    await act(async () => {
      clickElement(tagButton as HTMLButtonElement);
    });

    expect(mockAppData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tag", tag: "grammar" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("renders the Edit decks shortcut inside the review filter menu", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".review-edit-decks-link")).toBeNull();

    const trigger = container.querySelector(".review-filter-trigger");

    expect(trigger).not.toBeNull();

    await act(async () => {
      clickElement(trigger as HTMLButtonElement);
    });

    const editDecksLink = Array.from(container.querySelectorAll(".review-filter-menu-entry")).find((element) => element.textContent?.trim() === "Edit decks");

    expect(editDecksLink).not.toBeUndefined();
    expect(editDecksLink?.getAttribute("href")).toBe("/settings/workspace/decks");
  });

  it("shows the review queue head as the current card", async () => {
    const topQueueCard = createCard({
      cardId: "top-queue-card",
      frontText: "Top queue front",
    });
    const secondQueueCard = createCard({
      cardId: "second-queue-card",
      frontText: "Second queue front",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    mockAppData.cards = [topQueueCard, secondQueueCard];
    mockAppData.reviewQueue = [topQueueCard, secondQueueCard];
    mockAppData.reviewTimeline = [topQueueCard, secondQueueCard];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".review-front")?.textContent).toContain("Top queue front");
    expect(container.querySelectorAll(".review-queue-card-active")).toHaveLength(1);
    expect(container.querySelector(".review-queue-card-active")?.textContent).toContain("Top queue front");
  });

  it("switches the current card when the queue head changes after rerender", async () => {
    const firstQueueHead = createCard({
      cardId: "first-queue-head",
      frontText: "First queue head",
    });
    const secondQueueHead = createCard({
      cardId: "second-queue-head",
      frontText: "Second queue head",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    mockAppData.cards = [firstQueueHead, secondQueueHead];
    mockAppData.reviewQueue = [firstQueueHead, secondQueueHead];
    mockAppData.reviewTimeline = [firstQueueHead, secondQueueHead];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".review-front")?.textContent).toContain("First queue head");

    mockAppData.reviewQueue = [secondQueueHead, firstQueueHead];
    mockAppData.reviewTimeline = [secondQueueHead, firstQueueHead];
    mockAppData.localReadVersion = 1;

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".review-front")?.textContent).toContain("Second queue head");
    expect(container.querySelector(".review-queue-card-active")?.textContent).toContain("Second queue head");
  });

  it("does not change the current card when clicking a non-head queue item", async () => {
    const topQueueCard = createCard({
      cardId: "top-queue-card",
      frontText: "Top queue front",
    });
    const secondQueueCard = createCard({
      cardId: "second-queue-card",
      frontText: "Second queue front",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    mockAppData.cards = [topQueueCard, secondQueueCard];
    mockAppData.reviewQueue = [topQueueCard, secondQueueCard];
    mockAppData.reviewTimeline = [topQueueCard, secondQueueCard];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const queueCards = container.querySelectorAll(".review-queue-card");
    expect(queueCards).toHaveLength(2);

    await act(async () => {
      queueCards[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".review-front")?.textContent).toContain("Top queue front");
    expect(container.querySelector(".review-queue-card-active")?.textContent).toContain("Top queue front");
  });

  it("renders short plain front text in centered short mode", async () => {
    mockAppData.cards = [createCard({ frontText: "Hola" })];
    mockAppData.reviewQueue = mockAppData.cards;
    mockAppData.reviewTimeline = mockAppData.cards;

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    const front = container.querySelector(".review-front");

    expect(front?.getAttribute("data-presentation-mode")).toBe("shortPlain");
    expect(front?.textContent).toContain("Hola");
  });

  it("keeps four-word one-line text in centered short mode", async () => {
    mockAppData.cards = [createCard({ frontText: "one two three four" })];
    mockAppData.reviewQueue = mockAppData.cards;
    mockAppData.reviewTimeline = mockAppData.cards;

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector(".review-front")?.getAttribute("data-presentation-mode")).toBe("shortPlain");
  });

  it("switches five-word text and multi-line text to paragraph mode", async () => {
    const paragraphCard = createCard({
      frontText: "one two three four five",
      backText: "First line\nSecond line",
    });
    mockAppData.cards = [paragraphCard];
    mockAppData.reviewQueue = [paragraphCard];
    mockAppData.reviewTimeline = [paragraphCard];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector(".review-reveal-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const front = container.querySelector(".review-front");
    const back = container.querySelector(".review-back");

    expect(front?.getAttribute("data-presentation-mode")).toBe("paragraphPlain");
    expect(back?.getAttribute("data-presentation-mode")).toBe("paragraphPlain");
    expect(reviewStylesContain(
      ".review-card-content-shortPlain,",
      ".review-card-content-paragraphPlain",
      "white-space: pre-wrap",
    )).toBe(true);
  });

  it("renders markdown content with semantic elements instead of centered mode", async () => {
    const markdownCard = createCard({
      frontText: "# Heading\n\n- item\n- item two",
      backText: "```ts\nconst answer = 42;\n```",
    });
    mockAppData.cards = [markdownCard];
    mockAppData.reviewQueue = [markdownCard];
    mockAppData.reviewTimeline = [markdownCard];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector(".review-reveal-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const front = container.querySelector(".review-front");
    const back = container.querySelector(".review-back");

    expect(front?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(reviewStylesContain(".review-card-content-markdown", "white-space: normal")).toBe(true);
    expect(container.querySelector(".review-front h1")?.textContent).toBe("Heading");
    expect(container.querySelectorAll(".review-front ul li")).toHaveLength(2);
    expect(back?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(container.querySelector(".review-back pre code")?.textContent).toContain("const answer = 42;");
  });

  it("renders symbol-only markdown list items as literal bullets without nested empty lists", async () => {
    const markdownCard = createCard({
      frontText: "Front",
      backText: [
        "Base64 alphabet:",
        "",
        "- A-Z",
        "",
        "- a-z",
        "",
        "- 0-9",
        "",
        "- +",
        "",
        "- /",
        "",
        "Characters that are in Base64 but not in Base32:",
        "",
        "- a-z",
        "",
        "- 0, 1, 8, 9",
        "",
        "- +",
        "",
        "- /",
      ].join("\n"),
    });
    mockAppData.cards = [markdownCard];
    mockAppData.reviewQueue = [markdownCard];
    mockAppData.reviewTimeline = [markdownCard];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector(".review-reveal-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const back = container.querySelector(".review-back");
    const backLists = Array.from(back?.querySelectorAll(".review-markdown-ul") ?? []);
    const topLevelLists = backLists.filter((list) => list.parentElement?.classList.contains("review-card-content-markdown"));
    const plusItems = Array.from(back?.querySelectorAll(".review-markdown-li") ?? [])
      .filter((item) => item.textContent?.trim() === "+");
    const emptyNestedLists = Array.from(back?.querySelectorAll(".review-markdown-li > .review-markdown-ul") ?? [])
      .filter((list) => list.textContent?.trim() === "");

    expect(back?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(reviewStylesContain(".review-card-content-markdown", "white-space: normal")).toBe(true);
    expect(topLevelLists).toHaveLength(2);
    expect(Array.from(topLevelLists[0]?.children ?? [])).toHaveLength(5);
    expect(Array.from(topLevelLists[1]?.children ?? [])).toHaveLength(4);
    expect(plusItems).toHaveLength(2);
    expect(emptyNestedLists).toHaveLength(0);
  });

  it("renders the empty back placeholder through the adaptive content view", async () => {
    const emptyBackCard = createCard({
      frontText: "Front",
      backText: "",
    });
    mockAppData.cards = [emptyBackCard];
    mockAppData.reviewQueue = [emptyBackCard];
    mockAppData.reviewTimeline = [emptyBackCard];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      container.querySelector(".review-reveal-btn")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const back = container.querySelector(".review-back");

    expect(back?.textContent).toContain("No back text");
    expect(back?.getAttribute("data-presentation-mode")).toBe("shortPlain");
  });
});
