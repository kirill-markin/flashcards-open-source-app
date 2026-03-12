// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "./ReviewScreen";
import type { Card, Deck, ReviewFilter } from "../types";
import { cardsRoute, chatRoute } from "../routes";

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

    expect(menuChildren).toEqual(["All cards", "Grammar", "Edit decks", "divider", "grammar (2)", "travel (1)", "verbs (1)"]);

    const grammarButton = container.querySelector('[data-review-filter-key="deck:deck-1"]');

    expect(grammarButton).not.toBeNull();

    await act(async () => {
      clickElement(grammarButton as HTMLButtonElement);
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
    expect(editDecksLink?.getAttribute("href")).toBe("/settings/decks");
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

    expect(container.querySelector(".review-front")?.getAttribute("data-presentation-mode")).toBe("paragraphPlain");
    expect(container.querySelector(".review-back")?.getAttribute("data-presentation-mode")).toBe("paragraphPlain");
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

    expect(container.querySelector(".review-front")?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(container.querySelector(".review-front h1")?.textContent).toBe("Heading");
    expect(container.querySelectorAll(".review-front ul li")).toHaveLength(2);
    expect(container.querySelector(".review-back")?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(container.querySelector(".review-back pre code")?.textContent).toContain("const answer = 42;");
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
