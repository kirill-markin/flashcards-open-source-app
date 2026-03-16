// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import { createCard, setupReviewScreenTest } from "./ReviewScreenTestSupport";

const reviewScreen = setupReviewScreenTest();

describe("ReviewScreen queue", () => {
  it("shows the review queue head as the current card", async () => {
    const state = reviewScreen.getState();
    const topQueueCard = createCard({
      cardId: "top-queue-card",
      frontText: "Top queue front",
    });
    const secondQueueCard = createCard({
      cardId: "second-queue-card",
      frontText: "Second queue front",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    state.cards = [topQueueCard, secondQueueCard];
    state.reviewQueue = [topQueueCard, secondQueueCard];
    state.reviewTimeline = [topQueueCard, secondQueueCard];

    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    expect(container.querySelector(".review-front")?.textContent).toContain("Top queue front");
    expect(container.querySelectorAll(".review-queue-card-active")).toHaveLength(1);
    expect(container.querySelector(".review-queue-card-active")?.textContent).toContain("Top queue front");
  });

  it("switches the current card when the queue head changes after rerender", async () => {
    const state = reviewScreen.getState();
    const firstQueueHead = createCard({
      cardId: "first-queue-head",
      frontText: "First queue head",
    });
    const secondQueueHead = createCard({
      cardId: "second-queue-head",
      frontText: "Second queue head",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    state.cards = [firstQueueHead, secondQueueHead];
    state.reviewQueue = [firstQueueHead, secondQueueHead];
    state.reviewTimeline = [firstQueueHead, secondQueueHead];

    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    expect(container.querySelector(".review-front")?.textContent).toContain("First queue head");

    state.reviewQueue = [secondQueueHead, firstQueueHead];
    state.reviewTimeline = [secondQueueHead, firstQueueHead];
    state.appData.localReadVersion = 1;

    await reviewScreen.rerenderReviewScreen();

    expect(container.querySelector(".review-front")?.textContent).toContain("Second queue head");
    expect(container.querySelector(".review-queue-card-active")?.textContent).toContain("Second queue head");
  });

  it("does not change the current card when clicking a non-head queue item", async () => {
    const state = reviewScreen.getState();
    const topQueueCard = createCard({
      cardId: "top-queue-card",
      frontText: "Top queue front",
    });
    const secondQueueCard = createCard({
      cardId: "second-queue-card",
      frontText: "Second queue front",
      updatedAt: "2026-03-10T10:00:00.000Z",
    });
    state.cards = [topQueueCard, secondQueueCard];
    state.reviewQueue = [topQueueCard, secondQueueCard];
    state.reviewTimeline = [topQueueCard, secondQueueCard];

    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    const queueCards = container.querySelectorAll(".review-queue-card");
    expect(queueCards).toHaveLength(2);

    await act(async () => {
      queueCards[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector(".review-front")?.textContent).toContain("Top queue front");
    expect(container.querySelector(".review-queue-card-active")?.textContent).toContain("Top queue front");
  });
});
