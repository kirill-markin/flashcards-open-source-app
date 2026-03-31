// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
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
  revealAnswer,
} = setupReviewScreenTest();

describe("ReviewScreen", () => {
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

    await setTextFieldValueAsync(searchInput, "eta");

    expect(getContainer().textContent).toContain("Beta");
    expect(getContainer().textContent).toContain("Zeta");
    expect(getContainer().textContent).not.toContain("Alpha");

    await dispatchDocumentKeydown("Escape");
    expect(getContainer().querySelector(".review-filter-menu")).toBeNull();

    await openReviewFilterMenu();
    const betaButton = [...getContainer().querySelectorAll("[data-review-filter-key]")]
      .find((element) => element.getAttribute("data-review-filter-key") === "deck:deck-2");
    if (!(betaButton instanceof HTMLButtonElement)) {
      throw new Error("Beta review filter option was not found");
    }

    await clickElementAsync(betaButton);

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({
      kind: "deck",
      deckId: "deck-2",
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
});
