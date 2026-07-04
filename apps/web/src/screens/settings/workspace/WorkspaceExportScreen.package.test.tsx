// @vitest-environment jsdom
import { act } from "react";
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
  WorkspaceResetProgressPreview,
} from "../../../types";
import { WorkspaceExportScreen } from "./WorkspaceExportScreen";

const {
  downloadWorkspacePackageExportMock,
  previewWorkspacePackageExportMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  downloadWorkspacePackageExportMock: vi.fn<(
    workspaceId: string,
    request: WorkspacePackageExportRequest,
  ) => Promise<WorkspacePackageExportDownloadResult>>(),
  previewWorkspacePackageExportMock: vi.fn<(
    workspaceId: string,
    request: WorkspacePackageExportRequest,
  ) => Promise<WorkspacePackageExportPreviewResponse>>(),
  useAppDataMock: vi.fn<() => AppDataContextValue>(),
}));

vi.mock("../../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api")>();
  return {
    ...actual,
    downloadWorkspacePackageExport: downloadWorkspacePackageExportMock,
    previewWorkspacePackageExport: previewWorkspacePackageExportMock,
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
      { tag: "import:2026-07-01", cardsCount: 1 },
    ],
    tagsSelectedForRemoval: [
      { tag: "import:2026-07-01", cardsCount: 1 },
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

function createTagFilteredExportPreviewResponse(): WorkspacePackageExportPreviewResponse {
  return {
    ...createExportPreviewResponse(),
    selectedCardCount: 2,
    availableTagCounts: [
      { tag: "geography", cardsCount: 2 },
      { tag: "shared", cardsCount: 1 },
      { tag: "import:2026-07-01", cardsCount: 1 },
    ],
    tagsSelectedForRemoval: [
      { tag: "import:2026-07-01", cardsCount: 1 },
    ],
  };
}

function createExportDownloadResult(): WorkspacePackageExportDownloadResult {
  return {
    blob: new Blob([new Uint8Array([80, 75, 3, 4])], { type: "application/zip" }),
    filename: "backend-flashcards.zip",
    contentType: "application/zip",
  };
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
    appData = createAppData();
    useAppDataMock.mockReturnValue(appData);
    previewWorkspacePackageExportMock.mockResolvedValue(createExportPreviewResponse());
    downloadWorkspacePackageExportMock.mockResolvedValue(createExportDownloadResult());
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

async function clickElement(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

async function waitForExportPreview(): Promise<void> {
  await waitForCondition("Package export preview did not finish", () => (
    previewWorkspacePackageExportMock.mock.calls.length > 0
      && getContainer().querySelector("[data-testid='workspace-package-export-preview']") !== null
  ));
}

async function waitForExportPreviewCallCount(callCount: number): Promise<void> {
  await waitForCondition(`Package export preview did not reach ${callCount} calls`, () => (
    previewWorkspacePackageExportMock.mock.calls.length >= callCount
      && getContainer().querySelector("[data-testid='workspace-package-export-preview']") !== null
  ));
}

async function waitForExportDownload(): Promise<void> {
  await waitForCondition("Package export download did not finish", () => (
    downloadWorkspacePackageExportMock.mock.calls.length > 0
  ));
}

function readExportDownloadRequest(): WorkspacePackageExportRequest {
  const request = downloadWorkspacePackageExportMock.mock.calls[0]?.[1];
  if (request === undefined) {
    throw new Error("Package export download request was not captured");
  }

  return request;
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
    expect(requireElement("[data-testid='workspace-package-export-all-cards-radio']", HTMLInputElement).checked).toBe(true);
    expect(requireElement(
      "[data-testid='workspace-package-export-card-selection-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    ).checked).toBe(false);
    expect(requireElement(
      "[data-testid='workspace-package-export-included-tag-checkbox'][data-tag='temporary']",
      HTMLInputElement,
    ).checked).toBe(true);
    expect(requireElement(
      "[data-testid='workspace-package-export-included-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    ).checked).toBe(true);
    expect(getContainer().querySelector(
      "[data-testid='workspace-package-export-included-tag-checkbox'][data-tag='import:2026-07-01']",
    )).toBeNull();
    expect(downloadWorkspacePackageExportMock).not.toHaveBeenCalled();
  });

  it("previews a tag-filter card selection when a card tag is selected", async () => {
    previewWorkspacePackageExportMock.mockImplementation(async (_workspaceId, request): Promise<WorkspacePackageExportPreviewResponse> => (
      request.selection.kind === "tagFilters"
        ? createTagFilteredExportPreviewResponse()
        : createExportPreviewResponse()
    ));

    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-export-button']", HTMLButtonElement));
    await waitForExportPreviewCallCount(1);
    await clickElement(requireElement(
      "[data-testid='workspace-package-export-card-selection-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    ));
    await waitForExportPreviewCallCount(2);

    expect(previewWorkspacePackageExportMock.mock.calls[1]?.[1].selection).toEqual({
      kind: "tagFilters",
      includeTags: ["geography"],
      excludeTags: [],
    });
    expect(requireElement("[data-testid='workspace-package-export-preview-card-count']", HTMLElement).textContent).toBe("2");
    expect(requireElement(
      "[data-testid='workspace-package-export-card-selection-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    ).checked).toBe(true);
    expect(requireElement(
      "[data-testid='workspace-package-export-included-tag-checkbox'][data-tag='shared']",
      HTMLInputElement,
    ).checked).toBe(true);
    expect(getContainer().querySelector(
      "[data-testid='workspace-package-export-included-tag-checkbox'][data-tag='temporary']",
    )).toBeNull();
  });

  it("maps excluded package tags to additional removed tags when downloading", async () => {
    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-export-button']", HTMLButtonElement));
    await waitForExportPreview();

    await clickElement(requireElement(
      "[data-testid='workspace-package-export-included-tag-checkbox'][data-tag='geography']",
      HTMLInputElement,
    ));
    await clickElement(requireElement("[data-testid='workspace-package-export-confirm-button']", HTMLButtonElement));
    await waitForExportDownload();

    expect(readExportDownloadRequest()).toMatchObject({
      selection: {
        kind: "allActiveCards",
      },
      tagPolicy: {
        additionalRemovedTags: ["geography"],
      },
    });
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
        additionalRemovedTags: [],
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

  it("resets the preview when the active workspace changes before download", async () => {
    await renderScreen();
    await clickElement(requireElement("[data-testid='workspace-package-export-button']", HTMLButtonElement));
    await waitForExportPreview();

    getAppData().activeWorkspace = {
      workspaceId: "workspace-2",
      name: "Secondary",
      createdAt: "2026-03-11T00:00:00.000Z",
      isSelected: true,
    };
    await renderScreen();
    await waitForCondition("Package export preview was not reset after workspace change", () => (
      getContainer().querySelector("[data-testid='workspace-package-export-preview']") === null
    ));

    expect(getContainer().querySelector("[data-testid='workspace-package-export-confirm-button']")).toBeNull();
    expect(downloadWorkspacePackageExportMock).not.toHaveBeenCalled();
  });
});
