// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDataContextValue } from "../../../appData";
import { AppErrorDialogProvider } from "../../../appError/AppErrorContext";
import { I18nProvider } from "../../../i18n";
import type {
  Card,
  Deck,
  ResetWorkspaceProgressResponse,
  ReviewFilter,
  WorkspacePackageExportDownloadResult,
  WorkspacePackageExportPreviewResponse,
  WorkspacePackageExportRequest,
  WorkspacePackageImportConfirmOptions,
  WorkspacePackageImportConfirmResponse,
  WorkspacePackageImportPreviewResponse,
  WorkspaceResetProgressPreview,
} from "../../../types";
import { WorkspaceExportScreen } from "./WorkspaceExportScreen";

type ExportWorkspaceCardsCsvParams = Parameters<typeof import("../../../workspaceExport").exportWorkspaceCardsCsv>[0];

const {
  confirmWorkspacePackageImportMock,
  downloadWorkspacePackageExportMock,
  exportWorkspaceCardsCsvMock,
  previewWorkspacePackageExportMock,
  previewWorkspacePackageImportMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  confirmWorkspacePackageImportMock: vi.fn<(
    workspaceId: string,
    file: File,
    options: WorkspacePackageImportConfirmOptions,
  ) => Promise<WorkspacePackageImportConfirmResponse>>(),
  downloadWorkspacePackageExportMock: vi.fn<(
    workspaceId: string,
    request: WorkspacePackageExportRequest,
  ) => Promise<WorkspacePackageExportDownloadResult>>(),
  exportWorkspaceCardsCsvMock: vi.fn<(params: ExportWorkspaceCardsCsvParams) => Promise<void>>(),
  previewWorkspacePackageExportMock: vi.fn<(
    workspaceId: string,
    request: WorkspacePackageExportRequest,
  ) => Promise<WorkspacePackageExportPreviewResponse>>(),
  previewWorkspacePackageImportMock: vi.fn<(
    workspaceId: string,
    fileOrBlob: Blob,
  ) => Promise<WorkspacePackageImportPreviewResponse>>(),
  useAppDataMock: vi.fn<() => AppDataContextValue>(),
}));

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api")>();
  return {
    ...actual,
    confirmWorkspacePackageImport: confirmWorkspacePackageImportMock,
    downloadWorkspacePackageExport: downloadWorkspacePackageExportMock,
    previewWorkspacePackageExport: previewWorkspacePackageExportMock,
    previewWorkspacePackageImport: previewWorkspacePackageImportMock,
  };
});

vi.mock("../../../workspaceExport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../workspaceExport")>();
  return {
    ...actual,
    exportWorkspaceCardsCsv: exportWorkspaceCardsCsvMock,
  };
});

vi.mock("../../../appData", () => ({
  useAppData: useAppDataMock,
}));

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

type WorkspaceExportScreenHarness = Readonly<{
  getAppData: () => Mutable<AppDataContextValue>;
  getContainer: () => HTMLDivElement;
  renderScreen: () => Promise<void>;
}>;

function throwNotUsed(functionName: string): never {
  throw new Error(`${functionName} was not expected in this test`);
}

function createExportPreviewResponse(): WorkspacePackageExportPreviewResponse {
  return {
    selectedCardCount: 3,
    availableTagCounts: [
      { tag: "geography", cardsCount: 2 },
      { tag: "temporary", cardsCount: 1 },
    ],
    tagsSelectedForRemoval: [
      { tag: "temporary", cardsCount: 1 },
    ],
    referencedMediaCount: 2,
    approximateReferencedMediaBytes: 1536,
    defaultPackageMetadata: {
      label: "Primary export",
      author: "Export author",
      comment: "Export comment",
      createdAt: "2026-04-01T09:00:00.000Z",
      sourceUrl: "https://example.com/export",
    },
  };
}

function createExportPreviewResponseWithMetadata(
  defaultPackageMetadata: WorkspacePackageExportPreviewResponse["defaultPackageMetadata"],
): WorkspacePackageExportPreviewResponse {
  return {
    ...createExportPreviewResponse(),
    defaultPackageMetadata,
  };
}

