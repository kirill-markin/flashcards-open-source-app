// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CardFormScreen } from "./CardFormScreen";
import type { Card } from "../types";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    cards: [] as Array<Card>,
    ensureCardsLoaded: vi.fn(async () => undefined),
    getCardById: vi.fn(async (): Promise<Card> => {
      throw new Error("not used");
    }),
    createCardItem: vi.fn(async (): Promise<Card> => {
      throw new Error("not used");
    }),
    updateCardItem: vi.fn(async (): Promise<Card> => {
      throw new Error("not used");
    }),
    deleteCardItem: vi.fn(async (): Promise<Card> => {
      throw new Error("not used");
    }),
    setErrorMessage: vi.fn(),
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

function LocationProbe(): ReactElement {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function findButton(container: HTMLDivElement, text: string): HTMLButtonElement | null {
  const button = Array.from(container.querySelectorAll("button")).find((element) => element.textContent?.trim() === text);
  return button instanceof HTMLButtonElement ? button : null;
}

function deferredPromise<T>(): Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}> {
  let resolvePromise: ((value: T) => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  if (resolvePromise === null || rejectPromise === null) {
    throw new Error("Deferred promise initialization failed");
  }

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

describe("CardFormScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let confirmMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    loadWorkspaceTagsSummaryMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockResolvedValue({
      tags: [],
      totalCards: 0,
    });
    mockAppData.cards = [];
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.getCardById.mockReset();
    mockAppData.createCardItem.mockReset();
    mockAppData.updateCardItem.mockReset();
    mockAppData.deleteCardItem.mockReset();
    mockAppData.setErrorMessage.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    confirmMock = vi.fn(() => true);
    vi.stubGlobal("confirm", confirmMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders delete only in edit mode", async () => {
    mockAppData.getCardById.mockResolvedValue(createCard());

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards/card-1"]}>
          <Routes>
            <Route path="/cards/:cardId" element={<CardFormScreen />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Delete card");
  });

  it("does not render delete in create mode", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards/new"]}>
          <Routes>
            <Route path="/cards/new" element={<CardFormScreen />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    expect(container.textContent).not.toContain("Delete card");
  });

  it("deletes the card and navigates back to cards after confirmation", async () => {
    mockAppData.getCardById.mockResolvedValue(createCard());
    mockAppData.deleteCardItem.mockResolvedValue(createCard({
      deletedAt: "2026-03-10T10:00:00.000Z",
    }));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards/card-1"]}>
          <Routes>
            <Route path="/cards/:cardId" element={<CardFormScreen />} />
            <Route path="/cards" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      click(findButton(container, "Delete card"));
    });

    expect(confirmMock).toHaveBeenCalledWith("Delete this card?");
    expect(mockAppData.deleteCardItem).toHaveBeenCalledWith("card-1");
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/cards");
  });

  it("does not delete when confirmation is canceled", async () => {
    confirmMock.mockReturnValue(false);
    mockAppData.getCardById.mockResolvedValue(createCard());

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards/card-1"]}>
          <Routes>
            <Route path="/cards/:cardId" element={<CardFormScreen />} />
            <Route path="/cards" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      click(findButton(container, "Delete card"));
    });

    expect(confirmMock).toHaveBeenCalledWith("Delete this card?");
    expect(mockAppData.deleteCardItem).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="location"]')).toBeNull();
    expect(container.textContent).toContain("Card form");
  });

  it("shows a screen error and stays on the form when deletion fails", async () => {
    mockAppData.getCardById.mockResolvedValue(createCard());
    mockAppData.deleteCardItem.mockRejectedValue(new Error("Delete failed"));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards/card-1"]}>
          <Routes>
            <Route path="/cards/:cardId" element={<CardFormScreen />} />
            <Route path="/cards" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      click(findButton(container, "Delete card"));
    });

    expect(container.textContent).toContain("Delete failed");
    expect(container.querySelector('[data-testid="location"]')).toBeNull();
    expect(container.textContent).toContain("Card form");
  });

  it("shows deleting state while the deletion request is in flight", async () => {
    const pendingDelete = deferredPromise<Card>();
    mockAppData.getCardById.mockResolvedValue(createCard());
    mockAppData.deleteCardItem.mockImplementation(async () => pendingDelete.promise);

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/cards/card-1"]}>
          <Routes>
            <Route path="/cards/:cardId" element={<CardFormScreen />} />
            <Route path="/cards" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    await act(async () => {
      click(findButton(container, "Delete card"));
    });

    expect(findButton(container, "Deleting…")).not.toBeNull();
    expect(findButton(container, "Save card")?.disabled).toBe(true);

    await act(async () => {
      pendingDelete.resolve(createCard({
        deletedAt: "2026-03-10T10:00:00.000Z",
      }));
      await pendingDelete.promise;
    });

    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/cards");
  });
});
