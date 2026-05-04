// @vitest-environment jsdom
import { act, useEffect, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Card, ReviewQueueSnapshot } from "../../types";
import { I18nProvider } from "../../i18n";
import {
  clickElementAsync,
  createCard,
  createDecks,
  loadReviewQueueChunkMock,
  loadReviewQueueSnapshotMock,
  setTextFieldValueAsync,
  setupReviewScreenTest,
  type ReviewScreenTestState,
} from "./ReviewScreenTestSupport";
import {
  useReviewScreenData,
  type ReviewSubmissionOutcome,
  type UseReviewScreenDataResult,
} from "./useReviewScreenData";

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  openReviewFilterMenu,
  renderReviewScreen,
  rerenderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

type DeferredPromise<Value> = Readonly<{
  promise: Promise<Value>;
  reject: (error: Error) => void;
  resolve: (value: Value) => void;
}>;

type ReviewQueueChunkResult = Readonly<{
  cards: ReadonlyArray<Card>;
  nextCursor: string | null;
}>;

function createDeferredPromise<Value>(): DeferredPromise<Value> {
  let rejectPromise: ((error: Error) => void) | null = null;
  let resolvePromise: ((value: Value) => void) | null = null;
  const promise = new Promise<Value>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  if (rejectPromise === null || resolvePromise === null) {
    throw new Error("Deferred promise callbacks were not initialized");
  }

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

type ReviewScreenDataHarnessProps = Readonly<{
  onResult: (result: UseReviewScreenDataResult) => void;
  state: ReviewScreenTestState;
}>;

function ReviewScreenDataHarness(props: ReviewScreenDataHarnessProps): ReactElement {
  const {
    onResult,
    state,
  } = props;
  const result = useReviewScreenData({
    activeWorkspaceId: state.appData.activeWorkspace?.workspaceId ?? null,
    getCardById: state.appData.getCardById,
    localReadVersion: state.appData.localReadVersion,
    selectedReviewFilter: state.appData.selectedReviewFilter,
    setErrorMessage: state.appData.setErrorMessage,
    submitReviewItem: state.appData.submitReviewItem,
  });

  useEffect(() => {
    onResult(result);
  }, [onResult, result]);

  return <div data-testid="review-screen-data-harness" />;
}

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
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => card);

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
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => card);
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

  it("optimistically advances during submit and restores a fresh due card after a same-context submit failure", async () => {
    const state = getState();
    const submittedCard = createCard({
      cardId: "card-pending-submit",
      frontText: "Pending original front",
      backText: "Pending original back",
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const refreshedSubmittedCard = {
      ...submittedCard,
      frontText: "Pending refreshed front",
      backText: "Pending refreshed back",
    };
    const nextCard = createCard({
      cardId: "card-pending-next",
      frontText: "Pending next front",
      backText: "Pending next back",
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const submitReviewPromise = createDeferredPromise<Card>();
    state.cards = [submittedCard, nextCard];
    state.reviewQueue = [submittedCard, nextCard];
    state.reviewTimeline = [submittedCard, nextCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === submittedCard.cardId) {
        return refreshedSubmittedCard;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);

    await renderReviewScreen();
    await revealAnswer();
    await dispatchDocumentKeydown("3");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-pending-submit", 2);
    expect(getContainer().textContent).toContain("Pending next front");
    expect(getContainer().textContent).not.toContain("Pending original frontPending original back");

    state.cards = [refreshedSubmittedCard, nextCard];
    state.reviewQueue = [refreshedSubmittedCard, nextCard];
    state.reviewTimeline = [refreshedSubmittedCard, nextCard];
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();

    expect(getContainer().textContent).toContain("Pending next front");
    expect(getContainer().textContent).not.toContain("Pending refreshed front");

    await act(async () => {
      submitReviewPromise.reject(new Error("Review submit failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.appData.setErrorMessage).toHaveBeenCalledWith("Review submit failed");
    expect(getContainer().textContent).toContain("Pending refreshed front");
    expect(getContainer().textContent).not.toContain("Pending original front");
  });

  it("reports the original submit failure when rollback lookup fails", async () => {
    const state = getState();
    const submittedCard = createCard({
      cardId: "card-rollback-lookup-submit",
      frontText: "Rollback lookup submitted front",
      backText: "Rollback lookup submitted back",
      dueAt: "2026-03-10T11:00:00.000Z",
    });
    const nextCard = createCard({
      cardId: "card-rollback-lookup-next",
      frontText: "Rollback lookup next front",
      backText: "Rollback lookup next back",
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const submitReviewPromise = createDeferredPromise<Card>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [submittedCard, nextCard];
    state.reviewQueue = [submittedCard, nextCard];
    state.reviewTimeline = [submittedCard, nextCard];
    state.appData.getCardById.mockImplementation(async (): Promise<Card> => {
      throw new Error("Rollback lookup read failed");
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const card = latestResult?.activeReviewQueue[0];
      if (card === undefined) {
        throw new Error("Review data harness did not load the rollback lookup submitted card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(card, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue[0]?.cardId).toBe(nextCard.cardId);

      await act(async () => {
        submitReviewPromise.reject(new Error("Review submit failed"));
        const didReview = await reviewPromise;
        if (didReview !== "failed") {
          throw new Error("Review data harness submit failure did not return failed");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(state.appData.getCardById).toHaveBeenCalledWith(submittedCard.cardId);
      expect(state.appData.setErrorMessage).toHaveBeenCalledWith("Review submit failed\nRollback lookup failed: Rollback lookup read failed");
      expect(latestResult?.activeReviewQueue[0]?.cardId).toBe(nextCard.cardId);
      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).not.toContain(submittedCard.cardId);
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("does not mutate queue, presented card, or timeline after a stale workspace submit failure", async () => {
    const state = getState();
    state.appData.selectedReviewFilter = {
      kind: "tag",
      tag: "grammar",
    };
    const submittedCard = createCard({
      cardId: "card-stale-failure-submit",
      frontText: "Stale failure submitted front",
      backText: "Stale failure submitted back",
      tags: ["grammar"],
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const oldNextCard = createCard({
      cardId: "card-stale-failure-old-presented",
      frontText: "Stale failure old presented front",
      backText: "Stale failure old presented back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const newPresentedCard = createCard({
      cardId: "card-stale-failure-new-presented",
      frontText: "Stale failure new presented front",
      backText: "Stale failure new presented back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:45:00.000Z",
    });
    const newCanonicalHead = createCard({
      cardId: "card-stale-failure-new-head",
      frontText: "Stale failure new head front",
      backText: "Stale failure new head back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:50:00.000Z",
    });
    const newCanonicalNext = createCard({
      cardId: "card-stale-failure-new-next",
      frontText: "Stale failure new next front",
      backText: "Stale failure new next back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:55:00.000Z",
    });
    const newTimelineTail = createCard({
      cardId: "card-stale-failure-new-tail",
      frontText: "Stale failure new tail front",
      backText: "Stale failure new tail back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:59:00.000Z",
    });
    const submitReviewPromise = createDeferredPromise<Card>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [submittedCard, oldNextCard];
    state.reviewQueue = [submittedCard, oldNextCard];
    state.reviewTimeline = [submittedCard, oldNextCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === oldNextCard.cardId) {
        return newPresentedCard;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const submittedReviewCard = latestResult?.activeReviewQueue[0];
      if (submittedReviewCard === undefined) {
        throw new Error("Review data harness did not load the stale failure submitted card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(submittedReviewCard, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      state.appData.activeWorkspace = {
        workspaceId: "workspace-2",
        name: "Secondary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      };
      state.cards = [newPresentedCard, newCanonicalHead, newCanonicalNext, newTimelineTail];
      state.reviewQueue = [newCanonicalHead, newCanonicalNext];
      state.reviewTimeline = [newCanonicalHead, newCanonicalNext, newTimelineTail];
      state.appData.localReadVersion = 1;

      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const expectedActiveQueueCardIds = [
        newPresentedCard.cardId,
        newCanonicalHead.cardId,
        newCanonicalNext.cardId,
      ];
      const expectedTimelineCardIds = [
        newPresentedCard.cardId,
        newCanonicalHead.cardId,
        newCanonicalNext.cardId,
        newTimelineTail.cardId,
      ];

      expect(state.appData.getCardById).toHaveBeenCalledWith(oldNextCard.cardId);
      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual(expectedActiveQueueCardIds);
      expect(latestResult?.queueCards.map((queueCard) => queueCard.cardId)).toEqual(expectedTimelineCardIds);

      await act(async () => {
        submitReviewPromise.reject(new Error("Review submit failed"));
        const didReview = await reviewPromise;
        if (didReview !== "stale") {
          throw new Error("Review data harness stale submit failure did not return stale");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(state.appData.setErrorMessage).not.toHaveBeenCalledWith("Review submit failed");
      expect(state.appData.getCardById).not.toHaveBeenCalledWith(submittedCard.cardId);
      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual(expectedActiveQueueCardIds);
      expect(latestResult?.queueCards.map((queueCard) => queueCard.cardId)).toEqual(expectedTimelineCardIds);
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("does not rollback into a synchronously changed selected filter while the new review snapshot is loading", async () => {
    const state = getState();
    state.appData.selectedReviewFilter = {
      kind: "tag",
      tag: "grammar",
    };
    const submittedCard = createCard({
      cardId: "card-stale-selected-filter-submit",
      frontText: "Stale selected filter submitted front",
      backText: "Stale selected filter submitted back",
      tags: ["grammar"],
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const oldNextCard = createCard({
      cardId: "card-stale-selected-filter-old-next",
      frontText: "Stale selected filter old next front",
      backText: "Stale selected filter old next back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const newFilterHead = createCard({
      cardId: "card-stale-selected-filter-new-head",
      frontText: "Stale selected filter new head front",
      backText: "Stale selected filter new head back",
      tags: ["code"],
      dueAt: "2026-03-10T11:45:00.000Z",
    });
    const newFilterNext = createCard({
      cardId: "card-stale-selected-filter-new-next",
      frontText: "Stale selected filter new next front",
      backText: "Stale selected filter new next back",
      tags: ["code"],
      dueAt: "2026-03-10T11:50:00.000Z",
    });
    const submitReviewPromise = createDeferredPromise<Card>();
    const nextSnapshotPromise = createDeferredPromise<ReviewQueueSnapshot>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [submittedCard, oldNextCard];
    state.reviewQueue = [submittedCard, oldNextCard];
    state.reviewTimeline = [submittedCard, oldNextCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === submittedCard.cardId) {
        return submittedCard;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const submittedReviewCard = latestResult?.activeReviewQueue[0];
      if (submittedReviewCard === undefined) {
        throw new Error("Review data harness did not load the stale selected-filter submitted card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(submittedReviewCard, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual([oldNextCard.cardId]);

      loadReviewQueueSnapshotMock.mockImplementation(async (): Promise<ReviewQueueSnapshot> => nextSnapshotPromise.promise);
      state.appData.selectedReviewFilter = {
        kind: "tag",
        tag: "code",
      };
      state.cards = [newFilterHead, newFilterNext];
      state.reviewQueue = [newFilterHead, newFilterNext];
      state.reviewTimeline = [newFilterHead, newFilterNext];
      state.appData.localReadVersion = 1;

      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        submitReviewPromise.reject(new Error("Review submit failed"));
        const didReview = await reviewPromise;
        if (didReview !== "stale") {
          throw new Error("Review data harness stale selected-filter submit failure did not return stale");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(state.appData.setErrorMessage).not.toHaveBeenCalledWith("Review submit failed");
      expect(state.appData.getCardById).not.toHaveBeenCalledWith(submittedCard.cardId);
      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual([oldNextCard.cardId]);

      await act(async () => {
        nextSnapshotPromise.resolve({
          resolvedReviewFilter: state.appData.selectedReviewFilter,
          cards: [newFilterHead, newFilterNext],
          nextCursor: null,
          reviewCounts: {
            dueCount: 2,
            totalCount: 2,
          },
        });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual([
        newFilterHead.cardId,
        newFilterNext.cardId,
      ]);
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("does not rollback or report after a same-filter session refresh before a late submit failure", async () => {
    const state = getState();
    const submittedCard = createCard({
      cardId: "card-stale-session-failure-submit",
      frontText: "Stale session failure submitted front",
      backText: "Stale session failure submitted back",
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const oldNextCard = createCard({
      cardId: "card-stale-session-failure-old-next",
      frontText: "Stale session failure old next front",
      backText: "Stale session failure old next back",
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const newHeadCard = createCard({
      cardId: "card-stale-session-failure-new-head",
      frontText: "Stale session failure new head front",
      backText: "Stale session failure new head back",
      dueAt: "2026-03-10T11:45:00.000Z",
    });
    const newNextCard = createCard({
      cardId: "card-stale-session-failure-new-next",
      frontText: "Stale session failure new next front",
      backText: "Stale session failure new next back",
      dueAt: "2026-03-10T11:50:00.000Z",
    });
    const newTimelineTail = createCard({
      cardId: "card-stale-session-failure-new-tail",
      frontText: "Stale session failure new tail front",
      backText: "Stale session failure new tail back",
      dueAt: "2026-03-10T11:55:00.000Z",
    });
    const submitReviewPromise = createDeferredPromise<Card>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [submittedCard, oldNextCard];
    state.reviewQueue = [submittedCard, oldNextCard];
    state.reviewTimeline = [submittedCard, oldNextCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      throw new Error(`Card not found: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const submittedReviewCard = latestResult?.activeReviewQueue[0];
      if (submittedReviewCard === undefined) {
        throw new Error("Review data harness did not load the stale session failure submitted card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(submittedReviewCard, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      state.cards = [newHeadCard, newNextCard, newTimelineTail];
      state.reviewQueue = [newHeadCard, newNextCard];
      state.reviewTimeline = [newHeadCard, newNextCard, newTimelineTail];
      state.appData.localReadVersion = 1;

      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual([
        newHeadCard.cardId,
        newNextCard.cardId,
      ]);
      expect(latestResult?.queueCards.map((queueCard) => queueCard.cardId)).toEqual([
        newHeadCard.cardId,
        newNextCard.cardId,
        newTimelineTail.cardId,
      ]);

      await act(async () => {
        submitReviewPromise.reject(new Error("Review submit failed"));
        const didReview = await reviewPromise;
        if (didReview !== "stale") {
          throw new Error("Review data harness stale same-filter submit failure did not return stale");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(state.appData.setErrorMessage).not.toHaveBeenCalledWith("Review submit failed");
      expect(state.appData.getCardById).not.toHaveBeenCalledWith(submittedCard.cardId);
      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual([
        newHeadCard.cardId,
        newNextCard.cardId,
      ]);
      expect(latestResult?.queueCards.map((queueCard) => queueCard.cardId)).toEqual([
        newHeadCard.cardId,
        newNextCard.cardId,
        newTimelineTail.cardId,
      ]);
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("keeps the canonical head after a same-context submit failure when the fresh card no longer matches the filter", async () => {
    const state = getState();
    state.appData.selectedReviewFilter = {
      kind: "tag",
      tag: "grammar",
    };
    const submittedCard = createCard({
      cardId: "card-filter-mismatch-submit",
      frontText: "Filter mismatch submitted original front",
      backText: "Filter mismatch submitted original back",
      tags: ["grammar"],
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const freshSubmittedCard = {
      ...submittedCard,
      frontText: "Filter mismatch submitted fresh front",
      backText: "Filter mismatch submitted fresh back",
      tags: ["code"],
    };
    const nextCard = createCard({
      cardId: "card-filter-mismatch-next",
      frontText: "Filter mismatch next front",
      backText: "Filter mismatch next back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const submitReviewPromise = createDeferredPromise<Card>();
    state.cards = [submittedCard, nextCard];
    state.reviewQueue = [submittedCard, nextCard];
    state.reviewTimeline = [submittedCard, nextCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === submittedCard.cardId) {
        return freshSubmittedCard;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);

    await renderReviewScreen();
    await revealAnswer();
    await dispatchDocumentKeydown("3");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-filter-mismatch-submit", 2);
    expect(getContainer().textContent).toContain("Filter mismatch next front");

    await act(async () => {
      submitReviewPromise.reject(new Error("Review submit failed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(state.appData.setErrorMessage).toHaveBeenCalledWith("Review submit failed");
    expect(getContainer().textContent).toContain("Filter mismatch next front");
    expect(getContainer().textContent).not.toContain("Filter mismatch submitted original front");
    expect(getContainer().textContent).not.toContain("Filter mismatch submitted fresh front");
  });

  it("keeps a submitted omitted card out when a refresh resumes after preserving lookup", async () => {
    const state = getState();
    const currentCard = createCard({
      cardId: "card-race-current",
      frontText: "Race current original front",
      backText: "Race current original back",
      dueAt: "2026-03-09T12:00:00.000Z",
    });
    const refreshedCurrentCard = {
      ...currentCard,
      frontText: "Race current refreshed front",
      backText: "Race current refreshed back",
    };
    const nextCard = createCard({
      cardId: "card-race-next",
      frontText: "Race next front",
      backText: "Race next back",
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const getCardByIdPromise = createDeferredPromise<Card>();
    const submitReviewPromise = createDeferredPromise<Card>();
    state.cards = [currentCard, nextCard];
    state.reviewQueue = [currentCard, nextCard];
    state.reviewTimeline = [currentCard, nextCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      if (cardId === currentCard.cardId) {
        return getCardByIdPromise.promise;
      }

      throw new Error(`Unexpected card lookup: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);

    await renderReviewScreen();

    state.cards = [refreshedCurrentCard, nextCard];
    state.reviewQueue = [nextCard];
    state.reviewTimeline = [nextCard, refreshedCurrentCard];
    state.appData.localReadVersion = 1;

    await rerenderReviewScreen();
    await revealAnswer();
    await dispatchDocumentKeydown("3");

    expect(state.appData.submitReviewItem).toHaveBeenCalledWith("card-race-current", 2);
    expect(getContainer().textContent).toContain("Race next front");
    expect(getContainer().textContent).not.toContain("Race current refreshed front");

    await act(async () => {
      getCardByIdPromise.resolve(refreshedCurrentCard);
      await Promise.resolve();
      await Promise.resolve();
    });

    const queueTitlesAfterRefresh = [...getContainer().querySelectorAll(".review-queue-card-title")].map((element) => element.textContent);
    expect(getContainer().textContent).toContain("Race next front");
    expect(getContainer().textContent).not.toContain("Race current original front");
    expect(getContainer().textContent).not.toContain("Race current refreshed front");
    expect(queueTitlesAfterRefresh).toEqual(["Race next front"]);

    await act(async () => {
      submitReviewPromise.resolve(refreshedCurrentCard);
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("optimistically decrements due count without decrementing total count", async () => {
    const state = getState();
    const currentCard = createCard({
      cardId: "card-count-current",
      frontText: "Count current front",
      backText: "Count current back",
      dueAt: "2026-03-10T11:00:00.000Z",
    });
    const nextCard = createCard({
      cardId: "card-count-next",
      frontText: "Count next front",
      backText: "Count next back",
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    let latestResult: UseReviewScreenDataResult | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [currentCard, nextCard];
    state.reviewQueue = [currentCard, nextCard];
    state.reviewTimeline = [currentCard, nextCard];
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => currentCard);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.reviewCounts).toEqual({
        dueCount: 2,
        totalCount: 2,
      });

      const card = latestResult?.activeReviewQueue[0];
      if (card === undefined) {
        throw new Error("Review data harness did not load the current card");
      }

      await act(async () => {
        const didReview = await latestResult?.handleReview(card, 2);
        if (didReview !== "saved") {
          throw new Error("Review data harness submit did not succeed");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.reviewCounts).toEqual({
        dueCount: 1,
        totalCount: 2,
      });
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("does not mutate a same-filter refreshed session after a stale successful submit response", async () => {
    const state = getState();
    const submittedCard = createCard({
      cardId: "card-stale-success-submit",
      frontText: "Stale success submitted front",
      backText: "Stale success submitted back",
      dueAt: "2026-03-10T11:00:00.000Z",
    });
    const oldNextCard = createCard({
      cardId: "card-stale-success-old-next",
      frontText: "Stale success old next front",
      backText: "Stale success old next back",
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    const newContextHead = createCard({
      cardId: "card-stale-success-new-head",
      frontText: "Stale success new head front",
      backText: "Stale success new head back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:45:00.000Z",
    });
    const newContextNext = createCard({
      cardId: "card-stale-success-new-next",
      frontText: "Stale success new next front",
      backText: "Stale success new next back",
      tags: ["grammar"],
      dueAt: "2026-03-10T11:50:00.000Z",
    });
    const submitReviewPromise = createDeferredPromise<Card>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [submittedCard, oldNextCard];
    state.reviewQueue = [submittedCard, oldNextCard];
    state.reviewTimeline = [submittedCard, oldNextCard];
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      throw new Error(`Card not found: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (): Promise<Card> => submitReviewPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const card = latestResult?.activeReviewQueue[0];
      if (card === undefined) {
        throw new Error("Review data harness did not load the stale success submitted card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(card, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      state.cards = [newContextHead, newContextNext];
      state.reviewQueue = [newContextHead, newContextNext];
      state.reviewTimeline = [newContextHead, newContextNext];
      state.appData.localReadVersion = 1;

      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual([
        newContextHead.cardId,
        newContextNext.cardId,
      ]);
      expect(latestResult?.reviewCounts).toEqual({
        dueCount: 2,
        totalCount: 2,
      });

      await act(async () => {
        submitReviewPromise.resolve(submittedCard);
        const didReview = await reviewPromise;
        if (didReview !== "stale") {
          throw new Error("Review data harness stale submit did not return stale");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((queueCard) => queueCard.cardId)).toEqual([
        newContextHead.cardId,
        newContextNext.cardId,
      ]);
      expect(latestResult?.reviewCounts).toEqual({
        dueCount: 2,
        totalCount: 2,
      });
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("excludes canonical, presented, and pending card ids when replenishing after optimistic submit", async () => {
    const state = getState();
    const cards = Array.from({ length: 5 }, (_, index) => createCard({
      cardId: `card-chunk-${index + 1}`,
      frontText: `Chunk card ${index + 1} front`,
      backText: `Chunk card ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));
    const chunkCard = createCard({
      cardId: "card-chunk-loaded",
      frontText: "Chunk loaded front",
      backText: "Chunk loaded back",
      dueAt: "2026-03-10T11:30:00.000Z",
    });
    state.cards = [...cards, chunkCard];
    state.reviewQueue = cards;
    state.reviewTimeline = [...cards, chunkCard];
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      const submittedCard = cards.find((candidateCard) => candidateCard.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted card id: ${cardId}`);
      }

      return submittedCard;
    });
    loadReviewQueueSnapshotMock.mockImplementation(async () => ({
      resolvedReviewFilter: state.appData.selectedReviewFilter,
      cards: state.reviewQueue,
      nextCursor: "cursor-after-initial-window",
      reviewCounts: {
        dueCount: state.reviewQueue.length,
        totalCount: state.reviewQueue.length,
      },
    }));
    loadReviewQueueChunkMock.mockResolvedValue({
      cards: [chunkCard],
      nextCursor: null,
    });

    await renderReviewScreen();
    await revealAnswer();
    await dispatchDocumentKeydown("3");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const chunkCall = loadReviewQueueChunkMock.mock.calls[0];
    if (chunkCall === undefined) {
      throw new Error("Review queue chunk was not requested");
    }
    const excludedCardIds = chunkCall[4];
    if (!(excludedCardIds instanceof Set)) {
      throw new Error("Review queue chunk exclusions were not a Set");
    }

    expect(chunkCall[0]).toBe("workspace-1");
    expect(chunkCall[2]).toBe("cursor-after-initial-window");
    expect(chunkCall[3]).toBe(4);
    expect([...excludedCardIds].sort()).toEqual(cards.map((card) => card.cardId).sort());
  });

  it("reports current-context chunk failures after a successful submit", async () => {
    const state = getState();
    const cards = Array.from({ length: 5 }, (_, index) => createCard({
      cardId: `card-current-chunk-failure-${index + 1}`,
      frontText: `Current chunk failure ${index + 1} front`,
      backText: `Current chunk failure ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));
    const loadChunkPromise = createDeferredPromise<ReviewQueueChunkResult>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = cards;
    state.reviewQueue = cards;
    state.reviewTimeline = cards;
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      const submittedCard = cards.find((candidateCard) => candidateCard.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted card id: ${cardId}`);
      }

      return submittedCard;
    });
    loadReviewQueueSnapshotMock.mockImplementation(async (): Promise<ReviewQueueSnapshot> => ({
      resolvedReviewFilter: state.appData.selectedReviewFilter,
      cards: state.reviewQueue,
      nextCursor: "cursor-after-initial-window",
      reviewCounts: {
        dueCount: state.reviewQueue.length,
        totalCount: state.reviewQueue.length,
      },
    }));
    loadReviewQueueChunkMock.mockImplementation(async (): Promise<ReviewQueueChunkResult> => loadChunkPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const submittedCard = latestResult?.activeReviewQueue[0];
      if (submittedCard === undefined) {
        throw new Error("Review data harness did not load the current chunk failure card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(submittedCard, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(loadReviewQueueChunkMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        loadChunkPromise.reject(new Error("Chunk load failed"));
        const didReview = await reviewPromise;
        if (didReview !== "saved") {
          throw new Error("Review data harness current chunk failure submit did not succeed");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(state.appData.setErrorMessage).toHaveBeenCalledWith("Failed to load more cards after submit: Chunk load failed");
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("does not report stale chunk failures after the workspace changes", async () => {
    const state = getState();
    const oldCards = Array.from({ length: 5 }, (_, index) => createCard({
      cardId: `card-stale-chunk-old-${index + 1}`,
      frontText: `Stale chunk old ${index + 1} front`,
      backText: `Stale chunk old ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));
    const newCards = [
      createCard({
        cardId: "card-stale-chunk-new-1",
        frontText: "Stale chunk new 1 front",
        backText: "Stale chunk new 1 back",
        dueAt: "2026-03-10T11:30:00.000Z",
      }),
      createCard({
        cardId: "card-stale-chunk-new-2",
        frontText: "Stale chunk new 2 front",
        backText: "Stale chunk new 2 back",
        dueAt: "2026-03-10T11:31:00.000Z",
      }),
    ];
    const loadChunkPromise = createDeferredPromise<ReviewQueueChunkResult>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = oldCards;
    state.reviewQueue = oldCards;
    state.reviewTimeline = oldCards;
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      throw new Error(`Card not found: ${cardId}`);
    });
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      const submittedCard = oldCards.find((candidateCard) => candidateCard.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted card id: ${cardId}`);
      }

      return submittedCard;
    });
    loadReviewQueueSnapshotMock.mockImplementation(async (): Promise<ReviewQueueSnapshot> => ({
      resolvedReviewFilter: state.appData.selectedReviewFilter,
      cards: state.reviewQueue,
      nextCursor: "cursor-after-initial-window",
      reviewCounts: {
        dueCount: state.reviewQueue.length,
        totalCount: state.reviewQueue.length,
      },
    }));
    loadReviewQueueChunkMock.mockImplementation(async (): Promise<ReviewQueueChunkResult> => loadChunkPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const submittedCard = latestResult?.activeReviewQueue[0];
      if (submittedCard === undefined) {
        throw new Error("Review data harness did not load the stale chunk submitted card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(submittedCard, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(loadReviewQueueChunkMock).toHaveBeenCalledTimes(1);

      state.appData.activeWorkspace = {
        workspaceId: "workspace-2",
        name: "Secondary",
        createdAt: "2026-03-10T00:00:00.000Z",
        isSelected: true,
      };
      state.cards = newCards;
      state.reviewQueue = newCards;
      state.reviewTimeline = newCards;
      state.appData.localReadVersion = 1;

      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((card) => card.cardId)).toEqual(newCards.map((card) => card.cardId));

      await act(async () => {
        loadChunkPromise.reject(new Error("Chunk load failed"));
        const didReview = await reviewPromise;
        if (didReview !== "stale") {
          throw new Error("Review data harness stale chunk failure submit did not return stale");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(state.appData.setErrorMessage).not.toHaveBeenCalledWith("Failed to load more cards after submit: Chunk load failed");
      expect(latestResult?.activeReviewQueue.map((card) => card.cardId)).toEqual(newCards.map((card) => card.cardId));
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("caps a chunk response after a concurrent queue refresh fills the canonical queue", async () => {
    const state = getState();
    const initialCards = Array.from({ length: 5 }, (_, index) => createCard({
      cardId: `card-concurrent-initial-${index + 1}`,
      frontText: `Concurrent initial ${index + 1} front`,
      backText: `Concurrent initial ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));
    const refreshCards = Array.from({ length: 4 }, (_, index) => createCard({
      cardId: `card-concurrent-refresh-${index + 1}`,
      frontText: `Concurrent refresh ${index + 1} front`,
      backText: `Concurrent refresh ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 10).padStart(2, "0")}:00.000Z`,
    }));
    const chunkCards = Array.from({ length: 4 }, (_, index) => createCard({
      cardId: `card-concurrent-chunk-${index + 1}`,
      frontText: `Concurrent chunk ${index + 1} front`,
      backText: `Concurrent chunk ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 20).padStart(2, "0")}:00.000Z`,
    }));
    const refreshedQueue = [...initialCards.slice(1), ...refreshCards];
    const loadChunkPromise = createDeferredPromise<ReviewQueueChunkResult>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let reviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [...initialCards, ...refreshCards, ...chunkCards];
    state.reviewQueue = initialCards;
    state.reviewTimeline = [...initialCards, ...refreshCards, ...chunkCards];
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      const submittedCard = initialCards.find((candidateCard) => candidateCard.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted card id: ${cardId}`);
      }

      return submittedCard;
    });
    loadReviewQueueSnapshotMock.mockImplementation(async () => ({
      resolvedReviewFilter: state.appData.selectedReviewFilter,
      cards: state.reviewQueue,
      nextCursor: "cursor-after-initial-window",
      reviewCounts: {
        dueCount: state.reviewQueue.length,
        totalCount: state.reviewQueue.length,
      },
    }));
    loadReviewQueueChunkMock.mockImplementation(async (): Promise<ReviewQueueChunkResult> => loadChunkPromise.promise);
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const submittedCard = latestResult?.activeReviewQueue[0];
      if (submittedCard === undefined) {
        throw new Error("Review data harness did not load the current card");
      }

      await act(async () => {
        reviewPromise = latestResult?.handleReview(submittedCard, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(loadReviewQueueChunkMock).toHaveBeenCalledTimes(1);

      state.reviewQueue = refreshedQueue;
      state.reviewTimeline = [...refreshedQueue, ...chunkCards];
      state.appData.localReadVersion = 1;

      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((card) => card.cardId)).toEqual(refreshedQueue.map((card) => card.cardId));

      await act(async () => {
        loadChunkPromise.resolve({
          cards: chunkCards,
          nextCursor: null,
        });
        const didReview = await reviewPromise;
        if (didReview !== "saved") {
          throw new Error("Review data harness submit did not succeed");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(latestResult?.activeReviewQueue.map((card) => card.cardId)).toEqual(refreshedQueue.map((card) => card.cardId));
      expect(latestResult?.activeReviewQueue).toHaveLength(8);
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
  });

  it("keeps the requested chunk cursor when eligible chunk cards are capacity-truncated", async () => {
    const state = getState();
    const initialCards = Array.from({ length: 5 }, (_, index) => createCard({
      cardId: `card-truncated-cursor-initial-${index + 1}`,
      frontText: `Truncated cursor initial ${index + 1} front`,
      backText: `Truncated cursor initial ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 1).padStart(2, "0")}:00.000Z`,
    }));
    const refreshCards = Array.from({ length: 3 }, (_, index) => createCard({
      cardId: `card-truncated-cursor-refresh-${index + 1}`,
      frontText: `Truncated cursor refresh ${index + 1} front`,
      backText: `Truncated cursor refresh ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 10).padStart(2, "0")}:00.000Z`,
    }));
    const chunkCards = Array.from({ length: 3 }, (_, index) => createCard({
      cardId: `card-truncated-cursor-chunk-${index + 1}`,
      frontText: `Truncated cursor chunk ${index + 1} front`,
      backText: `Truncated cursor chunk ${index + 1} back`,
      dueAt: `2026-03-10T11:${String(index + 20).padStart(2, "0")}:00.000Z`,
    }));
    const refreshedQueue = [...initialCards.slice(1), ...refreshCards];
    const firstChunkPromise = createDeferredPromise<ReviewQueueChunkResult>();
    let latestResult: UseReviewScreenDataResult | null = null;
    let firstReviewPromise: Promise<ReviewSubmissionOutcome> | null = null;
    let snapshotCursor: string | null = "cursor-after-initial-window";
    let chunkRequestCount = 0;
    const hookContainer = document.createElement("div");
    const hookRoot = ReactDOM.createRoot(hookContainer);
    state.cards = [...initialCards, ...refreshCards, ...chunkCards];
    state.reviewQueue = initialCards;
    state.reviewTimeline = [...initialCards, ...refreshCards, ...chunkCards];
    state.appData.submitReviewItem.mockImplementation(async (cardId: string): Promise<Card> => {
      const submittedCard = state.cards.find((candidateCard) => candidateCard.cardId === cardId);
      if (submittedCard === undefined) {
        throw new Error(`Unexpected submitted card id: ${cardId}`);
      }

      return submittedCard;
    });
    loadReviewQueueSnapshotMock.mockImplementation(async () => ({
      resolvedReviewFilter: state.appData.selectedReviewFilter,
      cards: state.reviewQueue,
      nextCursor: snapshotCursor,
      reviewCounts: {
        dueCount: state.reviewQueue.length,
        totalCount: state.reviewQueue.length,
      },
    }));
    loadReviewQueueChunkMock.mockImplementation(async (): Promise<ReviewQueueChunkResult> => {
      chunkRequestCount += 1;
      if (chunkRequestCount === 1) {
        return firstChunkPromise.promise;
      }

      return {
        cards: [],
        nextCursor: null,
      };
    });
    document.body.appendChild(hookContainer);

    try {
      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      const firstSubmittedCard = latestResult?.activeReviewQueue[0];
      if (firstSubmittedCard === undefined) {
        throw new Error("Review data harness did not load the first truncated cursor card");
      }

      await act(async () => {
        firstReviewPromise = latestResult?.handleReview(firstSubmittedCard, 2) ?? null;
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(loadReviewQueueChunkMock).toHaveBeenCalledTimes(1);

      snapshotCursor = "cursor-after-refresh-window";
      state.reviewQueue = refreshedQueue;
      state.reviewTimeline = [...refreshedQueue, ...chunkCards];
      state.appData.localReadVersion = 1;

      await act(async () => {
        hookRoot.render(
          <I18nProvider>
            <ReviewScreenDataHarness
              onResult={(result) => {
                latestResult = result;
              }}
              state={state}
            />
          </I18nProvider>,
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      await act(async () => {
        firstChunkPromise.resolve({
          cards: chunkCards,
          nextCursor: "cursor-after-truncated-chunk",
        });
        const didReview = await firstReviewPromise;
        if (didReview !== "saved") {
          throw new Error("Review data harness first truncated cursor submit did not succeed");
        }
        await Promise.resolve();
        await Promise.resolve();
      });

      const firstChunkCard = chunkCards[0];
      if (firstChunkCard === undefined) {
        throw new Error("Review data harness did not prepare a truncated chunk card");
      }

      expect(latestResult?.activeReviewQueue.map((card) => card.cardId)).toEqual([
        ...refreshedQueue.map((card) => card.cardId),
        firstChunkCard.cardId,
      ]);

      for (let reviewIndex = 0; reviewIndex < 4; reviewIndex += 1) {
        const card = latestResult?.activeReviewQueue[0];
        if (card === undefined) {
          throw new Error("Review data harness did not load a follow-up truncated cursor card");
        }

        await act(async () => {
          const didReview = await latestResult?.handleReview(card, 2);
          if (didReview !== "saved") {
            throw new Error("Review data harness follow-up truncated cursor submit did not succeed");
          }
          await Promise.resolve();
          await Promise.resolve();
        });
      }

      expect(loadReviewQueueChunkMock).toHaveBeenCalledTimes(2);
      expect(loadReviewQueueChunkMock.mock.calls[1]?.[2]).toBe("cursor-after-initial-window");
    } finally {
      await act(async () => {
        hookRoot.unmount();
      });
      hookContainer.remove();
    }
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
