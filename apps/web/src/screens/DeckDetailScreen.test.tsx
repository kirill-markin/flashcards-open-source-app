// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckDetailScreen } from "./DeckDetailScreen";
import type { Card, Deck } from "../types";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    cards: [] as Array<Card>,
    decks: [] as Array<Deck>,
    ensureCardsLoaded: vi.fn(async () => undefined),
    ensureDecksLoaded: vi.fn(async () => undefined),
    refreshCards: vi.fn(async () => undefined),
    refreshDecks: vi.fn(async () => undefined),
    getDeckById: vi.fn(async (): Promise<Deck> => {
      throw new Error("Deck not found: missing");
    }),
    deleteDeckItem: vi.fn(async (): Promise<Deck> => {
      throw new Error("not used");
    }),
    openReview: vi.fn(),
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

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("DeckDetailScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.cards = [];
    mockAppData.decks = [];
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.ensureDecksLoaded.mockClear();
    mockAppData.refreshCards.mockClear();
    mockAppData.refreshDecks.mockClear();
    mockAppData.getDeckById.mockReset();
    mockAppData.deleteDeckItem.mockClear();
    mockAppData.openReview.mockClear();
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

  it("renders the virtual All cards deck as read-only and opens review for all cards", async () => {
    mockAppData.cards = [
      createCard({
        cardId: "card-1",
        frontText: "Grammar front",
        tags: ["grammar"],
      }),
    ];

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/decks/all-cards"]}>
          <Routes>
            <Route path="/settings/decks/:deckId" element={<DeckDetailScreen />} />
            <Route path="/review" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("All cards");
    expect(container.textContent).toContain("Grammar front");
    expect(container.textContent).not.toContain("Edit deck");
    expect(container.textContent).not.toContain("Delete deck");

    await act(async () => {
      click(Array.from(container.querySelectorAll("button")).find((element) => element.textContent === "Open review") ?? null);
    });

    expect(mockAppData.openReview).toHaveBeenCalledWith({ kind: "allCards" });
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/review");
  });

  it("renders persisted deck actions and matching cards", async () => {
    mockAppData.cards = [
      createCard({
        cardId: "card-1",
        frontText: "Grammar front",
        tags: ["grammar", "verbs"],
        effortLevel: "fast",
      }),
      createCard({
        cardId: "card-2",
        frontText: "Travel front",
        tags: ["travel"],
        effortLevel: "long",
      }),
    ];
    mockAppData.decks = [createDeck()];
    mockAppData.getDeckById.mockResolvedValue(createDeck());

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/decks/deck-1"]}>
          <Routes>
            <Route path="/settings/decks/:deckId" element={<DeckDetailScreen />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Grammar");
    expect(container.textContent).toContain("Edit deck");
    expect(container.textContent).toContain("Delete deck");
    expect(container.textContent).toContain("Grammar front");
    expect(container.textContent).not.toContain("Travel front");
  });

  it("shows a not-found state for missing persisted decks", async () => {
    mockAppData.getDeckById.mockRejectedValue(new Error("Deck not found: missing"));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/decks/missing"]}>
          <Routes>
            <Route path="/settings/decks/:deckId" element={<DeckDetailScreen />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Deck not found");
  });
});
