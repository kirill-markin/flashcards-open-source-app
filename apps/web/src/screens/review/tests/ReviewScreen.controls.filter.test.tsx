// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  clickElementAsync,
  createCard,
  createDecks,
  reviewStylesContain,
  setTextFieldValueAsync,
  setupReviewScreenTest,
} from "../testSupport/ReviewScreenTestSupport";
import {
  composingKeydownElementAsync,
  flushReviewScreenPromises,
  getActiveReviewFilterOption,
  keydownElementAsync,
  pointerDownElementAsync,
} from "./ReviewScreen.controlsTestSupport";

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  openReviewFilterMenu,
  renderReviewScreen,
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
      kind: "tag",
      tag: "empty",
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

  it("filters, closes, and selects items in the review filter menu", async () => {
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
    expect(searchInput.getAttribute("aria-controls")).toBe(listbox.id);
    expect(reviewStylesContain(
      ".review-filter-menu",
      "display: flex",
      "flex-direction: column",
      "overflow: hidden",
      ".review-filter-listbox",
      "flex: 1 1 auto",
      "overflow-y: auto",
    )).toBe(true);

    const editDecksLink = filterMenu.querySelector(".review-filter-menu-entry-action");
    if (!(editDecksLink instanceof HTMLAnchorElement)) {
      throw new Error("Review filter edit decks link was not found");
    }

    expect(editDecksLink.getAttribute("role")).not.toBe("option");
    expect(editDecksLink.getAttribute("data-review-filter-key")).toBeNull();
    expect(listbox.contains(editDecksLink)).toBe(false);

    await setTextFieldValueAsync(searchInput, "med");

    expect([...listbox.querySelectorAll("[role='option']")].map((option) => (
      option.getAttribute("data-review-filter-key")
    ))).toEqual(["tag:medium"]);
    expect(listbox.querySelector(".review-filter-menu-divider")).toBeNull();

    await setTextFieldValueAsync(searchInput, "ta");

    expect(getReviewFilterMenu().textContent).toContain("Beta");
    expect(getReviewFilterMenu().textContent).toContain("Delta");
    expect(getReviewFilterMenu().textContent).not.toContain("Alpha");
    expect([...listbox.querySelectorAll("[role='option']")].map((option) => (
      option.getAttribute("data-review-filter-key")
    ))).toEqual(["deck:deck-2", "deck:deck-4", "deck:deck-6", "deck:deck-7"]);

    await vi.waitFor(() => {
      expect(getActiveReviewFilterOption(searchInput).getAttribute("data-review-filter-key")).toBe("deck:deck-2");
    });
    expect(getActiveReviewFilterOption(searchInput).classList.contains("review-filter-menu-entry-keyboard-active")).toBe(true);

    await composingKeydownElementAsync(searchInput, "ArrowDown");
    await composingKeydownElementAsync(searchInput, "Enter");

    expect(getActiveReviewFilterOption(searchInput).getAttribute("data-review-filter-key")).toBe("deck:deck-2");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();

    await keydownElementAsync(searchInput, "ArrowDown");
    expect(getActiveReviewFilterOption(searchInput).getAttribute("data-review-filter-key")).toBe("deck:deck-4");

    await keydownElementAsync(searchInput, "ArrowLeft");
    await keydownElementAsync(searchInput, "ArrowRight");
    await keydownElementAsync(searchInput, " ");

    expect(getActiveReviewFilterOption(searchInput).getAttribute("data-review-filter-key")).toBe("deck:deck-4");
    expect(state.appData.selectReviewFilter).not.toHaveBeenCalled();
    expect(queryReviewFilterMenu()).not.toBeNull();

    await keydownElementAsync(searchInput, "ArrowUp");
    expect(getActiveReviewFilterOption(searchInput).getAttribute("data-review-filter-key")).toBe("deck:deck-2");

    await keydownElementAsync(searchInput, "ArrowDown");
    await keydownElementAsync(searchInput, "Enter");

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({
      kind: "deck",
      deckId: "deck-4",
    });
    expect(queryReviewFilterMenu()).toBeNull();
    const triggerAfterSearchKeyboardSelect = getContainer().querySelector(".review-filter-trigger");
    if (!(triggerAfterSearchKeyboardSelect instanceof HTMLButtonElement)) {
      throw new Error("Review filter trigger was not found after search keyboard selection");
    }
    expect(document.activeElement).toBe(triggerAfterSearchKeyboardSelect);

    state.appData.selectReviewFilter.mockClear();
    await openReviewFilterMenu();
    await pointerDownElementAsync(triggerAfterSearchKeyboardSelect);
    expect(queryReviewFilterMenu()).not.toBeNull();
    await pointerDownElementAsync(getReviewFilterMenu());
    expect(queryReviewFilterMenu()).not.toBeNull();
    await pointerDownElementAsync(document.body);
    expect(queryReviewFilterMenu()).toBeNull();

    await openReviewFilterMenu();
    await dispatchDocumentKeydown("Escape");
    expect(queryReviewFilterMenu()).toBeNull();

    await openReviewFilterMenu();
    const mediumOption = [...getReviewFilterMenu().querySelectorAll("[data-review-filter-key]")]
      .find((element) => element.getAttribute("data-review-filter-key") === "tag:medium");
    if (!(mediumOption instanceof HTMLElement)) {
      throw new Error("Medium review filter option was not found");
    }

    await clickElementAsync(mediumOption);

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({
      kind: "tag",
      tag: "medium",
    });
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

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({
      kind: "deck",
      deckId: "deck-2",
    });
    expect(queryReviewFilterMenu()).toBeNull();
    const triggerAfterListboxKeyboardSelect = getContainer().querySelector(".review-filter-trigger");
    if (!(triggerAfterListboxKeyboardSelect instanceof HTMLButtonElement)) {
      throw new Error("Review filter trigger was not found after listbox keyboard selection");
    }
    expect(document.activeElement).toBe(triggerAfterListboxKeyboardSelect);
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
});
