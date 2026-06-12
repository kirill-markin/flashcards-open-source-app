// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Card } from "../../../types";
import {
  clickElement,
  clickElementAsync,
  createCard,
  createDecks,
  hasHydratedHotStateMock,
  loadReviewQueueSnapshotMock,
  reviewReactionLottieLoadAnimationMock,
  reviewStylesContain,
  setTextFieldValueAsync,
  setupReviewScreenTest,
} from "../testSupport/ReviewScreenTestSupport";
import {
  isReviewReactionLottieAssetReady,
  reviewReactionLottieVariants,
} from "../reactions/reviewReactionLottie";

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  openReviewFilterMenu,
  renderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

async function waitForReviewReactionLottieTestPrewarm(): Promise<void> {
  await vi.waitFor(() => {
    expect(reviewReactionLottieVariants.every((variant) => isReviewReactionLottieAssetReady(variant))).toBe(true);
  });
  expect(reviewReactionLottieLoadAnimationMock).toHaveBeenCalled();
}

async function flushReviewScreenPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dispatchPointerDown(element: Element): void {
  element.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
}

async function pointerDownElementAsync(element: Element): Promise<void> {
  await act(async () => {
    dispatchPointerDown(element);
  });
}

async function pointerDownAndClickElementAsync(element: Element): Promise<void> {
  await act(async () => {
    dispatchPointerDown(element);
    clickElement(element);
  });
}

async function createStaleReviewReactionOnSecondCard(cards: ReadonlyArray<Card>): Promise<Card> {
  if (cards.length < 2) {
    throw new Error(`Stale reaction setup requires at least two cards, received ${cards.length}.`);
  }

  const state = getState();
  state.cards = [...cards];
  state.reviewQueue = [...cards];
  state.reviewTimeline = [...cards];
  state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
    const submittedCard = state.cards.find((card) => card.cardId === cardId);
    if (submittedCard === undefined) {
      throw new Error(`Unexpected submitted review card id: ${cardId}`);
    }

    return submittedCard;
  });

  await renderReviewScreen();
  await waitForReviewReactionLottieTestPrewarm();
  await revealAnswer();

  const goodButton = getContainer().querySelector("[data-testid='review-rate-good']");
  if (!(goodButton instanceof HTMLButtonElement)) {
    throw new Error("Good rating button was not found");
  }

  await clickElementAsync(goodButton);
  await flushReviewScreenPromises();

  expect(getContainer().querySelectorAll("[data-testid='review-rating-reaction-event']")).toHaveLength(1);
  return cards[1];
}

type ReviewRatingShortcutDismissCase = Readonly<{
  expectedReactionRating: string;
  expectedSubmitRating: 0 | 1 | 2 | 3;
  key: string;
}>;

const reviewRatingShortcutDismissCases: ReadonlyArray<ReviewRatingShortcutDismissCase> = [
  { expectedReactionRating: "again", expectedSubmitRating: 0, key: "1" },
  { expectedReactionRating: "hard", expectedSubmitRating: 1, key: "2" },
  { expectedReactionRating: "good", expectedSubmitRating: 2, key: "3" },
  { expectedReactionRating: "easy", expectedSubmitRating: 3, key: "4" },
];

