// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Card, UpdateCardInput } from "../../../types";
import {
  clickElementAsync,
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

async function renderScreen(): Promise<void> {
  await renderScreenAt("/cards/card-media-lifecycle", null);
}

describe("CardFormScreen lifecycle conflicts", () => {
  it("retains dormant lifecycle conflicts after a failed save", async () => {
    const pendingReference = "![Diagram](fcasset:failed-save-image?state=pending)";
    const readyReference = "![Diagram](fcasset:failed-save-image)";
    const pendingFrontText = `Question\n\n${pendingReference}`;
    const readyFrontText = `Question\n\n${readyReference}`;
    const initialCard = makeCard(pendingFrontText, "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard(readyFrontText, "Answer", ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const controls = await vi.waitFor(() => {
      const frontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const backTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      if (
        !(frontTextField instanceof HTMLTextAreaElement)
        || !(backTextField instanceof HTMLTextAreaElement)
        || !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Card form controls were not found");
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
    mocks.updateCardItemMock.mockRejectedValue(new Error("save unavailable"));
    await clickElementAsync(controls.saveButton);

    await vi.waitFor(() => {
      expect(mocks.updateCardItemMock).toHaveBeenCalledTimes(1);
    });

    const pastedBackText = `Edited answer\n\n${pendingReference}`;
    await setTextFieldValueAsync(controls.backTextField, pastedBackText);

    await vi.waitFor(() => {
      expect(getContainer().querySelector('[role="alert"]')?.textContent).toContain("A managed image changed");
      expect(controls.saveButton.disabled).toBe(true);
      expect(controls.aiButton.disabled).toBe(true);
    });
    await clickElementAsync(controls.saveButton);
    await clickElementAsync(controls.aiButton);
    expect(mocks.updateCardItemMock).toHaveBeenCalledTimes(1);
    expect(mocks.handoffCardToAiMock).not.toHaveBeenCalled();
  });

  it("retains dormant lifecycle conflicts after a failed Edit with AI handoff", async () => {
    const pendingReference = "![Diagram](fcasset:failed-handoff-image?state=pending)";
    const readyReference = "![Diagram](fcasset:failed-handoff-image?state=ready)";
    const pendingFrontText = `Question\n\n${pendingReference}`;
    const readyFrontText = `Question\n\n${readyReference}`;
    const initialCard = makeCard(pendingFrontText, "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard(readyFrontText, "Answer", ["grammar"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const controls = await vi.waitFor(() => {
      const frontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const backTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      if (
        !(frontTextField instanceof HTMLTextAreaElement)
        || !(backTextField instanceof HTMLTextAreaElement)
        || !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
      ) {
        throw new Error("Card form controls were not found");
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
    mocks.updateCardItemMock.mockImplementation(async (
      _cardId: string,
      input: UpdateCardInput,
    ): Promise<Card> => ({
      ...refreshedCard,
      ...input,
    }));
    mocks.handoffCardToAiMock.mockResolvedValue(false);
    await clickElementAsync(controls.aiButton);

    await vi.waitFor(() => {
      expect(mocks.updateCardItemMock).toHaveBeenCalledTimes(1);
      expect(mocks.handoffCardToAiMock).toHaveBeenCalledTimes(1);
    });

    await setTextFieldValueAsync(
      controls.backTextField,
      `Edited answer\n\n${pendingReference}`,
    );
    await vi.waitFor(() => {
      expect(getContainer().querySelector('[role="alert"]')?.textContent).toContain("A managed image changed");
      expect(controls.saveButton.disabled).toBe(true);
      expect(controls.aiButton.disabled).toBe(true);
    });

    await clickElementAsync(controls.saveButton);
    await clickElementAsync(controls.aiButton);
    expect(mocks.updateCardItemMock).toHaveBeenCalledTimes(1);
    expect(mocks.handoffCardToAiMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a stale duplicate blocked after safely replacing another occurrence", async () => {
    const pendingReference = "![Diagram](fcasset:duplicate-image?state=pending)";
    const readyReference = "![Diagram](fcasset:duplicate-image)";
    const pendingFrontText = `Question\n\n${pendingReference}`;
    const readyFrontText = `Question\n\n${readyReference}`;
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
      return field;
    });
    const backTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Card form back field was not found");
    }
    const copiedBackText = `Answer\n\n${pendingReference}`;
    await setTextFieldValueAsync(backTextField, copiedBackText);

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const controls = await vi.waitFor(() => {
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      if (
        !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
        || !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Card form submission controls were not found");
      }
      expect(refreshedFrontTextField.value).toBe(readyFrontText);
      expect(refreshedBackTextField.value).toBe(copiedBackText);
      expect(getContainer().querySelector('[role="alert"]')).not.toBeNull();
      expect(saveButton.disabled).toBe(true);
      expect(aiButton.disabled).toBe(true);
      return {
        aiButton,
        backTextField: refreshedBackTextField,
        saveButton,
      };
    });

    await setTextFieldValueAsync(controls.backTextField, "Answer while the stale copy is cut");
    await vi.waitFor(() => {
      expect(getContainer().querySelector('[role="alert"]')).toBeNull();
      expect(controls.saveButton.disabled).toBe(false);
      expect(controls.aiButton.disabled).toBe(false);
    });

    const pastedBackText = `Answer after paste\n\n${pendingReference}`;
    await setTextFieldValueAsync(controls.backTextField, pastedBackText);
    await vi.waitFor(() => {
      expect(getContainer().querySelector('[role="alert"]')).not.toBeNull();
      expect(controls.saveButton.disabled).toBe(true);
      expect(controls.aiButton.disabled).toBe(true);
    });
    await clickElementAsync(controls.saveButton);
    await clickElementAsync(controls.aiButton);
    expect(mocks.updateCardItemMock).not.toHaveBeenCalled();
    expect(mocks.handoffCardToAiMock).not.toHaveBeenCalled();
  });

  it("blocks lifecycle replacement through shared or ambiguous definitions", async () => {
    const selectionText = "Selection anchor";
    const initialBackText = `Answer A\n\n${selectionText}`;
    const refreshedBackText = `Answer B\n\n${selectionText}`;
    const laterBackText = `Answer C\n\n${selectionText}`;
    const pendingFrontText = [
      "Question",
      "",
      "![First diagram][shared image]",
      "",
      "![Second diagram][SHARED   IMAGE]",
      "",
      "[Related link][shared image]",
      "",
      '[shared image]: <fcasset:shared-image?state=pending> "Shared title"',
      '[SHARED IMAGE]: <fcasset:unused-image?state=pending> "Duplicate definition"',
    ].join("\n");
    const readyFrontText = pendingFrontText.replace(
      "fcasset:shared-image?state=pending",
      "fcasset:shared-image",
    );
    const initialCard = makeCard(pendingFrontText, initialBackText, ["grammar"]);
    const refreshedCard = {
      ...makeCard(readyFrontText, refreshedBackText, ["grammar", "remote-b"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const laterRefreshedCard = {
      ...makeCard(readyFrontText, laterBackText, ["grammar", "remote-c"]),
      updatedAt: "2026-03-10T11:00:00.000Z",
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
    const editedFrontText = pendingFrontText.replace("Question", "Locally edited question");
    await setTextFieldValueAsync(frontTextField, editedFrontText);
    const backTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Card form back field was not found");
    }
    const selectionStart = initialBackText.indexOf(selectionText);
    await act(async () => {
      backTextField.focus();
      backTextField.setSelectionRange(
        selectionStart,
        selectionStart + selectionText.length,
        "backward",
      );
    });

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      const tagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (
        !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Refreshed card form fields were not found");
      }
      expect(refreshedFrontTextField.value).toBe(editedFrontText);
      expect(refreshedBackTextField.value).toBe(refreshedBackText);
      expect(tagsTrigger?.textContent).toContain("remote-b");
      expect(getContainer().querySelector('[role="alert"]')).not.toBeNull();
      expect(saveButton).toBeInstanceOf(HTMLButtonElement);
      expect(aiButton).toBeInstanceOf(HTMLButtonElement);
      expect((saveButton as HTMLButtonElement).disabled).toBe(true);
      expect((aiButton as HTMLButtonElement).disabled).toBe(true);
      const refreshedSelectionStart = refreshedBackText.indexOf(selectionText);
      expect(document.activeElement).toBe(refreshedBackTextField);
      expect(refreshedBackTextField.selectionStart).toBe(refreshedSelectionStart);
      expect(refreshedBackTextField.selectionEnd).toBe(
        refreshedSelectionStart + selectionText.length,
      );
      expect(refreshedBackTextField.selectionDirection).toBe("backward");
      return {
        backTextField: refreshedBackTextField,
        frontTextField: refreshedFrontTextField,
      };
    });

    mocks.loadCardByIdMock.mockResolvedValue(laterRefreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const laterFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const laterBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      const tagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (
        !(laterFrontTextField instanceof HTMLTextAreaElement)
        || !(laterBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Later refreshed card form fields were not found");
      }
      expect(laterFrontTextField.value).toBe(editedFrontText);
      expect(laterBackTextField.value).toBe(laterBackText);
      expect(tagsTrigger?.textContent).toContain("remote-c");
      expect(getContainer().querySelector('[role="alert"]')).not.toBeNull();
      expect(saveButton).toBeInstanceOf(HTMLButtonElement);
      expect(aiButton).toBeInstanceOf(HTMLButtonElement);
      expect((saveButton as HTMLButtonElement).disabled).toBe(true);
      expect((aiButton as HTMLButtonElement).disabled).toBe(true);
      const refreshedSelectionStart = laterBackText.indexOf(selectionText);
      expect(document.activeElement).toBe(laterBackTextField);
      expect(laterBackTextField.selectionStart).toBe(refreshedSelectionStart);
      expect(laterBackTextField.selectionEnd).toBe(
        refreshedSelectionStart + selectionText.length,
      );
      expect(laterBackTextField.selectionDirection).toBe("backward");
    });
    expect(mocks.updateCardItemMock).not.toHaveBeenCalled();
    expect(mocks.handoffCardToAiMock).not.toHaveBeenCalled();
  });

  it("blocks reconciliation when non-lifecycle query bytes also change", async () => {
    const pendingFrontText = 'Question\n\n![Diagram](<fcasset:front-image?variant=a+b&&state=pending&variant=%2f#front> "Generated")';
    const readyFrontText = 'Question\n\n![Diagram](<fcasset:front-image?variant=a%20b&&variant=%2F#front> "Generated")';
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
    const editedFrontText = pendingFrontText.replace("Question", "Locally edited question");
    await setTextFieldValueAsync(frontTextField, editedFrontText);

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const alert = getContainer().querySelector('[role="alert"]');
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      expect(alert?.textContent).toContain("A managed image changed");
      expect(saveButton).toBeInstanceOf(HTMLButtonElement);
      expect(aiButton).toBeInstanceOf(HTMLButtonElement);
      expect((saveButton as HTMLButtonElement).disabled).toBe(true);
      expect((aiButton as HTMLButtonElement).disabled).toBe(true);
      expect(frontTextField.value).toBe(editedFrontText);
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteCardItemMock.mockRejectedValue(new Error("delete unavailable"));
    const deleteButton = getContainer().querySelector('[data-testid="card-form-delete"]');
    if (!(deleteButton instanceof HTMLButtonElement)) {
      throw new Error("Card form delete button was not found");
    }
    await clickElementAsync(deleteButton);

    await vi.waitFor(() => {
      expect(mocks.deleteCardItemMock).toHaveBeenCalledWith("card-media-lifecycle");
      expect(mocks.showCapturedTechnicalErrorMock).toHaveBeenCalledTimes(1);
      const lifecycleAlert = getContainer().querySelector('[data-testid="card-form-lifecycle-conflict"]');
      const actionAlert = getContainer().querySelector('[data-testid="card-form-action-error"]');
      expect(lifecycleAlert?.textContent).toContain("A managed image changed");
      expect(actionAlert?.textContent).toBe(
        "A technical error occurred. Try again or restart the app.",
      );
      expect(getContainer().querySelectorAll('[role="alert"]')).toHaveLength(2);
    });
  });

  it("blocks save and AI handoff when a stale reference moves between card sides", async () => {
    const pendingReference = "![Diagram](fcasset:front-image?state=pending)";
    const pendingFrontText = `Question\n\n${pendingReference}`;
    const readyFrontText = "Question\n\n![Diagram](fcasset:front-image)";
    const initialCard = makeCard(pendingFrontText, "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard(
        readyFrontText.replace("Question", "Remotely edited question"),
        "Answer",
        ["grammar", "remote"],
      ),
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
    const movedStaleReference = '![Moved diagram](<fcasset:front-image?quality=full&state=pending#back> "Moved title")';
    const movedFrontText = "Edited question after moving the outdated reference";
    const movedBackText = `Edited answer\n\n${movedStaleReference}`;
    await setTextFieldValueAsync(backTextField, movedBackText);
    await setTextFieldValueAsync(frontTextField, movedFrontText);

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const conflictMessage = "A managed image changed while this card was open. Remove or edit the outdated pending or failed image reference before saving or using Edit with AI.";
    const initiallyBlockedControls = await vi.waitFor(() => {
      const alert = getContainer().querySelector('[role="alert"]');
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      if (
        !(alert instanceof HTMLElement)
        || !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
        || !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Blocked card form controls were not found");
      }
      expect(alert.textContent).toBe(conflictMessage);
      expect(saveButton.disabled).toBe(true);
      expect(aiButton.disabled).toBe(true);
      expect(refreshedFrontTextField.value).toBe(movedFrontText);
      expect(refreshedBackTextField.value).toBe(movedBackText);
      return {
        aiButton,
        backTextField: refreshedBackTextField,
        frontTextField: refreshedFrontTextField,
        saveButton,
      };
    });

    await clickElementAsync(initiallyBlockedControls.saveButton);
    await clickElementAsync(initiallyBlockedControls.aiButton);
    expect(mocks.updateCardItemMock).not.toHaveBeenCalled();
    expect(mocks.handoffCardToAiMock).not.toHaveBeenCalled();

    const cutBackText = "Edited answer while the outdated reference is cut";
    await setTextFieldValueAsync(initiallyBlockedControls.backTextField, cutBackText);

    await vi.waitFor(() => {
      expect(getContainer().querySelector('[role="alert"]')).toBeNull();
      expect(initiallyBlockedControls.saveButton.disabled).toBe(false);
      expect(initiallyBlockedControls.aiButton.disabled).toBe(false);
    });

    const pastedStaleReference = '![Pasted diagram](<fcasset:front-image?quality=compact&state=pending#pasted> "Pasted title")';
    const pastedBackText = `${cutBackText}\n\n${pastedStaleReference}`;
    await setTextFieldValueAsync(initiallyBlockedControls.backTextField, pastedBackText);

    await vi.waitFor(() => {
      expect(getContainer().querySelector('[role="alert"]')?.textContent).toBe(conflictMessage);
      expect(initiallyBlockedControls.saveButton.disabled).toBe(true);
      expect(initiallyBlockedControls.aiButton.disabled).toBe(true);
    });

    const laterRefreshedCard = {
      ...refreshedCard,
      backText: "Remotely edited answer",
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(laterRefreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const blockedControls = await vi.waitFor(() => {
      const alert = getContainer().querySelector('[role="alert"]');
      const saveButton = getContainer().querySelector('[data-testid="card-form-save"]');
      const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
      const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      if (
        !(alert instanceof HTMLElement)
        || !(saveButton instanceof HTMLButtonElement)
        || !(aiButton instanceof HTMLButtonElement)
        || !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Card form controls were not found after the later refresh");
      }
      expect(alert.textContent).toBe(conflictMessage);
      expect(saveButton.disabled).toBe(true);
      expect(aiButton.disabled).toBe(true);
      expect(refreshedFrontTextField.value).toBe(movedFrontText);
      expect(refreshedBackTextField.value).toBe(pastedBackText);
      return {
        aiButton,
        backTextField: refreshedBackTextField,
        saveButton,
      };
    });

    await clickElementAsync(blockedControls.saveButton);
    await clickElementAsync(blockedControls.aiButton);
    expect(mocks.updateCardItemMock).not.toHaveBeenCalled();
    expect(mocks.handoffCardToAiMock).not.toHaveBeenCalled();

    const resolvedBackText = "Edited answer without the outdated reference";
    await setTextFieldValueAsync(blockedControls.backTextField, resolvedBackText);

    await vi.waitFor(() => {
      expect(getContainer().querySelector('[role="alert"]')).toBeNull();
      expect(blockedControls.saveButton.disabled).toBe(false);
      expect(blockedControls.aiButton.disabled).toBe(false);
    });

    mocks.updateCardItemMock.mockImplementation(async (
      _cardId: string,
      input: UpdateCardInput,
    ): Promise<Card> => ({
      ...laterRefreshedCard,
      ...input,
    }));
    await clickElementAsync(blockedControls.aiButton);

    expect(mocks.updateCardItemMock).toHaveBeenCalledWith("card-media-lifecycle", {
      frontText: movedFrontText,
      backText: resolvedBackText,
      tags: ["grammar", "remote"],
    });
    expect(mocks.handoffCardToAiMock).toHaveBeenCalledTimes(1);
  });
});
