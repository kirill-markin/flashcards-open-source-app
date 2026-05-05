// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Card, ReviewQueueSnapshot } from "../../types";
import { I18nProvider } from "../../i18n";
import {
  createCard,
  createDeferredPromise,
  loadReviewQueueChunkMock,
  loadReviewQueueSnapshotMock,
  ReviewScreenDataHarness,
  setupReviewScreenTest,
  type ReviewQueueChunkResult,
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
  revealAnswer,
} = setupReviewScreenTest();

describe("useReviewScreenData chunk loading", () => {
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
});
