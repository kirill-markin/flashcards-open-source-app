// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createCard, createDecks, dispatchKeydown, setInputValue, setupReviewScreenTest } from "./ReviewScreenTestSupport";

const reviewScreen = setupReviewScreenTest();

describe("ReviewScreen hotkeys", () => {
  it("reveals the answer when pressing space", async () => {
    const state = reviewScreen.getState();
    const card = createCard({
      cardId: "space-card",
      frontText: "Question",
      backText: "Answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await reviewScreen.renderReviewScreen();

    expect(reviewScreen.getContainer().textContent).not.toContain("Answer");

    await reviewScreen.dispatchDocumentKeydown(" ");

    expect(reviewScreen.getContainer().textContent).toContain("Answer");
  });

  it.each([
    { key: "1", rating: 0 },
    { key: "2", rating: 1 },
    { key: "3", rating: 2 },
    { key: "4", rating: 3 },
  ] as const)("submits rating $rating when pressing $key", async ({ key, rating }) => {
    const state = reviewScreen.getState();
    const submitReviewItemMock = vi.fn(async (): Promise<typeof state.cards[number]> => createCard());
    const card = createCard({
      cardId: `rating-card-${key}`,
      frontText: `Question ${key}`,
      backText: `Answer ${key}`,
    });

    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.appData.submitReviewItem = submitReviewItemMock;

    await reviewScreen.renderReviewScreen();
    await reviewScreen.dispatchDocumentKeydown(" ");
    await reviewScreen.dispatchDocumentKeydown(key);

    expect(submitReviewItemMock).toHaveBeenCalledTimes(1);
    expect(submitReviewItemMock).toHaveBeenCalledWith(card.cardId, rating);
  });

  it("ignores review hotkeys while typing in the review filter search", async () => {
    const state = reviewScreen.getState();
    state.cards = [createCard({ cardId: "card-1", tags: ["grammar"] })];
    state.reviewQueue = state.cards;
    state.reviewTimeline = state.cards;
    state.decks = createDecks(["Grammar", "Travel", "Work", "Life", "Spanish", "German", "French"]);

    await reviewScreen.renderReviewScreen();
    await reviewScreen.openReviewFilterMenu();

    const searchInput = reviewScreen.getContainer().querySelector('input[name="review-filter-search"]');
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error("Review filter search input was not found");
    }

    searchInput.focus();
    setInputValue(searchInput, "gram");
    dispatchKeydown(searchInput, " ");

    expect(reviewScreen.getContainer().textContent).not.toContain("Back");
  });
});