function createExportDownloadResult(): WorkspacePackageExportDownloadResult {
  return {
    blob: new Blob([new Uint8Array([80, 75, 3, 4])], { type: "application/zip" }),
    filename: "backend-flashcards.zip",
    contentType: "application/zip",
  };
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

function setupWorkspaceExportScreen(): WorkspaceExportScreenHarness {
  let appData: Mutable<AppDataContextValue> | null = null;
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppDataMock.mockReset();
    previewWorkspacePackageExportMock.mockReset();
    downloadWorkspacePackageExportMock.mockReset();
    exportWorkspaceCardsCsvMock.mockReset();
    previewWorkspacePackageImportMock.mockReset();
    confirmWorkspacePackageImportMock.mockReset();
    appData = createAppData();
    useAppDataMock.mockReturnValue(appData);
    previewWorkspacePackageExportMock.mockResolvedValue(createExportPreviewResponse());
    downloadWorkspacePackageExportMock.mockResolvedValue(createExportDownloadResult());
    exportWorkspaceCardsCsvMock.mockResolvedValue(undefined);
    previewWorkspacePackageImportMock.mockResolvedValue(createPreviewResponse());
    confirmWorkspacePackageImportMock.mockResolvedValue(createConfirmResponse());
    vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((_blob: Blob): string => "blob:workspace-package-export"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn((_objectUrl: string): void => undefined),
    });
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
      throw new Error("Workspace export test app data is not ready");
    }

    return appData;
  }

  function getContainer(): HTMLDivElement {
    if (container === null) {
      throw new Error("Workspace export test container is not ready");
    }

    return container;
  }

  async function renderScreen(): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Workspace export test root is not ready");
    }

    await act(async () => {
      currentRoot.render(
        <I18nProvider>
          <AppErrorDialogProvider>
            <WorkspaceExportScreen />
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
} = setupWorkspaceExportScreen();

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

async function waitForPreview(): Promise<void> {
  await waitForCondition("Package preview did not finish", () => (
    previewWorkspacePackageImportMock.mock.calls.length > 0
      && getContainer().querySelector("[data-testid='workspace-package-import-preview']") !== null
  ));
}

async function waitForExportPreview(): Promise<void> {
  await waitForCondition("Package export preview did not finish", () => (
    previewWorkspacePackageExportMock.mock.calls.length > 0
      && getContainer().querySelector("[data-testid='workspace-package-export-preview']") !== null
  ));
}

async function waitForConfirm(): Promise<void> {
  await waitForCondition("Package import confirm did not finish", () => (
    confirmWorkspacePackageImportMock.mock.calls.length > 0
  ));
}

async function waitForExportDownload(): Promise<void> {
  await waitForCondition("Package export download did not finish", () => (
    downloadWorkspacePackageExportMock.mock.calls.length > 0
  ));
}

async function waitForCsvExport(): Promise<void> {
  await waitForCondition("CSV export did not finish", () => (
    exportWorkspaceCardsCsvMock.mock.calls.length > 0
  ));
}

function readExportDownloadRequest(): WorkspacePackageExportRequest {
  const request = downloadWorkspacePackageExportMock.mock.calls[0]?.[1];
  if (request === undefined) {
    throw new Error("Package export download request was not captured");
  }

  return request;
}

function readConfirmOptions(): WorkspacePackageImportConfirmOptions {
  const options = confirmWorkspacePackageImportMock.mock.calls[0]?.[2];
  if (options === undefined) {
    throw new Error("Package import confirm options were not captured");
  }

  return options;
}

describe("WorkspaceExportScreen package export", () => {
  it("previews all active cards with default options and displays export details", async () => {
    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-export-button']", HTMLButtonElement));
    await waitForExportPreview();

    expect(previewWorkspacePackageExportMock).toHaveBeenCalledWith("workspace-1", {
      selection: {
        kind: "allActiveCards",
      },
      tagPolicy: {
        additionalRemovedTags: [],
      },
      packageMetadata: {
        label: null,
        author: null,
        comment: null,
        createdAt: null,
        sourceUrl: null,
      },
    });
    expect(requireElement("[data-testid='workspace-package-export-preview-card-count']", HTMLElement).textContent).toBe("3");
    expect(requireElement("[data-testid='workspace-package-export-preview-referenced-media-count']", HTMLElement).textContent).toBe("2");
    expect(requireElement("[data-testid='workspace-package-export-preview-referenced-media-bytes']", HTMLElement).textContent).toBe("1.5 KB");
    expect(requireElement("[data-testid='workspace-package-export-preview-metadata']", HTMLElement).textContent).toContain("Primary export");
    expect(requireElement("[data-testid='workspace-package-export-preview-metadata']", HTMLElement).textContent).toContain("Export author");
    expect(requireElement("[data-testid='workspace-package-export-preview-metadata']", HTMLElement).textContent).toContain("Export comment");
    expect(requireElement("[data-testid='workspace-package-export-preview-metadata']", HTMLElement).textContent).toContain("https://example.com/export");
    expect(requireElement(
      "[data-testid='workspace-package-export-remove-tag-checkbox'][data-tag='temporary']",
      HTMLInputElement,
    ).checked).toBe(true);
    expect(requireElement(
      "[data-testid='workspace-package-export-remove-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    ).checked).toBe(false);
    expect(downloadWorkspacePackageExportMock).not.toHaveBeenCalled();
  });

  it("uses the current export tag removal checkbox state when downloading", async () => {
    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-export-button']", HTMLButtonElement));
    await waitForExportPreview();

    await clickElement(requireElement(
      "[data-testid='workspace-package-export-remove-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    ));
    await clickElement(requireElement("[data-testid='workspace-package-export-confirm-button']", HTMLButtonElement));
    await waitForExportDownload();

    expect(readExportDownloadRequest().tagPolicy.additionalRemovedTags).toEqual(["temporary", "geography"]);
  });

  it("downloads the backend ZIP with default metadata and returned filename", async () => {
    const downloadResult = createExportDownloadResult();
    let clickedDownloadName = "";
    let clickedHref = "";
    previewWorkspacePackageExportMock.mockResolvedValueOnce(createExportPreviewResponseWithMetadata({
      label: "Backend default label",
      author: "Backend author",
      createdAt: "2026-04-02T10:00:00.000Z",
    }));
    downloadWorkspacePackageExportMock.mockResolvedValueOnce(downloadResult);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function handleClick(this: HTMLAnchorElement): void {
      clickedDownloadName = this.download;
      clickedHref = this.href;
    });

    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-export-button']", HTMLButtonElement));
    await waitForExportPreview();
    await clickElement(requireElement("[data-testid='workspace-package-export-confirm-button']", HTMLButtonElement));
    await waitForCondition("Package export success was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-export-success']") !== null
    ));

    expect(downloadWorkspacePackageExportMock).toHaveBeenCalledWith("workspace-1", {
      selection: {
        kind: "allActiveCards",
      },
      tagPolicy: {
        additionalRemovedTags: ["temporary"],
      },
      packageMetadata: {
        label: "Backend default label",
        author: "Backend author",
        comment: null,
        createdAt: "2026-04-02T10:00:00.000Z",
        sourceUrl: null,
      },
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(downloadResult.blob);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:workspace-package-export");
    expect(clickedDownloadName).toBe("backend-flashcards.zip");
    expect(clickedHref).toBe("blob:workspace-package-export");
    expect(requireElement("[data-testid='workspace-export-success']", HTMLParagraphElement).textContent).toContain("flashcards.zip download started.");
  });

  it("surfaces export preview errors through the existing error UI", async () => {
    previewWorkspacePackageExportMock.mockRejectedValueOnce(new Error("Export preview failed"));

    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-export-button']", HTMLButtonElement));
    await waitForCondition("Package export preview error was not shown", () => (
      getContainer().querySelector("[data-testid='workspace-export-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-export-error']", HTMLParagraphElement).textContent).toContain("A technical error occurred.");
    expect(getContainer().querySelector("[data-testid='workspace-package-export-preview']")).toBeNull();
    expect(downloadWorkspacePackageExportMock).not.toHaveBeenCalled();
  });

  it("keeps CSV export on the existing CSV helper path", async () => {
    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-csv-export-button']", HTMLButtonElement));
    await waitForCsvExport();

    expect(exportWorkspaceCardsCsvMock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-1",
      workspaceName: "Primary",
      document: window.document,
      urlApi: URL,
    }));
    expect(previewWorkspacePackageExportMock).not.toHaveBeenCalled();
    expect(downloadWorkspacePackageExportMock).not.toHaveBeenCalled();
  });
});

describe("WorkspaceExportScreen package import", () => {
  it("initializes the import tag option from preview defaults", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();

    const checkbox = requireElement("[data-testid='workspace-package-import-tag-checkbox']", HTMLInputElement);
    const importTag = requireElement("[data-testid='workspace-package-import-preview-import-tag']", HTMLParagraphElement);

    expect(checkbox.checked).toBe(true);
    expect(importTag.textContent).toContain("import:2026-07-01");
  });

  it("previews a chosen ZIP and displays package counts and details", async () => {
    const file = createZipFile("flashcards.zip");

    await renderScreen();
    await choosePackageFile(file);
    await waitForPreview();

    expect(previewWorkspacePackageImportMock).toHaveBeenCalledWith("workspace-1", file);
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
    expect(getContainer().querySelector("[data-testid='workspace-export-error']")).toBeNull();
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
      getContainer().querySelector("[data-testid='workspace-export-success']") !== null
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
    expect(requireElement("[data-testid='workspace-export-success']", HTMLParagraphElement).textContent).toContain("Imported 2 cards with tag import:2026-07-01.");
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
      getContainer().querySelector("[data-testid='workspace-export-error']") !== null
    ));

    expect(confirmWorkspacePackageImportMock).toHaveBeenCalledTimes(1);
    expect(requireElement("[data-testid='workspace-export-error']", HTMLParagraphElement).textContent).toContain("A technical error occurred.");
    expect(getContainer().querySelector("[data-testid='workspace-export-success']")).toBeNull();
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
      getContainer().querySelector("[data-testid='workspace-export-error']") !== null
    ));

    expect(requireElement("[data-testid='workspace-export-error']", HTMLParagraphElement).textContent).toContain("A technical error occurred.");
    expect(confirmWorkspacePackageImportMock).not.toHaveBeenCalled();
  });
});
