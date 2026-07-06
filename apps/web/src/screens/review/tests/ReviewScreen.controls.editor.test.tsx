// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../../../types";
import { clearWebSyncCache } from "../../../localDb/core/cache";
import {
  enqueueMediaTransferUpload,
  loadMediaTransferQueueRecord,
  markMediaTransferFailed,
} from "../../../localDb/mediaTransfers";
import {
  clickElementAsync,
  createCard,
  loadReviewQueueSnapshotMock,
  setTextFieldValueAsync,
  setupReviewScreenTest,
} from "../testSupport/ReviewScreenTestSupport";

beforeEach(async () => {
  await clearWebSyncCache();
});

const {
  dispatchDocumentKeydown,
  getContainer,
  getState,
  renderReviewScreen,
  revealAnswer,
} = setupReviewScreenTest();

describe("ReviewScreen editor controls", () => {
  it("saves card edits from the review editor", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-edit",
      frontText: "Before",
      backText: "Existing back",
      tags: ["grammar"],
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
    });
  });

  it("shows failed media upload status and retries through the upload runner", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-media-upload",
      frontText: "![Diagram](fcasset:media-upload-asset)",
      backText: "Existing back",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    vi.useRealTimers();
    await enqueueMediaTransferUpload({
      transferId: "media-upload-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "media-upload-asset",
      sha256: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:00:00.000Z",
      nextAttemptAt: "2026-03-10T09:00:00.000Z",
    });
    await markMediaTransferFailed(
      "media-upload-transfer",
      "2026-03-10T09:05:00.000Z",
      "network unavailable",
      "2099-03-10T09:10:00.000Z",
    );

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }

    await clickElementAsync(editButton);

    await vi.waitFor(() => {
      const status = document.querySelector("[data-testid='card-form-media-upload-status']");
      expect(status?.textContent).toContain("Upload failed");
    });

    const retryButton = document.querySelector("[data-testid='card-form-media-upload-retry']");
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error("Media upload retry button was not found");
    }

    await clickElementAsync(retryButton);

    await vi.waitFor(async () => {
      const transfer = await loadMediaTransferQueueRecord("media-upload-transfer");
      expect(transfer?.nextAttemptAt).not.toBe("2099-03-10T09:10:00.000Z");
      expect(transfer?.nextAttemptAt.localeCompare(new Date().toISOString())).toBeLessThanOrEqual(0);
      expect(state.appData.runMediaUploadTransfers).toHaveBeenCalledTimes(1);
    });
  });

  it("shows due failed media uploads as pending without a manual retry action", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-media-upload-due",
      frontText: "![Diagram](fcasset:media-upload-due-asset)",
      backText: "Existing back",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    vi.useRealTimers();
    await enqueueMediaTransferUpload({
      transferId: "media-upload-due-transfer",
      workspaceId: "workspace-1",
      mediaAssetId: "media-upload-due-asset",
      sha256: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      mimeType: "image/png",
      sizeBytes: 42817,
      sourceBlobCacheKey: "6e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      createdAt: "2026-03-10T09:00:00.000Z",
      nextAttemptAt: "2026-03-10T09:00:00.000Z",
    });
    await markMediaTransferFailed(
      "media-upload-due-transfer",
      "2026-03-10T09:05:00.000Z",
      "network unavailable",
      "2000-03-10T09:10:00.000Z",
    );

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }

    await clickElementAsync(editButton);

    await vi.waitFor(() => {
      const status = document.querySelector("[data-testid='card-form-media-upload-status']");
      expect(status?.textContent).toContain("Pending upload");
      expect(status?.getAttribute("data-status")).toBe("pending");
      expect(status?.getAttribute("data-transfer-status")).toBe("failed");
    });

    expect(document.querySelector("[data-testid='card-form-media-upload-retry']")).toBeNull();
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
});
