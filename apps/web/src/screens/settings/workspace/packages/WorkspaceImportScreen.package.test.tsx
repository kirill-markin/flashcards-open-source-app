// @vitest-environment jsdom
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../api";
import type { AppDataContextValue } from "../../../../appData";
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
import { WorkspaceImportScreen } from "./WorkspaceImportScreen";

const {
  confirmWorkspacePackageImportMock,
  previewWorkspacePackageImportMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  confirmWorkspacePackageImportMock: vi.fn<(
    workspaceId: string,
    file: File,
    options: WorkspacePackageImportConfirmOptions,
  ) => Promise<WorkspacePackageImportConfirmResponse>>(),
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

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

type WorkspaceImportScreenHarness = Readonly<{
  getAppData: () => Mutable<AppDataContextValue>;
  getContainer: () => HTMLDivElement;
  renderScreen: () => Promise<void>;
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
        reviewReactionAnimationsEnabled: true,
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
    refreshAccountPreferences: vi.fn(async () => ({ reviewReactionAnimationsEnabled: true })),
    initialize: vi.fn(async (): Promise<void> => undefined),
    chooseWorkspace: vi.fn(async (_workspaceId: string): Promise<void> => undefined),
    createWorkspace: vi.fn(async (_name: string): Promise<void> => undefined),
    renameWorkspace: vi.fn(async (_workspaceId: string, _name: string): Promise<void> => undefined),
    deleteWorkspace: vi.fn(async (_workspaceId: string, _confirmationText: string): Promise<void> => undefined),
    loadWorkspaceResetProgressPreview: vi.fn(async (_workspaceId: string): Promise<WorkspaceResetProgressPreview> => throwNotUsed("loadWorkspaceResetProgressPreview")),
    resetWorkspaceProgress: vi.fn(async (_workspaceId: string, _confirmationText: string): Promise<ResetWorkspaceProgressResponse> => throwNotUsed("resetWorkspaceProgress")),
    runSync: vi.fn(async (): Promise<void> => undefined),
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
    previewWorkspacePackageImportMock.mockReset();
    confirmWorkspacePackageImportMock.mockReset();
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

  async function renderScreen(): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Workspace import test root is not ready");
    }

    await act(async () => {
      currentRoot.render(
        <I18nProvider>
          <AppErrorDialogProvider>
            <WorkspaceImportScreen />
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
  it("initializes the editable import tag option from preview defaults", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();

    const checkbox = requireElement("[data-testid='workspace-package-import-tag-checkbox']", HTMLInputElement);
    const importTagInput = requireElement("[data-testid='workspace-package-import-tag-input']", HTMLInputElement);

    expect(checkbox.checked).toBe(true);
    expect(importTagInput.value).toBe("import:2026-07-01");
  });

  it("previews a chosen ZIP and displays package counts and details", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();

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

    await renderScreen();
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

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();

    expect(requireElement("[data-testid='workspace-package-import-preview-metadata']", HTMLElement).textContent).toContain("not-a-date");
    expect(getContainer().querySelector("[data-testid='workspace-import-error']")).toBeNull();
  });

  it("uses the current tag removal checkbox state when confirming import", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen();
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

    await renderScreen();
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

    await renderScreen();
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

  it("resets the preview when the active workspace changes before confirm", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();

    getAppData().activeWorkspace = {
      workspaceId: "workspace-2",
      name: "Secondary",
      createdAt: "2026-03-11T00:00:00.000Z",
      isSelected: true,
    };
    await renderScreen();
    await waitForCondition("Package preview was not reset after workspace change", () => (
      getContainer().querySelector("[data-testid='workspace-package-import-preview']") === null
    ));

    expect(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("resets the preview when the installation id changes before confirm", async () => {
    const file = createZipFile("flashcards.zip");
    const appData = getAppData();

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();

    if (appData.cloudSettings === null) {
      throw new Error("Cloud settings fixture is not ready");
    }

    appData.cloudSettings = {
      ...appData.cloudSettings,
      installationId: "00000000-0000-4000-8000-000000000002",
    };
    await renderScreen();
    await waitForCondition("Package preview was not reset after installation change", () => (
      getContainer().querySelector("[data-testid='workspace-package-import-preview']") === null
    ));

    expect(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("does not start package preview when installation id is missing", async () => {
    const appData = getAppData();

    if (appData.cloudSettings === null) {
      throw new Error("Cloud settings fixture is not ready");
    }

    appData.cloudSettings = {
      ...appData.cloudSettings,
      installationId: "",
    };

    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement));

    expect(requireElement("[data-testid='workspace-package-import-button']", HTMLButtonElement).disabled).toBe(true);
    expect(requireElement("[data-testid='workspace-package-import-file-input']", HTMLInputElement).disabled).toBe(true);
    expect(requireElement("[data-testid='workspace-package-import-unavailable']", HTMLParagraphElement).textContent).toContain("Workspace is unavailable");
    expect(previewWorkspacePackageImportMock).not.toHaveBeenCalled();
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });

  it("confirms import with generated options, refreshes local data, and shows tagged success", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForCondition("Package import success was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-success']") !== null
    ));

    const options = readConfirmOptions();
    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledWith("workspace-1", file, expect.objectContaining({
      addImportTag: true,
      importId: "11111111-1111-4111-8111-111111111111",
      importTag: "import:2026-07-01",
      lastModifiedByReplicaId: "00000000-0000-4000-8000-000000000001",
      operationIdPrefix: "11111111-1111-4111-8111-111111111111",
      removeTags: ["temporary"],
    }));
    expect(options.clientUpdatedAt).toBe(options.importedAt);
    expect(Date.parse(options.importedAt)).not.toBeNaN();
    expect(getAppData().refreshLocalData).toHaveBeenCalledTimes(1);
    expect(requireElement("[data-testid='workspace-import-success']", HTMLParagraphElement).textContent).toContain("Imported 2 cards with tag import:2026-07-01.");
  });

  it("surfaces refresh failures after confirm without showing success", async () => {
    const file = createZipFile("flashcards.zip");
    getAppData().refreshLocalData = vi.fn(async (): Promise<void> => {
      throw new Error("Refresh failed");
    });

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();
    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));
    await waitForCondition("Package refresh error was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain("A technical error occurred.");
    expect(getContainer().querySelector("[data-testid='workspace-import-success']")).toBeNull();
    expect(getContainer().querySelector("[data-testid='workspace-package-import-preview']")).toBeNull();

    await clickElement(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement));

    expect(requireElement("[data-testid='workspace-package-import-confirm-button']", HTMLButtonElement).disabled).toBe(true);
    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces preview errors through the existing error UI", async () => {
    const file = createZipFile("flashcards.zip");
    previewWorkspacePackageImportMock.mockRejectedValueOnce(new Error("Preview failed"));

    await renderScreen();
    await choosePackageFile(file);
    await waitForCondition("Package preview error was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain("A technical error occurred.");
    expect(document.body.querySelector("[data-testid='app-error-dialog']")).not.toBeNull();
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

    await renderScreen();
    await choosePackageFile(file);
    await waitForCondition("Invalid package guidance was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-import-error']", HTMLParagraphElement).textContent).toContain(
      "This file is not a valid flashcards.zip. Choose a package exported from Flashcards Open Source App.",
    );
    expect(getContainer().querySelector("[data-testid='workspace-package-import-preview']")).toBeNull();
    expect(document.body.querySelector("[data-testid='app-error-dialog']")).toBeNull();
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });
});
