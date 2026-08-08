// @vitest-environment jsdom

import { act } from "react";
import { Link } from "react-router";
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

async function renderScreen(): Promise<void> {
  await renderScreenAt("/cards/card-media-lifecycle", null);
}

async function renderCreateScreen(): Promise<void> {
  await renderScreenAt("/cards/new", null);
}

async function renderScreenWithIdentitySwitcher(): Promise<void> {
  await renderScreenAt(
    "/cards/card-media-lifecycle",
    <Link to="/cards/other-card" data-testid="card-form-identity-switch">
      Switch card
    </Link>,
  );
}

describe("CardFormScreen draft and refresh lifecycle", () => {
  it("keeps an initial missing-card load blocking", async () => {
    mocks.loadCardByIdMock.mockResolvedValue(null);

    await renderScreen();

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(1);
      expect(getContainer().querySelector('[data-testid="card-form-load-error"]')?.textContent).toContain(
        "Card not found",
      );
      expect(getContainer().querySelector('[data-testid="card-form-load-retry"]')).toBeInstanceOf(
        HTMLButtonElement,
      );
      expect(getContainer().querySelector('[data-testid="card-form-front-text"]')).toBeNull();
    });
    expect(mocks.showCapturedTechnicalErrorMock).not.toHaveBeenCalled();
  });

  it("preserves a create-card draft through local data refreshes", async () => {
    await renderCreateScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = getContainer().querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Create card front field was not found");
      }
      return field;
    });
    const backTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Create card back field was not found");
    }
    await setTextFieldValueAsync(frontTextField, "Draft question");
    await setTextFieldValueAsync(backTextField, "Draft answer");

    const tagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
    if (!(tagsTrigger instanceof HTMLElement)) {
      throw new Error("Create card tags trigger was not found");
    }
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Create card tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, "draft");
    await act(async () => {
      tagsInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
    });
    await clickElementAsync(tagsTrigger);

    getAppData().localReadVersion += 1;
    await renderCreateScreen();

    await vi.waitFor(() => {
      expect(mocks.loadWorkspaceTagsSummaryMock).toHaveBeenCalledTimes(2);
      expect(frontTextField.value).toBe("Draft question");
      expect(backTextField.value).toBe("Draft answer");
      expect(tagsTrigger.textContent).toContain("draft");
    });
    expect(mocks.loadCardByIdMock).not.toHaveBeenCalled();
  });

  it("preserves an open tag draft through a same-card refresh", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard("Remotely edited question", "Answer", ["grammar", "remote"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const tagsTrigger = await vi.waitFor(() => {
      const trigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Card form tags trigger was not found");
      }
      return trigger;
    });
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, " local-draft ");

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const refreshedTagsTrigger = await vi.waitFor(() => {
      const trigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      const input = document.getElementById("card-form-screen-tags-input");
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Refreshed card form tags trigger was not found");
      }
      if (!(input instanceof HTMLInputElement)) {
        throw new Error("Open tag draft was not preserved through refresh");
      }
      expect(input.value).toBe(" local-draft ");
      expect(trigger.textContent).toContain("remote");
      expect(trigger.textContent).not.toContain("local-draft");
      return trigger;
    });

    const refreshedTagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(refreshedTagsInput instanceof HTMLInputElement)) {
      throw new Error("Refreshed card form tags input was not found");
    }
    await act(async () => {
      refreshedTagsInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }));
    });
    expect(document.getElementById("card-form-screen-tags-input")).toBeNull();
    expect(refreshedTagsTrigger.textContent).toContain("remote");
    expect(refreshedTagsTrigger.textContent).not.toContain("local-draft");

    await clickElementAsync(refreshedTagsTrigger);
    const confirmedTagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(confirmedTagsInput instanceof HTMLInputElement)) {
      throw new Error("Reopened card form tags input was not found");
    }
    await setTextFieldValueAsync(confirmedTagsInput, "local-draft");
    await act(async () => {
      confirmedTagsInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
    });
    await clickElementAsync(refreshedTagsTrigger);

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

    expect(refreshedTagsTrigger.textContent).toContain("local-draft");
    expect(mocks.updateCardItemMock).toHaveBeenCalledWith("card-media-lifecycle", {
      frontText: "Remotely edited question",
      backText: "Answer",
      tags: ["grammar", "remote", "local-draft"],
    });
  });

  it("rebases an untouched open tag selection before saving", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard("Remotely edited question", "Answer", ["grammar", "remote"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const tagsTrigger = await vi.waitFor(() => {
      const trigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Card form tags trigger was not found");
      }
      return trigger;
    });
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, " exact raw draft ");

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(tagsTrigger.textContent).toContain("remote");
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
      frontText: "Remotely edited question",
      backText: "Answer",
      tags: ["grammar", "remote", "exact raw draft"],
    });
  });

  it("rebases locally edited open tags over refreshed parent tags", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar", "keep"]);
    const refreshedCard = {
      ...makeCard(
        "Remotely edited question",
        "Answer",
        ["grammar", "keep", "remote"],
      ),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreen();

    const tagsTrigger = await vi.waitFor(() => {
      const trigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Card form tags trigger was not found");
      }
      return trigger;
    });
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    const grammarTagChip = [...document.querySelectorAll(".tag-input-surface > .tag-chip")]
      .find((tagChip) => (
        tagChip.querySelector(".tag-chip-label")?.textContent === "grammar"
      ));
    const removeGrammarButton = grammarTagChip?.querySelector(".tag-chip-remove");
    if (!(removeGrammarButton instanceof HTMLButtonElement)) {
      throw new Error("Grammar tag remove button was not found");
    }
    await clickElementAsync(removeGrammarButton);
    await setTextFieldValueAsync(tagsInput, "local");
    await act(async () => {
      tagsInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
    });
    await setTextFieldValueAsync(tagsInput, " exact remaining draft ");

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact remaining draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(tagsTrigger.textContent).toContain("grammar");
      expect(tagsTrigger.textContent).toContain("remote");
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
      frontText: "Remotely edited question",
      backText: "Answer",
      tags: ["keep", "remote", "local", "exact remaining draft"],
    });
  });

  it("keeps an open tag draft mounted through a failed background refresh and recovery", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard("Remotely edited question", "Answer", ["grammar", "remote"]),
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
    const tagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
    if (!(tagsTrigger instanceof HTMLElement)) {
      throw new Error("Card form tags trigger was not found");
    }
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, " exact raw draft ");

    mocks.loadCardByIdMock.mockRejectedValueOnce(new Error("refresh unavailable"));
    getAppData().localReadVersion += 1;
    await renderScreen();

    const retryButton = await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      const currentFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const currentTagsInput = document.getElementById("card-form-screen-tags-input");
      const refreshError = getContainer().querySelector('[data-testid="card-form-refresh-error"]');
      const button = getContainer().querySelector('[data-testid="card-form-refresh-retry"]');
      expect(currentFrontTextField).toBe(frontTextField);
      expect(currentTagsInput).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(refreshError?.textContent).toContain("A technical error occurred");
      expect(mocks.showCapturedTechnicalErrorMock).not.toHaveBeenCalled();
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
    expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
    expect(tagsInput.value).toBe(" exact raw draft ");
    expect(document.activeElement).toBe(tagsInput);
    await clickElementAsync(retryButton);

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(3);
      const currentFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const currentTagsInput = document.getElementById("card-form-screen-tags-input");
      const currentTagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      expect(currentFrontTextField).toBe(frontTextField);
      expect(currentTagsInput).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(frontTextField.value).toBe("Remotely edited question");
      expect(currentTagsTrigger?.textContent).toContain("remote");
      expect(getContainer().querySelector('[data-testid="card-form-refresh-error"]')).toBeNull();
      expect(getContainer().querySelector('[data-testid="card-form-refresh-retry"]')).toBeNull();
      expect(mocks.showCapturedTechnicalErrorMock).not.toHaveBeenCalled();
    });
  });

  it("keeps an open tag draft mounted through a missing-card background refresh and recovery", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    const refreshedCard = {
      ...makeCard("Remotely edited question", "Answer", ["grammar", "remote"]),
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
    const tagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
    if (!(tagsTrigger instanceof HTMLElement)) {
      throw new Error("Card form tags trigger was not found");
    }
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, " exact raw draft ");

    mocks.loadCardByIdMock.mockResolvedValueOnce(null);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const retryButton = await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      expect(getContainer().querySelector('[data-testid="card-form-front-text"]')).toBe(frontTextField);
      expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(getContainer().querySelector('[data-testid="card-form-refresh-error"]')?.textContent).toContain(
        "Card not found",
      );
      expect(getContainer().querySelector('[data-testid="card-form-load-error"]')).toBeNull();
      const button = getContainer().querySelector('[data-testid="card-form-refresh-retry"]');
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error("Card form refresh retry button was not found");
      }
      return button;
    });
    expect(mocks.showCapturedTechnicalErrorMock).not.toHaveBeenCalled();

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    await act(async () => {
      retryButton.dispatchEvent(new Event("pointerdown", {
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
    expect(tagsInput.value).toBe(" exact raw draft ");
    expect(document.activeElement).toBe(tagsInput);
    await clickElementAsync(retryButton);

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(3);
      expect(getContainer().querySelector('[data-testid="card-form-front-text"]')).toBe(frontTextField);
      expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(frontTextField.value).toBe("Remotely edited question");
      expect(tagsTrigger.textContent).toContain("remote");
      expect(getContainer().querySelector('[data-testid="card-form-refresh-error"]')).toBeNull();
      expect(getContainer().querySelector('[data-testid="card-form-refresh-retry"]')).toBeNull();
      expect(mocks.showCapturedTechnicalErrorMock).not.toHaveBeenCalled();
    });
  });

  it("discards an open tag draft when the card identity changes", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    const otherCard = {
      ...makeCard("Other question", "Other answer", ["other"]),
      cardId: "other-card",
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreenWithIdentitySwitcher();

    const tagsTrigger = await vi.waitFor(() => {
      const trigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Card form tags trigger was not found");
      }
      return trigger;
    });
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, "discarded-draft");

    mocks.loadCardByIdMock.mockResolvedValue(otherCard);
    const identitySwitcher = getContainer().querySelector('[data-testid="card-form-identity-switch"]');
    if (!(identitySwitcher instanceof HTMLAnchorElement)) {
      throw new Error("Card form identity switch was not found");
    }
    await act(async () => {
      identitySwitcher.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }));
    });

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      const frontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const refreshedTagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (
        !(frontTextField instanceof HTMLTextAreaElement)
        || !(refreshedTagsTrigger instanceof HTMLElement)
      ) {
        throw new Error("Other card form fields were not found");
      }
      expect(frontTextField.value).toBe("Other question");
      expect(refreshedTagsTrigger.textContent).toContain("other");
      expect(refreshedTagsTrigger.textContent).not.toContain("discarded-draft");
    });
    expect(document.getElementById("card-form-screen-tags-input")).toBeNull();
    expect(mocks.updateCardItemMock).not.toHaveBeenCalled();
  });

  it("resets the editor when a different card is missing", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    mocks.loadCardByIdMock.mockResolvedValue(initialCard);

    await renderScreenWithIdentitySwitcher();

    const tagsTrigger = await vi.waitFor(() => {
      const trigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (!(trigger instanceof HTMLElement)) {
        throw new Error("Card form tags trigger was not found");
      }
      return trigger;
    });
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, "discarded-draft");

    mocks.loadCardByIdMock.mockResolvedValue(null);
    const identitySwitcher = getContainer().querySelector('[data-testid="card-form-identity-switch"]');
    if (!(identitySwitcher instanceof HTMLAnchorElement)) {
      throw new Error("Card form identity switch was not found");
    }
    await act(async () => {
      identitySwitcher.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      }));
    });

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      expect(getContainer().querySelector('[data-testid="card-form-load-error"]')?.textContent).toContain(
        "Card not found",
      );
      expect(getContainer().querySelector('[data-testid="card-form-load-retry"]')).toBeInstanceOf(
        HTMLButtonElement,
      );
      expect(getContainer().querySelector('[data-testid="card-form-front-text"]')).toBeNull();
      expect(document.getElementById("card-form-screen-tags-input")).toBeNull();
    });
    expect(tagsInput.isConnected).toBe(false);
    expect(mocks.showCapturedTechnicalErrorMock).not.toHaveBeenCalled();
  });

  it("merges same-card lifecycle refreshes into the draft before saving", async () => {
    const pendingFrontText = 'Question\n\n![Diagram](<fcasset:front-image?variant=large&state=pending#front> "Generated")';
    const failedBackText = 'Answer\n\n![Example](<fcasset:back-image?variant=large&state=failed#back> "Generated")';
    const readyFrontText = 'Question\n\n![Diagram](<fcasset:front-image?variant=large#front> "Generated")';
    const readyBackText = 'Answer\n\n![Example](<fcasset:back-image?variant=large#back> "Generated")';
    const initialCard = makeCard(pendingFrontText, failedBackText, ["grammar"]);
    const refreshedCard = {
      ...makeCard(
        readyFrontText.replace("Question", "Remotely edited question"),
        readyBackText.replace("Answer", "Remotely edited answer"),
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

    const editedFrontText = pendingFrontText.replace("Question", "Edited question");
    await setTextFieldValueAsync(frontTextField, editedFrontText);

    const tagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
    if (!(tagsTrigger instanceof HTMLElement)) {
      throw new Error("Card form tags trigger was not found");
    }
    await clickElementAsync(tagsTrigger);
    const tagsInput = document.getElementById("card-form-screen-tags-input");
    if (!(tagsInput instanceof HTMLInputElement)) {
      throw new Error("Card form tags input was not found");
    }
    await setTextFieldValueAsync(tagsInput, "local");
    await act(async () => {
      tagsInput.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }));
    });
    await clickElementAsync(tagsTrigger);

    const selectedText = "Generated";
    const selectionStart = editedFrontText.indexOf(selectedText);
    await act(async () => {
      frontTextField.focus();
      frontTextField.setSelectionRange(
        selectionStart,
        selectionStart + selectedText.length,
        "forward",
      );
    });

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    const reconciledFrontText = readyFrontText.replace("Question", "Edited question");
    const reconciledBackText = readyBackText.replace("Answer", "Remotely edited answer");
    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      const refreshedFrontTextField = getContainer().querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = getContainer().querySelector('[data-testid="card-form-back-text"]');
      const refreshedTagsTrigger = getContainer().querySelector('[data-testid="card-form-tags-trigger"]');
      if (
        !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
        || !(refreshedTagsTrigger instanceof HTMLElement)
      ) {
        throw new Error("Refreshed card form fields were not found");
      }
      expect(refreshedFrontTextField.value).toBe(reconciledFrontText);
      expect(refreshedBackTextField.value).toBe(reconciledBackText);
      expect(refreshedTagsTrigger.textContent).toContain("local");
      expect(refreshedTagsTrigger.textContent).not.toContain("remote");
      const reconciledSelectionStart = reconciledFrontText.indexOf(selectedText);
      expect(document.activeElement).toBe(refreshedFrontTextField);
      expect(refreshedFrontTextField.selectionStart).toBe(reconciledSelectionStart);
      expect(refreshedFrontTextField.selectionEnd).toBe(
        reconciledSelectionStart + selectedText.length,
      );
      expect(refreshedFrontTextField.selectionDirection).toBe("forward");
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
      frontText: reconciledFrontText,
      backText: reconciledBackText,
      tags: ["grammar", "local"],
    });
  });

  it("ignores a pre-save background load after a successful same-form save", async () => {
    const initialCard = makeCard("Question", "Answer", ["grammar"]);
    const staleLoadedCard = {
      ...makeCard("Stale remote question", "Answer", ["grammar", "stale"]),
      updatedAt: "2026-03-10T10:00:00.000Z",
    };
    const savedCard = {
      ...makeCard("Saved question", "Answer", ["grammar"]),
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    const laterRefreshedCard = {
      ...makeCard("Later remote question", "Answer", ["grammar", "later"]),
      updatedAt: "2026-03-10T12:00:00.000Z",
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
    await setTextFieldValueAsync(frontTextField, "Saved question");

    const staleLoad = createDeferredPromise<Card>();
    mocks.loadCardByIdMock.mockImplementationOnce(() => staleLoad.promise);
    getAppData().localReadVersion += 1;
    await renderScreen();
    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
    });

    mocks.updateCardItemMock.mockResolvedValue(savedCard);
    const aiButton = getContainer().querySelector('[data-testid="card-form-edit-with-ai"]');
    if (!(aiButton instanceof HTMLButtonElement)) {
      throw new Error("Card form Edit with AI button was not found");
    }
    await clickElementAsync(aiButton);

    await vi.waitFor(() => {
      expect(mocks.updateCardItemMock).toHaveBeenCalledWith("card-media-lifecycle", {
        frontText: "Saved question",
        backText: "Answer",
        tags: ["grammar"],
      });
      expect(mocks.handoffCardToAiMock).toHaveBeenCalledWith(savedCard);
      expect(frontTextField.value).toBe("Saved question");
    });

    await act(async () => {
      staleLoad.resolve(staleLoadedCard);
      await staleLoad.promise;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(frontTextField.value).toBe("Saved question");
    expect(getContainer().querySelector('[data-testid="card-form-tags-trigger"]')?.textContent).not.toContain("stale");

    mocks.loadCardByIdMock.mockResolvedValue(laterRefreshedCard);
    getAppData().localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(3);
      expect(frontTextField.value).toBe("Later remote question");
      expect(getContainer().querySelector('[data-testid="card-form-tags-trigger"]')?.textContent).toContain("later");
    });
  });

});
