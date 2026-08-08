// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearWebSyncCache } from "../../../../localDb/core/cache";
import {
  enqueueMediaTransferUpload,
  loadMediaTransferQueueRecord,
  markMediaTransferFailed,
} from "../../../../localDb/mediaTransfers";
import {
  clickElementAsync,
  createCard,
  setTextFieldValueAsync,
  setupReviewScreenTest,
} from "../../testSupport/ReviewScreenTestSupport";

const mocks = vi.hoisted(() => ({
  handoffCardToAiMock: vi.fn(),
}));

vi.mock("../../../../chat/handoff/useAiCardHandoff", () => ({
  useAiCardHandoff: () => mocks.handoffCardToAiMock,
}));

beforeEach(async () => {
  await clearWebSyncCache();
  mocks.handoffCardToAiMock.mockReset();
  mocks.handoffCardToAiMock.mockResolvedValue(true);
});

const {
  getContainer,
  getState,
  renderReviewScreen,
  rerenderReviewScreen,
} = setupReviewScreenTest();

describe("ReviewScreen editor media and actions", () => {
  it("reconciles synced media lifecycle markers without overwriting editor text changes", async () => {
    const state = getState();
    const pendingFrontText = [
      "Question",
      "",
      '![Primary diagram](<fcasset:front-image?variant=large&state=pending#front> "Generated")',
      "",
      "![Secondary diagram](fcasset:secondary-image?state=pending)",
    ].join("\n");
    const failedBackText = 'Answer\n\n![Example](<fcasset:back-image?variant=large&state=failed#back> "Generated")';
    const readyFrontText = [
      "Question",
      "",
      '![Primary diagram](<fcasset:front-image?variant=large&state=ready#front> "Generated")',
      "",
      "![Secondary diagram](fcasset:secondary-image?state=pending)",
    ].join("\n");
    const readyBackText = 'Answer\n\n![Example](<fcasset:back-image?variant=large&state=promoted#back> "Generated")';
    const card = createCard({
      cardId: "card-media-lifecycle-sync",
      frontText: pendingFrontText,
      backText: failedBackText,
      tags: ["grammar"],
    });
    const refreshedCard = {
      ...card,
      frontText: readyFrontText.replace("Question", "Remotely edited question"),
      backText: readyBackText.replace("Answer", "Remotely edited answer"),
      tags: ["grammar", "remote"],
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    state.appData.updateCardItem.mockResolvedValue(refreshedCard);
    vi.useRealTimers();

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    const frontTextField = document.getElementById("review-card-editor-front-text");
    const backTextField = document.getElementById("review-card-editor-back-text");
    if (!(frontTextField instanceof HTMLTextAreaElement) || !(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Review editor text fields were not found");
    }

    const editedBackText = 'Edited answer\n\n![Example](<fcasset:back-image?variant=large&state=failed#back> "Generated")';
    await setTextFieldValueAsync(backTextField, editedBackText);

    const tagsTrigger = document.querySelector('[data-testid="card-form-tags-trigger"]');
    if (!(tagsTrigger instanceof HTMLElement)) {
      throw new Error("Review editor tags trigger was not found");
    }
    await clickElementAsync(tagsTrigger);

    const tagsInput = document.getElementById("review-card-editor-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Review editor tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, "custom");
    await act(async () => {
      tagsInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
    });
    await clickElementAsync(tagsTrigger);

    const selectedText = "Secondary diagram";
    const selectionStart = pendingFrontText.indexOf(selectedText);
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(
        selectionStart,
        selectionStart + selectedText.length,
        "backward",
      );
    });

    state.cards = [refreshedCard];
    state.reviewQueue = [refreshedCard];
    state.reviewTimeline = [refreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    const reconciledFrontText = readyFrontText.replace("Question", "Remotely edited question");
    const reconciledBackText = readyBackText.replace("Answer", "Edited answer");
    await vi.waitFor(() => {
      expect(frontTextField.value).toBe(reconciledFrontText);
      expect(backTextField.value).toBe(reconciledBackText);
      const reconciledSelectionStart = reconciledFrontText.indexOf(selectedText);
      expect(document.activeElement).toBe(frontTextField);
      expect(frontTextField.selectionStart).toBe(reconciledSelectionStart);
      expect(frontTextField.selectionEnd).toBe(
        reconciledSelectionStart + selectedText.length,
      );
      expect(frontTextField.selectionDirection).toBe("backward");
    });

    const saveButton = document.querySelector(".review-editor-modal .primary-btn");
    if (!(saveButton instanceof HTMLButtonElement)) {
      throw new Error("Review editor save button was not found");
    }
    await clickElementAsync(saveButton);

    expect(state.appData.updateCardItem).toHaveBeenCalledWith("card-media-lifecycle-sync", {
      frontText: reconciledFrontText,
      backText: reconciledBackText,
      tags: ["grammar", "custom"],
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
});

