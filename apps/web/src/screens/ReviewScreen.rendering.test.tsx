// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import { cardsRoute, chatRoute } from "../routes";
import {
  createCard,
  createDeck,
  clickElement,
  reviewStylesContain,
  setupReviewScreenTest,
} from "./ReviewScreenTestSupport";

const reviewScreen = setupReviewScreenTest();

describe("ReviewScreen rendering", () => {
  it("renders the selected deck-specific queue and timeline", async () => {
    const state = reviewScreen.getState();
    const grammarCard = createCard({
      cardId: "grammar-card",
      frontText: "Grammar front",
      tags: ["grammar"],
    });
    state.decks = [createDeck()];
    state.cards = [grammarCard];
    state.reviewQueue = [grammarCard];
    state.reviewTimeline = [grammarCard];
    state.appData.selectedReviewFilter = { kind: "deck", deckId: "deck-1" };

    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    expect(container.querySelector(".review-screen-panel")).not.toBeNull();
    expect(container.querySelector(".review-queue-subtitle")).toBeNull();
    expect(container.textContent).toContain("Grammar");
    expect(container.textContent).toContain("Grammar front");
    expect(container.textContent).not.toContain("No cards to review right now.");
  });

  it("fits review into the desktop viewport with internal pane and queue scrolling", () => {
    expect(reviewStylesContain(
      ".review-screen-panel {",
      "grid-template-rows: auto minmax(0, 1fr);",
      "max-height: calc(100dvh - 156px);",
      "overflow: hidden;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-layout {",
      "align-items: stretch;",
      "min-height: 0;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-pane {",
      "overflow-y: auto;",
      "scrollbar-gutter: stable;",
      "scroll-padding-bottom: 152px;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-queue-panel {",
      "grid-template-rows: auto minmax(0, 1fr);",
      "overflow: hidden;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-queue-head {",
      "position: sticky;",
      "top: 0;",
      "background: transparent;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-queue-list {",
      "overflow-y: auto;",
      "overscroll-behavior: contain;",
      "scrollbar-gutter: stable;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-surface {",
      "min-height: 132px;",
      "grid-template-rows: auto minmax(76px, 1fr);",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-surface-front {",
      "min-height: auto;",
      "grid-template-rows: auto auto;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-surface-front .review-card-body {",
      "min-height: 0;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-card-body {",
      "min-height: 76px;",
    )).toBe(true);
    expect(reviewStylesContain(
      ".review-actions-dock {",
      "position: sticky;",
      "background: transparent;",
      "border: none;",
      "box-shadow: none;",
    )).toBe(true);
    expect(reviewStylesContain(
      "@media (max-width: 1024px) {",
      "max-height: none;",
      "overflow: visible;",
      "grid-template-columns: 1fr;",
      "scroll-padding-bottom: 0;",
      "position: static;",
      "scrollbar-gutter: auto;",
    )).toBe(true);
  });

  it("shows all empty-state review actions for non-All-cards filters", async () => {
    const state = reviewScreen.getState();
    state.decks = [createDeck()];
    state.appData.selectedReviewFilter = { kind: "deck", deckId: "deck-1" };

    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    const links = Array.from(container.querySelectorAll(".review-empty-actions a"));
    const switchButton = Array.from(container.querySelectorAll(".review-empty-actions button"))
      .find((element) => element.textContent?.trim() === "switch to all cards deck");

    expect(container.textContent).toContain("No Cards Yet");
    expect(container.textContent).toContain("Create card");
    expect(container.textContent).toContain("Create with AI");
    expect(container.textContent).toContain("switch to all cards deck");
    expect(links.map((element) => element.getAttribute("href"))).toEqual([`${cardsRoute}/new`, chatRoute]);
    expect(switchButton).not.toBeUndefined();

    await act(async () => {
      clickElement(switchButton as HTMLButtonElement);
    });

    expect(state.appData.selectReviewFilter).toHaveBeenCalledWith({ kind: "allCards" });
  });

  it("shows only creation empty-state review actions for All cards", async () => {
    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    expect(container.textContent).toContain("No Cards Yet");
    expect(container.textContent).toContain("Create card");
    expect(container.textContent).toContain("Create with AI");
    expect(container.textContent).not.toContain("switch to all cards deck");
  });

  it("renders short plain front text in centered short mode", async () => {
    const state = reviewScreen.getState();
    state.cards = [createCard({ frontText: "Hola" })];
    state.reviewQueue = state.cards;
    state.reviewTimeline = state.cards;

    await reviewScreen.renderReviewScreen();

    const front = reviewScreen.getContainer().querySelector(".review-front");

    expect(front?.getAttribute("data-presentation-mode")).toBe("shortPlain");
    expect(front?.textContent).toContain("Hola");
  });

  it("keeps four-word one-line text in centered short mode", async () => {
    const state = reviewScreen.getState();
    state.cards = [createCard({ frontText: "one two three four" })];
    state.reviewQueue = state.cards;
    state.reviewTimeline = state.cards;

    await reviewScreen.renderReviewScreen();

    expect(reviewScreen.getContainer().querySelector(".review-front")?.getAttribute("data-presentation-mode")).toBe("shortPlain");
  });

  it("switches five-word text and multi-line text to paragraph mode", async () => {
    const state = reviewScreen.getState();
    const paragraphCard = createCard({
      frontText: "one two three four five",
      backText: "First line\nSecond line",
    });
    state.cards = [paragraphCard];
    state.reviewQueue = [paragraphCard];
    state.reviewTimeline = [paragraphCard];

    await reviewScreen.renderReviewScreen();
    await reviewScreen.revealAnswer();

    const container = reviewScreen.getContainer();
    const front = container.querySelector(".review-front");
    const back = container.querySelector(".review-back");

    expect(front?.getAttribute("data-presentation-mode")).toBe("paragraphPlain");
    expect(back?.getAttribute("data-presentation-mode")).toBe("paragraphPlain");
    expect(reviewStylesContain(
      ".review-card-content-shortPlain,",
      ".review-card-content-paragraphPlain",
      "white-space: pre-wrap",
    )).toBe(true);
  });

  it("renders markdown content with semantic elements instead of centered mode", async () => {
    const state = reviewScreen.getState();
    const markdownCard = createCard({
      frontText: "# Heading\n\n- item\n- item two",
      backText: "```ts\nconst answer = 42;\n```",
    });
    state.cards = [markdownCard];
    state.reviewQueue = [markdownCard];
    state.reviewTimeline = [markdownCard];

    await reviewScreen.renderReviewScreen();
    await reviewScreen.revealAnswer();

    const container = reviewScreen.getContainer();
    const front = container.querySelector(".review-front");
    const back = container.querySelector(".review-back");

    expect(front?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(reviewStylesContain(".review-card-content-markdown", "white-space: normal")).toBe(true);
    expect(container.querySelector(".review-front h1")?.textContent).toBe("Heading");
    expect(container.querySelectorAll(".review-front ul li")).toHaveLength(2);
    expect(back?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(container.querySelector(".review-back pre code")?.textContent).toContain("const answer = 42;");
  });

  it("renders symbol-only markdown list items as literal bullets without nested empty lists", async () => {
    const state = reviewScreen.getState();
    const markdownCard = createCard({
      frontText: "Front",
      backText: [
        "Base64 alphabet:",
        "",
        "- A-Z",
        "",
        "- a-z",
        "",
        "- 0-9",
        "",
        "- +",
        "",
        "- /",
        "",
        "Characters that are in Base64 but not in Base32:",
        "",
        "- a-z",
        "",
        "- 0, 1, 8, 9",
        "",
        "- +",
        "",
        "- /",
      ].join("\n"),
    });
    state.cards = [markdownCard];
    state.reviewQueue = [markdownCard];
    state.reviewTimeline = [markdownCard];

    await reviewScreen.renderReviewScreen();
    await reviewScreen.revealAnswer();

    const back = reviewScreen.getContainer().querySelector(".review-back");
    const backLists = Array.from(back?.querySelectorAll(".review-markdown-ul") ?? []);
    const topLevelLists = backLists.filter((list) => list.parentElement?.classList.contains("review-card-content-markdown"));
    const plusItems = Array.from(back?.querySelectorAll(".review-markdown-li") ?? [])
      .filter((item) => item.textContent?.trim() === "+");
    const emptyNestedLists = Array.from(back?.querySelectorAll(".review-markdown-li > .review-markdown-ul") ?? [])
      .filter((list) => list.textContent?.trim() === "");

    expect(back?.getAttribute("data-presentation-mode")).toBe("markdown");
    expect(reviewStylesContain(".review-card-content-markdown", "white-space: normal")).toBe(true);
    expect(topLevelLists).toHaveLength(2);
    expect(Array.from(topLevelLists[0]?.children ?? [])).toHaveLength(5);
    expect(Array.from(topLevelLists[1]?.children ?? [])).toHaveLength(4);
    expect(plusItems).toHaveLength(2);
    expect(emptyNestedLists).toHaveLength(0);
  });

  it("renders the empty back placeholder through the adaptive content view", async () => {
    const state = reviewScreen.getState();
    const emptyBackCard = createCard({
      frontText: "Front",
      backText: "",
    });
    state.cards = [emptyBackCard];
    state.reviewQueue = [emptyBackCard];
    state.reviewTimeline = [emptyBackCard];

    await reviewScreen.renderReviewScreen();
    await reviewScreen.revealAnswer();

    const back = reviewScreen.getContainer().querySelector(".review-back");

    expect(back?.textContent).toContain("No back text");
    expect(back?.getAttribute("data-presentation-mode")).toBe("shortPlain");
  });
});
