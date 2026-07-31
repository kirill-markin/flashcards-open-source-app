// @vitest-environment jsdom

import { act } from "react";
import ReactDOM from "react-dom/client";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStorageMock } from "../../../api/ApiTestSupport";
import { I18nProvider } from "../../../i18n";
import type { Card, UpdateCardInput } from "../../../types";

const mocks = vi.hoisted(() => ({
  deleteCardItemMock: vi.fn(),
  handoffCardToAiMock: vi.fn(),
  loadCardByIdMock: vi.fn(),
  loadMediaAssetRecordMock: vi.fn(),
  loadMediaBlobCacheRecordMock: vi.fn(),
  loadMediaUploadTransfersForWorkspaceMediaAssetsMock: vi.fn(),
  loadWorkspaceTagsSummaryMock: vi.fn(),
  markMediaUploadTransferDueForRetryMock: vi.fn(),
  showCapturedTechnicalErrorMock: vi.fn(),
  updateCardItemMock: vi.fn(),
  useAppDataMock: vi.fn(),
  writeMediaBlobCacheRecordMock: vi.fn(),
}));

vi.mock("../../../appData", () => ({
  useAppData: mocks.useAppDataMock,
}));

vi.mock("../../../appError/AppErrorContext", () => ({
  useAppErrorDialog: () => ({
    showCapturedTechnicalError: mocks.showCapturedTechnicalErrorMock,
  }),
}));

vi.mock("../../../chat/handoff/useAiCardHandoff", () => ({
  useAiCardHandoff: () => mocks.handoffCardToAiMock,
}));

vi.mock("../../../localDb/cards/cards", () => ({
  loadCardById: mocks.loadCardByIdMock,
}));

vi.mock("../../../localDb/cards/workspace", () => ({
  loadWorkspaceTagsSummary: mocks.loadWorkspaceTagsSummaryMock,
}));

vi.mock("../../../localDb/mediaAssets", () => ({
  loadMediaAssetRecord: mocks.loadMediaAssetRecordMock,
}));

vi.mock("../../../localDb/mediaTransfers", () => ({
  loadMediaBlobCacheRecord: mocks.loadMediaBlobCacheRecordMock,
  loadMediaUploadTransfersForWorkspaceMediaAssets: mocks.loadMediaUploadTransfersForWorkspaceMediaAssetsMock,
  markMediaUploadTransferDueForRetry: mocks.markMediaUploadTransferDueForRetryMock,
  writeMediaBlobCacheRecord: mocks.writeMediaBlobCacheRecordMock,
}));

import { CardFormScreen } from "./CardFormScreen";

type MutableCardFormScreenAppData = {
  activeWorkspace: Readonly<{
    workspaceId: string;
    name: string;
    createdAt: string;
    isSelected: boolean;
  }>;
  cloudSettings: null;
  createCardItem: ReturnType<typeof vi.fn>;
  deleteCardItem: ReturnType<typeof vi.fn>;
  localReadVersion: number;
  runMediaUploadTransfers: ReturnType<typeof vi.fn>;
  session: null;
  setErrorMessage: ReturnType<typeof vi.fn>;
  updateCardItem: ReturnType<typeof vi.fn>;
};

function makeCard(frontText: string, backText: string, tags: ReadonlyArray<string>): Card {
  const timestamp = "2026-03-10T09:00:00.000Z";
  return {
    cardId: "card-media-lifecycle",
    frontText,
    backText,
    cardType: "basic",
    metadata: {
      version: 1,
      source: null,
    },
    tags,
    dueAt: null,
    createdAt: timestamp,
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: timestamp,
    lastModifiedByReplicaId: "device-1",
    lastOperationId: "operation-1",
    updatedAt: timestamp,
    deletedAt: null,
  };
}

