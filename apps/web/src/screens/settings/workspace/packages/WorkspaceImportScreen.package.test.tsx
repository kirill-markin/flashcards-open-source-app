// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../api";
import type { AppDataContextValue } from "../../../../appData";
import { WorkspaceMaintenancePendingError } from "../../../../appData/sync/engine/workspaceMaintenanceLock";
import { AppErrorDialogProvider } from "../../../../appError/AppErrorContext";
import { I18nProvider } from "../../../../i18n";
import type {
  Card,
  Deck,
  ResetWorkspaceProgressResponse,
  ReviewFilter,
  WorkspacePackageImportConfirmOptions,
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportPreviewResponse,
  WorkspaceResetProgressPreview,
} from "../../../../types";
import { LibraryImportScreen } from "../../../library/LibraryImportScreen";
import { aiImportSources } from "./aiImportSources";
import { WorkspaceAiImport } from "./WorkspaceAiImport";
import { WorkspaceImportScreen } from "./WorkspaceImportScreen";
import { WorkspacePackageImportProvider } from "./WorkspacePackageImportContext";
import { WorkspaceTextImportScreen } from "./WorkspaceTextImportScreen";

const workspaceReplicaId = "ed46c6cc-17c9-5b1c-a82a-169543e8a453";

const {
  captureAppOperationErrorMock,
  confirmWorkspacePackageImportMock,
  loadWorkspaceTagsSummaryMock,
  previewWorkspacePackageImportMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  captureAppOperationErrorMock: vi.fn(),
  confirmWorkspacePackageImportMock: vi.fn<(
    workspaceId: string,
    file: File,
    options: WorkspacePackageImportConfirmOptions,
  ) => Promise<WorkspacePackageImportConfirmResponse>>(),
  loadWorkspaceTagsSummaryMock: vi.fn(),
  previewWorkspacePackageImportMock: vi.fn<(
    workspaceId: string,
    fileOrBlob: Blob,
  ) => Promise<WorkspacePackageImportPreviewResponse>>(),
  useAppDataMock: vi.fn<() => AppDataContextValue>(),
}));

vi.mock("../../../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../api")>();
  return {
    ...actual,
    confirmWorkspacePackageImport: confirmWorkspacePackageImportMock,
    previewWorkspacePackageImport: previewWorkspacePackageImportMock,
  };
});

vi.mock("../../../../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("../../../../localDb/cards/workspace", () => ({
  loadWorkspaceTagsSummary: loadWorkspaceTagsSummaryMock,
}));

vi.mock("../../../../observability/appOperationObservation", () => ({
  captureAppOperationError: captureAppOperationErrorMock,
}));

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

type WorkspaceImportScreenHarness = Readonly<{
  getAppData: () => Mutable<AppDataContextValue>;
  getContainer: () => HTMLDivElement;
  renderScreen: (screen: ReactElement) => Promise<void>;
}>;

function throwNotUsed(functionName: string): never {
  throw new Error(`${functionName} was not expected in this test`);
}

function createPreviewResponse(): WorkspacePackageImportPreviewResponse {
  return {
    sourceKind: "zip",
    packageMetadata: {
      label: "Shared deck",
      author: "Package author",
      comment: "Package comment",
      createdAt: "2026-04-01T09:00:00.000Z",
      sourceUrl: "https://example.com/package",
    },
    cardCount: 3,
    tagCounts: [
      { tag: "geography", cardsCount: 2 },
      { tag: "temporary", cardsCount: 1 },
    ],
    referencedMediaCount: 2,
    packageMediaFileCount: 4,
    warnings: [
      {
        code: "MEDIA_NOT_REFERENCED",
        message: "Unused media file will be skipped.",
        mediaPath: "media/unused.png",
      },
    ],
    defaultOptions: {
      addImportTag: true,
      suggestedImportTag: "import:2026-07-01",
      keptTags: ["geography"],
      removedTags: ["temporary"],
    },
  };
}

function createPreviewResponseWithMetadata(
  packageMetadata: WorkspacePackageImportPreviewResponse["packageMetadata"],
): WorkspacePackageImportPreviewResponse {
  return {
    ...createPreviewResponse(),
    packageMetadata,
  };
}

function createConfirmResponse(): WorkspacePackageImportConfirmResponse {
  return {
    cards: [],
    importedMediaAssets: [],
    summary: {
      cardCount: 2,
      cardBatchCount: 1,
      referencedMediaCount: 2,
      importedMediaAssetCount: 1,
      appliedMediaAssetCount: 1,
      keptTagCount: 1,
      removedTagCount: 1,
      importTag: "import:2026-07-01",
    },
  };
}

function createZipFile(fileName: string): File {
  return new File([new Uint8Array([80, 75, 3, 4])], fileName, { type: "application/zip" });
}

