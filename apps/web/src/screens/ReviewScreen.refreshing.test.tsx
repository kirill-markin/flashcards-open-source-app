// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewScreen } from "./ReviewScreen";
import type { Card, DecksListSnapshot, ReviewFilter, ReviewQueueSnapshot, ReviewTimelinePage, WorkspaceTagsSummary } from "../types";

const {
  loadDecksListSnapshotMock,
  loadReviewQueueChunkMock,
  loadReviewQueueSnapshotMock,
  loadReviewTimelinePageMock,
  loadWorkspaceTagsSummaryMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  loadDecksListSnapshotMock: vi.fn(),
  loadReviewQueueChunkMock: vi.fn(),
  loadReviewQueueSnapshotMock: vi.fn(),
  loadReviewTimelinePageMock: vi.fn(),
  loadWorkspaceTagsSummaryMock: vi.fn(),
  useAppDataMock: vi.fn(),
}));

vi.mock("../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("../syncStorage", () => ({
  loadDecksListSnapshot: loadDecksListSnapshotMock,
  loadReviewQueueChunk: loadReviewQueueChunkMock,
  loadReviewQueueSnapshot: loadReviewQueueSnapshotMock,
  loadReviewTimelinePage: loadReviewTimelinePageMock,
  loadWorkspaceTagsSummary: loadWorkspaceTagsSummaryMock,
}));

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

function createCard(overrides?: Partial<Card>): Card {
  return {
    cardId: "card-1",
    frontText: "What is OpenTelemetry?",
    backText: "A set of observability standards and SDKs.",
    tags: ["metrics"],
    effortLevel: "fast",
    dueAt: null,
    createdAt: "2026-03-10T09:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-03-10T09:00:00.000Z",
    lastModifiedByDeviceId: "device-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-03-10T09:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

const reviewFilter: ReviewFilter = { kind: "allCards" };

const reviewQueueSnapshot: ReviewQueueSnapshot = {
  resolvedReviewFilter: reviewFilter,
  cards: [createCard()],
  nextCursor: null,
  reviewCounts: {
    dueCount: 1,
    totalCount: 1,
  },
};

const reviewTimelinePage: ReviewTimelinePage = {
  cards: [createCard()],
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

describe("ReviewScreen background refresh", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let localReadVersion: number;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localReadVersion = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    loadReviewQueueChunkMock.mockReset();
    loadReviewQueueSnapshotMock.mockReset();
    loadReviewTimelinePageMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockReset();
    loadDecksListSnapshotMock.mockReset();
    useAppDataMock.mockReset();

    useAppDataMock.mockImplementation(() => ({
      workspaceSettings: {
        algorithm: "fsrs-6",
        desiredRetention: 0.9,
        learningStepsMinutes: [1, 10],
        relearningStepsMinutes: [10],
        maximumIntervalDays: 36500,
        enableFuzz: true,
        clientUpdatedAt: "2026-03-10T09:00:00.000Z",
        lastModifiedByDeviceId: "device-1",
        lastOperationId: "settings-operation-1",
        updatedAt: "2026-03-10T09:00:00.000Z",
      },
      selectedReviewFilter: reviewFilter,
      localReadVersion,
      localCardCount: 1,
      refreshLocalData: vi.fn(async () => undefined),
      selectReviewFilter: vi.fn(),
      submitReviewItem: vi.fn(async () => createCard()),
      updateCardItem: vi.fn(async () => createCard()),
      deleteCardItem: vi.fn(async () => createCard({ deletedAt: "2026-03-10T10:00:00.000Z" })),
      setErrorMessage: vi.fn(),
    }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the current review content visible during a localReadVersion refresh", async () => {
    loadReviewQueueSnapshotMock.mockResolvedValue(reviewQueueSnapshot);
    loadReviewTimelinePageMock.mockResolvedValue(reviewTimelinePage);
    loadWorkspaceTagsSummaryMock.mockResolvedValue(tagsSummary);
    loadDecksListSnapshotMock.mockResolvedValue(decksSnapshot);

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

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

    localReadVersion = 1;

    await act(async () => {
      root.render(
        <MemoryRouter>
          <ReviewScreen />
        </MemoryRouter>,
      );
    });

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
