// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Card, ReviewQueueSnapshot } from "../../types";
import { I18nProvider } from "../../i18n";
import {
  createCard,
  createDeferredPromise,
  loadReviewQueueSnapshotMock,
  ReviewScreenDataHarness,
  setupReviewScreenTest,
} from "./ReviewScreenTestSupport";
import {
  type ReviewSubmissionOutcome,
  type UseReviewScreenDataResult,
} from "./useReviewScreenData";

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  renderReviewScreen,
  rerenderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

describe("useReviewScreenData submit", () => {
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
});
