// @vitest-environment jsdom
import { useCallback, useEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  buildSelectedReviewFilterStorageKey,
  loadSelectedReviewFilterForWorkspace,
  storeSelectedReviewFilterForWorkspace,
} from "../../../appData/context/reviewFilterPersistence";
import type { ReviewFilter, ReviewQueueSnapshot } from "../../../types";
import {
  clickElementAsync,
  createCard,
  createDeferredPromise,
  createDecks,
  createStorageMock,
  loadReviewQueueSnapshotMock,
  reviewStylesContain,
  setTextFieldValueAsync,
  setupReviewScreenTest,
  useAppDataMock,
} from "../testSupport/ReviewScreenTestSupport";
import {
  composingKeydownElementAsync,
  flushReviewScreenPromises,
  getActiveReviewFilterOption,
  keydownElementAsync,
  pointerDownAndClickElementAsync,
  pointerDownElementAsync,
} from "./ReviewScreen.controlsTestSupport";

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  openReviewFilterMenu,
  renderReviewScreen,
  renderReviewScreenStrictMode,
  rerenderReviewScreen,
} = setupReviewScreenTest();

function queryReviewFilterMenu(): HTMLDivElement | null {
  const menu = document.querySelector(".review-filter-menu");
  if (menu === null) {
    return null;
  }

  if (!(menu instanceof HTMLDivElement)) {
    throw new Error("Review filter menu was not rendered as a div");
  }

  return menu;
}

function getReviewFilterMenu(): HTMLDivElement {
  const menu = queryReviewFilterMenu();
  if (menu === null) {
    throw new Error("Review filter menu was not found");
  }

  return menu;
}

