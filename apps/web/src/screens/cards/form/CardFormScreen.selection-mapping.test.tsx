// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Card, UpdateCardInput } from "../../../types";
import {
  clickElementAsync,
  createDeferredPromise,
  makeCard,
  mocks,
  setTextFieldValueAsync,
  setupCardFormScreenTest,
} from "./CardFormScreen.lifecycleTestSupport";

const {
  getAppData,
  getContainer,
  renderScreenAt,
} = setupCardFormScreenTest();

type AnimationFrameController = Readonly<{
  cancelledIds: () => ReadonlyArray<number>;
  flush: (animationFrameId: number) => Promise<void>;
  scheduledIds: () => ReadonlyArray<number>;
}>;

function installAnimationFrameController(): AnimationFrameController {
  const callbacks = new Map<number, FrameRequestCallback>();
  const cancelledAnimationFrameIds: Array<number> = [];
  let nextAnimationFrameId = 1;

  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const animationFrameId = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    callbacks.set(animationFrameId, callback);
    return animationFrameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((animationFrameId) => {
    cancelledAnimationFrameIds.push(animationFrameId);
  });

  return {
    cancelledIds: () => [...cancelledAnimationFrameIds],
    flush: async (animationFrameId: number): Promise<void> => {
      const callback = callbacks.get(animationFrameId);
      if (callback === undefined) {
        throw new Error(`Animation frame was not scheduled: animationFrameId=${animationFrameId}`);
      }
      callbacks.delete(animationFrameId);
      await act(async () => {
        callback(0);
      });
    },
    scheduledIds: () => [...callbacks.keys()],
  };
}

async function renderScreen(): Promise<void> {
  await renderScreenAt("/cards/card-media-lifecycle", null);
}