function createAppData(): Mutable<AppDataContextValue> {
  return {
    sessionLoadState: "ready",
    sessionVerificationState: "verified",
    isSessionVerified: true,
    sessionErrorMessage: "",
    sessionTechnicalError: null,
    session: {
      userId: "user-1",
      selectedWorkspaceId: "workspace-1",
      authTransport: "session",
      csrfToken: "csrf-token-1",
      preferences: {
        accentColor: "#FF6719",
        theme: "dark",
        reviewReactionAnimationsEnabled: true,
        firstReviewOnboardingCompleted: true,
      },
      profile: {
        email: "user@example.com",
        locale: "en",
        createdAt: "2026-03-10T00:00:00.000Z",
      },
    },
    activeWorkspace: {
      workspaceId: "workspace-1",
      name: "Primary",
      createdAt: "2026-03-10T00:00:00.000Z",
      isSelected: true,
    },
    availableWorkspaces: [],
    isChoosingWorkspace: false,
    workspaceSettings: null,
    cloudSettings: {
      installationId: "00000000-0000-4000-8000-000000000001",
      cloudState: "linked",
      linkedUserId: "user-1",
      linkedWorkspaceId: "workspace-1",
      linkedEmail: "user@example.com",
      onboardingCompleted: true,
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
    localReadVersion: 0,
    localCardCount: 0,
    isSyncing: false,
    selectedReviewFilter: { kind: "allCards" } satisfies ReviewFilter,
    errorMessage: "",
    technicalError: null,
    setErrorMessage: vi.fn(),
    setAccountPreferences: vi.fn(),
    firstReviewOnboardingCompleted: true,
    setFirstReviewOnboardingCompleted: vi.fn(async (): Promise<void> => undefined),
    refreshAccountPreferences: vi.fn(async () => ({ accentColor: "#FF6719", theme: "dark", reviewReactionAnimationsEnabled: true, firstReviewOnboardingCompleted: true })),
    refreshConnectedAccount: vi.fn(async (): Promise<void> => undefined),
    initialize: vi.fn(async (): Promise<void> => undefined),
    chooseWorkspace: vi.fn(async (_workspaceId: string): Promise<void> => undefined),
    createWorkspace: vi.fn(async (_name: string): Promise<null> => null),
    renameWorkspace: vi.fn(async (_workspaceId: string, _name: string): Promise<void> => undefined),
    deleteWorkspace: vi.fn(async (_workspaceId: string, _confirmationText: string): Promise<void> => undefined),
    loadWorkspaceResetProgressPreview: vi.fn(async (_workspaceId: string): Promise<WorkspaceResetProgressPreview> => throwNotUsed("loadWorkspaceResetProgressPreview")),
    resetWorkspaceProgress: vi.fn(async (_workspaceId: string, _confirmationText: string): Promise<ResetWorkspaceProgressResponse> => throwNotUsed("resetWorkspaceProgress")),
    runSync: vi.fn(async (): Promise<void> => undefined),
    requireActiveWorkspaceSync: vi.fn(async (): Promise<void> => undefined),
    runMediaUploadTransfers: vi.fn(),
    refreshLocalData: vi.fn(async (): Promise<void> => undefined),
    getCardById: vi.fn(async (_cardId: string): Promise<Card> => throwNotUsed("getCardById")),
    getDeckById: vi.fn(async (_deckId: string): Promise<Deck> => throwNotUsed("getDeckById")),
    createCardItem: vi.fn(async (_input): Promise<Card> => throwNotUsed("createCardItem")),
    createDeckItem: vi.fn(async (_input): Promise<Deck> => throwNotUsed("createDeckItem")),
    updateCardItem: vi.fn(async (_cardId: string, _input): Promise<Card> => throwNotUsed("updateCardItem")),
    updateDeckItem: vi.fn(async (_deckId: string, _input): Promise<Deck> => throwNotUsed("updateDeckItem")),
    deleteCardItem: vi.fn(async (_cardId: string): Promise<Card> => throwNotUsed("deleteCardItem")),
    deleteDeckItem: vi.fn(async (_deckId: string): Promise<Deck> => throwNotUsed("deleteDeckItem")),
    selectReviewFilter: vi.fn(),
    openReview: vi.fn(),
    submitReviewItem: vi.fn(async (_cardId: string, _rating: 0 | 1 | 2 | 3): Promise<Card> => throwNotUsed("submitReviewItem")),
  };
}

function setupWorkspaceImportScreen(): WorkspaceImportScreenHarness {
  let appData: Mutable<AppDataContextValue> | null = null;
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppDataMock.mockReset();
    captureAppOperationErrorMock.mockReset();
    captureAppOperationErrorMock.mockReturnValue(true);
    previewWorkspacePackageImportMock.mockReset();
    confirmWorkspacePackageImportMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockReset();
    loadWorkspaceTagsSummaryMock.mockResolvedValue({
      tags: [
        { tag: "demo", cardsCount: 1 },
        { tag: "geography", cardsCount: 3 },
      ],
      totalCards: 4,
    });
    appData = createAppData();
    useAppDataMock.mockReturnValue(appData);
    previewWorkspacePackageImportMock.mockResolvedValue(createPreviewResponse());
    confirmWorkspacePackageImportMock.mockResolvedValue(createConfirmResponse());
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    const currentRoot = root;
    if (currentRoot !== null) {
      act(() => currentRoot.unmount());
    }
    container?.remove();
    appData = null;
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

  function getAppData(): Mutable<AppDataContextValue> {
    if (appData === null) {
      throw new Error("Workspace import test app data is not ready");
    }

    return appData;
  }

  function getContainer(): HTMLDivElement {
    if (container === null) {
      throw new Error("Workspace import test container is not ready");
    }

    return container;
  }

  async function renderScreen(screen: ReactElement): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Workspace import test root is not ready");
    }

    await act(async () => {
      currentRoot.render(
        <I18nProvider>
          <AppErrorDialogProvider>
            <WorkspacePackageImportProvider>
              <MemoryRouter>{screen}</MemoryRouter>
            </WorkspacePackageImportProvider>
          </AppErrorDialogProvider>
        </I18nProvider>,
      );
    });
  }

  return {
    getAppData,
    getContainer,
    renderScreen,
  };
}