describe("ReviewScreen filter controls", () => {
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
      streakFreeze: {
        availableCredits: 1,
        capacity: 2,
        balanceUnits: 10,
        unitsPerCredit: 10,
        earnedUnitsPerStreakDay: 1,
        nextCreditProgressUnits: 0,
        nextCreditRequiredUnits: 10,
      },
      isInteractive: true,
    };

    await renderReviewScreen();

    const progressBadge = getContainer().querySelector("[data-testid='review-progress-badge']");
    if (!(progressBadge instanceof HTMLAnchorElement)) {
      throw new Error("Review progress badge was not found");
    }
    const leaderboardShortcut = getContainer().querySelector("[data-testid='review-leaderboard-shortcut']");
    if (!(leaderboardShortcut instanceof HTMLAnchorElement)) {
      throw new Error("Review leaderboard shortcut was not found");
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
    expect(progressBadge.textContent).toContain("12");
    expect(progressBadge.textContent).not.toContain("1/2");
    expect(progressBadge.querySelector(".review-progress-freeze-indicator")).toBeNull();
    expect(progressBadge.getAttribute("aria-label")).toBe("Review streak 12 days. Reviewed today.");
    expect(progressBadge.getAttribute("title")).toBe("Review streak 12 days. Reviewed today.");
    const queueBadge = getContainer().querySelector("[data-testid='review-queue-badge']");
    if (!(queueBadge instanceof HTMLButtonElement)) {
      throw new Error("Review queue badge was not found");
    }
    expect(queueBadge.querySelector(".review-progress-badge-value")).toBeNull();
    expect(queueBadge.getAttribute("aria-label")).toContain("1 card");
    expect(queueBadge.getAttribute("aria-controls")).toBeNull();
    expect(queueBadge.getAttribute("aria-expanded")).toBe("false");
    expect(queueBadge.getAttribute("href")).toBeNull();
    expect(queueBadge.disabled).toBe(false);
    expect(leaderboardShortcut.className).toContain("review-leaderboard-shortcut");
    expect(leaderboardShortcut.className).not.toContain("review-leaderboard-shortcut-ranked");
    expect(leaderboardShortcut.querySelector(".review-progress-badge-value")).toBeNull();
    expect(leaderboardShortcut.getAttribute("aria-label")).toBe("Open leaderboard");
    expect(leaderboardShortcut.getAttribute("href")).toBe("/progress#leaderboard");
    expect(reviewStylesContain(
      ".review-leaderboard-shortcut .review-progress-badge-icon",
      "color: #fbbf24",
    )).toBe(true);
    const reviewLayout = getContainer().querySelector(".review-layout");
    if (!(reviewLayout instanceof HTMLElement)) {
      throw new Error("Review layout was not found");
    }
    expect(reviewLayout.className).not.toContain("review-layout-queue-open");
    expect(getContainer().querySelector("#review-queue-panel")).toBeNull();
    expect(getContainer().querySelectorAll("[data-testid='review-queue-card']")).toHaveLength(0);
    expect(getContainer().querySelector("[data-testid='review-screen-toolbar']")).toBeNull();
    expect(headerActions.contains(scopeTrigger)).toBe(true);
    expect(headerActions.contains(queueBadge)).toBe(true);
    expect(headerActions.contains(leaderboardShortcut)).toBe(true);
    expect(headerActions.contains(progressBadge)).toBe(true);
    expect(scopeTrigger.compareDocumentPosition(progressBadge) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const progressBadgeIcon = progressBadge.querySelector("svg.review-progress-badge-icon");
    if (!(progressBadgeIcon instanceof SVGSVGElement)) {
      throw new Error("Review progress badge icon was not found");
    }

    expect(progressBadgeIcon.getAttribute("aria-hidden")).toBe("true");

    await clickElementAsync(queueBadge);
    expect(queueBadge.getAttribute("aria-controls")).toBe("review-queue-panel");
    expect(queueBadge.getAttribute("aria-expanded")).toBe("true");
    expect(reviewLayout.className).toContain("review-layout-queue-open");
    const queuePanelAfterOpen = getContainer().querySelector("#review-queue-panel");
    if (!(queuePanelAfterOpen instanceof HTMLElement)) {
      throw new Error("Review queue panel was not found after opening");
    }
    const queueCloseButton = getContainer().querySelector("[data-testid='review-queue-close']");
    if (!(queueCloseButton instanceof HTMLButtonElement)) {
      throw new Error("Review queue close button was not found");
    }
    expect(queuePanelAfterOpen.className).toContain("review-queue-panel-open");
    expect(queueCloseButton.getAttribute("aria-label")).toBe("Close queue");
    expect(getContainer().querySelectorAll("[data-testid='review-queue-card']")).toHaveLength(1);
    expect(window.location.hash).toBe("");

    await clickElementAsync(queueCloseButton);
    expect(queueBadge.getAttribute("aria-controls")).toBeNull();
    expect(queueBadge.getAttribute("aria-expanded")).toBe("false");
    expect(reviewLayout.className).not.toContain("review-layout-queue-open");
    expect(getContainer().querySelector("#review-queue-panel")).toBeNull();
    expect(getContainer().querySelectorAll("[data-testid='review-queue-card']")).toHaveLength(0);
    expect(window.location.hash).toBe("");

    await clickElementAsync(queueBadge);
    expect(queueBadge.getAttribute("aria-expanded")).toBe("true");
    expect(getContainer().querySelector("#review-queue-panel")).not.toBeNull();
    expect(window.location.hash).toBe("");

    await clickElementAsync(queueBadge);
    expect(queueBadge.getAttribute("aria-expanded")).toBe("false");
    expect(getContainer().querySelector("#review-queue-panel")).toBeNull();
    expect(getContainer().querySelectorAll("[data-testid='review-queue-card']")).toHaveLength(0);
    expect(window.location.hash).toBe("");
  });

  it("renders the review leaderboard rank when the cached leaderboard snapshot has a placement", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-leaderboard-badge",
      frontText: "Question",
      backText: "Answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.reviewLeaderboardBadge = {
      rank: 3,
      windowKey: "last_24_hours",
      isInteractive: true,
    };

    await renderReviewScreen();

    const leaderboardShortcut = getContainer().querySelector("[data-testid='review-leaderboard-shortcut']");
    if (!(leaderboardShortcut instanceof HTMLAnchorElement)) {
      throw new Error("Review leaderboard shortcut was not found");
    }
    const leaderboardShortcutValue = leaderboardShortcut.querySelector(".review-progress-badge-value");
    if (!(leaderboardShortcutValue instanceof HTMLSpanElement)) {
      throw new Error("Review leaderboard shortcut value was not found");
    }

    expect(leaderboardShortcut.className).toContain("review-leaderboard-shortcut-ranked");
    expect(leaderboardShortcutValue.textContent).toBe("3");
    expect(leaderboardShortcut.getAttribute("aria-label")).toContain("#3");
  });

  it("keeps an open empty queue closable from the header shortcut", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-empty-open-queue",
      frontText: "Question",
      backText: "Answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await renderReviewScreen();

    const queueBadge = getContainer().querySelector("[data-testid='review-queue-badge']");
    if (!(queueBadge instanceof HTMLButtonElement)) {
      throw new Error("Review queue badge was not found");
    }

    await clickElementAsync(queueBadge);
    expect(queueBadge.disabled).toBe(false);
    expect(queueBadge.getAttribute("aria-expanded")).toBe("true");
    expect(getContainer().querySelector("#review-queue-panel")).not.toBeNull();

    state.reviewQueue = [];
    state.reviewTimeline = [];
    state.appData.selectedReviewFilter = {
      kind: "tags",
      tags: [],
    };
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();
    await flushReviewScreenPromises();
    await vi.waitFor(() => {
      const refreshedQueueBadge = getContainer().querySelector("[data-testid='review-queue-badge']");
      if (!(refreshedQueueBadge instanceof HTMLButtonElement)) {
        throw new Error("Review queue badge was not found while waiting for empty queue");
      }

      expect(refreshedQueueBadge.getAttribute("aria-label")).toContain("0 cards");
    });

    const emptyQueueBadge = getContainer().querySelector("[data-testid='review-queue-badge']");
    if (!(emptyQueueBadge instanceof HTMLButtonElement)) {
      throw new Error("Review queue badge was not found after queue emptied");
    }

    expect(emptyQueueBadge.disabled).toBe(false);
    expect(emptyQueueBadge.getAttribute("aria-controls")).toBe("review-queue-panel");
    expect(emptyQueueBadge.getAttribute("aria-expanded")).toBe("true");
    expect(getContainer().querySelector("#review-queue-panel")).not.toBeNull();

    await clickElementAsync(emptyQueueBadge);

    const closedEmptyQueueBadge = getContainer().querySelector("[data-testid='review-queue-badge']");
    if (!(closedEmptyQueueBadge instanceof HTMLButtonElement)) {
      throw new Error("Review queue badge was not found after closing empty queue");
    }

    expect(closedEmptyQueueBadge.disabled).toBe(true);
    expect(closedEmptyQueueBadge.getAttribute("aria-controls")).toBeNull();
    expect(closedEmptyQueueBadge.getAttribute("aria-expanded")).toBeNull();
    expect(getContainer().querySelector("#review-queue-panel")).toBeNull();
  });

  it("stages accessible multi-select changes and applies the final filter once on dismissal", async () => {
    const state = getState();
    state.decks = createDecks(["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"]);
    state.cards = [
      createCard({ cardId: "tag-1", tags: ["grammar"] }),
      createCard({ cardId: "tag-2", tags: ["verbs"] }),
      createCard({ cardId: "tag-3", tags: ["medium"] }),
    ];
    state.reviewQueue = [state.cards[0] as (typeof state.cards)[number]];
    state.reviewTimeline = state.cards;

    await renderReviewScreen();
    await openReviewFilterMenu();

    const filterMenu = getReviewFilterMenu();
    const searchInput = filterMenu.querySelector(".review-filter-search-input");
    if (!(searchInput instanceof HTMLInputElement)) {
      throw new Error("Review filter search input was not found");
    }

    expect(searchInput.getAttribute("role")).toBe("combobox");
    expect(searchInput.getAttribute("aria-haspopup")).toBe("listbox");
    expect(searchInput.getAttribute("aria-expanded")).toBe("true");

    const listbox = filterMenu.querySelector("[role='listbox']");
    if (!(listbox instanceof HTMLElement)) {
      throw new Error("Review filter listbox was not found");
    }

    expect(listbox.classList.contains("review-filter-listbox")).toBe(true);
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
    expect(searchInput.getAttribute("aria-controls")).toBe(listbox.id);
    expect(listbox.querySelector("[data-review-filter-key='allCards']")?.getAttribute("aria-selected")).toBe("true");
    expect(listbox.querySelector("[data-review-filter-key='tag:grammar']")?.getAttribute("aria-selected")).toBe("true");
    expect(listbox.querySelector("[data-review-filter-key='tag:verbs']")?.getAttribute("aria-selected")).toBe("true");
    expect(listbox.querySelector("[data-review-filter-key='tag:medium']")?.getAttribute("aria-selected")).toBe("true");

    const selectedAllCardsOption = listbox.querySelector("[data-review-filter-key='allCards']");
    if (!(selectedAllCardsOption instanceof HTMLElement)) {
      throw new Error("Selected All Cards review filter option was not found");
    }

    await clickElementAsync(selectedAllCardsOption);

    expect(selectedAllCardsOption.getAttribute("aria-selected")).toBe("false");
    expect(listbox.querySelector("[data-review-filter-key='tag:grammar']")?.getAttribute("aria-selected")).toBe("false");
    expect(listbox.querySelector("[data-review-filter-key='tag:verbs']")?.getAttribute("aria-selected")).toBe("false");
    expect(listbox.querySelector("[data-review-filter-key='tag:medium']")?.getAttribute("aria-selected")).toBe("false");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(getContainer().querySelector("[data-testid='review-pane']")?.getAttribute("data-review-pane-state")).toBe("card");
    expect(getContainer().querySelector("[data-testid='review-pane']")?.getAttribute("data-review-current-card-id")).toBe("tag-1");
    expect(queryReviewFilterMenu()).not.toBeNull();

    const grammarOptionFromEmpty = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:grammar']");
    if (!(grammarOptionFromEmpty instanceof HTMLElement)) {
      throw new Error("Grammar review filter option was not found after clearing All Cards");
    }

    await clickElementAsync(grammarOptionFromEmpty);

    expect(grammarOptionFromEmpty.getAttribute("aria-selected")).toBe("true");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();

    await pointerDownElementAsync(document.body);
    expect(queryReviewFilterMenu()).toBeNull();
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tags", tags: ["grammar"] });

    state.appData.selectedReviewFilter = { kind: "tags", tags: ["grammar"] };
    await rerenderReviewScreen();
    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    const verbsOption = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:verbs']");
    if (!(verbsOption instanceof HTMLElement)) {
      throw new Error("Verbs review filter option was not found");
    }
    await clickElementAsync(verbsOption);
    expect(verbsOption.getAttribute("aria-selected")).toBe("true");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    await dispatchDocumentKeydown("Escape");
    expect(queryReviewFilterMenu()).toBeNull();
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tags", tags: ["grammar", "verbs"] });

    state.appData.selectedReviewFilter = { kind: "tags", tags: ["grammar", "verbs"] };
    await rerenderReviewScreen();
    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    const allCardsOption = getReviewFilterMenu().querySelector("[data-review-filter-key='allCards']");
    const trigger = getContainer().querySelector(".review-filter-trigger");
    if (!(allCardsOption instanceof HTMLElement) || !(trigger instanceof HTMLButtonElement)) {
      throw new Error("All Cards option or review filter trigger was not found");
    }
    await clickElementAsync(allCardsOption);
    expect(allCardsOption.getAttribute("aria-selected")).toBe("true");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    await clickElementAsync(trigger);
    expect(queryReviewFilterMenu()).toBeNull();
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "allCards" });

    state.appData.selectedReviewFilter = { kind: "allCards" };
    await rerenderReviewScreen();
    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    const selectedAllCardsForEditDecks = getReviewFilterMenu().querySelector("[data-review-filter-key='allCards']");
    const editDecksLink = getReviewFilterMenu().querySelector(".review-filter-menu-entry-action");
    if (!(selectedAllCardsForEditDecks instanceof HTMLElement) || !(editDecksLink instanceof HTMLAnchorElement)) {
      throw new Error("All Cards option or Edit decks link was not found");
    }
    await clickElementAsync(selectedAllCardsForEditDecks);
    expect(selectedAllCardsForEditDecks.getAttribute("aria-selected")).toBe("false");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    await clickElementAsync(editDecksLink);
    expect(queryReviewFilterMenu()).toBeNull();
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tags", tags: [] });

    state.appData.selectedReviewFilter = { kind: "allCards" };
    await rerenderReviewScreen();
    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    const searchableFilterMenu = getReviewFilterMenu();
    const searchableListbox = searchableFilterMenu.querySelector("[role='listbox']");
    const searchableInput = searchableFilterMenu.querySelector(".review-filter-search-input");
    if (!(searchableListbox instanceof HTMLElement) || !(searchableInput instanceof HTMLInputElement)) {
      throw new Error("Searchable review filter controls were not found after reopening");
    }
    searchableListbox.scrollTop = 24;

    expect(reviewStylesContain(
      ".review-filter-menu",
      "display: flex",
      "flex-direction: column",
      "overflow: hidden",
      ".review-filter-listbox",
      "flex: 1 1 auto",
      "overflow-y: auto",
    )).toBe(true);

    const searchableEditDecksLink = searchableFilterMenu.querySelector(".review-filter-menu-entry-action");
    if (!(searchableEditDecksLink instanceof HTMLAnchorElement)) {
      throw new Error("Review filter Edit decks link was not found after reopening");
    }
    expect(searchableEditDecksLink.getAttribute("role")).not.toBe("option");
    expect(searchableEditDecksLink.getAttribute("data-review-filter-key")).toBeNull();
    expect(searchableListbox.contains(searchableEditDecksLink)).toBe(false);

    await setTextFieldValueAsync(searchableInput, "med");

    expect([...searchableListbox.querySelectorAll("[role='option']")].map((option) => (
      option.getAttribute("data-review-filter-key")
    ))).toEqual(["tag:medium"]);
    expect(searchableListbox.querySelector(".review-filter-menu-divider")).toBeNull();

    await setTextFieldValueAsync(searchableInput, "ta");

    expect(getReviewFilterMenu().textContent).toContain("Beta");
    expect(getReviewFilterMenu().textContent).toContain("Delta");
    expect(getReviewFilterMenu().textContent).not.toContain("Alpha");
    expect([...searchableListbox.querySelectorAll("[role='option']")].map((option) => (
      option.getAttribute("data-review-filter-key")
    ))).toEqual(["deck:deck-2", "deck:deck-4", "deck:deck-6", "deck:deck-7"]);

    await vi.waitFor(() => {
      expect(getActiveReviewFilterOption(searchableInput).getAttribute("data-review-filter-key")).toBe("deck:deck-2");
    });
    expect(getActiveReviewFilterOption(searchableInput).classList.contains("review-filter-menu-entry-keyboard-active")).toBe(true);

    await composingKeydownElementAsync(searchableInput, "ArrowDown");
    await composingKeydownElementAsync(searchableInput, "Enter");

    expect(getActiveReviewFilterOption(searchableInput).getAttribute("data-review-filter-key")).toBe("deck:deck-2");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();

    await keydownElementAsync(searchableInput, "ArrowDown");
    expect(getActiveReviewFilterOption(searchableInput).getAttribute("data-review-filter-key")).toBe("deck:deck-4");

    await keydownElementAsync(searchableInput, "ArrowLeft");
    await keydownElementAsync(searchableInput, "ArrowRight");
    await keydownElementAsync(searchableInput, " ");

    expect(getActiveReviewFilterOption(searchableInput).getAttribute("data-review-filter-key")).toBe("deck:deck-4");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();

    await keydownElementAsync(searchableInput, "ArrowUp");
    expect(getActiveReviewFilterOption(searchableInput).getAttribute("data-review-filter-key")).toBe("deck:deck-2");

    await keydownElementAsync(searchableInput, "ArrowDown");
    await keydownElementAsync(searchableInput, "Enter");

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();
    expect(document.activeElement).toBe(searchableInput);
    expect(searchableListbox.scrollTop).toBe(24);

    const triggerAfterSearchKeyboardSelect = getContainer().querySelector(".review-filter-trigger");
    if (!(triggerAfterSearchKeyboardSelect instanceof HTMLButtonElement)) {
      throw new Error("Review filter trigger was not found after search keyboard selection");
    }
    await pointerDownElementAsync(triggerAfterSearchKeyboardSelect);
    expect(queryReviewFilterMenu()).not.toBeNull();
    await pointerDownElementAsync(getReviewFilterMenu());
    expect(queryReviewFilterMenu()).not.toBeNull();
    await pointerDownElementAsync(document.body);
    expect(queryReviewFilterMenu()).toBeNull();
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-4" });
  });

  it("selects items by keyboard when the review filter menu has no search field", async () => {
    const state = getState();
    state.decks = createDecks(["Alpha", "Beta"]);
    const card = createCard({
      cardId: "card-no-search-filter",
      frontText: "Front",
      backText: "Back",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await renderReviewScreen();
    await openReviewFilterMenu();

    const filterMenu = getReviewFilterMenu();
    expect(filterMenu.querySelector(".review-filter-search-input")).toBeNull();

    const listbox = filterMenu.querySelector("[role='listbox']");
    if (!(listbox instanceof HTMLElement)) {
      throw new Error("Review filter listbox was not found");
    }
    const editDecksLink = filterMenu.querySelector(".review-filter-menu-entry-action");
    if (!(editDecksLink instanceof HTMLAnchorElement)) {
      throw new Error("Review filter edit decks link was not found");
    }

    expect(listbox.getAttribute("tabindex")).toBe("0");
    expect(listbox.compareDocumentPosition(editDecksLink) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(listbox);
    });
    await vi.waitFor(() => {
      expect(getActiveReviewFilterOption(listbox).getAttribute("data-review-filter-key")).toBe("allCards");
    });

    await keydownElementAsync(listbox, "ArrowDown");
    expect(getActiveReviewFilterOption(listbox).getAttribute("data-review-filter-key")).toBe("deck:deck-1");

    await keydownElementAsync(listbox, "ArrowDown");
    expect(getActiveReviewFilterOption(listbox).getAttribute("data-review-filter-key")).toBe("deck:deck-2");

    await keydownElementAsync(listbox, " ");

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(getReviewFilterMenu().querySelector("[data-review-filter-key='deck:deck-2']")?.getAttribute("aria-selected")).toBe("true");
    expect(queryReviewFilterMenu()).not.toBeNull();
    const triggerAfterListboxKeyboardSelect = getContainer().querySelector(".review-filter-trigger");
    if (!(triggerAfterListboxKeyboardSelect instanceof HTMLButtonElement)) {
      throw new Error("Review filter trigger was not found after listbox keyboard selection");
    }
    expect(document.activeElement).toBe(listbox);
    await clickElementAsync(triggerAfterListboxKeyboardSelect);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-2" });
  });

  it("uses the pointer-selected option for the next keyboard selection", async () => {
    const state = getState();
    state.decks = createDecks(["Pointer deck"]);
    const card = createCard({
      cardId: "card-pointer-keyboard-filter",
      frontText: "Front",
      backText: "Back",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await renderReviewScreen();
    await openReviewFilterMenu();

    const listbox = getReviewFilterMenu().querySelector("[role='listbox']");
    const deckOption = getReviewFilterMenu().querySelector("[data-review-filter-key='deck:deck-1']");
    if (!(listbox instanceof HTMLElement) || !(deckOption instanceof HTMLElement)) {
      throw new Error("Pointer-keyboard review filter controls were not found");
    }

    await clickElementAsync(deckOption);

    expect(getActiveReviewFilterOption(listbox)).toBe(deckOption);
    expect(listbox.getAttribute("aria-activedescendant")).toBe(deckOption.id);
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();

    await keydownElementAsync(listbox, " ");

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();
    await pointerDownElementAsync(document.body);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-1" });
  });

  it("keeps searchable pointer selection owned by the combobox for keyboard activation", async () => {
    const state = getState();
    state.decks = createDecks(["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta"]);
    const card = createCard({
      cardId: "card-search-pointer-keyboard-filter",
      frontText: "Front",
      backText: "Back",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];

    await renderReviewScreen();
    await openReviewFilterMenu();

    const searchInput = getReviewFilterMenu().querySelector(".review-filter-search-input");
    const deckOption = getReviewFilterMenu().querySelector("[data-review-filter-key='deck:deck-4']");
    if (!(searchInput instanceof HTMLInputElement) || !(deckOption instanceof HTMLElement)) {
      throw new Error("Searchable pointer-keyboard review filter controls were not found");
    }
    expect(document.activeElement).toBe(searchInput);

    const wasPointerDownPrevented = await pointerDownAndClickElementAsync(deckOption);

    expect(wasPointerDownPrevented).toBe(true);
    expect(document.activeElement).toBe(searchInput);
    expect(getActiveReviewFilterOption(searchInput)).toBe(deckOption);
    expect(searchInput.getAttribute("aria-activedescendant")).toBe(deckOption.id);
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();

    await keydownElementAsync(searchInput, "Enter");

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(searchInput);
    expect(queryReviewFilterMenu()).not.toBeNull();
    await dispatchDocumentKeydown("Escape");
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "deck", deckId: "deck-4" });
  });

  it("shows the resolved tag count after StrictMode replays the initial load effect", async () => {
    const state = getState();
    const card = createCard({
      cardId: "strict-mode-resolved-filter-card",
      frontText: "Front",
      backText: "Back",
      tags: ["grammar"],
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.appData.selectedReviewFilter = {
      kind: "tags",
      tags: ["grammar", "missing"],
    };
    loadReviewQueueSnapshotMock.mockResolvedValue({
      resolvedReviewFilter: {
        kind: "tags",
        tags: ["grammar"],
      },
      cards: [card],
      nextCursor: null,
      reviewCounts: {
        dueCount: 1,
        totalCount: 1,
      },
    });

    await renderReviewScreenStrictMode();

    await vi.waitFor(() => {
      const trigger = getContainer().querySelector("[data-testid='review-filter-trigger']");
      if (!(trigger instanceof HTMLButtonElement)) {
        throw new Error("Review filter trigger was not found after StrictMode loading");
      }

      expect(trigger.textContent).toContain("1 tag");
      expect(trigger.textContent).not.toContain("2 tags");
    });
  });

  it("carries a restored exact-all snapshot through the stateful persisted All Cards promotion", async () => {
    const state = getState();
    const workspaceId = "workspace-1";
    state.cards = [
      createCard({ cardId: "grammar-card", tags: ["grammar"] }),
      createCard({ cardId: "verbs-card", tags: ["verbs"] }),
    ];
    state.reviewQueue = state.cards;
    state.reviewTimeline = state.cards;
    state.appData.selectedReviewFilter = {
      kind: "tags",
      tags: ["grammar", "verbs"],
    };
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    storeSelectedReviewFilterForWorkspace(workspaceId, state.appData.selectedReviewFilter);
    const promotedSelections = vi.fn<(reviewFilter: ReviewFilter) => void>();
    useAppDataMock.mockImplementation(() => {
      const [selectedReviewFilter, setSelectedReviewFilter] = useState<ReviewFilter>(
        () => loadSelectedReviewFilterForWorkspace(workspaceId),
      );
      useEffect(() => {
        storeSelectedReviewFilterForWorkspace(workspaceId, selectedReviewFilter);
      }, [selectedReviewFilter]);
      const selectReviewFilter = useCallback((reviewFilter: ReviewFilter): void => {
        promotedSelections(reviewFilter);
        setSelectedReviewFilter(reviewFilter);
      }, []);

      return {
        ...state.appData,
        selectedReviewFilter,
        selectReviewFilter,
      };
    });
    const unexpectedSecondLoad = createDeferredPromise<ReviewQueueSnapshot>();
    loadReviewQueueSnapshotMock.mockResolvedValueOnce({
      resolvedReviewFilter: { kind: "allCards" },
      cards: state.reviewQueue,
      nextCursor: null,
      reviewCounts: {
        dueCount: state.reviewQueue.length,
        totalCount: state.reviewQueue.length,
      },
    });
    loadReviewQueueSnapshotMock.mockImplementation(() => unexpectedSecondLoad.promise);

    await renderReviewScreen();

    await vi.waitFor(() => {
      expect(promotedSelections).toHaveBeenCalledTimes(1);
      expect(promotedSelections).toHaveBeenCalledWith({ kind: "allCards" });
      expect(loadSelectedReviewFilterForWorkspace(workspaceId)).toEqual({ kind: "allCards" });
    });

    await openReviewFilterMenu();

    const allCardsOption = getReviewFilterMenu().querySelector("[data-review-filter-key='allCards']");
    const grammarOption = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:grammar']");
    const verbsOption = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:verbs']");
    const trigger = getContainer().querySelector("[data-testid='review-filter-trigger']");
    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (
      !(allCardsOption instanceof HTMLElement)
      || !(grammarOption instanceof HTMLElement)
      || !(verbsOption instanceof HTMLElement)
      || !(trigger instanceof HTMLButtonElement)
      || !(reviewPane instanceof HTMLElement)
    ) {
      throw new Error("Promoted All Cards filter controls were not found");
    }

    expect(trigger.textContent).toContain("All cards");
    expect(allCardsOption.getAttribute("aria-selected")).toBe("true");
    expect(grammarOption.getAttribute("aria-selected")).toBe("true");
    expect(verbsOption.getAttribute("aria-selected")).toBe("true");
    expect(reviewPane.dataset.reviewPaneState).toBe("card");
    expect(loadReviewQueueSnapshotMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(buildSelectedReviewFilterStorageKey(workspaceId))).toBe(
      JSON.stringify({ kind: "allCards" }),
    );
  });

  it.each([
    ["explicit empty", { kind: "tags", tags: [] }, { kind: "tags", tags: [] }],
    ["missing tag", { kind: "tags", tags: ["grammar", "missing"] }, { kind: "tags", tags: ["grammar"] }],
    ["subset", { kind: "tags", tags: ["grammar"] }, { kind: "tags", tags: ["grammar"] }],
  ] as const)("does not promote a %s tag selection", async (_scenario, selectedReviewFilter, resolvedReviewFilter) => {
    const state = getState();
    const card = createCard({ cardId: "grammar-card", tags: ["grammar"] });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.appData.selectedReviewFilter = selectedReviewFilter;
    loadReviewQueueSnapshotMock.mockResolvedValue({
      resolvedReviewFilter,
      cards: resolvedReviewFilter.tags.length === 0 ? [] : [card],
      nextCursor: null,
      reviewCounts: {
        dueCount: resolvedReviewFilter.tags.length === 0 ? 0 : 1,
        totalCount: resolvedReviewFilter.tags.length === 0 ? 0 : 1,
      },
    });

    await renderReviewScreen();

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
  });

  it("materializes deck tags and canonicalizes a complete custom selection to All Cards", async () => {
    const state = getState();
    state.decks = [
      ...createDecks(["Grammar and verbs"]),
    ].map((deck) => ({
      ...deck,
      filterDefinition: {
        version: 2,
        tags: ["grammar", "verbs"],
      },
    }));
    state.cards = [
      createCard({ cardId: "grammar-card", tags: ["grammar"] }),
      createCard({ cardId: "verbs-card", tags: ["verbs"] }),
    ];
    state.reviewQueue = state.cards;
    state.reviewTimeline = state.cards;
    state.appData.selectedReviewFilter = {
      kind: "deck",
      deckId: "deck-1",
    };

    await renderReviewScreen();
    await openReviewFilterMenu();

    const grammarOption = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:grammar']");
    if (!(grammarOption instanceof HTMLElement)) {
      throw new Error("Grammar review filter option was not found");
    }
    expect(grammarOption.getAttribute("aria-selected")).toBe("true");
    expect(getReviewFilterMenu().querySelector("[data-review-filter-key='deck:deck-1']")?.getAttribute("aria-selected")).toBe("true");

    await clickElementAsync(grammarOption);

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(grammarOption.getAttribute("aria-selected")).toBe("false");
    expect(queryReviewFilterMenu()).not.toBeNull();
    await pointerDownElementAsync(document.body);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tags", tags: ["verbs"] });

    state.appData.selectedReviewFilter = {
      kind: "tags",
      tags: ["grammar"],
    };
    await rerenderReviewScreen();
    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    const verbsOption = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:verbs']");
    if (!(verbsOption instanceof HTMLElement)) {
      throw new Error("Verbs review filter option was not found");
    }

    await clickElementAsync(verbsOption);

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(verbsOption.getAttribute("aria-selected")).toBe("true");
    expect(queryReviewFilterMenu()).not.toBeNull();
    await dispatchDocumentKeydown("Escape");
    expect(state.appData.selectReviewFilter).toHaveBeenCalledTimes(1);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "allCards" });
  });

  it("retains missing custom and preset tags while toggling visible tags", async () => {
    const state = getState();
    state.decks = createDecks(["Configured deck", "All tags deck"]).map((deck) => ({
      ...deck,
      filterDefinition: {
        version: 2,
        tags: deck.deckId === "deck-1" ? ["grammar", "missing"] : [],
      },
    }));
    state.cards = [
      createCard({ cardId: "visible-grammar-card", tags: ["grammar"] }),
      createCard({ cardId: "visible-verbs-card", tags: ["verbs"] }),
    ];
    state.reviewQueue = state.cards;
    state.reviewTimeline = state.cards;
    state.appData.selectedReviewFilter = {
      kind: "deck",
      deckId: "deck-1",
    };

    await renderReviewScreen();
    await openReviewFilterMenu();

    const verbsFromConfiguredDeck = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:verbs']");
    if (!(verbsFromConfiguredDeck instanceof HTMLElement)) {
      throw new Error("Verbs option was not found for the configured deck");
    }
    expect(verbsFromConfiguredDeck.getAttribute("aria-selected")).toBe("false");

    await clickElementAsync(verbsFromConfiguredDeck);

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    await pointerDownElementAsync(document.body);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({
      kind: "tags",
      tags: ["grammar", "missing", "verbs"],
    });

    state.appData.selectedReviewFilter = {
      kind: "tags",
      tags: ["grammar", "missing"],
    };
    await rerenderReviewScreen();
    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    const verbsFromCustomSelection = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:verbs']");
    if (!(verbsFromCustomSelection instanceof HTMLElement)) {
      throw new Error("Verbs option was not found for the custom selection");
    }

    await clickElementAsync(verbsFromCustomSelection);

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    await pointerDownElementAsync(document.body);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({
      kind: "tags",
      tags: ["grammar", "missing", "verbs"],
    });

    state.appData.selectedReviewFilter = {
      kind: "deck",
      deckId: "deck-2",
    };
    await rerenderReviewScreen();
    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    const grammarFromAllTagsDeck = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:grammar']");
    const verbsFromAllTagsDeck = getReviewFilterMenu().querySelector("[data-review-filter-key='tag:verbs']");
    if (!(grammarFromAllTagsDeck instanceof HTMLElement) || !(verbsFromAllTagsDeck instanceof HTMLElement)) {
      throw new Error("Visible tag options were not found for the all-tags deck");
    }
    expect(grammarFromAllTagsDeck.getAttribute("aria-selected")).toBe("true");
    expect(verbsFromAllTagsDeck.getAttribute("aria-selected")).toBe("true");

    await clickElementAsync(grammarFromAllTagsDeck);

    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();
    const reviewFilterTrigger = getContainer().querySelector(".review-filter-trigger");
    if (!(reviewFilterTrigger instanceof HTMLButtonElement)) {
      throw new Error("Review filter trigger was not found");
    }
    await clickElementAsync(reviewFilterTrigger);
    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "tags", tags: ["verbs"] });
  });

  it("keeps review filter option ids unique for similar tag text", async () => {
    const state = getState();
    state.cards = [
      createCard({ cardId: "tag-slash", tags: ["a/b"] }),
      createCard({ cardId: "tag-escaped", tags: ["a-2f-b"] }),
    ];
    state.reviewQueue = [state.cards[0] as (typeof state.cards)[number]];
    state.reviewTimeline = state.cards;

    await renderReviewScreen();
    await openReviewFilterMenu();

    const filterMenu = getReviewFilterMenu();
    const slashTagOption = filterMenu.querySelector("[data-review-filter-key='tag:a/b']");
    const escapedTagOption = filterMenu.querySelector("[data-review-filter-key='tag:a-2f-b']");
    if (!(slashTagOption instanceof HTMLElement) || !(escapedTagOption instanceof HTMLElement)) {
      throw new Error("Review filter collision test options were not found");
    }

    expect(slashTagOption.id).not.toBe("");
    expect(escapedTagOption.id).not.toBe("");
    expect(slashTagOption.id).not.toBe(escapedTagOption.id);
    expect(document.getElementById(slashTagOption.id)).toBe(slashTagOption);
    expect(document.getElementById(escapedTagOption.id)).toBe(escapedTagOption);
  });

  it("shows one unique-card count for case-insensitive tag variants", async () => {
    const state = getState();
    state.cards = [
      createCard({ cardId: "case-variant-card", tags: ["Grammar", "grammar"] }),
      createCard({ cardId: "lowercase-card", tags: ["grammar"] }),
    ];
    state.reviewQueue = state.cards;
    state.reviewTimeline = state.cards;

    await renderReviewScreen();
    await openReviewFilterMenu();

    const tagOptions = getReviewFilterMenu().querySelectorAll("[data-review-filter-key='tag:grammar']");
    expect(tagOptions).toHaveLength(1);
    expect(tagOptions[0]?.textContent).toContain("Grammar (2)");
  });
});
