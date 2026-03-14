// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecksScreen } from "./DecksScreen";
import type { Card, Deck } from "../types";

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
    decksState: {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    },
    ensureCardsLoaded: vi.fn(async () => undefined),
    ensureDecksLoaded: vi.fn(async () => undefined),
    refreshCards: vi.fn(async () => undefined),
    refreshDecks: vi.fn(async () => undefined),
  },
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

function collapseText(value: string | null): string {
  return value?.replace(/\s+/g, "").trim() ?? "";
}

describe("DecksScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.ensureDecksLoaded.mockClear();
    mockAppData.refreshCards.mockClear();
    mockAppData.refreshDecks.mockClear();
    mockAppData.cards = [];
    mockAppData.cardsState = {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    };
    mockAppData.decks = [];
    mockAppData.decksState = {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("renders All cards first, requests cards and decks, and shows derived stats", async () => {
    mockAppData.cards = [
      {
        cardId: "card-1",
        frontText: "Front 1",
        backText: "Back 1",
        tags: ["grammar", "verbs"],
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
      },
      {
        cardId: "card-2",
        frontText: "Front 2",
        backText: "Back 2",
        tags: ["grammar", "verbs"],
        effortLevel: "fast",
        dueAt: "2026-03-10T11:00:00.000Z",
        createdAt: "2026-03-10T09:00:00.000Z",
        reps: 1,
        lapses: 0,
        fsrsCardState: "review",
        fsrsStepIndex: null,
        fsrsStability: null,
        fsrsDifficulty: null,
        fsrsLastReviewedAt: null,
        fsrsScheduledDays: null,
        clientUpdatedAt: "2026-03-10T09:00:00.000Z",
        lastModifiedByDeviceId: "device-1",
        lastOperationId: "operation-2",
        updatedAt: "2026-03-10T09:00:00.000Z",
        deletedAt: null,
      },
      {
        cardId: "card-3",
        frontText: "Front 3",
        backText: "Back 3",
        tags: ["travel"],
        effortLevel: "long",
        dueAt: "2026-03-10T15:00:00.000Z",
        createdAt: "2026-03-10T09:00:00.000Z",
        reps: 2,
        lapses: 0,
        fsrsCardState: "review",
        fsrsStepIndex: null,
        fsrsStability: null,
        fsrsDifficulty: null,
        fsrsLastReviewedAt: null,
        fsrsScheduledDays: null,
        clientUpdatedAt: "2026-03-10T09:00:00.000Z",
        lastModifiedByDeviceId: "device-1",
        lastOperationId: "operation-3",
        updatedAt: "2026-03-10T09:00:00.000Z",
        deletedAt: null,
      },
    ];
    mockAppData.decks = [
      {
        deckId: "deck-1",
        workspaceId: "workspace-1",
        name: "Grammar",
        filterDefinition: {
          version: 2,
          effortLevels: ["fast"],
          tags: ["grammar", "verbs"],
        },
        createdAt: "2026-03-10T09:00:00.000Z",
        clientUpdatedAt: "2026-03-10T09:00:00.000Z",
        lastModifiedByDeviceId: "device-1",
        lastOperationId: "deck-operation-1",
        updatedAt: "2026-03-10T09:00:00.000Z",
        deletedAt: null,
      },
    ];

    await act(async () => {
      root.render(
        <MemoryRouter>
          <DecksScreen />
        </MemoryRouter>,
      );
    });

    expect(mockAppData.ensureCardsLoaded).toHaveBeenCalledTimes(1);
    expect(mockAppData.ensureDecksLoaded).toHaveBeenCalledTimes(1);

    const deckTitles = Array.from(container.querySelectorAll(".deck-card-title")).map((element) => element.textContent);
    expect(deckTitles).toEqual(["All cards", "Grammar"]);
    expect(container.textContent).toContain("2 total");
    const deckLinks = Array.from(container.querySelectorAll(".deck-card-link")).map((element) => element.getAttribute("href"));
    expect(deckLinks).toEqual(["/settings/workspace/decks/all-cards", "/settings/workspace/decks/deck-1"]);

    const deckCards = Array.from(container.querySelectorAll(".deck-card"));

    expect(collapseText(deckCards[0]?.textContent)).toContain("Allcards2dueAllcards3cards1new2reviewed");
    expect(collapseText(deckCards[1]?.textContent)).toContain(
      "Grammar2dueeffortinfastANDtagsanyofgrammar,verbs2cards1new1reviewed",
    );
  });

  it("shows the synthetic All cards entry even when there are no persisted decks", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <DecksScreen />
        </MemoryRouter>,
      );
    });

    const deckTitles = Array.from(container.querySelectorAll(".deck-card-title")).map((element) => element.textContent);
    const deckLinks = Array.from(container.querySelectorAll(".deck-card-link")).map((element) => element.getAttribute("href"));

    expect(deckTitles).toEqual(["All cards"]);
    expect(deckLinks).toEqual(["/settings/workspace/decks/all-cards"]);
    expect(container.textContent).toContain("1 total");
    expect(container.textContent).not.toContain("You haven't created any decks yet.");
  });
});
