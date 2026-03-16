// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildNextCardsTableSorts, CardsScreen } from "./CardsScreen";
import type { Card, QueryCardsPage } from "../types";

const {
  loadWorkspaceTagsSummaryMock,
  queryCardsMock,
  mockAppData,
} = vi.hoisted(() => ({
  loadWorkspaceTagsSummaryMock: vi.fn(),
  queryCardsMock: vi.fn(),
  mockAppData: {
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    },
    cards: [] as Array<Card>,
    ensureCardsLoaded: vi.fn(async () => undefined),
    refreshCards: vi.fn(async () => undefined),
    updateCardItem: vi.fn(async () => {
      throw new Error("not used");
    }),
    setErrorMessage: vi.fn(),
  },
}));

vi.mock("../localDb/cards", () => ({
  queryLocalCardsPage: queryCardsMock,
}));

vi.mock("../localDb/workspace", () => ({
  loadWorkspaceTagsSummary: loadWorkspaceTagsSummaryMock,
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

class IntersectionObserverMock {
  static instances: Array<IntersectionObserverMock> = [];

  readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    IntersectionObserverMock.instances.push(this);
  }

  observe(): void {}

  disconnect(): void {}

  unobserve(): void {}
}

function createCardsPage(overrides?: Partial<QueryCardsPage>): QueryCardsPage {
  return {
    cards: [],
    nextCursor: null,
    totalCount: 0,
    ...overrides,
  };
}

function createCard(overrides?: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "Front",
    backText: "Back",
    tags: [],
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
    lastOperationId: "operation-1",
    updatedAt: "2026-03-10T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function clickElement(element: Element): void {
  if (element instanceof HTMLElement) {
    element.click();
    return;
  }

  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function keyDownElement(element: Element, key: string): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

describe("buildNextCardsTableSorts", () => {
  it("adds new sort keys as primary and keeps only three user sorts", () => {
    const initialSorts = [
      { key: "frontText", direction: "asc" },
      { key: "backText", direction: "asc" },
      { key: "tags", direction: "asc" },
    ] as const;

    expect(buildNextCardsTableSorts(initialSorts, "reps")).toEqual([
      { key: "reps", direction: "asc" },
      { key: "frontText", direction: "asc" },
      { key: "backText", direction: "asc" },
    ]);
  });

  it("promotes an existing secondary sort and toggles its direction", () => {
    expect(buildNextCardsTableSorts([
      { key: "frontText", direction: "asc" },
      { key: "reps", direction: "asc" },
      { key: "createdAt", direction: "desc" },
    ], "reps")).toEqual([
      { key: "reps", direction: "desc" },
      { key: "frontText", direction: "asc" },
      { key: "createdAt", direction: "desc" },
    ]);
  });
});

describe("CardsScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    vi.useFakeTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queryCardsMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockResolvedValue({
      tags: [],
      totalCards: 0,
    });
    mockAppData.cards = [];
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.refreshCards.mockClear();
    mockAppData.setErrorMessage.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    IntersectionObserverMock.instances.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("debounces search before reloading the first page", async () => {
    queryCardsMock.mockResolvedValue(createCardsPage());

    await act(async () => {
      root.render(
        <MemoryRouter>
          <CardsScreen />
        </MemoryRouter>,
      );
    });

    expect(queryCardsMock).toHaveBeenCalledTimes(1);
    const searchInput = container.querySelector('input[name="cards-search"]');
    expect(searchInput).not.toBeNull();

    await act(async () => {
      const inputElement = searchInput as HTMLInputElement;
      setInputValue(inputElement, "h");
      vi.advanceTimersByTime(299);
    });

    expect(queryCardsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      const inputElement = searchInput as HTMLInputElement;
      setInputValue(inputElement, "hola");
      vi.advanceTimersByTime(300);
    });

    expect(queryCardsMock).toHaveBeenCalledTimes(2);
    expect(queryCardsMock).toHaveBeenLastCalledWith("workspace-1", {
      searchText: "hola",
      cursor: null,
      limit: 50,
      sorts: [],
      filter: null,
    });
  });

  it("loads the next page when the sentinel intersects", async () => {
    queryCardsMock
      .mockResolvedValueOnce(createCardsPage({
        cards: [createCard()],
        nextCursor: "cursor-1",
        totalCount: 2,
      }))
      .mockResolvedValueOnce(createCardsPage({
        cards: [],
        nextCursor: null,
        totalCount: 2,
      }));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <CardsScreen />
        </MemoryRouter>,
      );
    });

    expect(IntersectionObserverMock.instances).toHaveLength(1);

    await act(async () => {
      IntersectionObserverMock.instances[0]?.callback([{
        isIntersecting: true,
      } as IntersectionObserverEntry], {} as IntersectionObserver);
    });

    expect(queryCardsMock).toHaveBeenCalledTimes(2);
    expect(queryCardsMock).toHaveBeenLastCalledWith("workspace-1", {
      searchText: null,
      cursor: "cursor-1",
      limit: 50,
      sorts: [],
      filter: null,
    });
  });

  it("renders fixed-width front and back columns with multiline clamp wrappers", async () => {
    queryCardsMock.mockResolvedValue(createCardsPage({
      cards: [createCard({
        frontText: "Line 1\nLine 2\nLine 3\nLine 4",
        backText: "",
      })],
      totalCount: 1,
    }));

    await act(async () => {
      root.render(
        <MemoryRouter>
          <CardsScreen />
        </MemoryRouter>,
      );
    });

    const frontHeader = container.querySelector("th.cards-col-front");
    const backHeader = container.querySelector("th.cards-col-back");
    const frontCell = container.querySelector("td.cards-col-front");
    const backCell = container.querySelector("td.cards-col-back");
    const multilineDisplays = container.querySelectorAll(".cards-cell-multiline-display");

    expect(frontHeader).not.toBeNull();
    expect(backHeader).not.toBeNull();
    expect(frontCell).not.toBeNull();
    expect(backCell).not.toBeNull();
    expect(multilineDisplays).toHaveLength(2);
    expect(frontCell?.querySelector(".cards-cell-multiline-display")?.textContent).toBe("Line 1\nLine 2\nLine 3\nLine 4");
    expect(backCell?.querySelector(".cards-cell-multiline-display")?.textContent).toBe("—");
  });

  it("applies an effort filter and reflects the active trigger state", async () => {
    queryCardsMock.mockResolvedValue(createCardsPage());

    await act(async () => {
      root.render(
        <MemoryRouter>
          <CardsScreen />
        </MemoryRouter>,
      );
    });

    const filterButton = container.querySelector(".cards-filter-trigger");
    expect(filterButton).not.toBeNull();

    await act(async () => {
      clickElement(filterButton as Element);
    });

    const mediumOption = Array.from(container.querySelectorAll(".deck-checkbox-option"))
      .find((element) => element.textContent?.includes("medium"));
    const mediumCheckbox = mediumOption?.querySelector("input");
    expect(mediumCheckbox).not.toBeNull();

    await act(async () => {
      clickElement(mediumCheckbox as Element);
    });

    const applyButton = Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent === "Apply");
    expect(applyButton).not.toBeNull();

    await act(async () => {
      clickElement(applyButton as Element);
    });

    expect(queryCardsMock).toHaveBeenLastCalledWith("workspace-1", {
      searchText: null,
      cursor: null,
      limit: 50,
      sorts: [],
      filter: {
        tags: [],
        effort: ["medium"],
      },
    });
    expect(container.querySelector(".cards-filter-trigger-active")?.textContent).toContain("Filter (1)");
  });

  it("applies a tags filter, combines it with search, and can clear it back to null", async () => {
    mockAppData.cards = [
      createCard({ cardId: "card-1", tags: ["grammar"] }),
      createCard({ cardId: "card-2", tags: ["verbs"] }),
    ];
    queryCardsMock.mockResolvedValue(createCardsPage());

    await act(async () => {
      root.render(
        <MemoryRouter>
          <CardsScreen />
        </MemoryRouter>,
      );
    });

    const filterButton = container.querySelector(".cards-filter-trigger");
    expect(filterButton).not.toBeNull();

    await act(async () => {
      clickElement(filterButton as Element);
    });

    const tagsInput = container.querySelector('input[name="cards-filter-tags"]');
    expect(tagsInput).not.toBeNull();

    await act(async () => {
      setInputValue(tagsInput as HTMLInputElement, "grammar");
      keyDownElement(tagsInput as Element, "Enter");
    });

    const applyButton = Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent === "Apply");
    expect(applyButton).not.toBeNull();

    await act(async () => {
      clickElement(applyButton as Element);
    });

    expect(queryCardsMock).toHaveBeenLastCalledWith("workspace-1", {
      searchText: null,
      cursor: null,
      limit: 50,
      sorts: [],
      filter: {
        tags: ["grammar"],
        effort: [],
      },
    });
    expect(container.textContent).toContain("No matching cards. Try a different search or clear filters.");

    const searchInput = container.querySelector('input[name="cards-search"]');
    expect(searchInput).not.toBeNull();

    await act(async () => {
      setInputValue(searchInput as HTMLInputElement, "hola");
      vi.advanceTimersByTime(300);
    });

    expect(queryCardsMock).toHaveBeenLastCalledWith("workspace-1", {
      searchText: "hola",
      cursor: null,
      limit: 50,
      sorts: [],
      filter: {
        tags: ["grammar"],
        effort: [],
      },
    });

    await act(async () => {
      clickElement(container.querySelector(".cards-filter-trigger") as Element);
    });

    const clearButton = Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent === "Clear");
    expect(clearButton).not.toBeNull();

    await act(async () => {
      clickElement(clearButton as Element);
    });

    const applyAfterClearButton = Array.from(container.querySelectorAll("button"))
      .find((element) => element.textContent === "Apply");
    expect(applyAfterClearButton).not.toBeNull();

    await act(async () => {
      clickElement(applyAfterClearButton as Element);
    });

    expect(queryCardsMock).toHaveBeenLastCalledWith("workspace-1", {
      searchText: "hola",
      cursor: null,
      limit: 50,
      sorts: [],
      filter: null,
    });
    expect(container.querySelector(".cards-filter-trigger-active")).toBeNull();
  });
});