const {
  getAppData,
  getContainer,
  renderScreen,
} = setupWorkspaceImportScreen();

function requireElement<ElementType extends Element>(
  selector: string,
  elementType: new () => ElementType,
): ElementType {
  const element = getContainer().querySelector(selector);
  if (!(element instanceof elementType)) {
    throw new Error(`Element was not found: ${selector}`);
  }

  return element;
}

function requireDocumentElement<ElementType extends Element>(
  selector: string,
  elementType: new () => ElementType,
): ElementType {
  const element = document.querySelector(selector);
  if (!(element instanceof elementType)) {
    throw new Error(`Element was not found: ${selector}`);
  }

  return element;
}

function setInputFiles(input: HTMLInputElement, files: ReadonlyArray<File>): void {
  Object.defineProperty(input, "files", {
    configurable: true,
    value: files,
  });
}

async function waitForCondition(description: string, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }

  throw new Error(description);
}

async function choosePackageFile(file: File): Promise<void> {
  const input = requireElement("[data-testid='workspace-package-import-file-input']", HTMLInputElement);
  setInputFiles(input, [file]);
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function clickElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

async function setTextInputValue(input: HTMLInputElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (valueSetter === undefined) {
    throw new Error("HTML input value setter is unavailable");
  }

  await act(async () => {
    valueSetter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (valueSetter === undefined) {
    throw new Error("HTML textarea value setter is unavailable");
  }

  await act(async () => {
    valueSetter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pressInputKey(input: HTMLInputElement, key: string): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

async function readPackageCardTags(file: Blob): Promise<ReadonlyArray<string>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileNameLength = view.getUint16(26, true);
  const extraFieldLength = view.getUint16(28, true);
  const contentLength = view.getUint32(18, true);
  const contentStart = 30 + fileNameLength + extraFieldLength;
  const packageJson = JSON.parse(new TextDecoder().decode(
    bytes.slice(contentStart, contentStart + contentLength),
  )) as { cards: Array<{ tags: Array<string> }> };
  return packageJson.cards[0]?.tags ?? [];
}

async function waitForPreview(): Promise<void> {
  await waitForCondition("Package preview did not finish", () => (
    previewWorkspacePackageImportMock.mock.calls.length > 0
      && getContainer().querySelector("[data-testid='workspace-package-import-preview']") !== null
  ));
}

async function waitForConfirm(): Promise<void> {
  await waitForCondition("Package import confirm did not finish", () => (
    confirmWorkspacePackageImportMock.mock.calls.length > 0
  ));
}

function readConfirmOptions(): WorkspacePackageImportConfirmOptions {
  const options = confirmWorkspacePackageImportMock.mock.calls[0]?.[2];
  if (options === undefined) {
    throw new Error("Package import confirm options were not captured");
  }

  return options;
}

describe("WorkspaceImportScreen package import", () => {
  it("links to each dedicated form in brand, then Nibomo and spreadsheet order", async () => {
    await renderScreen(<LibraryImportScreen />);

    const rows = Array.from(getContainer().querySelectorAll(
      "[data-testid='library-import-apps'] a[data-testid], [data-testid='library-import-formats'] a[data-testid]",
    ), (row) => row.getAttribute("href"));
    expect(rows).toEqual([
      ...["quizlet", "anki", "noji", "knowt", "remnote", "brainscape", "studysmarter", "cram", "mochi", "supermemo", "ankiapp", "other"]
        .map((sourceId) => `/w/workspace-1/library/import/${sourceId}`),
      "/w/workspace-1/library/import/nibomo",
      "/w/workspace-1/library/import/spreadsheet",
    ]);
    expect(getContainer().querySelector("[data-testid='workspace-text-import-editor']")).toBeNull();
    expect(getContainer().querySelector("[data-testid='workspace-package-import-card']")).toBeNull();
    expect(getContainer().querySelector("[data-testid='workspace-ai-import-card']")).toBeNull();
  });

  it.each([
    ...aiImportSources.filter((source) => source.id === "anki" || source.id === "quizlet").map((source) => ({
      form: () => <WorkspaceAiImport source={source} />,
      container: "workspace-ai-import-card",
      control: source.inputKind === "text" ? "workspace-ai-import-text-input" : "workspace-ai-import-select",
    })),
    {
      form: WorkspaceTextImportScreen,
      container: "workspace-text-import-editor",
      control: "workspace-text-import-input",
    },
  ])("shows session restoration while $control is disabled", async ({ form: Form, container, control }) => {
    const appData = getAppData();
    appData.isSessionVerified = false;
    appData.sessionVerificationState = "unverified";
    await renderScreen(<Form />);

    const form = requireElement(`[data-testid='${container}']`, HTMLElement);
    expect(form.querySelector("[role='status']")).not.toBeNull();
    expect(form.querySelector(`[data-testid='${control}']`)?.hasAttribute("disabled")).toBe(true);

    appData.isSessionVerified = true;
    appData.sessionVerificationState = "verified";
    await renderScreen(<Form />);

    expect(form.querySelector("[role='status']")).toBeNull();
    expect(form.querySelector(`[data-testid='${control}']`)?.hasAttribute("disabled")).toBe(false);
  });

  it("imports edited pasted cards through package preview and confirm", async () => {
    previewWorkspacePackageImportMock.mockResolvedValueOnce({
      ...createPreviewResponse(),
      cardCount: 1,
      tagCounts: [],
      referencedMediaCount: 0,
      packageMediaFileCount: 0,
      warnings: [],
      defaultOptions: {
        addImportTag: true,
        suggestedImportTag: "import:2026-07-01",
        keptTags: [],
        removedTags: [],
      },
    });

    await renderScreen(<WorkspaceTextImportScreen />);
    await setTextAreaValue(
      requireElement("[data-testid='workspace-text-import-input']", HTMLTextAreaElement),
      "Canada\tOttawa\nUnited States\tWashington D.C.",
    );

    const previewRows = getContainer().querySelectorAll("[data-testid='workspace-text-import-preview-row']");
    expect(previewRows).toHaveLength(2);
    const secondBackInput = requireElement(
      "[data-testid='workspace-text-import-back-input'][data-card-id='source-row-2']",
      HTMLTextAreaElement,
    );
    await setTextAreaValue(secondBackInput, "Washington, D.C.");
    await clickElement(requireElement(
      "[data-testid='workspace-text-import-remove-card'][data-card-id='source-row-1']",
      HTMLButtonElement,
    ));

    await clickElement(requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement));
    await waitForConfirm();

    const previewFile = previewWorkspacePackageImportMock.mock.calls[0]?.[1];
    const confirmedFile = confirmWorkspacePackageImportMock.mock.calls[0]?.[1];
    expect(previewFile).toBeInstanceOf(File);
    expect(confirmedFile).toBe(previewFile);
    expect(readConfirmOptions()).toEqual(expect.objectContaining({
      addImportTag: true,
      importTag: "import:2026-07-01",
      removeTags: [],
    }));
  });

  it("clears a confirmed text import and retries only sync after maintenance contention", async () => {
    previewWorkspacePackageImportMock.mockResolvedValueOnce({ ...createPreviewResponse(), cardCount: 2 });
    captureAppOperationErrorMock.mockReturnValue(false);
    let rejectRefresh: (error: Error) => void = (error) => { throw error; };
    const pendingRefresh = new Promise<void>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    const refreshLocalDataMock = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(pendingRefresh)
      .mockResolvedValueOnce(undefined);
    getAppData().refreshLocalData = refreshLocalDataMock;

    await renderScreen(<WorkspaceTextImportScreen />);
    const input = requireElement("[data-testid='workspace-text-import-input']", HTMLTextAreaElement);
    const confirmButton = requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement);
    await setTextAreaValue(input, "Canada\tOttawa\nFrance\tParis");
    await clickElement(confirmButton);
    await waitForCondition("Confirmed text import did not clear its draft", () => input.value === "");
    expect(refreshLocalDataMock).toHaveBeenCalledTimes(2);
    expect(getContainer().querySelector("[data-testid='workspace-import-success']")).not.toBeNull();

    await act(async () => rejectRefresh(new WorkspaceMaintenancePendingError("Retry syncing.")));
    expect(confirmButton.disabled).toBe(true);
    const retry = requireElement("[data-testid='workspace-text-import-retry-sync']", HTMLButtonElement);
    await clickElement(retry);

    expect(refreshLocalDataMock).toHaveBeenCalledTimes(3);
    expect(previewWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
    expect(getContainer().querySelector("[data-testid='workspace-text-import-retry-sync']")).toBeNull();
  });

  it("blocks pasted text import until every preview card has a front and back", async () => {
    await renderScreen(<WorkspaceTextImportScreen />);
    await setTextAreaValue(
      requireElement("[data-testid='workspace-text-import-input']", HTMLTextAreaElement),
      "Complete\tAnswer\nMissing answer",
    );

    expect(requireElement("[data-testid='workspace-text-import-invalid-count']", HTMLElement).textContent).toContain("1");
    expect(requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);
    expect(previewWorkspacePackageImportMock).not.toHaveBeenCalled();
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("deletes every invalid pasted card in one action", async () => {
    await renderScreen(<WorkspaceTextImportScreen />);
    await setTextAreaValue(
      requireElement("[data-testid='workspace-text-import-input']", HTMLTextAreaElement),
      "Complete\tAnswer\nMissing answer\n\tMissing front",
    );

    expect(getContainer().querySelectorAll("[data-testid='workspace-text-import-preview-row']")).toHaveLength(3);
    expect(requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);

    await clickElement(requireElement(
      "[data-testid='workspace-text-import-delete-invalid']",
      HTMLButtonElement,
    ));

    expect(getContainer().querySelectorAll("[data-testid='workspace-text-import-preview-row']")).toHaveLength(1);
    expect(getContainer().querySelector("[data-testid='workspace-text-import-invalid-count']")).toBeNull();
    expect(requireElement("[data-testid='workspace-text-import-front-input']", HTMLTextAreaElement).value).toBe("Complete");
    expect(requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement).disabled).toBe(false);
  });

  it("applies picker tags to every pasted card instead of adding the automatic import tag", async () => {
    previewWorkspacePackageImportMock.mockResolvedValueOnce({
      ...createPreviewResponse(),
      cardCount: 1,
      tagCounts: [{ tag: "exam", cardsCount: 1 }],
      referencedMediaCount: 0,
      packageMediaFileCount: 0,
      warnings: [],
      defaultOptions: {
        addImportTag: true,
        suggestedImportTag: "import:2026-07-01",
        keptTags: ["exam"],
        removedTags: [],
      },
    });

    await renderScreen(<WorkspaceTextImportScreen />);
    await waitForCondition("Tag suggestions were not loaded", () => loadWorkspaceTagsSummaryMock.mock.calls.length === 1);
    await setTextAreaValue(
      requireElement("[data-testid='workspace-text-import-input']", HTMLTextAreaElement),
      "Canada\tOttawa",
    );
    await clickElement(requireElement(
      "[data-testid='workspace-text-import-tags-trigger']",
      HTMLElement,
    ));
    const tagInput = requireDocumentElement("#workspace-text-import-tags-input", HTMLInputElement);
    await setTextInputValue(tagInput, "exam");
    await pressInputKey(tagInput, "Enter");
    await clickElement(requireElement(
      "[data-testid='workspace-text-import-tags-trigger']",
      HTMLElement,
    ));

    await clickElement(requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement));
    await waitForConfirm();

    const previewFile = previewWorkspacePackageImportMock.mock.calls[0]?.[1];
    if (previewFile === undefined) {
      throw new Error("Pasted card package was not previewed");
    }
    expect(await readPackageCardTags(previewFile)).toEqual(["exam"]);
    expect(readConfirmOptions()).toEqual(expect.objectContaining({
      addImportTag: false,
      importTag: "",
      removeTags: [],
    }));
  });

  it("offers existing workspace tags in the pasted-card tag picker", async () => {
    await renderScreen(<WorkspaceTextImportScreen />);
    await waitForCondition("Tag suggestions were not loaded", () => loadWorkspaceTagsSummaryMock.mock.calls.length === 1);
    await clickElement(requireElement(
      "[data-testid='workspace-text-import-tags-trigger']",
      HTMLElement,
    ));

    const pickerText = requireDocumentElement(".cell-tags-overlay", HTMLElement).textContent;
    expect(pickerText).toContain("geography");
    expect(pickerText).toContain("3");
  });

  it("shows pasted-data errors beside the text editor", async () => {
    previewWorkspacePackageImportMock.mockRejectedValueOnce(new ApiError({
      statusCode: 413,
      message: "Request body is too large",
      code: null,
      requestId: null,
      retryAfterMs: null,
      endpoint: "POST /workspaces/workspace-1/packages/import/preview",
      responseBodyKind: "empty",
    }));

    await renderScreen(<WorkspaceTextImportScreen />);
    const editor = requireElement("[data-testid='workspace-text-import-editor']", HTMLElement);
    await setTextAreaValue(
      requireElement("[data-testid='workspace-text-import-input']", HTMLTextAreaElement),
      "Canada\tOttawa",
    );
    await clickElement(requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement));
    await waitForCondition("Pasted-data error was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    const error = requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement);
    expect(editor.contains(error)).toBe(true);
    expect(error.textContent).toContain("The pasted data is too large");
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("keeps a tagging choice made before selecting a ZIP and applies preview defaults on replacement", async () => {
    await renderScreen(<WorkspaceImportScreen />);

    const advanced = requireElement("[data-testid='workspace-package-import-advanced']", HTMLElement);
    expect(advanced.closest("details")?.open).toBe(false);
    const checkbox = requireElement("[data-testid='workspace-package-import-tag-checkbox']", HTMLInputElement);
    expect(checkbox.checked).toBe(true);

    await clickElement(advanced);
    await clickElement(checkbox);
    await choosePackageFile(createZipFile("flashcards.zip"));
    await waitForPreview();
    expect(checkbox.checked).toBe(false);

    await clickElement(advanced);
    const replacement = createZipFile("replacement.zip");
    const preview = createPreviewResponse();
    previewWorkspacePackageImportMock.mockResolvedValueOnce({
      ...preview,
      defaultOptions: { ...preview.defaultOptions, suggestedImportTag: "import:replacement", removedTags: [] },
    });
    await choosePackageFile(replacement);
    await waitForPreview();

    expect(advanced.closest("details")?.open).toBe(false);
    expect(checkbox.checked).toBe(true);
    expect(requireElement("[data-testid='workspace-package-import-tag-input']", HTMLInputElement).value).toBe("import:replacement");
    expect(requireElement(
      "[data-testid='workspace-package-remove-tag-checkbox'][data-tag='temporary']",
      HTMLInputElement,
    ).checked).toBe(false);
  });

  it("previews a dropped ZIP and displays its filename, package counts and details", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen(<WorkspaceImportScreen />);
    const picker = requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement);
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
    await act(async () => {
      picker.dispatchEvent(drop);
    });
    await waitForPreview();

    expect(drop.defaultPrevented).toBe(true);
    expect(requireElement("[data-testid='workspace-package-import-file-name']", HTMLParagraphElement).textContent).toBe(file.name);
    expect(previewWorkspacePackageImportMock).toHaveBeenCalledWith("workspace-1", file);
    expect(requireElement("[data-testid='workspace-package-import-preview-source']", HTMLElement).textContent).toBe("ZIP package");
    expect(requireElement("[data-testid='workspace-package-import-preview-card-count']", HTMLElement).textContent).toBe("3");
    expect(requireElement("[data-testid='workspace-package-import-preview-referenced-media-count']", HTMLElement).textContent).toBe("2");
    expect(requireElement("[data-testid='workspace-package-import-preview-package-media-count']", HTMLElement).textContent).toBe("4");
    expect(requireElement("[data-testid='workspace-package-import-preview-metadata']", HTMLElement).textContent).toContain("Shared deck");
    expect(requireElement("[data-testid='workspace-package-import-preview-metadata']", HTMLElement).textContent).toContain("Package author");
    expect(requireElement("[data-testid='workspace-package-import-preview-metadata']", HTMLElement).textContent).toContain("Package comment");
    expect(requireElement("[data-testid='workspace-package-import-preview-metadata']", HTMLElement).textContent).toContain("https://example.com/package");
    expect(requireElement("[data-testid='workspace-package-import-preview-warnings']", HTMLElement).textContent).toContain("Unused media file will be skipped.");
  });

  it("renders unsafe package source URLs as plain text", async () => {
    const file = createZipFile("flashcards.zip");
    previewWorkspacePackageImportMock.mockResolvedValueOnce(createPreviewResponseWithMetadata({
      ...createPreviewResponse().packageMetadata,
      sourceUrl: "javascript:alert(1)",
    }));

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();

    const metadata = requireElement("[data-testid='workspace-package-import-preview-metadata']", HTMLElement);
    const sourceLink = Array.from(metadata.querySelectorAll("a")).find((link) => link.textContent === "javascript:alert(1)");

    expect(metadata.textContent).toContain("javascript:alert(1)");
    expect(sourceLink).toBeUndefined();
  });

  it("renders malformed package created dates as plain text", async () => {
    const file = createZipFile("flashcards.zip");
    previewWorkspacePackageImportMock.mockResolvedValueOnce(createPreviewResponseWithMetadata({
      ...createPreviewResponse().packageMetadata,
      createdAt: "not-a-date",
    }));

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();

    expect(requireElement("[data-testid='workspace-package-import-preview-metadata']", HTMLElement).textContent).toContain("not-a-date");
    expect(getContainer().querySelector("[data-testid='workspace-import-error']")).toBeNull();
  });

  it("uses the current tag removal checkbox state when confirming import", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();

    const geographyCheckbox = requireElement(
      "[data-testid='workspace-package-remove-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    );
    expect(geographyCheckbox.checked).toBe(false);

    await clickElement(geographyCheckbox);
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForConfirm();

    expect(readConfirmOptions().removeTags).toEqual(["temporary", "geography"]);
  });

  it("sends the edited import tag when confirming import", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();
    await setTextInputValue(
      requireElement("[data-testid='workspace-package-import-tag-input']", HTMLInputElement),
      "custom-import-tag",
    );
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForConfirm();

    expect(readConfirmOptions().importTag).toBe("custom-import-tag");
  });

  it("blocks confirm when enabled import tagging has a blank tag", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();
    await setTextInputValue(
      requireElement("[data-testid='workspace-package-import-tag-input']", HTMLInputElement),
      "   ",
    );
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));

    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain("Enter an import tag");
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("keeps ZIP confirmation and sync retry scoped when switching workspaces", async () => {
    const file = createZipFile("flashcards.zip");
    let resolveConfirm: ((result: WorkspacePackageImportConfirmResponse) => void) | null = null;
    const pendingConfirm = new Promise<WorkspacePackageImportConfirmResponse>((resolve) => {
      resolveConfirm = resolve;
    });
    confirmWorkspacePackageImportMock.mockReturnValueOnce(pendingConfirm);
    const refreshLocalDataMock = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Previous workspace refresh failed"));
    getAppData().refreshLocalData = refreshLocalDataMock;

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForConfirm();

    const appData = getAppData();
    const firstWorkspace = appData.activeWorkspace;
    const secondWorkspace = {
      workspaceId: "workspace-2",
      name: "Secondary",
      createdAt: "2026-03-11T00:00:00.000Z",
      isSelected: true,
    };
    appData.activeWorkspace = secondWorkspace;
    await renderScreen(<WorkspaceImportScreen />);
    expect(getContainer().querySelector("[data-testid='workspace-package-import-preview']")).toBeNull();
    expect(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);
    expect(requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement).disabled).toBe(false);

    appData.activeWorkspace = firstWorkspace;
    await renderScreen(<WorkspaceImportScreen />);
    expect(requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement).disabled).toBe(true);
    const confirmButton = requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement);
    expect(confirmButton.disabled).toBe(true);
    expect(confirmButton.getAttribute("aria-busy")).toBe("true");

    appData.activeWorkspace = secondWorkspace;
    appData.refreshLocalData = vi.fn(async () => undefined);
    await renderScreen(<WorkspaceImportScreen />);

    const completeConfirm = resolveConfirm;
    if (completeConfirm === null) {
      throw new Error("Package confirmation resolve function is unavailable");
    }
    await act(async () => completeConfirm(createConfirmResponse()));

    expect(refreshLocalDataMock).toHaveBeenCalledTimes(2);
    expect(appData.refreshLocalData).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='app-error-dialog']")).toBeNull();
    expect(getContainer().querySelector("[data-testid='workspace-import-error']")).toBeNull();
    expect(getContainer().querySelector("[data-testid='workspace-import-success']")).toBeNull();
    expect(requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement).disabled).toBe(false);

    const newFile = createZipFile("workspace-2.zip");
    await choosePackageFile(newFile);
    await waitForPreview();
    expect(previewWorkspacePackageImportMock).toHaveBeenLastCalledWith("workspace-2", newFile);
    expect(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement).disabled).toBe(false);

    appData.activeWorkspace = firstWorkspace;
    const retryRefresh = vi.fn(async () => undefined);
    appData.refreshLocalData = retryRefresh;
    await renderScreen(<WorkspaceImportScreen />);
    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement)).not.toBeNull();
    const retryButton = requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement);
    expect(retryButton.disabled).toBe(false);
    await clickElement(retryButton);

    expect(retryRefresh).toHaveBeenCalledTimes(1);
    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
    expect(requireElement("[data-testid='workspace-import-success']", HTMLParagraphElement)).not.toBeNull();
  });

  it("resets the preview when the installation id changes before confirm", async () => {
    const file = createZipFile("flashcards.zip");
    const appData = getAppData();

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();

    if (appData.cloudSettings === null) {
      throw new Error("Cloud settings fixture is not ready");
    }

    appData.cloudSettings = {
      ...appData.cloudSettings,
      installationId: "00000000-0000-4000-8000-000000000002",
    };
    await renderScreen(<WorkspaceImportScreen />);
    await waitForCondition("Package preview was not reset after installation change", () => (
      getContainer().querySelector("[data-testid='workspace-package-import-preview']") === null
    ));

    expect(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("explains unavailable ZIP and spreadsheet forms when there is no linked installation", async () => {
    const appData = getAppData();

    if (appData.cloudSettings === null) {
      throw new Error("Cloud settings fixture is not ready");
    }

    appData.cloudSettings = {
      ...appData.cloudSettings,
      installationId: "",
    };

    await renderScreen(<WorkspaceImportScreen />);
    await clickElement(requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement));

    expect(requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement).disabled).toBe(true);
    expect(requireElement("[data-testid='workspace-package-import-file-input']", HTMLInputElement).disabled).toBe(true);
    expect(requireElement("[data-testid='workspace-package-import-unavailable']", HTMLParagraphElement).textContent).toContain("Workspace is unavailable");
    expect(previewWorkspacePackageImportMock).not.toHaveBeenCalled();
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();

    if (appData.session === null) {
      throw new Error("Session fixture is not ready");
    }
    appData.session = {
      ...appData.session,
      authTransport: "guest",
      browserGuestCapabilities: {
        isGuest: true, platformFundedAi: false, ownKeyAi: true, requiresAccountLinking: true,
      },
    };
    appData.cloudSettings = {
      ...appData.cloudSettings,
      cloudState: "guest",
      linkedEmail: null,
    };
    await renderScreen(<WorkspaceTextImportScreen />);
    expect(requireElement("[data-testid='workspace-text-import-input']", HTMLTextAreaElement).disabled).toBe(true);
    expect(requireElement("[data-testid='workspace-text-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);
    expect(requireElement("[data-testid='workspace-text-import-editor'] [role='status']", HTMLParagraphElement).textContent)
      .toContain("Workspace is unavailable");
  });

  it("registers and submits the derived replica, refreshes imported data, and shows tagged success", async () => {
    const file = createZipFile("flashcards.zip");
    const operationOrder: string[] = [];
    let resolveRegistrationRefresh: (() => void) | null = null;
    const registrationRefreshPromise = new Promise<void>((resolve) => {
      resolveRegistrationRefresh = resolve;
    });
    const refreshLocalDataMock = vi.fn()
      .mockImplementationOnce(() => {
        operationOrder.push("refresh");
        return registrationRefreshPromise;
      })
      .mockImplementationOnce(async (): Promise<void> => {
        operationOrder.push("refresh");
      });
    getAppData().refreshLocalData = refreshLocalDataMock;
    confirmWorkspacePackageImportMock.mockImplementationOnce(async () => {
      operationOrder.push("confirm");
      return createConfirmResponse();
    });

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForCondition("Replica registration refresh did not start", () => (
      refreshLocalDataMock.mock.calls.length === 1
    ));
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
    expect(operationOrder).toEqual(["refresh"]);

    const completeRegistrationRefresh = resolveRegistrationRefresh;
    if (completeRegistrationRefresh === null) {
      throw new Error("Replica registration refresh resolve function is unavailable");
    }
    await act(async () => completeRegistrationRefresh());
    await waitForCondition("Package import success was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-success']") !== null
    ));

    const options = readConfirmOptions();
    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledWith("workspace-1", file, expect.objectContaining({
      addImportTag: true,
      importId: "11111111-1111-4111-8111-111111111111",
      importTag: "import:2026-07-01",
      lastModifiedByReplicaId: workspaceReplicaId,
      operationIdPrefix: "11111111-1111-4111-8111-111111111111",
      removeTags: ["temporary"],
    }));
    expect(options.clientUpdatedAt).toBe(options.importedAt);
    expect(Date.parse(options.importedAt)).not.toBeNaN();
    expect(refreshLocalDataMock).toHaveBeenCalledTimes(2);
    expect(operationOrder).toEqual(["refresh", "confirm", "refresh"]);
    expect(requireElement("[data-testid='workspace-import-success']", HTMLParagraphElement).textContent).toContain("Imported 2 cards with tag import:2026-07-01.");
  });

  it("refreshes the destination after Back and keeps the failed sync available for retry", async () => {
    const file = createZipFile("flashcards.zip");
    const pendingConfirm = Promise.withResolvers<WorkspacePackageImportConfirmResponse>();
    confirmWorkspacePackageImportMock.mockReturnValueOnce(pendingConfirm.promise);
    getAppData().refreshLocalData = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Refresh failed"))
      .mockResolvedValueOnce(undefined);

    await renderScreen(
      <Routes>
        <Route path="/" element={<Navigate replace to="/w/workspace-1/library/import/nibomo" />} />
        <Route path="/w/:workspaceId/library/import" element={<LibraryImportScreen />} />
        <Route path="/w/:workspaceId/library/import/nibomo" element={<WorkspaceImportScreen />} />
      </Routes>,
    );
    await choosePackageFile(file);
    await waitForPreview();
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForConfirm();
    await clickElement(requireElement("[data-testid='workspace-import-back']", HTMLAnchorElement));
    expect(getContainer().querySelector("[data-testid='workspace-package-import-card']")).toBeNull();
    await act(async () => pendingConfirm.resolve(createConfirmResponse()));
    expect(getAppData().refreshLocalData).toHaveBeenCalledTimes(2);

    await clickElement(requireElement("[data-testid='library-import-nibomo']", HTMLAnchorElement));
    await waitForCondition("Package refresh error was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
    expect(getAppData().refreshLocalData).toHaveBeenCalledTimes(2);
    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain("A technical error occurred.");
    expect(getContainer().querySelector("[data-testid='workspace-import-success']")).toBeNull();
    expect(getContainer().querySelector("[data-testid='workspace-package-import-preview']")).toBeNull();

    const retryButton = requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement);
    expect(retryButton.disabled).toBe(false);
    await clickElement(retryButton);
    expect(getAppData().refreshLocalData).toHaveBeenCalledTimes(3);
    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
    expect(requireElement("[data-testid='workspace-import-success']", HTMLParagraphElement)).not.toBeNull();
  });

  it("surfaces preview errors through the existing error UI", async () => {
    const file = createZipFile("flashcards.zip");
    previewWorkspacePackageImportMock.mockRejectedValueOnce(new Error("Preview failed"));

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForCondition("Package preview error was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain("A technical error occurred.");
    expect(document.body.querySelector("[data-testid='app-error-dialog']")).not.toBeNull();
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();

    const retryButton = requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement);
    expect(retryButton.disabled).toBe(false);
    await clickElement(retryButton);
    await waitForPreview();
    expect(previewWorkspacePackageImportMock).toHaveBeenCalledTimes(2);
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("shows inline guidance for invalid packages without a technical error dialog", async () => {
    const file = createZipFile("flashcards.zip");
    previewWorkspacePackageImportMock.mockRejectedValueOnce(new ApiError({
      statusCode: 400,
      message: "ZIP entry is not supported: gemini-code-1784560458635.txt",
      code: "WORKSPACE_PACKAGE_IMPORT_PREVIEW_ZIP_INVALID",
      requestId: "7684327b-64e3-41b2-a4f0-7bf428d4e225",
      retryAfterMs: null,
      endpoint: "POST /workspaces/workspace-1/packages/import/preview",
      responseBodyKind: "json",
    }));

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForCondition("Invalid package guidance was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain(
      "This file is not a valid flashcards.zip. Choose a package exported from Nibomo.",
    );
    expect(getContainer().querySelector("[data-testid='workspace-package-import-preview']")).toBeNull();
    expect(document.body.querySelector("[data-testid='app-error-dialog']")).toBeNull();
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("shows inline package-too-large guidance for a code-less preview 413 without capturing it", async () => {
    const file = createZipFile("flashcards.zip");
    previewWorkspacePackageImportMock.mockRejectedValueOnce(new ApiError({
      statusCode: 413,
      message: "Request body is too large",
      code: null,
      requestId: null,
      retryAfterMs: null,
      endpoint: "POST /workspaces/workspace-1/packages/import/preview",
      responseBodyKind: "empty",
    }));

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForCondition("Package-too-large guidance was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain(
      "The selected package is too large. Choose a smaller flashcards.zip.",
    );
    expect(document.body.querySelector("[data-testid='app-error-dialog']")).toBeNull();
    expect(captureAppOperationErrorMock).not.toHaveBeenCalled();
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("shows inline package-too-large guidance for a coded confirm 413 without capturing it", async () => {
    const file = createZipFile("flashcards.zip");
    confirmWorkspacePackageImportMock.mockRejectedValueOnce(new ApiError({
      statusCode: 413,
      message: "Workspace package is too large",
      code: "WORKSPACE_PACKAGE_IMPORT_FILE_TOO_LARGE",
      requestId: "7684327b-64e3-41b2-a4f0-7bf428d4e225",
      retryAfterMs: null,
      endpoint: "POST /workspaces/workspace-1/packages/import/confirm",
      responseBodyKind: "json",
    }));

    await renderScreen(<WorkspaceImportScreen />);
    await choosePackageFile(file);
    await waitForPreview();
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForCondition("Package-too-large guidance was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain(
      "The selected package is too large. Choose a smaller flashcards.zip.",
    );
    expect(document.body.querySelector("[data-testid='app-error-dialog']")).toBeNull();
    expect(captureAppOperationErrorMock).not.toHaveBeenCalled();
    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
  });
});
