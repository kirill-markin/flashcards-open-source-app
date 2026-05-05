// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Card } from "../../types";
import {
  createCard,
  setupReviewScreenTest,
} from "./ReviewScreenTestSupport";

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  renderReviewScreen,
  rerenderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

describe("ReviewScreen presented card preservation", () => {
  it("keeps an omitted presented card stable across a bounded refresh and advances to the canonical head after review", async () => {
    const state = getState();
    const currentCard = createCard({
      cardId: "card-current",
      frontText: "Current front",
      backText: "Current back",
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const recentCards = Array.from({ length: 8 }, (_, index) => createCard({
      cardId: `card-recent-${index + 1}`,
      frontText: `Recent due ${index + 1} front`,
      backText: `Recent due ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
      createdAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));
    const futureCard = createCard({
      cardId: "card-future",
      frontText: "Future front",
      backText: "Future back",
      dueAt: "2026-03-11T12:00:00.000Z",
      createdAt: "2026-03-10T09:15:00.000Z",
      updatedAt: "2026-03-10T09:15:00.000Z",
    });
    state.cards = [currentCard, ...recentCards, futureCard];
    state.reviewQueue = [currentCard];
    state.reviewTimeline = [currentCard, ...recentCards, futureCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === currentCard.cardId) {
        return currentCard;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => currentCard);

    await renderReviewScreen();

    expect(getContainer().textContent).toContain("Current front");
    expect(getContainer().textContent).not.toContain("Recent due 1 frontCurrent front");

    state.reviewQueue = [...recentCards];
    state.reviewTimeline = [...recentCards, futureCard];
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();

    expect(state.appData.getCardById).toHaveBeenCalledWith("card-current");
    expect(getContainer().textContent).toContain("Current front");
    const queueTitlesAfterRefresh = [...getContainer().querySelectorAll(".review-queue-card-title")].map((element) => element.textContent);
    expect(queueTitlesAfterRefresh).toEqual([
      "Current front",
      ...recentCards.map((card) => card.frontText),
      "Future front",
    ]);

    await revealAnswer();
    await dispatchDocumentKeydown("3");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-current", 2);
    expect(getContainer().textContent).toContain("Recent due 1 front");
    expect(getContainer().textContent).not.toContain("Current frontCurrent back");

    state.reviewQueue = [currentCard, ...recentCards];
    state.reviewTimeline = [currentCard, ...recentCards, futureCard];
    state.appData.localReadVersion = 2;

    await rerenderReviewScreen();

    const queueTitlesAfterReappearance = [...getContainer().querySelectorAll(".review-queue-card-title")].map((element) => element.textContent);
    expect(queueTitlesAfterReappearance).toEqual([
      "Recent due 1 front",
      "Current front",
      ...recentCards.slice(1).map((card) => card.frontText),
      "Future front",
    ]);
  });

  it("does not preserve an omitted presented card after it stops matching the selected filter", async () => {
    const state = getState();
    state.appData.selectedReviewFilter = {
      kind: "tag",
      tag: "grammar",
    };
    const currentCard = createCard({
      cardId: "card-current-filter",
      frontText: "Current filter front",
      backText: "Current filter back",
      tags: ["grammar"],
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const currentCardWithoutSelectedTag = {
      ...currentCard,
      tags: ["code"],
    };
    const canonicalCards = Array.from({ length: 8 }, (_, index) => createCard({
      cardId: `card-filter-head-${index + 1}`,
      frontText: `Filter head ${index + 1} front`,
      backText: `Filter head ${index + 1} back`,
      tags: ["grammar"],
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
      createdAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));

    state.cards = [currentCard, ...canonicalCards];
    state.reviewQueue = [currentCard];
    state.reviewTimeline = [currentCard, ...canonicalCards];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === currentCard.cardId) {
        return currentCardWithoutSelectedTag;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });

    await renderReviewScreen();

    expect(getContainer().textContent).toContain("Current filter front");

    state.cards = [currentCardWithoutSelectedTag, ...canonicalCards];
    state.reviewQueue = [...canonicalCards];
    state.reviewTimeline = [...canonicalCards];
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();

    expect(state.appData.getCardById).toHaveBeenCalledWith("card-current-filter");
    expect(getContainer().textContent).toContain("Filter head 1 front");
    expect(getContainer().textContent).not.toContain("Current filter front");
    const queueTitlesAfterRefresh = [...getContainer().querySelectorAll(".review-queue-card-title")].map((element) => element.textContent);
    expect(queueTitlesAfterRefresh).toEqual(canonicalCards.map((card) => card.frontText));
  });

  it("does not preserve an omitted presented card after it is no longer due", async () => {
    const state = getState();
    const currentCard = createCard({
      cardId: "card-current-not-due",
      frontText: "Current not due front",
      backText: "Current not due back",
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const currentCardAfterReview = {
      ...currentCard,
      dueAt: "2026-03-11T12:00:00.000Z",
    };
    const canonicalCards = Array.from({ length: 8 }, (_, index) => createCard({
      cardId: `card-not-due-head-${index + 1}`,
      frontText: `Not due head ${index + 1} front`,
      backText: `Not due head ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
      createdAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));

    state.cards = [currentCard, ...canonicalCards];
    state.reviewQueue = [currentCard];
    state.reviewTimeline = [currentCard, ...canonicalCards];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === currentCard.cardId) {
        return currentCardAfterReview;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });

    await renderReviewScreen();

    expect(getContainer().textContent).toContain("Current not due front");

    state.cards = [currentCardAfterReview, ...canonicalCards];
    state.reviewQueue = [...canonicalCards];
    state.reviewTimeline = [...canonicalCards, currentCardAfterReview];
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();

    const reviewPane = getContainer().querySelector(".review-pane");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    expect(state.appData.getCardById).toHaveBeenCalledWith("card-current-not-due");
    expect(reviewPane.textContent).toContain("Not due head 1 front");
    expect(reviewPane.textContent).not.toContain("Current not due front");
    const queueTitlesAfterRefresh = [...getContainer().querySelectorAll(".review-queue-card-title")].map((element) => element.textContent);
    expect(queueTitlesAfterRefresh).toEqual([
      ...canonicalCards.map((card) => card.frontText),
      "Current not due front",
    ]);
  });

  it("does not preserve an omitted presented card after it is missing locally", async () => {
    const state = getState();
    const currentCard = createCard({
      cardId: "card-current-missing",
      frontText: "Current missing front",
      backText: "Current missing back",
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const canonicalCards = Array.from({ length: 8 }, (_, index) => createCard({
      cardId: `card-missing-head-${index + 1}`,
      frontText: `Missing head ${index + 1} front`,
      backText: `Missing head ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
      createdAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
      updatedAt: `2026-03-10T10:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));

    state.cards = [currentCard, ...canonicalCards];
    state.reviewQueue = [currentCard];
    state.reviewTimeline = [currentCard, ...canonicalCards];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      throw new Error(`Card not found: ${cardId}`);
    });

    await renderReviewScreen();

    expect(getContainer().textContent).toContain("Current missing front");

    state.cards = [...canonicalCards];
    state.reviewQueue = [...canonicalCards];
    state.reviewTimeline = [...canonicalCards];
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();

    expect(state.appData.getCardById).toHaveBeenCalledWith("card-current-missing");
    expect(getContainer().textContent).toContain("Missing head 1 front");
    expect(getContainer().textContent).not.toContain("Current missing front");
    expect(getContainer().textContent).not.toContain("Card not found: card-current-missing");
    const queueTitlesAfterRefresh = [...getContainer().querySelectorAll(".review-queue-card-title")].map((element) => element.textContent);
    expect(queueTitlesAfterRefresh).toEqual(canonicalCards.map((card) => card.frontText));
  });
});
