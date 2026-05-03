// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Card } from "../../types";
import {
  clickElementAsync,
  createCard,
  createDecks,
  loadReviewQueueSnapshotMock,
  setTextFieldValueAsync,
  setupReviewScreenTest,
} from "./ReviewScreenTestSupport";

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  openReviewFilterMenu,
  renderReviewScreen,
  rerenderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

describe("ReviewScreen", () => {
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
    expect(getContainer().querySelector("[data-testid='review-queue-badge']")).toBeNull();
    expect(getContainer().querySelector("[data-testid='review-screen-toolbar']")).toBeNull();
    expect(headerActions.contains(scopeTrigger)).toBe(true);
    expect(headerActions.contains(progressBadge)).toBe(true);
    expect(scopeTrigger.compareDocumentPosition(progressBadge) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const progressBadgeIcon = progressBadge.querySelector("svg.review-progress-badge-icon");
    if (!(progressBadgeIcon instanceof SVGSVGElement)) {
      throw new Error("Review progress badge icon was not found");
    }

    expect(progressBadgeIcon.getAttribute("aria-hidden")).toBe("true");
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

    await renderReviewScreen();
    await dispatchDocumentKeydown(" ");

    expect(getContainer().textContent).toContain("Answer");

    await dispatchDocumentKeydown("3");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-review", 2);
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
    loadReviewQueueSnapshotMock.mockClear();

    await renderReviewScreen();
    await dispatchDocumentKeydown("1");

    expect(state.appData.submitReviewItem).not.toHaveBeenCalled();

    await revealAnswer();
    await dispatchDocumentKeydown("1");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-hidden-answer", 0);
  });

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
