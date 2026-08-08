// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../../api";
import { parsePersistedReviewFilter } from "../../../../appData/context/reviewFilterPersistence";
import type { ReviewQueueSnapshot } from "../../../../types";
import {
  buildReviewLoadingCardPreview,
  serializeReviewFilterKey,
  writeReviewLoadingSnapshot,
} from "../../../shared/loadingSnapshots";
import {
  clickElementAsync,
  createCard,
  createDeferredPromise,
  createStorageMock,
  hasHydratedHotStateMock,
  loadReviewQueueSnapshotMock,
  setupReviewScreenTest,
} from "../../testSupport/ReviewScreenTestSupport";
import { flushReviewScreenPromises } from "./ReviewScreenControlTestSupport";

const {
  getContainer,
  getState,
  renderReviewScreen,
} = setupReviewScreenTest();

describe("ReviewScreen loading controls", () => {
  it("keeps a cold empty local workspace in loading state until sync hydrates it", async () => {
    hasHydratedHotStateMock.mockResolvedValue(false);

    await renderReviewScreen();
    await flushReviewScreenPromises();

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    expect(reviewPane.dataset.reviewPaneState).toBe("loading");
    expect(reviewPane.dataset.reviewPaneEmptyReason).toBe("none");
    expect(reviewPane.querySelector(".review-card-answer")).toBeNull();
    const speechButton = reviewPane.querySelector(".review-card-surface-front .review-card-speech-btn");
    if (!(speechButton instanceof HTMLButtonElement)) {
      throw new Error("Review loading front speech button was not found");
    }

    expect(speechButton.disabled).toBe(true);
    expect(getContainer().textContent).not.toContain("No Cards Yet");
  });

  it("keeps a loading snapshot preview on the unrevealed front card surface", async () => {
    const state = getState();
    const snapshotCard = createCard({
      cardId: "card-loading-preview",
      frontText: "Snapshot front prompt",
      backText: "Snapshot back answer",
      tags: ["grammar"],
      dueAt: "2026-03-10T12:30:00.000Z",
    });
    state.cards = [snapshotCard];
    state.reviewQueue = [snapshotCard];
    state.reviewTimeline = [snapshotCard];
    writeReviewLoadingSnapshot({
      version: 1,
      workspaceId: "workspace-1",
      selectedReviewFilterKey: "allCards",
      resolvedReviewFilterTitle: "All Cards",
      reviewCounts: {
        dueCount: 1,
        totalCount: 1,
      },
      currentCard: buildReviewLoadingCardPreview(snapshotCard),
      queuePreview: [buildReviewLoadingCardPreview(snapshotCard)],
      savedAt: "2026-03-10T12:00:00.000Z",
    });
    const pendingReviewQueueSnapshot = createDeferredPromise<ReviewQueueSnapshot>();
    loadReviewQueueSnapshotMock.mockImplementation((): Promise<ReviewQueueSnapshot> => pendingReviewQueueSnapshot.promise);

    await renderReviewScreen();

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }
    const frontCard = reviewPane.querySelector("[data-testid='review-current-front-card']");
    if (!(frontCard instanceof HTMLElement)) {
      throw new Error("Review loading front card was not found");
    }
    const speechButton = reviewPane.querySelector(".review-card-surface-front .review-card-speech-btn");
    if (!(speechButton instanceof HTMLButtonElement)) {
      throw new Error("Review loading front speech button was not found");
    }

    expect(reviewPane.dataset.reviewPaneState).toBe("loading");
    expect(reviewPane.querySelector(".review-card-answer")).toBeNull();
    expect(frontCard.textContent).toContain("Snapshot front prompt");
    expect(speechButton.disabled).toBe(true);

    await act(async () => {
      pendingReviewQueueSnapshot.resolve({
        resolvedReviewFilter: state.appData.selectedReviewFilter,
        cards: [snapshotCard],
        nextCursor: null,
        reviewCounts: {
          dueCount: 1,
          totalCount: 1,
        },
      });
      await pendingReviewQueueSnapshot.promise;
    });
    await flushReviewScreenPromises();
  });

  it("restores and migrates a decomposed legacy tag snapshot for a normalized persisted selection", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    const state = getState();
    const snapshotCard = createCard({
      cardId: "legacy-unicode-loading-preview",
      frontText: "Legacy Unicode snapshot prompt",
      backText: "Snapshot answer",
      tags: ["E\u0301clair"],
    });
    state.cards = [snapshotCard];
    state.reviewQueue = [snapshotCard];
    state.reviewTimeline = [snapshotCard];
    state.appData.selectedReviewFilter = parsePersistedReviewFilter(JSON.stringify({
      kind: "tags",
      tags: [" E\u0301CLAIR "],
    }));
    const legacySelectedReviewFilterKey = `tags:${encodeURIComponent("e\u0301clair")}`;
    writeReviewLoadingSnapshot({
      version: 1,
      workspaceId: "workspace-1",
      selectedReviewFilterKey: legacySelectedReviewFilterKey,
      resolvedReviewFilterTitle: "1 tag",
      reviewCounts: {
        dueCount: 1,
        totalCount: 1,
      },
      currentCard: buildReviewLoadingCardPreview(snapshotCard),
      queuePreview: [buildReviewLoadingCardPreview(snapshotCard)],
      savedAt: "2026-03-10T12:00:00.000Z",
    });
    const legacyStorageKey = window.localStorage.key(0);
    if (legacyStorageKey === null) {
      throw new Error("Legacy review loading snapshot storage key was not written");
    }
    const pendingReviewQueueSnapshot = createDeferredPromise<ReviewQueueSnapshot>();
    loadReviewQueueSnapshotMock.mockImplementation(() => pendingReviewQueueSnapshot.promise);

    await renderReviewScreen();

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    const frontCard = reviewPane?.querySelector("[data-testid='review-current-front-card']");
    if (!(reviewPane instanceof HTMLElement) || !(frontCard instanceof HTMLElement)) {
      throw new Error("Migrated Unicode review loading preview was not rendered");
    }
    const canonicalSelectedReviewFilterKey = serializeReviewFilterKey(state.appData.selectedReviewFilter);
    const canonicalStorageKey = window.localStorage.key(0);
    if (canonicalStorageKey === null) {
      throw new Error("Canonical review loading snapshot storage key was not written");
    }
    const canonicalSnapshotValue = window.localStorage.getItem(canonicalStorageKey);
    if (canonicalSnapshotValue === null) {
      throw new Error("Canonical review loading snapshot value was not written");
    }

    expect(frontCard.textContent).toContain("Legacy Unicode snapshot prompt");
    expect(reviewPane.querySelector(".review-loading-card-surface")).toBeNull();
    expect(loadReviewQueueSnapshotMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(legacyStorageKey)).toBeNull();
    expect(canonicalStorageKey.endsWith(`:${canonicalSelectedReviewFilterKey}`)).toBe(true);
    expect(JSON.parse(canonicalSnapshotValue)).toMatchObject({
      selectedReviewFilterKey: canonicalSelectedReviewFilterKey,
      currentCard: {
        cardId: snapshotCard.cardId,
        frontText: snapshotCard.frontText,
      },
    });

    await act(async () => {
      pendingReviewQueueSnapshot.resolve({
        resolvedReviewFilter: state.appData.selectedReviewFilter,
        cards: [snapshotCard],
        nextCursor: null,
        reviewCounts: {
          dueCount: 1,
          totalCount: 1,
        },
      });
      await pendingReviewQueueSnapshot.promise;
    });
    await flushReviewScreenPromises();
  });

  it("shows a retry path instead of staying in cold empty loading after sync fails", async () => {
    const state = getState();
    state.appData.errorMessage = "Cloud sync failed";
    state.appData.isSyncing = false;
    hasHydratedHotStateMock.mockResolvedValue(false);

    await renderReviewScreen();
    await flushReviewScreenPromises();

    const reviewPane = getContainer().querySelector("[data-testid='review-pane']");
    if (!(reviewPane instanceof HTMLElement)) {
      throw new Error("Review pane was not found");
    }

    const retryButton = getContainer().querySelector(".review-loading-retry-btn");
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error("Review retry button was not found");
    }

    expect(reviewPane.dataset.reviewPaneState).toBe("empty");
    expect(reviewPane.dataset.reviewPaneEmptyReason).toBe("no-cards");
    expect(getContainer().textContent).not.toContain("Cloud sync failed");
    expect(getContainer().querySelector(".error-banner")?.textContent).toContain("A technical error occurred.");

    const expectedSyncError = new ApiError({
      statusCode: 404,
      message: "Workspace not found",
      code: "WORKSPACE_NOT_FOUND",
      requestId: "request-1",
      retryAfterMs: null,
      endpoint: "POST /workspaces/workspace-1/sync/pull",
      responseBodyKind: "json",
    });
    state.appData.refreshLocalData.mockRejectedValueOnce(expectedSyncError);

    await clickElementAsync(retryButton);
    await flushReviewScreenPromises();

    expect(state.appData.refreshLocalData).toHaveBeenCalledTimes(1);
    expect(state.appData.setErrorMessage).toHaveBeenCalledWith("Workspace not found");
  });
});
