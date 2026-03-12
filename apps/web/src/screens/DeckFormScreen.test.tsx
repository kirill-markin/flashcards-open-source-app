// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeckFormScreen } from "./DeckFormScreen";
import type { Card, Deck } from "../types";

const { mockAppData } = vi.hoisted(() => ({
  mockAppData: {
    cards: [] as Array<Card>,
    ensureCardsLoaded: vi.fn(async () => undefined),
    ensureDecksLoaded: vi.fn(async () => undefined),
    createDeckItem: vi.fn(async (): Promise<Deck> => {
      throw new Error("not used");
    }),
    getDeckById: vi.fn(async (): Promise<Deck> => {
      throw new Error("not used");
    }),
    updateDeckItem: vi.fn(async (): Promise<Deck> => {
      throw new Error("not used");
    }),
    setErrorMessage: vi.fn(),
  },
}));

vi.mock("../appData", () => ({
  useAppData: () => mockAppData,
}));

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

function setInputValue(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function click(element: Element | null): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

describe("DeckFormScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mockAppData.cards = [];
    mockAppData.ensureCardsLoaded.mockClear();
    mockAppData.ensureDecksLoaded.mockClear();
    mockAppData.createDeckItem.mockReset();
    mockAppData.getDeckById.mockReset();
    mockAppData.updateDeckItem.mockReset();
    mockAppData.setErrorMessage.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("loads deck data in edit mode and saves changes back to the detail route", async () => {
    mockAppData.getDeckById.mockResolvedValue(createDeck());
    mockAppData.updateDeckItem.mockResolvedValue(createDeck({ name: "Grammar updated" }));

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/settings/decks/deck-1/edit"]}>
          <Routes>
            <Route path="/settings/decks/:deckId/edit" element={<DeckFormScreen />} />
            <Route path="/settings/decks/:deckId" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    });

    const nameInput = container.querySelector("#deck-name");
    expect(nameInput).not.toBeNull();
    expect((nameInput as HTMLInputElement).value).toBe("Grammar");

    await act(async () => {
      setInputValue(nameInput as HTMLInputElement, "Grammar updated");
    });

    await act(async () => {
      click(Array.from(container.querySelectorAll("button")).find((element) => element.textContent === "Save changes") ?? null);
    });

    expect(mockAppData.updateDeckItem).toHaveBeenCalledWith("deck-1", {
      name: "Grammar updated",
      filterDefinition: {
        version: 2,
        effortLevels: ["fast"],
        tags: ["grammar"],
      },
    });
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe("/settings/decks/deck-1");
  });
});
