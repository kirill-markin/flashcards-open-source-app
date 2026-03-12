// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsScreen } from "./SettingsScreen";
import type { Card, Deck } from "../types";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Spanish",
      createdAt: "2026-03-10T09:00:00.000Z",
    },
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
    refreshCards: vi.fn(async () => undefined),
    refreshDecks: vi.fn(async () => undefined),
  },
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

describe("SettingsScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.cards = [
      {
        cardId: "card-1",
        frontText: "Front",
        backText: "Back",
        tags: ["grammar", "verbs"],
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
        clientUpdatedAt: "2026-03-10T00:00:00.000Z",
        lastModifiedByDeviceId: "device-1",
        lastOperationId: "op-1",
        updatedAt: "2026-03-10T00:00:00.000Z",
        deletedAt: null,
      },
    ];
    mockAppData.decks = [{
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
    }];
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.ensureDecksLoaded.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders workspace settings entries for decks and tags with summary counts", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <SettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(mockAppData.ensureCardsLoaded).toHaveBeenCalledTimes(1);
    expect(mockAppData.ensureDecksLoaded).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Workspace navigation matches iOS");
    expect(container.textContent).toContain("Spanish");
    expect(container.textContent).toContain("Decks");
    expect(container.textContent).toContain("1 total");
    expect(container.textContent).toContain("Tags");

    const links = Array.from(container.querySelectorAll(".settings-nav-card")).map((element) => element.getAttribute("href"));
    expect(links).toEqual(["/settings/decks", "/settings/tags"]);
  });
});