function setTextFieldValue(field: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = field instanceof HTMLInputElement
    ? HTMLInputElement.prototype
    : HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

async function setTextFieldValueAsync(
  field: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  await act(async () => {
    setTextFieldValue(field, value);
  });
}

async function clickElementAsync(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

type DeferredPromise<Result> = Readonly<{
  promise: Promise<Result>;
  resolve: (value: Result) => void;
}>;

function createDeferredPromise<Result>(): DeferredPromise<Result> {
  let resolvePromise: ((value: Result) => void) | null = null;
  const promise = new Promise<Result>((resolve) => {
    resolvePromise = (value: Result): void => {
      resolve(value);
    };
  });
  if (resolvePromise === null) {
    throw new Error("Deferred promise resolver was not initialized");
  }

  return {
    promise,
    resolve: resolvePromise,
  };
}

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

describe("CardFormScreen generated-media lifecycle refresh", () => {
  let appData: MutableCardFormScreenAppData;
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

    mocks.deleteCardItemMock.mockReset();
    mocks.handoffCardToAiMock.mockReset();
    mocks.loadCardByIdMock.mockReset();
    mocks.loadMediaAssetRecordMock.mockReset();
    mocks.loadMediaBlobCacheRecordMock.mockReset();
    mocks.loadMediaUploadTransfersForWorkspaceMediaAssetsMock.mockReset();
    mocks.loadWorkspaceTagsSummaryMock.mockReset();
    mocks.markMediaUploadTransferDueForRetryMock.mockReset();
    mocks.showCapturedTechnicalErrorMock.mockReset();
    mocks.updateCardItemMock.mockReset();
    mocks.useAppDataMock.mockReset();
    mocks.writeMediaBlobCacheRecordMock.mockReset();
    mocks.loadMediaAssetRecordMock.mockResolvedValue(null);
    mocks.handoffCardToAiMock.mockResolvedValue(true);
    mocks.loadMediaUploadTransfersForWorkspaceMediaAssetsMock.mockResolvedValue([]);
    mocks.loadWorkspaceTagsSummaryMock.mockResolvedValue({
      tags: [{ tag: "grammar", cardsCount: 1 }],
      totalCards: 1,
    });

    appData = {
      activeWorkspace: {
        workspaceId: "workspace-1",
        name: "Workspace",
        createdAt: "2026-03-10T09:00:00.000Z",
        isSelected: true,
      },
      cloudSettings: null,
      createCardItem: vi.fn(),
      deleteCardItem: mocks.deleteCardItemMock,
      localReadVersion: 0,
      runMediaUploadTransfers: vi.fn(),
      session: null,
      setErrorMessage: vi.fn(),
      updateCardItem: mocks.updateCardItemMock,
    };
    mocks.useAppDataMock.mockImplementation(() => appData);

    container = document.createElement("div");
    document.body.append(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderScreenAt(initialEntry: string): Promise<void> {
    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/cards/new" element={<CardFormScreen />} />
              <Route path="/cards/:cardId" element={<CardFormScreen />} />
              <Route path="/cards" element={<div />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
  }

  async function renderScreen(): Promise<void> {
    await renderScreenAt("/cards/card-media-lifecycle");
  }

  async function renderScreenWithIdentitySwitcher(): Promise<void> {
    await act(async () => {
      root.render(
        <I18nProvider>
          <MemoryRouter initialEntries={["/cards/card-media-lifecycle"]}>
            <Link to="/cards/other-card" data-testid="card-form-identity-switch">
              Switch card
            </Link>
            <Routes>
              <Route path="/cards/:cardId" element={<CardFormScreen />} />
            </Routes>
          </MemoryRouter>
        </I18nProvider>,
      );
    });
  }

  async function renderCreateScreen(): Promise<void> {
    await renderScreenAt("/cards/new");
  }

  it("keeps an initial missing-card load blocking", async () => {
    mocks.loadCardByIdMock.mockResolvedValue(null);

    await renderScreen();

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(1);
      expect(container.querySelector('[data-testid="card-form-load-error"]')?.textContent).toContain(
        "Card not found",
      );
      expect(container.querySelector('[data-testid="card-form-load-retry"]')).toBeInstanceOf(
        HTMLButtonElement,
      );
      expect(container.querySelector('[data-testid="card-form-front-text"]')).toBeNull();
    });
    expect(mocks.showCapturedTechnicalErrorMock).not.toHaveBeenCalled();
  });

  it("preserves a create-card draft through local data refreshes", async () => {
    await renderCreateScreen();

    const frontTextField = await vi.waitFor(() => {
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Create card front field was not found");
      }
      return field;
    });
    const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Create card back field was not found");
    }
    await setTextFieldValueAsync(frontTextField, "Draft question");
    await setTextFieldValueAsync(backTextField, "Draft answer");

    const tagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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

    appData.localReadVersion += 1;
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
      const trigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const refreshedTagsTrigger = await vi.waitFor(() => {
      const trigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    const saveButton = container.querySelector('[data-testid="card-form-save"]');
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
      const trigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    appData.localReadVersion += 1;
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
    const saveButton = container.querySelector('[data-testid="card-form-save"]');
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
      const trigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    appData.localReadVersion += 1;
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
    const saveButton = container.querySelector('[data-testid="card-form-save"]');
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    const tagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const retryButton = await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      const currentFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const currentTagsInput = document.getElementById("card-form-screen-tags-input");
      const refreshError = container.querySelector('[data-testid="card-form-refresh-error"]');
      const button = container.querySelector('[data-testid="card-form-refresh-retry"]');
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
      const currentFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const currentTagsInput = document.getElementById("card-form-screen-tags-input");
      const currentTagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
      expect(currentFrontTextField).toBe(frontTextField);
      expect(currentTagsInput).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(frontTextField.value).toBe("Remotely edited question");
      expect(currentTagsTrigger?.textContent).toContain("remote");
      expect(container.querySelector('[data-testid="card-form-refresh-error"]')).toBeNull();
      expect(container.querySelector('[data-testid="card-form-refresh-retry"]')).toBeNull();
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    const tagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const retryButton = await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      expect(container.querySelector('[data-testid="card-form-front-text"]')).toBe(frontTextField);
      expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(container.querySelector('[data-testid="card-form-refresh-error"]')?.textContent).toContain(
        "Card not found",
      );
      expect(container.querySelector('[data-testid="card-form-load-error"]')).toBeNull();
      const button = container.querySelector('[data-testid="card-form-refresh-retry"]');
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
      expect(container.querySelector('[data-testid="card-form-front-text"]')).toBe(frontTextField);
      expect(document.getElementById("card-form-screen-tags-input")).toBe(tagsInput);
      expect(tagsInput.value).toBe(" exact raw draft ");
      expect(document.activeElement).toBe(tagsInput);
      expect(frontTextField.value).toBe("Remotely edited question");
      expect(tagsTrigger.textContent).toContain("remote");
      expect(container.querySelector('[data-testid="card-form-refresh-error"]')).toBeNull();
      expect(container.querySelector('[data-testid="card-form-refresh-retry"]')).toBeNull();
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
      const trigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    const identitySwitcher = container.querySelector('[data-testid="card-form-identity-switch"]');
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
      const frontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const refreshedTagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
      const trigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    const identitySwitcher = container.querySelector('[data-testid="card-form-identity-switch"]');
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
      expect(container.querySelector('[data-testid="card-form-load-error"]')?.textContent).toContain(
        "Card not found",
      );
      expect(container.querySelector('[data-testid="card-form-load-retry"]')).toBeInstanceOf(
        HTMLButtonElement,
      );
      expect(container.querySelector('[data-testid="card-form-front-text"]')).toBeNull();
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });
    const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Card form back field was not found");
    }

    const editedFrontText = pendingFrontText.replace("Question", "Edited question");
    await setTextFieldValueAsync(frontTextField, editedFrontText);

    const tagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const reconciledFrontText = readyFrontText.replace("Question", "Edited question");
    const reconciledBackText = readyBackText.replace("Answer", "Remotely edited answer");
    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
      const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
      const refreshedTagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
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
    const saveButton = container.querySelector('[data-testid="card-form-save"]');
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    await setTextFieldValueAsync(frontTextField, "Saved question");

    const staleLoad = createDeferredPromise<Card>();
    mocks.loadCardByIdMock.mockImplementationOnce(() => staleLoad.promise);
    appData.localReadVersion += 1;
    await renderScreen();
    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(2);
    });

    mocks.updateCardItemMock.mockResolvedValue(savedCard);
    const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
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
    expect(container.querySelector('[data-testid="card-form-tags-trigger"]')?.textContent).not.toContain("stale");

    mocks.loadCardByIdMock.mockResolvedValue(laterRefreshedCard);
    appData.localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      expect(mocks.loadCardByIdMock).toHaveBeenCalledTimes(3);
      expect(frontTextField.value).toBe("Later remote question");
      expect(container.querySelector('[data-testid="card-form-tags-trigger"]')?.textContent).toContain("later");
    });
  });

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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const restoreId = animationFrames.scheduledIds()[0];
    if (restoreId === undefined) {
      throw new Error("Multiple-replacement selection restore was not scheduled");
    }
    await animationFrames.flush(restoreId);

    const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const restoreId = animationFrames.scheduledIds()[0];
    if (restoreId === undefined) {
      throw new Error("Definition-backed selection restore was not scheduled");
    }
    await animationFrames.flush(restoreId);

    const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
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
    expect(container.querySelector('[role="alert"]')).toBeNull();
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const frontRestoreId = animationFrames.scheduledIds()[0];
    if (frontRestoreId === undefined) {
      throw new Error("Front selection restore was not scheduled");
    }
    await animationFrames.flush(frontRestoreId);

    const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
    const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const backRestoreId = animationFrames.scheduledIds()[0];
    if (backRestoreId === undefined) {
      throw new Error("Back selection restore was not scheduled");
    }
    await animationFrames.flush(backRestoreId);

    const refreshedBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const firstRestoreId = animationFrames.scheduledIds()[0];
    if (firstRestoreId === undefined) {
      throw new Error("First selection restore was not scheduled");
    }

    mocks.loadCardByIdMock.mockRejectedValueOnce(new Error("refresh unavailable"));
    appData.localReadVersion += 1;
    await renderScreen();

    const recoveryRestoreId = animationFrames.scheduledIds().find(
      (animationFrameId) => animationFrameId !== firstRestoreId,
    );
    if (recoveryRestoreId === undefined) {
      throw new Error("Failed-refresh selection recovery was not scheduled");
    }
    expect(animationFrames.cancelledIds()).toContain(firstRestoreId);
    const retryButton = container.querySelector('[data-testid="card-form-refresh-retry"]');
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

    const laterFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
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
    appData.localReadVersion += 1;
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
      const button = container.querySelector('[data-testid="card-form-refresh-retry"]');
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
      expect(container.querySelector('[data-testid="card-form-refresh-error"]')).toBeNull();
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    appData.localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(refreshedFrontTextField instanceof HTMLTextAreaElement)) {
        throw new Error("Refreshed card form front field was not found");
      }
      expect(refreshedFrontTextField.value).toBe(readyFrontText);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    mocks.updateCardItemMock.mockImplementation(async (
      _cardId: string,
      input: UpdateCardInput,
    ): Promise<Card> => ({
      ...refreshedCard,
      ...input,
    }));
    const saveButton = container.querySelector('[data-testid="card-form-save"]');
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });
    const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Card form back field was not found");
    }

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    appData.localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
      if (
        !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Refreshed card form fields were not found");
      }
      expect(refreshedFrontTextField.value).toBe(readyFrontText);
      expect(refreshedBackTextField.value).toBe(readyBackText);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    });

    mocks.updateCardItemMock.mockImplementation(async (
      _cardId: string,
      input: UpdateCardInput,
    ): Promise<Card> => ({
      ...refreshedCard,
      ...input,
    }));
    const saveButton = container.querySelector('[data-testid="card-form-save"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    const controls = await vi.waitFor(() => {
      const frontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
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
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("A managed image changed");
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
    appData.localReadVersion += 1;
    await renderScreen();

    const controls = await vi.waitFor(() => {
      const frontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
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
      expect(container.querySelector('[role="alert"]')?.textContent).toContain("A managed image changed");
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      return field;
    });
    const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Card form back field was not found");
    }
    const copiedBackText = `Answer\n\n${pendingReference}`;
    await setTextFieldValueAsync(backTextField, copiedBackText);

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    appData.localReadVersion += 1;
    await renderScreen();

    const controls = await vi.waitFor(() => {
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
      const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
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
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
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
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(controls.saveButton.disabled).toBe(false);
      expect(controls.aiButton.disabled).toBe(false);
    });

    const pastedBackText = `Answer after paste\n\n${pendingReference}`;
    await setTextFieldValueAsync(controls.backTextField, pastedBackText);
    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });
    const editedFrontText = pendingFrontText.replace("Question", "Locally edited question");
    await setTextFieldValueAsync(frontTextField, editedFrontText);
    const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
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
    appData.localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
      const tagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
      if (
        !(refreshedFrontTextField instanceof HTMLTextAreaElement)
        || !(refreshedBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Refreshed card form fields were not found");
      }
      expect(refreshedFrontTextField.value).toBe(editedFrontText);
      expect(refreshedBackTextField.value).toBe(refreshedBackText);
      expect(tagsTrigger?.textContent).toContain("remote-b");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
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
    appData.localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const laterFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const laterBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
      const tagsTrigger = container.querySelector('[data-testid="card-form-tags-trigger"]');
      if (
        !(laterFrontTextField instanceof HTMLTextAreaElement)
        || !(laterBackTextField instanceof HTMLTextAreaElement)
      ) {
        throw new Error("Later refreshed card form fields were not found");
      }
      expect(laterFrontTextField.value).toBe(editedFrontText);
      expect(laterBackTextField.value).toBe(laterBackText);
      expect(tagsTrigger?.textContent).toContain("remote-c");
      expect(container.querySelector('[role="alert"]')).not.toBeNull();
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });
    const editedFrontText = pendingFrontText.replace("Question", "Locally edited question");
    await setTextFieldValueAsync(frontTextField, editedFrontText);

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    appData.localReadVersion += 1;
    await renderScreen();

    await vi.waitFor(() => {
      const alert = container.querySelector('[role="alert"]');
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
      expect(alert?.textContent).toContain("A managed image changed");
      expect(saveButton).toBeInstanceOf(HTMLButtonElement);
      expect(aiButton).toBeInstanceOf(HTMLButtonElement);
      expect((saveButton as HTMLButtonElement).disabled).toBe(true);
      expect((aiButton as HTMLButtonElement).disabled).toBe(true);
      expect(frontTextField.value).toBe(editedFrontText);
    });

    vi.spyOn(window, "confirm").mockReturnValue(true);
    mocks.deleteCardItemMock.mockRejectedValue(new Error("delete unavailable"));
    const deleteButton = container.querySelector('[data-testid="card-form-delete"]');
    if (!(deleteButton instanceof HTMLButtonElement)) {
      throw new Error("Card form delete button was not found");
    }
    await clickElementAsync(deleteButton);

    await vi.waitFor(() => {
      expect(mocks.deleteCardItemMock).toHaveBeenCalledWith("card-media-lifecycle");
      expect(mocks.showCapturedTechnicalErrorMock).toHaveBeenCalledTimes(1);
      const lifecycleAlert = container.querySelector('[data-testid="card-form-lifecycle-conflict"]');
      const actionAlert = container.querySelector('[data-testid="card-form-action-error"]');
      expect(lifecycleAlert?.textContent).toContain("A managed image changed");
      expect(actionAlert?.textContent).toBe(
        "A technical error occurred. Try again or restart the app.",
      );
      expect(container.querySelectorAll('[role="alert"]')).toHaveLength(2);
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
      const field = container.querySelector('[data-testid="card-form-front-text"]');
      if (!(field instanceof HTMLTextAreaElement)) {
        throw new Error("Card form front field was not found");
      }
      expect(field.value).toBe(pendingFrontText);
      return field;
    });
    const backTextField = container.querySelector('[data-testid="card-form-back-text"]');
    if (!(backTextField instanceof HTMLTextAreaElement)) {
      throw new Error("Card form back field was not found");
    }
    const movedStaleReference = '![Moved diagram](<fcasset:front-image?quality=full&state=pending#back> "Moved title")';
    const movedFrontText = "Edited question after moving the outdated reference";
    const movedBackText = `Edited answer\n\n${movedStaleReference}`;
    await setTextFieldValueAsync(backTextField, movedBackText);
    await setTextFieldValueAsync(frontTextField, movedFrontText);

    mocks.loadCardByIdMock.mockResolvedValue(refreshedCard);
    appData.localReadVersion += 1;
    await renderScreen();

    const conflictMessage = "A managed image changed while this card was open. Remove or edit the outdated pending or failed image reference before saving or using Edit with AI.";
    const initiallyBlockedControls = await vi.waitFor(() => {
      const alert = container.querySelector('[role="alert"]');
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
      const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
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
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(initiallyBlockedControls.saveButton.disabled).toBe(false);
      expect(initiallyBlockedControls.aiButton.disabled).toBe(false);
    });

    const pastedStaleReference = '![Pasted diagram](<fcasset:front-image?quality=compact&state=pending#pasted> "Pasted title")';
    const pastedBackText = `${cutBackText}\n\n${pastedStaleReference}`;
    await setTextFieldValueAsync(initiallyBlockedControls.backTextField, pastedBackText);

    await vi.waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(conflictMessage);
      expect(initiallyBlockedControls.saveButton.disabled).toBe(true);
      expect(initiallyBlockedControls.aiButton.disabled).toBe(true);
    });

    const laterRefreshedCard = {
      ...refreshedCard,
      backText: "Remotely edited answer",
      updatedAt: "2026-03-10T11:00:00.000Z",
    };
    mocks.loadCardByIdMock.mockResolvedValue(laterRefreshedCard);
    appData.localReadVersion += 1;
    await renderScreen();

    const blockedControls = await vi.waitFor(() => {
      const alert = container.querySelector('[role="alert"]');
      const saveButton = container.querySelector('[data-testid="card-form-save"]');
      const aiButton = container.querySelector('[data-testid="card-form-edit-with-ai"]');
      const refreshedFrontTextField = container.querySelector('[data-testid="card-form-front-text"]');
      const refreshedBackTextField = container.querySelector('[data-testid="card-form-back-text"]');
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
      expect(container.querySelector('[role="alert"]')).toBeNull();
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
