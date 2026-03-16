// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSettingsScreen } from "./WorkspaceSettingsScreen";
import type { Card, Deck } from "../types";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    },
    cards: [] as Array<Card>,
    decks: [] as Array<Deck>,
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
  },
}));

const {
  loadDecksListSnapshotMock,
  loadWorkspaceTagsSummaryMock,
} = vi.hoisted(() => ({
  loadDecksListSnapshotMock: vi.fn(),
  loadWorkspaceTagsSummaryMock: vi.fn(),
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

vi.mock("../localDb/decks", () => ({
  loadDecksListSnapshot: loadDecksListSnapshotMock,
}));

vi.mock("../localDb/workspace", () => ({
  loadWorkspaceTagsSummary: loadWorkspaceTagsSummaryMock,
}));

describe("WorkspaceSettingsScreen", () => {
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
        createdAt: "2026-03-10T00:00:00.000Z",
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
    loadDecksListSnapshotMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockReset();
    loadDecksListSnapshotMock.mockResolvedValue({
      deckSummaries: [{
        deckId: "deck-1",
        name: "Grammar",
        filterDefinition: {
          version: 2,
          effortLevels: ["fast"],
          tags: ["grammar"],
        },
        createdAt: "2026-03-10T09:00:00.000Z",
        totalCards: 1,
        dueCards: 1,
        newCards: 1,
        reviewedCards: 0,
      }],
      allCardsStats: {
        totalCards: 1,
        dueCards: 1,
        newCards: 1,
        reviewedCards: 0,
      },
    });
    loadWorkspaceTagsSummaryMock.mockResolvedValue({
      tags: [
        { tag: "grammar", cardsCount: 1 },
        { tag: "verbs", cardsCount: 1 },
      ],
      totalCards: 1,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders workspace settings entries in grouped order", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <WorkspaceSettingsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Workspace Settings");
    expect(container.textContent).toContain("Workspace Data");
    expect(container.textContent).toContain("Decks");
    expect(container.textContent).toContain("Tags");
    expect(container.textContent).toContain("Settings");
    expect(container.textContent).toContain("Overview");
    expect(container.textContent).toContain("Scheduler");
    expect(container.textContent).toContain("Export");
    expect(container.textContent).toContain("Device");
    expect(container.textContent).toContain("This Device");

    const links = Array.from(container.querySelectorAll(".settings-nav-card")).map((element) => element.getAttribute("href"));
    expect(links).toEqual([
      "/settings/workspace/decks",
      "/settings/workspace/tags",
      "/settings/workspace/overview",
      "/settings/workspace/scheduler",
      "/settings/workspace/export",
      "/settings/workspace/device",
    ]);
  });
});