describe("CardFormScreen lifecycle selection mapping", () => {
  it("maps a selection through multiple source-ordered lifecycle replacements", async () => {
    const firstPendingDestination = "fcasset:first-image?quality=high&state=pending#first";
    const firstReadyDestination = "fcasset:first-image?quality=high&state=ready#first";
    const secondFailedDestination = "fcasset:second-image?state=failed#second";
    const secondReadyDestination = "fcasset:second-image?state=generated#second";
    const initialFrontText = [
      "Question",
      "",
      `![First](<${firstPendingDestination}> "First")`,
      "",
      "Bridge",
      "",
      `![Second](<${secondFailedDestination}> "Second")`,
      "",
      "Tail",
    ].join("\n");
    const readyFrontText = initialFrontText
      .replace(firstPendingDestination, firstReadyDestination)
      .replace(secondFailedDestination, secondReadyDestination);
    const editedFrontText = initialFrontText.replace(
      "Question",
      "Locally edited question",
    );
    const reconciledFrontText = readyFrontText.replace(
      "Question",
      "Locally edited question",
    );
    const initialCard = makeCard(initialFrontText, "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard(readyFrontText, "Answer", ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    await setTextFieldValueAsync(frontTextField, editedFrontText);

    const animationFrames = installAnimationFrameController();
    const firstDestinationStart = editedFrontText.indexOf(firstPendingDestination);
    const secondDestinationStart = editedFrontText.indexOf(secondFailedDestination);
    const selectionStartWithinFirstDestination = (
      firstPendingDestination.indexOf("pending") + 2
    );
    const selectionEndWithinSecondDestination = (
      secondFailedDestination.indexOf("failed") + 4
    );
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(
        firstDestinationStart + selectionStartWithinFirstDestination,
        secondDestinationStart + selectionEndWithinSecondDestination,
        "backward",
      );
    });

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const restoreId = animationFrames.scheduledIds()[0];
    if (restoreId === undefined) {
      throw new Error("Multiple-replacement selection restore was not scheduled");
    }
    await animationFrames.flush(restoreId);

    const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
    if (!(refreshedFrontTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Refreshed card form front field was not found");
    }
    expect(refreshedFrontTextField.value).toBe(reconciledFrontText);
    expect(refreshedFrontTextField.selectionStart).toBe(
      reconciledFrontText.indexOf(firstReadyDestination)
        + Math.min(
          selectionStartWithinFirstDestination,
          firstReadyDestination.length,
        ),
    );
    expect(refreshedFrontTextField.selectionEnd).toBe(
      reconciledFrontText.indexOf(secondReadyDestination)
        + Math.min(
          selectionEndWithinSecondDestination,
          secondReadyDestination.length,
        ),
    );
    expect(refreshedFrontTextField.selectionDirection).toBe("backward");
  });

  it("orders reversed definition destinations before replacement and selection mapping", async () => {
    const firstPendingDestination = "fcasset:first-definition?state=pending";
    const firstReadyDestination = "fcasset:first-definition?state=ready";
    const secondFailedDestination = "fcasset:second-definition?state=failed";
    const secondReadyDestination = "fcasset:second-definition";
    const initialFrontText = [
      "Question",
      "",
      "![First][first image]",
      "",
      "![Second][second image]",
      "",
      `[second image]: <${secondFailedDestination}> "Second title"`,
      `[first image]: <${firstPendingDestination}> "First title"`,
    ].join("\n");
    const readyFrontText = initialFrontText
      .replace(secondFailedDestination, secondReadyDestination)
      .replace(firstPendingDestination, firstReadyDestination);
    const editedFrontText = initialFrontText.replace(
      "Question",
      "Locally edited question",
    );
    const reconciledFrontText = readyFrontText.replace(
      "Question",
      "Locally edited question",
    );
    const initialCard = makeCard(initialFrontText, "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard(readyFrontText, "Answer", ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    await setTextFieldValueAsync(frontTextField, editedFrontText);

    const animationFrames = installAnimationFrameController();
    const secondDestinationStart = editedFrontText.indexOf(secondFailedDestination);
    const firstDestinationStart = editedFrontText.indexOf(firstPendingDestination);
    const selectionStartWithinSecondDestination = (
      secondFailedDestination.indexOf("failed") + 2
    );
    const selectionEndWithinFirstDestination = (
      firstPendingDestination.indexOf("pending") + 4
    );
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(
        secondDestinationStart + selectionStartWithinSecondDestination,
        firstDestinationStart + selectionEndWithinFirstDestination,
        "backward",
      );
    });

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const restoreId = animationFrames.scheduledIds()[0];
    if (restoreId === undefined) {
      throw new Error("Definition-backed selection restore was not scheduled");
    }
    await animationFrames.flush(restoreId);

    const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
    if (!(refreshedFrontTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Refreshed card form front field was not found");
    }
    expect(refreshedFrontTextField.value).toBe(reconciledFrontText);
    expect(refreshedFrontTextField.selectionStart).toBe(
      reconciledFrontText.indexOf(secondReadyDestination)
        + Math.min(
          selectionStartWithinSecondDestination,
          secondReadyDestination.length,
        ),
    );
    expect(refreshedFrontTextField.selectionEnd).toBe(
      reconciledFrontText.indexOf(firstReadyDestination)
        + Math.min(
          selectionEndWithinFirstDestination,
          firstReadyDestination.length,
        ),
    );
    expect(refreshedFrontTextField.selectionDirection).toBe("backward");
    expect(getContainer().querySelector('[role="alert"]')).toBeNull();
  });

  it("clamps restored carets and selections to Unicode code-point boundaries", async () => {
    const initialFrontText = "Front ab end";
    const emojiFrontText = "Front 😀 end";
    const initialBackText = "Back abcd end";
    const emojiBackText = "Back 😀🚀 end";
    const initialCard = makeCard(initialFrontText, initialBackText, ["grammar"]);
    const frontRefreshedCard = {
      ...makeCard(emojiFrontText, initialBackText, ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const backRefreshedCard = {
      ...makeCard(emojiFrontText, emojiBackText, ["grammar"]),
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    const animationFrames = installAnimationFrameController();
    const frontPrefixLength = "Front ".length;
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(
        frontPrefixLength + 1,
        frontPrefixLength + 1,
        "none",
      );
    });

    mocks.loadCardByIdMock.mockResolvedValue(frontRefreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const frontRestoreId = animationFrames.scheduledIds()[0];
    if (frontRestoreId === undefined) {
      throw new Error("Front selection restore was not scheduled");
    }
    await animationFrames.flush(frontRestoreId);

    const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
    const backTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
    if (
      !(refreshedFrontTextField instanceof HTMLTextAreaElement)
      || !(backTextField instanceof HTMLTextAreaElement)
    ) {
      throw new Error("Refreshed card form fields were not found");
    }
    expect(refreshedFrontTextField.value).toBe(emojiFrontText);
    expect(refreshedFrontTextField.selectionStart).toBe(
      frontPrefixLength + "😀".length,
    );
    expect(refreshedFrontTextField.selectionEnd).toBe(
      frontPrefixLength + "😀".length,
    );
    expect(refreshedFrontTextField.selectionDirection).toBe("none");

    const backPrefixLength = "Back ".length;
    await act(async () => {
      backTextField.focus();
      backTextField.setSelectionRange(
        backPrefixLength + 1,
        backPrefixLength + 3,
        "backward",
      );
    });
    mocks.loadCardByIdMock.mockResolvedValue(backRefreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const backRestoreId = animationFrames.scheduledIds()[0];
    if (backRestoreId === undefined) {
      throw new Error("Back selection restore was not scheduled");
    }
    await animationFrames.flush(backRestoreId);

    const refreshedBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
    if (!(refreshedBackTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Refreshed card form back field was not found");
    }
    expect(refreshedBackTextField.value).toBe(emojiBackText);
    expect(refreshedBackTextField.selectionStart).toBe(backPrefixLength);
    expect(refreshedBackTextField.selectionEnd).toBe(
      backPrefixLength + "😀🚀".length,
    );
    expect(refreshedBackTextField.selectionDirection).toBe("backward");
  });

  it("preserves composed selection mapping through a failed superseding refresh", async () => {
    const selectedText = "selection";
    const initialFrontText = `A\n${selectedText}`;
    const firstRefreshedFrontText = `BBBB\n${selectedText}`;
    const laterRefreshedFrontText = `CC\n${selectedText}`;
    const initialCard = makeCard(initialFrontText, "Answer", ["grammar"]);
    const firstRefreshedCard = {
      ...makeCard(firstRefreshedFrontText, "Answer", ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const laterRefreshedCard = {
      ...makeCard(laterRefreshedFrontText, "Answer", ["grammar"]),
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    const animationFrames = installAnimationFrameController();
    const initialSelectionStart = initialFrontText.indexOf(selectedText);
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(
        initialSelectionStart,
        initialSelectionStart + selectedText.length,
        "forward",
      );
    });

    mocks.loadCardByIdMock.mockResolvedValue(firstRefreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const firstRestoreId = animationFrames.scheduledIds()[0];
    if (firstRestoreId === undefined) {
      throw new Error("First selection restore was not scheduled");
    }

    mocks.loadCardByIdMock.mockRejectedValueOnce(new Error("refresh unavailable"));
    getAppData().localReadVersion += 1;
    await renderScreen();

    const recoveryRestoreId = animationFrames.scheduledIds().find(
      (animationFrameId) => animationFrameId !== firstRestoreId,
    );
    if (recoveryRestoreId === undefined) {
      throw new Error("Failed-refresh selection recovery was not scheduled");
    }
    expect(animationFrames.cancelledIds()).toContain(firstRestoreId);
    const retryButton = getContainer().querySelector('[data-testid="card-form-refresh-retry"]');
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error("Card form refresh retry button was not found");
    }

    mocks.loadCardByIdMock.mockResolvedValue(laterRefreshedCard);
    await clickElementAsync(retryButton);

    const scheduledRestoreIds = animationFrames.scheduledIds();
    const laterRestoreId = scheduledRestoreIds.find(
      (animationFrameId) => (
        animationFrameId !== firstRestoreId
        && animationFrameId !== recoveryRestoreId
      ),
    );
    if (laterRestoreId === undefined) {
      throw new Error("Later selection restore was not scheduled");
    }
    expect(animationFrames.cancelledIds()).toContain(recoveryRestoreId);

    await animationFrames.flush(laterRestoreId);

    const laterFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
    if (!(laterFrontTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Later refreshed card form front field was not found");
    }
    const laterSelectionStart = laterRefreshedFrontText.indexOf(selectedText);
    expect(laterFrontTextField.value).toBe(laterRefreshedFrontText);
    expect(document.activeElement).toBe(laterFrontTextField);
    expect(laterFrontTextField.selectionStart).toBe(laterSelectionStart);
    expect(laterFrontTextField.selectionEnd).toBe(
      laterSelectionStart + selectedText.length,
    );
    expect(laterFrontTextField.selectionDirection).toBe("forward");

    await animationFrames.flush(recoveryRestoreId);
    await animationFrames.flush(firstRestoreId);
    expect(laterFrontTextField.selectionStart).toBe(laterSelectionStart);
    expect(laterFrontTextField.selectionEnd).toBe(
      laterSelectionStart + selectedText.length,
    );
    expect(laterFrontTextField.selectionDirection).toBe("forward");
  });

  it("does not restore an ordinary textarea selection after blur and missing-card retry", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard("Remotely edited question", "Answer", ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const missingRefresh = createDeferredPromise<Card | null>();
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    const animationFrames = installAnimationFrameController();
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(1, 5, "forward");
    });

    mocks.loadCardByIdMock.mockImplementationOnce(() => missingRefresh.promise);
    getAppData().localReadVersion += 1;
    await renderScreen();
    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      frontTextField.blur();
      missingRefresh.resolve(null);
      await missingRefresh.promise;
    });

    const retryButton = await vi.waitFor(() => {
      expect(document.activeElement).toBe(document.body);
      expect(animationFrames.scheduledIds()).toEqual([]);
      const button = getContainer().querySelector('[data-testid="card-form-refresh-retry"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Card form refresh retry button was not found");
      }
      return button;
    });

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    await act(async () => {
      retryButton.dispatchEvent(new Event("pointerdown", {
        bubbles: true,
        cancelable: true,
      }));
    });
    await clickElementAsync(retryButton);

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(3);
      expect(frontTextField.value).toBe("Remotely edited question");
      expect(getContainer().querySelector('[data-testid="card-form-refresh-error"]')).toBeNull();
    });
    expect(document.activeElement).toBe(document.body);
    expect(animationFrames.scheduledIds()).toEqual([]);
  });

  it("reconciles the outer destination when alt code repeats the stale URL", async () => {
    const pendingUrl = "fcasset:repeated-alt-image?state=pending";
    const readyUrl = "fcasset:repeated-alt-image";
    const altText = `Code \`](${pendingUrl})\` destination`;
    const pendingFrontText = `Question\n\n![${altText}](${pendingUrl})`;
    const readyFrontText = `Question\n\n![${altText}](${readyUrl})`;
    const initialCard = makeCard(pendingFrontText, "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard(readyFrontText, "Answer", ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(refreshedFrontTextField instanceof HTMLTextAreaElement)) {
        throw new Error("Refreshed card form front field was not found");
      }
      expect(refreshedFrontTextField.value).toBe(readyFrontText);
      expect(getContainer().querySelector('[role="alert"]')).toBeNull();
    });

    mocks.updateCardItemMock.mockImplementation(async (
      _cardId: string,
      input: UpdateCardInput,
    ): Promise<Card> => ({
      ...refreshedCard,
      ...input,
    }));
    const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
    if (!(saveButton instanceof HTMLButtonElement)) {
      throw new Error("Card form save button was not found");
    }
    await clickElementAsync(saveButton);

    expect(mocks.updateCardItemMock).toHaveBeenCalledWith("card-media-lifecycle", {
      frontText: readyFrontText,
      backText: "Answer",
      tags: ["grammar"],
    });
  });

  it("preserves exact bytes for explicit-ready and unknown lifecycle states", async () => {
    const pendingFrontText = [
      "Question",
      "",
      "![Diagram][ Generated   Diagram ]",
      "",
      '[generated diagram]: <fcasset:front-image?variant=a&amp;state=pending#front> "Generated title"',
    ].join("\n");
    const readyFrontText = pendingFrontText.replace(
      "fcasset:front-image?variant=a&amp;state=pending#front",
      "fcasset:front-image?variant=a&amp;state=ready#front",
    );
    const failedBackText = 'Answer\n\n![Example](fcasset:back-image?variant=a\\&state=failed#back "Example title")';
    const readyBackText = failedBackText.replace(
      "fcasset:back-image?variant=a\\&state=failed#back",
      "fcasset:back-image?variant=a\\&state=generated#back",
    );
    const initialCard = makeCard(pendingFrontText, failedBackText, ["grammar"]);
    const refreshedCard = {
      ...makeCard(readyFrontText, readyBackText, ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });
    const backTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Card form back field was not found");
    }

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      if (
        !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Refreshed card form fields were not found");
      }
      expect(refreshedFrontTextField.value).toBe(readyFrontText);
      expect(refreshedBackTextField.value).toBe(readyBackText);
      expect(getContainer().querySelector('[role="alert"]')).toBeNull();
    });

    mocks.updateCardItemMock.mockImplementation(async (
      _cardId: string,
      input: UpdateCardInput,
    ): Promise<Card> => ({
      ...refreshedCard,
      ...input,
    }));
    const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
    if (!(saveButton instanceof HTMLButtonElement)) {
      throw new Error("Card form save button was not found");
    }
    await clickElementAsync(saveButton);

    expect(mocks.updateCardItemMock).toHaveBeenCalledWith("card-media-lifecycle", {
      frontText: readyFrontText,
      backText: readyBackText,
      tags: ["grammar"],
    });
  });

});