describe("ReviewScreen controls", () => {
  it("keeps a cold empty local workspace in loading state until sync hydrates it", async () => {
    hasHydratedHotStateMock.mockResolvedValue(false);

    await renderReviewScreen();
    await flushReviewScreenPromises();

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    expect(reviewPane.dataset.reviewPaneState).toBe("loading");
    expect(reviewPane.dataset.reviewPaneEmptyReason).toBe("none");
    expect(getContainer().textContent).not.toContain("No Cards Yet");
  });

  it("shows a retry path instead of staying in cold empty loading after sync fails", async () => {
    const state = getState();
    state.appData.errorMessage = "Cloud sync failed";
    state.appData.isSyncing = false;
    hasHydratedHotStateMock.mockResolvedValue(false);

    await renderReviewScreen();
    await flushReviewScreenPromises();

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    const retryButton = getContainer().querySelector(".review-loading-retry-btn");
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error("Review retry button was not found");
    }

    expect(reviewPane.dataset.reviewPaneState).toBe("empty");
    expect(reviewPane.dataset.reviewPaneEmptyReason).toBe("no-cards");
    expect(getContainer().textContent).toContain("Cloud sync failed");
  });

  it("renders compact review header controls with scope before streak", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-progress-badge",
      frontText: "Question",
      backText: "Answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.reviewProgressBadge = {
      streakDays: 12,
      hasReviewedToday: true,
      isInteractive: true,
    };

    await renderReviewScreen();

    const progressBadge = getContainer().querySelector("[data-testid='review-progress-badge']");
    if (!(progressBadge instanceof HTMLAnchorElement)) {
      throw new Error("Review progress badge was not found");
    }
    const headerActions = getContainer().querySelector(".review-screen-head-actions");
    if (!(headerActions instanceof HTMLDivElement)) {
      throw new Error("Review screen header actions were not found");
    }
    const scopeTrigger = getContainer().querySelector("[data-testid='review-filter-trigger']");
    if (!(scopeTrigger instanceof HTMLButtonElement)) {
      throw new Error("Review scope trigger was not found");
    }

    expect(progressBadge.className).toContain("review-progress-badge");
    expect(progressBadge.className).toContain("review-progress-badge-active");
    expect(progressBadge.className).not.toContain("review-progress-badge-approximate");
    expect(progressBadge.textContent).not.toContain("🔥");
    const queueBadge = getContainer().querySelector("[data-testid='review-queue-badge']");
    if (!(queueBadge instanceof HTMLButtonElement)) {
      throw new Error("Review queue badge was not found");
    }
    expect(queueBadge.querySelector(".review-progress-badge-value")).toBeNull();
    expect(queueBadge.getAttribute("aria-label")).toContain("1 card");
    expect(queueBadge.getAttribute("aria-controls")).toBe("review-queue-panel");
    expect(queueBadge.getAttribute("aria-expanded")).toBe("false");
    expect(queueBadge.getAttribute("href")).toBeNull();
    expect(queueBadge.disabled).toBe(false);
    const queuePanel = getContainer().querySelector("#review-queue-panel");
    if (!(queuePanel instanceof HTMLElement)) {
      throw new Error("Review queue panel was not found");
    }
    const queueCloseButton = getContainer().querySelector("[data-testid='review-queue-close']");
    if (!(queueCloseButton instanceof HTMLButtonElement)) {
      throw new Error("Review queue close button was not found");
    }
    expect(queuePanel.className).not.toContain("review-queue-panel-open");
    expect(queueCloseButton.getAttribute("aria-label")).toBe("Close queue");
    expect(getContainer().querySelector("[data-testid='review-screen-toolbar']")).toBeNull();
    expect(headerActions.contains(scopeTrigger)).toBe(true);
    expect(headerActions.contains(queueBadge)).toBe(true);
    expect(headerActions.contains(progressBadge)).toBe(true);
    expect(scopeTrigger.compareDocumentPosition(progressBadge) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const progressBadgeIcon = progressBadge.querySelector("svg.review-progress-badge-icon");
    if (!(progressBadgeIcon instanceof SVGSVGElement)) {
      throw new Error("Review progress badge icon was not found");
    }

    expect(progressBadgeIcon.getAttribute("aria-hidden")).toBe("true");

    await clickElementAsync(queueBadge);
    expect(queueBadge.getAttribute("aria-expanded")).toBe("true");
    expect(queuePanel.className).toContain("review-queue-panel-open");
    expect(window.location.hash).toBe("");

    await clickElementAsync(queueCloseButton);
    expect(queueBadge.getAttribute("aria-expanded")).toBe("false");
    expect(queuePanel.className).not.toContain("review-queue-panel-open");
    expect(window.location.hash).toBe("");

    await clickElementAsync(queueBadge);
    expect(queueBadge.getAttribute("aria-expanded")).toBe("true");
    expect(window.location.hash).toBe("");

    await clickElementAsync(queueBadge);
    expect(queueBadge.getAttribute("aria-expanded")).toBe("false");
    expect(queuePanel.className).not.toContain("review-queue-panel-open");
    expect(window.location.hash).toBe("");
  });

  it("reveals the answer with Space and submits the selected rating shortcut", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-review",
      frontText: "Question",
      backText: "Answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => card);

    await renderReviewScreen();
    await dispatchDocumentKeydown(" ");

    expect(getContainer().textContent).toContain("Answer");

    await dispatchDocumentKeydown("3");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-review", 2);
  });

  it("emits a decorative reaction and advances immediately when a rating is clicked", async () => {
    const state = getState();
    const firstCard = createCard({
      cardId: "card-reaction-first",
      frontText: "First reaction question",
      backText: "First reaction answer",
    });
    const secondCard = createCard({
      cardId: "card-reaction-second",
      frontText: "Second reaction question",
      backText: "Second reaction answer",
    });
    state.cards = [firstCard, secondCard];
    state.reviewQueue = [firstCard, secondCard];
    state.reviewTimeline = [firstCard, secondCard];
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      const submittedCard = state.cards.find((card) => card.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted review card id: ${cardId}`);
      }

      return submittedCard;
    });

    await renderReviewScreen();
    await waitForReviewReactionLottieTestPrewarm();
    await revealAnswer();

    const goodButton = getContainer().querySelector("[data-testid='review-rate-good']");
    if (!(goodButton instanceof HTMLButtonElement)) {
      throw new Error("Good rating button was not found");
    }

    await clickElementAsync(goodButton);
    await flushReviewScreenPromises();

    const reactionLayer = getContainer().querySelector("[data-testid='review-rating-reaction-layer']");
    if (!(reactionLayer instanceof HTMLElement)) {
      throw new Error("Review rating reaction layer was not found");
    }
    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    expect(reactionLayer.getAttribute("aria-hidden")).toBe("true");
    expect(getContainer().querySelectorAll("[data-testid='review-rating-reaction-event']")).toHaveLength(1);
    expect(getContainer().querySelector(".review-rating-reaction-crown-fallback-art")).toBeNull();
    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-reaction-first", 2);
    expect(reviewPane.getAttribute("data-review-current-card-id")).toBe("card-reaction-second");
    expect(getContainer().textContent).toContain("Second reaction question");
  });

  it("dismisses an active decorative reaction on review pointer input without changing the card", async () => {
    const secondCard = await createStaleReviewReactionOnSecondCard([
      createCard({
        cardId: "card-pointer-first",
        frontText: "Pointer first question",
        backText: "Pointer first answer",
      }),
      createCard({
        cardId: "card-pointer-second",
        frontText: "Pointer second question",
        backText: "Pointer second answer",
      }),
    ]);

    const reviewScreen = getContainer().querySelector("[data-testid='review-screen']");
    if (!(reviewScreen instanceof HTMLElement)) {
      throw new Error("Review screen main element was not found");
    }

    await pointerDownElementAsync(reviewScreen);

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    expect(getContainer().querySelectorAll("[data-testid='review-rating-reaction-event']")).toHaveLength(0);
    expect(reviewPane.getAttribute("data-review-current-card-id")).toBe(secondCard.cardId);
    expect(getContainer().textContent).toContain("Pointer second question");
    expect(getState().appData.submitReviewItem).toHaveBeenCalledTimes(1);
  });

  it("dismisses an active decorative reaction while the same reveal click still shows the answer", async () => {
    await createStaleReviewReactionOnSecondCard([
      createCard({
        cardId: "card-pointer-reveal-first",
        frontText: "Pointer reveal first question",
        backText: "Pointer reveal first answer",
      }),
      createCard({
        cardId: "card-pointer-reveal-second",
        frontText: "Pointer reveal second question",
        backText: "Pointer reveal second answer",
      }),
    ]);

    const revealButton = getContainer().querySelector(".review-reveal-btn");
    if (!(revealButton instanceof HTMLButtonElement)) {
      throw new Error("Reveal answer button was not found");
    }

    await pointerDownAndClickElementAsync(revealButton);

    expect(getContainer().querySelectorAll("[data-testid='review-rating-reaction-event']")).toHaveLength(0);
    expect(getContainer().textContent).toContain("Pointer reveal second answer");
    expect(getState().appData.submitReviewItem).toHaveBeenCalledTimes(1);
  });

  it("dismisses an active decorative reaction on Space while still revealing the answer", async () => {
    await createStaleReviewReactionOnSecondCard([
      createCard({
        cardId: "card-space-first",
        frontText: "Space first question",
        backText: "Space first answer",
      }),
      createCard({
        cardId: "card-space-second",
        frontText: "Space second question",
        backText: "Space second answer",
      }),
    ]);

    await dispatchDocumentKeydown(" ");

    expect(getContainer().querySelectorAll("[data-testid='review-rating-reaction-event']")).toHaveLength(0);
    expect(getContainer().textContent).toContain("Space second answer");
    expect(getState().appData.submitReviewItem).toHaveBeenCalledTimes(1);
  });

  for (const shortcutCase of reviewRatingShortcutDismissCases) {
    it(`dismisses an active decorative reaction before rating shortcut ${shortcutCase.key} submits`, async () => {
      const secondCard = await createStaleReviewReactionOnSecondCard([
        createCard({
          cardId: `card-shortcut-${shortcutCase.key}-first`,
          frontText: `Shortcut ${shortcutCase.key} first question`,
          backText: `Shortcut ${shortcutCase.key} first answer`,
        }),
        createCard({
          cardId: `card-shortcut-${shortcutCase.key}-second`,
          frontText: `Shortcut ${shortcutCase.key} second question`,
          backText: `Shortcut ${shortcutCase.key} second answer`,
        }),
        createCard({
          cardId: `card-shortcut-${shortcutCase.key}-third`,
          frontText: `Shortcut ${shortcutCase.key} third question`,
          backText: `Shortcut ${shortcutCase.key} third answer`,
        }),
      ]);

      await revealAnswer();
      await dispatchDocumentKeydown(shortcutCase.key);
      await flushReviewScreenPromises();

      const reactionEvents = getContainer().querySelectorAll("[data-testid='review-rating-reaction-event']");
      const [reactionEvent] = reactionEvents;
      if (!(reactionEvent instanceof HTMLElement)) {
        throw new Error(`Review reaction event for shortcut ${shortcutCase.key} was not found`);
      }
      const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
      if (!(reviewPane instanceof HTMLElement)) {
        throw new Error("Review pane was not found");
      }

      expect(reactionEvents).toHaveLength(1);
      expect(reactionEvent.getAttribute("data-review-reaction-rating")).toBe(shortcutCase.expectedReactionRating);
      expect(getState().appData.submitReviewItem).toHaveBeenLastCalledWith(
        secondCard.cardId,
        shortcutCase.expectedSubmitRating,
      );
      expect(reviewPane.getAttribute("data-review-current-card-id")).toBe(`card-shortcut-${shortcutCase.key}-third`);
    });
  }

  it("keeps only the newest three decorative reactions active", async () => {
    const state = getState();
    const cards = Array.from({ length: 5 }, (_, index) => createCard({
      cardId: `card-rapid-reaction-${index + 1}`,
      frontText: `Rapid reaction question ${index + 1}`,
      backText: `Rapid reaction answer ${index + 1}`,
    }));
    state.cards = cards;
    state.reviewQueue = cards;
    state.reviewTimeline = cards;
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      const submittedCard = cards.find((card) => card.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted review card id: ${cardId}`);
      }

      return submittedCard;
    });

    await renderReviewScreen();
    await waitForReviewReactionLottieTestPrewarm();

    for (let index = 0; index < 4; index += 1) {
      await revealAnswer();
      const goodButton = getContainer().querySelector("[data-testid='review-rate-good']");
      if (!(goodButton instanceof HTMLButtonElement)) {
        throw new Error(`Good rating button was not found for rapid reaction ${index + 1}`);
      }

      await clickElementAsync(goodButton);
      await flushReviewScreenPromises();
    }

    expect(getContainer().querySelectorAll("[data-testid='review-rating-reaction-event']")).toHaveLength(3);
    expect(state.appData.submitReviewItem).toHaveBeenCalledTimes(4);
  });

  it("keeps review reaction overlay styles pointer-transparent with reduced motion support", () => {
    expect(reviewStylesContain(
      ".review-rating-reaction-layer",
      "pointer-events: none",
      "@media (prefers-reduced-motion: reduce)",
      "review-reaction-reduced-pop",
    )).toBe(true);
  });

  it("ignores review shortcuts while the filter menu or editor is open", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-shortcuts",
      frontText: "Front",
      backText: "Back",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await renderReviewScreen();
    await openReviewFilterMenu();
    await dispatchDocumentKeydown(" ");

    expect(getContainer().textContent).not.toContain("Back");
    expect(state.appData.submitReviewItem).not.toHaveBeenCalled();

    const trigger = getContainer().querySelector(".review-filter-trigger");
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error("Review filter trigger was not found");
    }

    await clickElementAsync(trigger);

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }

    await clickElementAsync(editButton);
    await dispatchDocumentKeydown(" ");
    await dispatchDocumentKeydown("3");

    expect(getContainer().querySelector(".review-pane .review-card-answer")).toBeNull();
    expect(state.appData.submitReviewItem).not.toHaveBeenCalled();
  });

  it("shows review AI only on the revealed back card and keeps the card text full width", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-ai-placement",
      frontText: "Front question",
      backText: "Back answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await renderReviewScreen();

    expect(getContainer().querySelector(".review-pane-head-actions .review-card-ai-btn")).toBeNull();
    expect(getContainer().querySelector(".review-card-surface-front .review-card-ai-btn")).toBeNull();
    expect(getContainer().querySelector(".review-card-surface-front .review-card-actions")).toBeTruthy();

    await revealAnswer();

    const backAiButton = getContainer().querySelector(".review-card-answer .review-card-ai-btn");
    if (!(backAiButton instanceof HTMLButtonElement)) {
      throw new Error("Review back AI button was not found");
    }

    expect(backAiButton.textContent).toBe("AI");
    expect(backAiButton.getAttribute("aria-label")).toBe("Open back card in AI chat");
    expect(getContainer().querySelector(".review-pane-head-actions .review-card-ai-btn")).toBeNull();
    expect(getContainer().querySelector(".review-card-answer .review-card-speech-btn")).not.toBeNull();
  });

  it("filters, closes, and selects items in the review filter menu", async () => {
    const state = getState();
    state.decks = createDecks(["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"]);
    state.cards = [
      createCard({ cardId: "tag-1", tags: ["grammar"] }),
      createCard({ cardId: "tag-2", tags: ["verbs"] }),
    ];
    state.reviewQueue = [state.cards[0] as (typeof state.cards)[number]];
    state.reviewTimeline = state.cards;

    await renderReviewScreen();
    await openReviewFilterMenu();

    const searchInput = getContainer().querySelector(".review-filter-search-input");
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error("Review filter search input was not found");
    }

    await setTextFieldValueAsync(searchInput, "med");

    expect(getContainer().textContent).toContain("Medium");
    expect(getContainer().textContent).not.toContain("Alpha");

    await dispatchDocumentKeydown("Escape");
    expect(getContainer().querySelector(".review-filter-menu")).toBeNull();

    await openReviewFilterMenu();
    const mediumButton = [...getContainer().querySelectorAll("[data-review-filter-key]")]
      .find((element) => element.getAttribute("data-review-filter-key") === "effort:medium");
    if (!(mediumButton instanceof HTMLButtonElement)) {
      throw new Error("Medium review filter option was not found");
    }

    await clickElementAsync(mediumButton);

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({
      kind: "effort",
      effortLevel: "medium",
    });
  });

  it("saves card edits from the review editor", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-edit",
      frontText: "Before",
      backText: "Existing back",
      tags: ["grammar"],
      effortLevel: "medium",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }

    await clickElementAsync(editButton);

    const frontTextField = document.getElementById("review-card-editor-front-text");
    if (!(frontTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Review editor front field was not found");
    }

    await setTextFieldValueAsync(frontTextField, "After");

    const saveButton = [...document.querySelectorAll(".review-editor-modal .primary-btn")][0];
    if (!(saveButton instanceof HTMLButtonElement)) {
      throw new Error("Review editor save button was not found");
    }

    await clickElementAsync(saveButton);

    expect(state.appData.updateCardItem).toHaveBeenCalledWith("card-edit", {
      frontText: "After",
      backText: "Existing back",
      tags: ["grammar"],
      effortLevel: "medium",
    });
  });

  it("deletes the edited card after confirmation", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-delete",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }

    await clickElementAsync(editButton);

    const deleteButton = document.querySelector(".review-editor-delete-btn");
    if (!(deleteButton instanceof HTMLButtonElement)) {
      throw new Error("Review editor delete button was not found");
    }

    await clickElementAsync(deleteButton);

    expect(confirmMock).toHaveBeenCalledWith("Delete this card?");
    expect(state.appData.deleteCardItem).toHaveBeenCalledWith("card-delete");

    confirmMock.mockRestore();
  });

  it("keeps rating shortcuts disabled until the answer is visible", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-hidden-answer",
      frontText: "Question",
      backText: "Answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => card);
    loadReviewQueueSnapshotMock.mockClear();

    await renderReviewScreen();
    await dispatchDocumentKeydown("1");

    expect(state.appData.submitReviewItem).not.toHaveBeenCalled();

    await revealAnswer();
    await dispatchDocumentKeydown("1");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-hidden-answer", 0);
  });
});
