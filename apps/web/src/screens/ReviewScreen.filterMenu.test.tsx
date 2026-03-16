// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import { createCard, createDeck, createDecks, clickElement, setInputValue, setupReviewScreenTest } from "./ReviewScreenTestSupport";

const reviewScreen = setupReviewScreenTest();

describe("ReviewScreen filter menu", () => {
  it("lists review filter rows in order and dispatches the selected deck filter", async () => {
    const state = reviewScreen.getState();
    state.decks = [createDeck()];
    state.cards = [
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

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const container = reviewScreen.getContainer();
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

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-1" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("does not show filter search when there are 7 or fewer deck and tag choices total", async () => {
    const state = reviewScreen.getState();
    state.decks = createDecks([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
      "Epsilon",
      "Zeta",
    ]);

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    expect(reviewScreen.getContainer().querySelector('input[name="review-filter-search"]')).toBeNull();
  });

  it("shows filter search and autofocuses it when deck and tag choices total more than 7", async () => {
    const state = reviewScreen.getState();
    state.decks = createDecks([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    state.cards = [
      createCard({ cardId: "card-1", tags: ["grammar", "verbs"] }),
      createCard({ cardId: "card-2", tags: ["travel", "database"] }),
    ];

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const searchInput = reviewScreen.getContainer().querySelector('input[name="review-filter-search"]');

    expect(searchInput).not.toBeNull();
    expect(document.activeElement).toBe(searchInput);
  });

  it("filters review filter entries case-insensitively and still matches All cards", async () => {
    const state = reviewScreen.getState();
    state.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const container = reviewScreen.getContainer();
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
    const state = reviewScreen.getState();
    state.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);
    state.cards = [
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

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const container = reviewScreen.getContainer();
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

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tag", tag: "travel" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("shows a no-match filter state while keeping Edit decks visible", async () => {
    const state = reviewScreen.getState();
    state.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);
    state.cards = [
      createCard({
        cardId: "grammar-card",
        tags: ["grammar"],
      }),
    ];

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const container = reviewScreen.getContainer();
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
    const state = reviewScreen.getState();
    state.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);

    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    const trigger = container.querySelector(".review-filter-trigger");

    await reviewScreen.openReviewFilterMenu();

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
    const state = reviewScreen.getState();
    state.decks = createDecks([
      "Python",
      "Database",
      "System Design",
      "Cloud",
      "Math",
      "Grammar",
      "Travel",
    ]);

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const container = reviewScreen.getContainer();
    const searchInput = container.querySelector('input[name="review-filter-search"]');

    await act(async () => {
      setInputValue(searchInput as HTMLInputElement, "python");
    });

    const pythonButton = container.querySelector('[data-review-filter-key="deck:deck-1"]');

    expect(pythonButton).not.toBeNull();

    await act(async () => {
      clickElement(pythonButton as HTMLButtonElement);
    });

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-1" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("dispatches the selected tag filter", async () => {
    const state = reviewScreen.getState();
    state.cards = [
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

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const container = reviewScreen.getContainer();
    const tagButton = container.querySelector('[data-review-filter-key="tag:grammar"]');

    expect(tagButton).not.toBeNull();

    await act(async () => {
      clickElement(tagButton as HTMLButtonElement);
    });

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tag", tag: "grammar" });
    expect(container.querySelector(".review-filter-menu")).toBeNull();
  });

  it("renders the Edit decks shortcut inside the review filter menu", async () => {
    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    expect(container.querySelector(".review-edit-decks-link")).toBeNull();

    await reviewScreen.openReviewFilterMenu();

    const editDecksLink = Array.from(container.querySelectorAll(".review-filter-menu-entry")).find((element) => element.textContent?.trim() === "Edit decks");

    expect(editDecksLink).not.toBeUndefined();
    expect(editDecksLink?.getAttribute("href")).toBe("/settings/workspace/decks");
  });
});
