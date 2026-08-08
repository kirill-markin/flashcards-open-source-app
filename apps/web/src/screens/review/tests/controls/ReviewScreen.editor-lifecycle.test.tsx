// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Card } from "../../../../types";
import { clearWebSyncCache } from "../../../../localDb/core/cache";
import {
  clickElementAsync,
  createCard,
  createDeferredPromise,
  loadReviewQueueSnapshotMock,
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

type AnimationFrameController = Readonly<{
  cancelledIds: () => ReadonlyArray<number>;
  flushAll: () => Promise<void>;
  latestScheduledId: () => number | null;
  restore: () => void;
}>;

function installAnimationFrameController(): AnimationFrameController {
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelledAnimationFrameIds: Array<number> = [];
  let nextAnimationFrameId = 1;
  const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const animationFrameId = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    callbacks.set(animationFrameId, callback);
    return animationFrameId;
  });
  const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((animationFrameId) => {
    cancelledAnimationFrameIds.push(animationFrameId);
  });

  return {
    cancelledIds: () => [...cancelledAnimationFrameIds],
    flushAll: async (): Promise<void> => {
      const scheduledCallbacks = [...callbacks.entries()].reverse();
      callbacks.clear();
      for (const [, callback] of scheduledCallbacks) {
        await act(async () => {
          callback(0);
        });
      }
    },
    latestScheduledId: () => {
      const scheduledIds = [...callbacks.keys()];
      return scheduledIds.at(-1) ?? null;
    },
    restore: () => {
      requestAnimationFrameSpy.mockRestore();
      cancelAnimationFrameSpy.mockRestore();
    },
  };
}

