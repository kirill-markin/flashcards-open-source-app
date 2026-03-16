// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TagsScreen } from "./TagsScreen";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    },
    cards: [
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
      {
        cardId: "card-2",
        frontText: "Front 2",
        backText: "Back 2",
        tags: ["grammar"],
        effortLevel: "medium",
        dueAt: null,
        reps: 1,
        lapses: 0,
        fsrsCardState: "review",
        fsrsStepIndex: null,
        fsrsStability: null,
        fsrsDifficulty: null,
        fsrsLastReviewedAt: null,
        fsrsScheduledDays: null,
        clientUpdatedAt: "2026-03-10T00:00:00.000Z",
        lastModifiedByDeviceId: "device-1",
        lastOperationId: "op-2",
        updatedAt: "2026-03-10T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    cardsState: {
      status: "ready",
      items: [],
      errorMessage: "",
      hasLoaded: true,
    },
    ensureCardsLoaded: vi.fn(async () => undefined),
    refreshCards: vi.fn(async () => undefined),
  },
}));

const { loadWorkspaceTagsSummaryMock } = vi.hoisted(() => ({
  loadWorkspaceTagsSummaryMock: vi.fn(),
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

vi.mock("../localDb/workspace", () => ({
  loadWorkspaceTagsSummary: loadWorkspaceTagsSummaryMock,
}));

describe("TagsScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    loadWorkspaceTagsSummaryMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockResolvedValue({
      tags: [
        { tag: "grammar", cardsCount: 2 },
        { tag: "verbs", cardsCount: 1 },
      ],
      totalCards: 2,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders workspace tag counts and the non-overlapping total card count", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter>
          <TagsScreen />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Tags");
    expect(container.textContent).toContain("2 total");
    expect(container.textContent).toContain("grammar");
    expect(container.textContent).toContain("2 cards");
    expect(container.textContent).toContain("verbs");
    expect(container.textContent).toContain("1 card");
    expect(container.textContent).toContain("Total cards");
    expect(container.textContent).toContain("2");
  });
});
