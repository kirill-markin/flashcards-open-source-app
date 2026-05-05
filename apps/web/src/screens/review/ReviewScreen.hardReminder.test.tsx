// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import type { Card } from "../../types";
import {
  createCard,
  createDeferredPromise,
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

describe("ReviewScreen hard reminder", () => {
  it("shows the hard reminder after a full recent window with too many hard answers", async () => {
    const state = getState();
    const cards = Array.from({ length: 8 }, (_, index) => createCard({
      cardId: `hard-reminder-${index + 1}`,
      frontText: `Question ${index + 1}`,
      backText: `Answer ${index + 1}`,
    }));
    state.cards = cards;
    state.reviewQueue = cards;
    state.reviewTimeline = cards;
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<typeof cards[number]> => {
      return createCard({ cardId });
    });

    await renderReviewScreen();

    for (const key of ["2", "2", "2", "2", "2", "3", "3"]) {
      await revealAnswer();
      await dispatchDocumentKeydown(key);
      expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    }

    await revealAnswer();
    await dispatchDocumentKeydown("2");

    const reminderDialog = getContainer().querySelector('[role="dialog"]');
    expect(reminderDialog).not.toBeNull();
    expect(getContainer().textContent).toContain('choose "Again"');
    expect(getContainer().textContent).toContain('"Hard"');
    expect(state.appData.submitReviewItem).toHaveBeenCalledTimes(8);
  });

  it("does not settle or update hard-reminder state after a stale submit completion", async () => {
    const state = getState();
    const cards = Array.from({ length: 10 }, (_, index) => createCard({
      cardId: `stale-screen-submit-${index + 1}`,
      frontText: `Stale screen question ${index + 1}`,
      backText: `Stale screen answer ${index + 1}`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));
    const refreshedCards = [
      createCard({
        cardId: "stale-screen-refresh-1",
        frontText: "Stale screen refreshed question 1",
        backText: "Stale screen refreshed answer 1",
        dueAt: "2026-03-10T11:30:00.000Z",
      }),
      createCard({
        cardId: "stale-screen-refresh-2",
        frontText: "Stale screen refreshed question 2",
        backText: "Stale screen refreshed answer 2",
        dueAt: "2026-03-10T11:31:00.000Z",
      }),
    ];
    const staleSubmitPromise = createDeferredPromise<Card>();
    let submitCallCount = 0;
    state.cards = cards;
    state.reviewQueue = cards;
    state.reviewTimeline = cards;
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      throw new Error(`Card not found: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      submitCallCount += 1;
      if (submitCallCount === 8) {
        return staleSubmitPromise.promise;
      }

      const submittedCard = cards.find((candidateCard) => candidateCard.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted card id: ${cardId}`);
      }

      return submittedCard;
    });

    await renderReviewScreen();

    for (const key of ["2", "2", "2", "2", "3", "3", "3"]) {
      await revealAnswer();
      await dispatchDocumentKeydown(key);
      expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
    }

    await revealAnswer();
    await dispatchDocumentKeydown("2");

    expect(state.appData.submitReviewItem).toHaveBeenCalledTimes(8);

    state.cards = refreshedCards;
    state.reviewQueue = refreshedCards;
    state.reviewTimeline = refreshedCards;
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();

    await act(async () => {
      const staleSubmittedCard = cards[7];
      if (staleSubmittedCard === undefined) {
        throw new Error("Stale screen submitted card was not prepared");
      }
      staleSubmitPromise.resolve(staleSubmittedCard);
      await Promise.resolve();
      await Promise.resolve();
    });

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    expect(reviewPane.getAttribute("data-review-submit-state")).toBe("idle");
    expect(reviewPane.getAttribute("data-review-last-submitted-card-id")).toBe("");
    expect(getContainer().querySelector('[role="dialog"]')).toBeNull();
  });
});