describe("ReviewScreen editor lifecycle controls", () => {
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

  it("preserves edits made while an AI pre-save is pending and does not hand off stale text", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-ai-pre-save-edit-race",
      frontText: "Initial question",
      backText: "Answer",
      tags: ["grammar"],
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    const pendingUpdate = createDeferredPromise<Card>();
    state.appData.updateCardItem.mockReturnValue(pendingUpdate.promise);

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    const frontTextField = document.getElementById("review-card-editor-front-text");
    const aiButton = document.querySelector("[data-testid='review-editor-edit-with-ai']");
    if (
      !(frontTextField instanceof HTMLTextAreaElement)
      || !(aiButton instanceof HTMLButtonElement)
    ) {
      throw new Error("Review editor AI controls were not found");
    }

    const submittedFrontText = "Question submitted before the race";
    await setTextFieldValueAsync(frontTextField, submittedFrontText);
    await clickElementAsync(aiButton);

    await vi.waitFor(() => {
      expect(state.appData.updateCardItem).toHaveBeenCalledWith(
        "card-ai-pre-save-edit-race",
        {
          frontText: submittedFrontText,
          backText: "Answer",
          tags: ["grammar"],
        },
      );
    });

    const latestFrontText = "Question edited while the save is pending";
    await setTextFieldValueAsync(frontTextField, latestFrontText);
    await act(async () => {
      pendingUpdate.resolve({
        ...card,
        frontText: submittedFrontText,
        clientUpdatedAt: "2026-03-10T10:00:00.000Z",
        lastOperationId: "operation-ai-pre-save-race",
        updatedAt: "2026-03-10T10:00:00.000Z",
      });
      await pendingUpdate.promise;
    });

    await vi.waitFor(() => {
      expect(frontTextField.value).toBe(latestFrontText);
      expect(aiButton.disabled).toBe(false);
      expect(mocks.handoffCardToAiMock).not.toHaveBeenCalled();
    });
  });

  it("does not let an obsolete AI handoff close a reopened editor", async () => {
    const state = getState();
    const card = createCard({
      cardId: "card-ai-handoff-presentation-race",
      frontText: "Question",
      backText: "Answer",
    });
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    const pendingHandoff = createDeferredPromise<boolean>();
    mocks.handoffCardToAiMock.mockReturnValue(pendingHandoff.promise);

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    const aiButton = document.querySelector("[data-testid='review-editor-edit-with-ai']");
    if (!(aiButton instanceof HTMLButtonElement)) {
      throw new Error("Review editor AI button was not found");
    }
    await clickElementAsync(aiButton);

    await vi.waitFor(() => {
      expect(mocks.handoffCardToAiMock).toHaveBeenCalledWith(card);
    });

    const cancelButton = document.querySelector("[data-testid='review-editor-cancel']");
    if (!(cancelButton instanceof HTMLButtonElement)) {
      throw new Error("Review editor cancel button was not found");
    }
    await clickElementAsync(cancelButton);
    await clickElementAsync(editButton);

    const reopenedFrontTextField = document.getElementById("review-card-editor-front-text");
    if (!(reopenedFrontTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Reopened Review editor front field was not found");
    }
    const reopenedDraft = "Draft from the reopened editor";
    await setTextFieldValueAsync(reopenedFrontTextField, reopenedDraft);

    await act(async () => {
      pendingHandoff.resolve(true);
      await pendingHandoff.promise;
    });

    await vi.waitFor(() => {
      expect(document.querySelector(".review-editor-modal")).not.toBeNull();
      expect(reopenedFrontTextField.value).toBe(reopenedDraft);
    });
  });

  it("advances the observed baseline across unresolved lifecycle refreshes", async () => {
    const state = getState();
    const selectionText = "Selection anchor";
    const pendingFrontText = "Question\n\n![Diagram](fcasset:chained-refresh-image?state=pending)";
    const readyFrontText = "Question\n\n![Diagram](fcasset:chained-refresh-image)";
    const initialBackText = `Answer A\n\n${selectionText}`;
    const refreshedBackText = `Answer B\n\n${selectionText}`;
    const laterBackText = `Answer C\n\n${selectionText}`;
    const card = createCard({
      cardId: "card-media-lifecycle-chained-refresh",
      frontText: pendingFrontText,
      backText: initialBackText,
      tags: ["grammar"],
    });
    const refreshedCard = {
      ...card,
      frontText: readyFrontText,
      backText: refreshedBackText,
      tags: ["grammar", "remote-b"],
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const laterRefreshedCard = {
      ...refreshedCard,
      backText: laterBackText,
      tags: ["grammar", "remote-c"],
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    vi.useRealTimers();

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    const frontTextField = document.getElementById("review-card-editor-front-text");
    const backTextField = document.getElementById("review-card-editor-back-text");
    if (
      !(frontTextField instanceof HTMLTextAreaElement)
      || !(backTextField instanceof HTMLTextAreaElement)
    ) {
      throw new Error("Review editor text fields were not found");
    }
    const editedFrontText = pendingFrontText.replace("Diagram", "Locally edited diagram");
    await setTextFieldValueAsync(frontTextField, editedFrontText);
    const selectionStart = initialBackText.indexOf(selectionText);
    await act(async () => {
      backTextField.focus();
      backTextField.setSelectionRange(
        selectionStart,
        selectionStart + selectionText.length,
        "forward",
      );
    });

    state.cards = [refreshedCard];
    state.reviewQueue = [refreshedCard];
    state.reviewTimeline = [refreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    const blockedControls = await vi.waitFor(() => {
      const alert = document.querySelector("[data-testid='review-editor-lifecycle-conflict']");
      const saveButton = document.querySelector(".review-editor-modal .primary-btn");
      const aiButton = document.querySelector("[data-testid='review-editor-edit-with-ai']");
      const tagsTrigger = document.querySelector('[data-testid="card-form-tags-trigger"]');
      if (
        !(alert instanceof HTMLElement)
        || !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Blocked Review editor controls were not found");
      }
      expect(frontTextField.value).toBe(editedFrontText);
      expect(backTextField.value).toBe(refreshedBackText);
      expect(tagsTrigger?.textContent).toContain("remote-b");
      expect(saveButton.disabled).toBe(true);
      expect(aiButton.disabled).toBe(true);
      const refreshedSelectionStart = refreshedBackText.indexOf(selectionText);
      expect(document.activeElement).toBe(backTextField);
      expect(backTextField.selectionStart).toBe(refreshedSelectionStart);
      expect(backTextField.selectionEnd).toBe(
        refreshedSelectionStart + selectionText.length,
      );
      expect(backTextField.selectionDirection).toBe("forward");
      return { aiButton, saveButton };
    });

    state.cards = [laterRefreshedCard];
    state.reviewQueue = [laterRefreshedCard];
    state.reviewTimeline = [laterRefreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    await vi.waitFor(() => {
      const tagsTrigger = document.querySelector('[data-testid="card-form-tags-trigger"]');
      expect(frontTextField.value).toBe(editedFrontText);
      expect(backTextField.value).toBe(laterBackText);
      expect(tagsTrigger?.textContent).toContain("remote-c");
      expect(document.querySelector("[data-testid='review-editor-lifecycle-conflict']")).not.toBeNull();
      expect(blockedControls.saveButton.disabled).toBe(true);
      expect(blockedControls.aiButton.disabled).toBe(true);
      const refreshedSelectionStart = laterBackText.indexOf(selectionText);
      expect(document.activeElement).toBe(backTextField);
      expect(backTextField.selectionStart).toBe(refreshedSelectionStart);
      expect(backTextField.selectionEnd).toBe(
        refreshedSelectionStart + selectionText.length,
      );
      expect(backTextField.selectionDirection).toBe("forward");
    });

    await clickElementAsync(blockedControls.saveButton);
    await clickElementAsync(blockedControls.aiButton);
    expect(state.appData.updateCardItem).not.toHaveBeenCalled();
    expect(mocks.handoffCardToAiMock).not.toHaveBeenCalled();
  });

  it("cancels obsolete selection restores and preserves the editor through failed or missing refreshes", async () => {
    const state = getState();
    const selectedText = "Selection 😀 anchor";
    const pendingReference = "![Diagram](fcasset:selection-race-image?state=pending)";
    const readyReference = "![Diagram](fcasset:selection-race-image)";
    const initialFrontText = `A\n\n${pendingReference}\n\n${selectedText}`;
    const refreshedFrontText = `BBBB\n\n${readyReference}\n\n${selectedText}`;
    const laterFrontText = `CC\n\n${readyReference}\n\n${selectedText}`;
    const card = createCard({
      cardId: "card-media-lifecycle-selection-race",
      frontText: initialFrontText,
      backText: "Answer",
    });
    const refreshedCard = {
      ...card,
      frontText: refreshedFrontText,
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const laterRefreshedCard = {
      ...refreshedCard,
      frontText: laterFrontText,
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    vi.useRealTimers();

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
    const selectionStart = initialFrontText.indexOf(selectedText);
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(
        selectionStart,
        selectionStart + selectedText.length,
        "backward",
      );
    });

    const animationFrames = installAnimationFrameController();
    try {
      state.cards = [refreshedCard];
      state.reviewQueue = [refreshedCard];
      state.reviewTimeline = [refreshedCard];
      state.appData.localReadVersion += 1;
      await rerenderReviewScreen();

      const firstRestoreId = animationFrames.latestScheduledId();
      if (firstRestoreId === null) {
        throw new Error("First Review editor selection restore was not scheduled");
      }

      state.cards = [laterRefreshedCard];
      state.reviewQueue = [laterRefreshedCard];
      state.reviewTimeline = [laterRefreshedCard];
      state.appData.localReadVersion += 1;
      await rerenderReviewScreen();

      const laterRestoreId = animationFrames.latestScheduledId();
      if (laterRestoreId === null || laterRestoreId === firstRestoreId) {
        throw new Error("Later Review editor selection restore was not scheduled");
      }
      expect(animationFrames.cancelledIds()).toContain(firstRestoreId);
      expect(frontTextField.value).toBe(laterFrontText);

      await act(async () => {
        frontTextField.blur();
      });
      expect(animationFrames.cancelledIds()).toContain(laterRestoreId);
      expect(document.activeElement).toBe(document.body);

      loadReviewQueueSnapshotMock.mockRejectedValueOnce(new Error("refresh unavailable"));
      state.appData.localReadVersion += 1;
      await rerenderReviewScreen();

      expect(document.querySelector(".review-editor-modal")).not.toBeNull();
      expect(frontTextField.value).toBe(laterFrontText);
      expect(document.activeElement).not.toBe(frontTextField);

      state.cards = [];
      state.reviewQueue = [];
      state.reviewTimeline = [];
      state.appData.localReadVersion += 1;
      await rerenderReviewScreen();

      expect(document.querySelector(".review-editor-modal")).not.toBeNull();
      expect(frontTextField.value).toBe(laterFrontText);
      await animationFrames.flushAll();
      expect(document.activeElement).not.toBe(frontTextField);
      expect(frontTextField.value).toBe(laterFrontText);
    } finally {
      animationFrames.restore();
    }
  });

  it("retains dormant lifecycle conflicts after a failed AI handoff", async () => {
    const state = getState();
    const pendingReference = "![Diagram](fcasset:failed-handoff-image?state=pending)";
    const readyReference = "![Diagram](fcasset:failed-handoff-image)";
    const pendingFrontText = `Question\n\n${pendingReference}`;
    const readyFrontText = `Question\n\n${readyReference}`;
    const card = createCard({
      cardId: "card-media-lifecycle-handoff",
      frontText: pendingFrontText,
      backText: "Answer",
      tags: ["grammar"],
    });
    const refreshedCard = {
      ...card,
      frontText: readyFrontText,
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    vi.useRealTimers();

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    state.cards = [refreshedCard];
    state.reviewQueue = [refreshedCard];
    state.reviewTimeline = [refreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    const controls = await vi.waitFor(() => {
      const frontTextField = document.getElementById("review-card-editor-front-text");
      const backTextField = document.getElementById("review-card-editor-back-text");
      const saveButton = document.querySelector(".review-editor-modal .primary-btn");
      const aiButton = document.querySelector("[data-testid='review-editor-edit-with-ai']");
      if (
        !(frontTextField instanceof HTMLTextAreaElement)
        || !(backTextField instanceof HTMLTextAreaElement)
        || !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Review editor controls were not found");
      }
      expect(frontTextField.value).toBe(readyFrontText);
      return {
        aiButton,
        backTextField,
        frontTextField,
        saveButton,
      };
    });

    const editedFrontText = readyFrontText.replace("Question", "Edited question");
    await setTextFieldValueAsync(controls.frontTextField, editedFrontText);
    const savedCard = {
      ...refreshedCard,
      frontText: editedFrontText,
    };
    state.appData.updateCardItem.mockResolvedValue(savedCard);
    mocks.handoffCardToAiMock.mockResolvedValue(false);
    await clickElementAsync(controls.aiButton);

    await vi.waitFor(() => {
      expect(state.appData.updateCardItem).toHaveBeenCalledTimes(1);
      expect(mocks.handoffCardToAiMock).toHaveBeenCalledWith(savedCard);
    });

    const pastedBackText = `Edited answer\n\n${pendingReference}`;
    await setTextFieldValueAsync(controls.backTextField, pastedBackText);

    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid='review-editor-lifecycle-conflict']")?.textContent).toContain(
        "A managed image changed",
      );
      expect(controls.saveButton.disabled).toBe(true);
      expect(controls.aiButton.disabled).toBe(true);
    });
    await clickElementAsync(controls.saveButton);
    await clickElementAsync(controls.aiButton);
    expect(state.appData.updateCardItem).toHaveBeenCalledTimes(1);
    expect(mocks.handoffCardToAiMock).toHaveBeenCalledTimes(1);
  });

  it("retains a successful AI pre-save when its version bump refresh fails against the stale queue", async () => {
    const state = getState();
    const pendingReference = "![Diagram](fcasset:pre-save-refresh-image?state=pending)";
    const readyReference = "![Diagram](fcasset:pre-save-refresh-image)";
    const initialCard = createCard({
      cardId: "card-media-lifecycle-pre-save-refresh",
      frontText: `Question\n\n${pendingReference}`,
      backText: "Answer",
      tags: ["grammar"],
    });
    const refreshedCard = {
      ...initialCard,
      frontText: `Question\n\n${readyReference}`,
      clientUpdatedAt: "2026-03-10T10:00:00.000Z",
      lastModifiedByReplicaId: "device-remote",
      lastOperationId: "operation-remote-ready",
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    state.cards = [initialCard];
    state.reviewQueue = [initialCard];
    state.reviewTimeline = [initialCard];
    vi.useRealTimers();

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    state.cards = [refreshedCard];
    state.reviewQueue = [refreshedCard];
    state.reviewTimeline = [refreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    const controls = await vi.waitFor(() => {
      const frontTextField = document.getElementById("review-card-editor-front-text");
      const backTextField = document.getElementById("review-card-editor-back-text");
      const aiButton = document.querySelector("[data-testid='review-editor-edit-with-ai']");
      const saveButton = document.querySelector(".review-editor-modal .primary-btn");
      if (
        !(frontTextField instanceof HTMLTextAreaElement)
        || !(backTextField instanceof HTMLTextAreaElement)
        || !(aiButton instanceof HTMLButtonElement)
        || !(saveButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Review editor controls were not found");
      }
      expect(frontTextField.value).toBe(refreshedCard.frontText);
      return {
        aiButton,
        backTextField,
        frontTextField,
        saveButton,
      };
    });

    const savedFrontText = refreshedCard.frontText.replace("Question", "Saved question");
    await setTextFieldValueAsync(controls.frontTextField, savedFrontText);
    const firstSavedCard = {
      ...refreshedCard,
      frontText: savedFrontText,
      clientUpdatedAt: "2026-03-10T11:00:00.000Z",
      lastModifiedByReplicaId: "device-local",
      lastOperationId: "operation-local-pre-save",
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    const secondSavedCard = {
      ...firstSavedCard,
      clientUpdatedAt: "2026-03-10T12:00:00.000Z",
      lastOperationId: "operation-local-final-save",
      updatedAt: "2026-03-10T12:00:00.000Z",
    };
    let updateCallCount = 0;
    state.appData.updateCardItem.mockImplementation(async (_cardId, input): Promise<Card> => {
      updateCallCount += 1;
      state.appData.localReadVersion += 1;
      return {
        ...(updateCallCount === 1 ? firstSavedCard : secondSavedCard),
        ...input,
      };
    });
    loadReviewQueueSnapshotMock.mockRejectedValueOnce(new Error("refresh unavailable"));
    mocks.handoffCardToAiMock.mockResolvedValue(false);
    await clickElementAsync(controls.aiButton);

    await vi.waitFor(() => {
      expect(state.appData.updateCardItem).toHaveBeenCalledTimes(1);
      expect(mocks.handoffCardToAiMock).toHaveBeenCalledWith(firstSavedCard);
      expect(controls.frontTextField.value).toBe(savedFrontText);
      expect(document.querySelector(".review-editor-modal")).not.toBeNull();
    });

    await setTextFieldValueAsync(
      controls.backTextField,
      `Answer\n\n${pendingReference}`,
    );
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-testid='review-editor-lifecycle-conflict']"),
      ).not.toBeNull();
      expect(controls.saveButton.disabled).toBe(true);
    });
    await setTextFieldValueAsync(controls.backTextField, "Answer");
    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-testid='review-editor-lifecycle-conflict']"),
      ).toBeNull();
      expect(controls.saveButton.disabled).toBe(false);
    });

    await clickElementAsync(controls.saveButton);

    expect(state.appData.updateCardItem).toHaveBeenLastCalledWith(
      "card-media-lifecycle-pre-save-refresh",
      {
        frontText: savedFrontText,
        backText: "Answer",
        tags: ["grammar"],
      },
    );
  });

  it("retains a successful AI pre-save while omitted and applies each later queue revision once", async () => {
    const state = getState();
    const initialCard = createCard({
      cardId: "card-pre-save-omitted-refresh",
      frontText: "Question",
      backText: "Answer",
      tags: ["grammar"],
    });
    state.cards = [initialCard];
    state.reviewQueue = [initialCard];
    state.reviewTimeline = [initialCard];
    vi.useRealTimers();

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    const frontTextField = document.getElementById("review-card-editor-front-text");
    const backTextField = document.getElementById("review-card-editor-back-text");
    const aiButton = document.querySelector("[data-testid='review-editor-edit-with-ai']");
    if (
      !(frontTextField instanceof HTMLTextAreaElement)
      || !(backTextField instanceof HTMLTextAreaElement)
      || !(aiButton instanceof HTMLButtonElement)
    ) {
      throw new Error("Review editor controls were not found");
    }

    const savedFrontText = "Saved question";
    await setTextFieldValueAsync(frontTextField, savedFrontText);
    const savedCard = {
      ...initialCard,
      frontText: savedFrontText,
      clientUpdatedAt: "2026-03-10T10:00:00.000Z",
      lastModifiedByReplicaId: "device-local",
      lastOperationId: "operation-local-omitted",
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    state.appData.updateCardItem.mockImplementation(async (_cardId, input): Promise<Card> => {
      state.appData.localReadVersion += 1;
      return {
        ...savedCard,
        ...input,
      };
    });
    state.appData.getCardById.mockImplementation(async (cardId: string): Promise<Card> => {
      throw new Error(`Card not found: ${cardId}`);
    });
    state.cards = [];
    state.reviewQueue = [];
    state.reviewTimeline = [];
    mocks.handoffCardToAiMock.mockResolvedValue(false);
    await clickElementAsync(aiButton);

    await vi.waitFor(() => {
      expect(mocks.handoffCardToAiMock).toHaveBeenCalledWith(savedCard);
      expect(document.querySelector(".review-editor-modal")).not.toBeNull();
      expect(frontTextField.value).toBe(savedFrontText);
    });

    const laterCard = {
      ...savedCard,
      frontText: "Remotely refreshed question",
      backText: "Remotely refreshed answer",
      tags: ["grammar", "remote"],
      clientUpdatedAt: "2026-03-10T11:00:00.000Z",
      lastModifiedByReplicaId: "device-remote",
      lastOperationId: "operation-remote-later",
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    state.cards = [laterCard];
    state.reviewQueue = [laterCard];
    state.reviewTimeline = [laterCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    await vi.waitFor(() => {
      expect(frontTextField.value).toBe(laterCard.frontText);
      expect(backTextField.value).toBe(laterCard.backText);
      expect(
        document.querySelector('[data-testid="card-form-tags-trigger"]')?.textContent,
      ).toContain("remote");
    });

    const locallyEditedBackText = "Locally edited after the later revision";
    await setTextFieldValueAsync(backTextField, locallyEditedBackText);
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    await vi.waitFor(() => {
      expect(frontTextField.value).toBe(laterCard.frontText);
      expect(backTextField.value).toBe(locallyEditedBackText);
    });
  });

  it("retains dormant conflicts after failed Save and resets them only after close", async () => {
    const state = getState();
    const pendingReference = "![Diagram](fcasset:failed-save-image?state=pending)";
    const readyReference = "![Diagram](fcasset:failed-save-image)";
    const card = createCard({
      cardId: "card-media-lifecycle-failed-save",
      frontText: `Question\n\n${pendingReference}`,
      backText: "Answer",
    });
    const refreshedCard = {
      ...card,
      frontText: `Question\n\n${readyReference}`,
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    state.cards = [card];
    state.reviewQueue = [card];
    state.reviewTimeline = [card];
    vi.useRealTimers();

    await renderReviewScreen();

    const editButton = getContainer().querySelector(".review-pane-edit-btn");
    if (!(editButton instanceof HTMLButtonElement)) {
      throw new Error("Review edit button was not found");
    }
    await clickElementAsync(editButton);

    state.cards = [refreshedCard];
    state.reviewQueue = [refreshedCard];
    state.reviewTimeline = [refreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    const controls = await vi.waitFor(() => {
      const backTextField = document.getElementById("review-card-editor-back-text");
      const cancelButton = document.querySelector("[data-testid='review-editor-cancel']");
      const saveButton = document.querySelector(".review-editor-modal .primary-btn");
      if (
        !(backTextField instanceof HTMLTextAreaElement)
        || !(cancelButton instanceof HTMLButtonElement)
        || !(saveButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Review editor controls were not found");
      }
      expect(saveButton.disabled).toBe(false);
      return { backTextField, cancelButton, saveButton };
    });

    state.appData.updateCardItem.mockRejectedValue(new Error("save unavailable"));
    await clickElementAsync(controls.saveButton);

    await vi.waitFor(() => {
      const actionAlerts = document.querySelectorAll(
        ".review-editor-modal .error-banner[role='alert']",
      );
      expect(actionAlerts.length).toBe(1);
      expect(
        document.querySelector("[data-testid='review-editor-lifecycle-conflict']"),
      ).toBeNull();
    });

    await setTextFieldValueAsync(
      controls.backTextField,
      `Answer\n\n${pendingReference}`,
    );

    await vi.waitFor(() => {
      expect(
        document.querySelector("[data-testid='review-editor-lifecycle-conflict']"),
      ).not.toBeNull();
      expect(
        document.querySelectorAll(".review-editor-modal .error-banner[role='alert']").length,
      ).toBe(2);
      expect(controls.saveButton.disabled).toBe(true);
    });

    await clickElementAsync(controls.cancelButton);
    expect(document.querySelector(".review-editor-modal")).toBeNull();

    await clickElementAsync(editButton);
    const reopenedBackTextField = document.getElementById("review-card-editor-back-text");
    const reopenedSaveButton = document.querySelector(".review-editor-modal .primary-btn");
    if (
      !(reopenedBackTextField instanceof HTMLTextAreaElement)
      || !(reopenedSaveButton instanceof HTMLButtonElement)
    ) {
      throw new Error("Reopened Review editor controls were not found");
    }
    await setTextFieldValueAsync(
      reopenedBackTextField,
      `Answer\n\n${pendingReference}`,
    );

    expect(
      document.querySelector("[data-testid='review-editor-lifecycle-conflict']"),
    ).toBeNull();
    expect(reopenedSaveButton.disabled).toBe(false);
  });

  it("blocks editor submission when a stale reference moves between card sides", async () => {
    const state = getState();
    const pendingReference = "![Diagram](fcasset:front-image?state=pending)";
    const pendingFrontText = `Question\n\n${pendingReference}`;
    const card = createCard({
      cardId: "card-media-lifecycle-conflict",
      frontText: pendingFrontText,
      backText: "Answer",
      tags: ["grammar"],
    });
    const refreshedCard = {
      ...card,
      frontText: "Remotely edited question\n\n![Diagram](fcasset:front-image)",
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
    if (
      !(frontTextField instanceof HTMLTextAreaElement)
      || !(backTextField instanceof HTMLTextAreaElement)
    ) {
      throw new Error("Review editor fields were not found");
    }
    const movedFrontText = "Edited question after moving the outdated reference";
    const ambiguousMovedBackText = `Edited answer\n\n${pendingReference}\n\n${pendingReference}`;
    await setTextFieldValueAsync(backTextField, ambiguousMovedBackText);
    await setTextFieldValueAsync(frontTextField, movedFrontText);

    state.cards = [refreshedCard];
    state.reviewQueue = [refreshedCard];
    state.reviewTimeline = [refreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    const conflictMessage = "A managed image changed while this card was open. Remove or edit the outdated pending or failed image reference before saving or using Edit with AI.";
    const blockedControls = await vi.waitFor(() => {
      const alert = document.querySelector("[data-testid='review-editor-lifecycle-conflict']");
      const saveButton = document.querySelector(".review-editor-modal .primary-btn");
      const aiButton = document.querySelector("[data-testid='review-editor-edit-with-ai']");
      if (
        !(alert instanceof HTMLElement)
        || !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Blocked Review editor controls were not found");
      }
      expect(alert.textContent).toBe(conflictMessage);
      expect(saveButton.disabled).toBe(true);
      expect(aiButton.disabled).toBe(true);
      expect(frontTextField.value).toBe(movedFrontText);
      expect(backTextField.value).toBe(ambiguousMovedBackText);
      return { aiButton, saveButton };
    });

    await clickElementAsync(blockedControls.saveButton);
    await clickElementAsync(blockedControls.aiButton);
    expect(state.appData.updateCardItem).not.toHaveBeenCalled();

    const cutBackText = "Edited answer while the outdated reference is cut";
    await setTextFieldValueAsync(backTextField, cutBackText);

    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid='review-editor-lifecycle-conflict']")).toBeNull();
      expect(blockedControls.saveButton.disabled).toBe(false);
      expect(blockedControls.aiButton.disabled).toBe(false);
    });

    const editedStaleReference = '![Edited diagram](<fcasset:front-image?variant=large&state=pending#draft> "Edited title")';
    const editedStaleBackText = `${cutBackText}\n\n${editedStaleReference}`;
    await setTextFieldValueAsync(backTextField, editedStaleBackText);

    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid='review-editor-lifecycle-conflict']")).not.toBeNull();
      expect(blockedControls.saveButton.disabled).toBe(true);
      expect(blockedControls.aiButton.disabled).toBe(true);
    });

    const laterRefreshedCard = {
      ...refreshedCard,
      backText: "Remotely edited answer",
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    state.cards = [laterRefreshedCard];
    state.reviewQueue = [laterRefreshedCard];
    state.reviewTimeline = [laterRefreshedCard];
    state.appData.localReadVersion += 1;
    await rerenderReviewScreen();

    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid='review-editor-lifecycle-conflict']")).not.toBeNull();
      expect(blockedControls.saveButton.disabled).toBe(true);
      expect(blockedControls.aiButton.disabled).toBe(true);
      expect(frontTextField.value).toBe(movedFrontText);
      expect(backTextField.value).toBe(editedStaleBackText);
    });
    await clickElementAsync(blockedControls.saveButton);
    await clickElementAsync(blockedControls.aiButton);
    expect(state.appData.updateCardItem).not.toHaveBeenCalled();

    const resolvedBackText = "Edited answer without the outdated reference";
    await setTextFieldValueAsync(backTextField, resolvedBackText);

    await vi.waitFor(() => {
      expect(document.querySelector("[data-testid='review-editor-lifecycle-conflict']")).toBeNull();
      expect(blockedControls.saveButton.disabled).toBe(false);
      expect(blockedControls.aiButton.disabled).toBe(false);
    });
    await clickElementAsync(blockedControls.saveButton);

    expect(state.appData.updateCardItem).toHaveBeenCalledWith("card-media-lifecycle-conflict", {
      frontText: movedFrontText,
      backText: resolvedBackText,
      tags: ["grammar", "remote"],
    });
  });
});

