// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it } from "vitest";
import type { DecksListSnapshot, ReviewFilter, ReviewQueueSnapshot, ReviewTimelinePage, WorkspaceTagsSummary } from "../types";
import {
  createCard,
  loadDecksListSnapshotMock,
  loadReviewQueueSnapshotMock,
  loadReviewTimelinePageMock,
  loadWorkspaceTagsSummaryMock,
  setupReviewScreenTest,
} from "./ReviewScreenTestSupport";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
}>;

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  if (resolvePromise === null) {
    throw new Error("Deferred promise resolver was not created");
  }

  return {
    promise,
    resolve: resolvePromise,
  };
}

const reviewFilter: ReviewFilter = { kind: "allCards" };

const refreshCard = createCard({
  frontText: "What is OpenTelemetry?",
  backText: "A set of observability standards and SDKs.",
  tags: ["metrics"],
});

const reviewQueueSnapshot: ReviewQueueSnapshot = {
  resolvedReviewFilter: reviewFilter,
  cards: [refreshCard],
  nextCursor: null,
  reviewCounts: {
    dueCount: 1,
    totalCount: 1,
  },
};

const reviewTimelinePage: ReviewTimelinePage = {
  cards: [refreshCard],
  hasMoreCards: false,
};

const tagsSummary: WorkspaceTagsSummary = {
  tags: [{
    tag: "metrics",
    cardsCount: 1,
  }],
  totalCards: 1,
};

const decksSnapshot: DecksListSnapshot = {
  deckSummaries: [],
  allCardsStats: {
    totalCards: 1,
    dueCards: 1,
    newCards: 1,
    reviewedCards: 0,
  },
};

const reviewScreen = setupReviewScreenTest();

describe("ReviewScreen background refresh", () => {
  it("keeps the current review content visible during a localReadVersion refresh", async () => {
    const state = reviewScreen.getState();
    state.appData.selectedReviewFilter = reviewFilter;

    loadReviewQueueSnapshotMock.mockResolvedValue(reviewQueueSnapshot);
    loadReviewTimelinePageMock.mockResolvedValue(reviewTimelinePage);
    loadWorkspaceTagsSummaryMock.mockResolvedValue(tagsSummary);
    loadDecksListSnapshotMock.mockResolvedValue(decksSnapshot);

    await reviewScreen.renderReviewScreen();

    const container = reviewScreen.getContainer();
    expect(container.textContent).toContain("What is OpenTelemetry?");
    expect(container.textContent).not.toContain("Loading review queue...");

    const deferredReviewQueue = createDeferred<ReviewQueueSnapshot>();
    const deferredReviewTimeline = createDeferred<ReviewTimelinePage>();
    const deferredTags = createDeferred<WorkspaceTagsSummary>();
    const deferredDecks = createDeferred<DecksListSnapshot>();

    loadReviewQueueSnapshotMock.mockReturnValueOnce(deferredReviewQueue.promise);
    loadReviewTimelinePageMock.mockReturnValueOnce(deferredReviewTimeline.promise);
    loadWorkspaceTagsSummaryMock.mockReturnValueOnce(deferredTags.promise);
    loadDecksListSnapshotMock.mockReturnValueOnce(deferredDecks.promise);

    state.appData.localReadVersion = 1;

    await reviewScreen.rerenderReviewScreen();

    expect(container.textContent).toContain("What is OpenTelemetry?");
    expect(container.textContent).not.toContain("Loading review queue...");

    await act(async () => {
      deferredReviewQueue.resolve(reviewQueueSnapshot);
      deferredReviewTimeline.resolve(reviewTimelinePage);
      deferredTags.resolve(tagsSummary);
      deferredDecks.resolve(decksSnapshot);
      await Promise.resolve();
    });
  });
});
