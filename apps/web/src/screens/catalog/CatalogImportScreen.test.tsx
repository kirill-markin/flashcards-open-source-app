// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import type { AppDataContextValue } from "../../appData";
import { AppErrorDialogProvider } from "../../appError/AppErrorContext";
import { I18nProvider } from "../../i18n";
import type {
  Card,
  CatalogPackageInstallConfirmOptions,
  CatalogPackageInstallConfirmResponse,
  CatalogPackageInstallPreviewResponse,
  CatalogPublicSnapshot,
  Deck,
  ResetWorkspaceProgressResponse,
  ReviewFilter,
  SessionInfo,
  WorkspaceResetProgressPreview,
  WorkspaceSummary,
} from "../../types";
import { CatalogImportScreen } from "./CatalogImportScreen";

const packageVersionId = "11111111-1111-4111-8111-111111111111";
const packageId = "22222222-2222-4222-8222-222222222222";
const authorId = "33333333-3333-4333-8333-333333333333";
const workspaceReplicaId = "45268888-5620-5912-9ed1-4bd6f2105aff";

const {
  buildLoginUrlMock,
  confirmCatalogPackageInstallMock,
  getOptionalSessionMock,
  loadPublicCatalogMock,
  previewCatalogPackageInstallMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  buildLoginUrlMock: vi.fn<(returnUrl: string, localeHint: string) => string>(),
  confirmCatalogPackageInstallMock: vi.fn<(
    workspaceId: string,
    requestedPackageVersionId: string,
    options: CatalogPackageInstallConfirmOptions,
  ) => Promise<CatalogPackageInstallConfirmResponse>>(),
  getOptionalSessionMock: vi.fn<() => Promise<SessionInfo | null>>(),
  loadPublicCatalogMock: vi.fn<() => Promise<CatalogPublicSnapshot>>(),
  previewCatalogPackageInstallMock: vi.fn<(
    workspaceId: string,
    requestedPackageVersionId: string,
  ) => Promise<CatalogPackageInstallPreviewResponse>>(),
  useAppDataMock: vi.fn<() => AppDataContextValue>(),
}));

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    buildLoginUrl: buildLoginUrlMock,
    confirmCatalogPackageInstall: confirmCatalogPackageInstallMock,
    getOptionalSession: getOptionalSessionMock,
    isAuthRedirectError: (_error: unknown): boolean => false,
    loadPublicCatalog: loadPublicCatalogMock,
    previewCatalogPackageInstall: previewCatalogPackageInstallMock,
  };
});

vi.mock("../../appData", () => ({
  AppDataProvider: (props: Readonly<{ children: ReactNode }>): ReactNode => props.children,
  useAppData: useAppDataMock,
}));

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

function throwNotUsed(functionName: string): never {
  throw new Error(`${functionName} was not expected in this test`);
}

function createSession(): SessionInfo {
  return {
    userId: "user-1",
    selectedWorkspaceId: "workspace-1",
    authTransport: "session",
    csrfToken: "csrf-token-1",
    preferences: { reviewReactionAnimationsEnabled: true },
    profile: {
      email: "user@example.com",
      locale: "en",
      createdAt: "2026-03-10T00:00:00.000Z",
    },
  };
}

function createWorkspace(workspaceId: string, name: string, isSelected: boolean): WorkspaceSummary {
  return {
    workspaceId,
    name,
    createdAt: "2026-03-10T00:00:00.000Z",
    isSelected,
  };
}

function createCatalogSnapshot(includeVersion: boolean): CatalogPublicSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-02T10:00:00.000Z",
    authors: [{
      authorId,
      slug: "test-author",
      displayName: "Test Author",
      bio: null,
      websiteUrl: null,
    }],
    packages: [{
      packageId,
      authorId,
      slug: "test-package",
      status: "published",
      latestPackageVersionId: packageVersionId,
      versionCount: 1,
      publishedAt: "2026-08-01T10:00:00.000Z",
    }],
    packageVersions: includeVersion ? [{
      packageVersionId,
      packageId,
      versionNumber: 1,
      status: "published",
      slug: "test-package",
      title: "тест",
      summary: "Test package",
      description: "Test package",
      languageTags: ["ru"],
      topicTags: ["test"],
      license: "CC0-1.0",
      contentWarning: null,
      coverMediaAssetId: null,
      cardCount: 2,
      updatedAt: "2026-08-01T10:00:00.000Z",
      publishedAt: "2026-08-01T10:00:00.000Z",
      installUrl: `http://localhost:3000/catalog/import/${packageVersionId}`,
    }] : [],
    cards: [],
    mediaAssets: [],
    collections: [],
    collectionPackages: [],
  };
}

function createInstallPreview(): CatalogPackageInstallPreviewResponse {
  return {
    packageVersion: {
      packageVersionId,
      packageId,
      versionNumber: 1,
      slug: "test-package",
      title: "тест",
      summary: "Test package",
      description: "Test package",
      languageTags: ["ru"],
      topicTags: ["test"],
      license: "CC0-1.0",
      contentWarning: null,
      coverPackageMediaKey: null,
      cardCount: 2,
      createdAt: "2026-08-01T10:00:00.000Z",
      publishedAt: "2026-08-01T10:00:00.000Z",
      author: {
        authorId,
        slug: "test-author",
        displayName: "Test Author",
      },
    },
    summary: { cardCount: 2, mediaAssetCount: 0 },
    tagCounts: [
      { tag: "geography", cardsCount: 2 },
      { tag: "temporary", cardsCount: 1 },
    ],
    defaultOptions: {
      addImportTag: true,
      suggestedImportTag: "import:2026-08-02",
      keptTags: ["geography"],
      removedTags: ["temporary"],
    },
  };
}

function createInstallResult(installId: string): CatalogPackageInstallConfirmResponse {
  return {
    packageVersion: createInstallPreview().packageVersion,
    installedCards: [],
    installedMediaAssets: [],
    summary: {
      cardCount: 2,
      mediaAssetCount: 0,
      installId,
      installedAt: "2026-08-02T10:00:00.000Z",
      keptTagCount: 1,
      removedTagCount: 1,
      importTag: "custom-tag",
    },
  };
}

type Deferred<Result> = Readonly<{
  promise: Promise<Result>;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
}>;

function createDeferred<Result>(): Deferred<Result> {
  let resolvePromise: ((result: Result) => void) | null = null;
  let rejectPromise: ((error: unknown) => void) | null = null;
  const promise = new Promise<Result>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: (result) => {
      if (resolvePromise === null) {
        throw new Error("Deferred promise resolve function is unavailable");
      }
      resolvePromise(result);
    },
    reject: (error) => {
      if (rejectPromise === null) {
        throw new Error("Deferred promise reject function is unavailable");
      }
      rejectPromise(error);
    },
  };
}

function createCatalogInstallConflict(code: string): ApiError {
  return new ApiError({
    statusCode: 409,
    message: "Catalog install already exists",
    code,
    requestId: "request-1",
    retryAfterMs: null,
    endpoint: "POST /catalog/install",
    responseBodyKind: "json",
  });
}

function createAppData(workspaces: ReadonlyArray<WorkspaceSummary>): Mutable<AppDataContextValue> {
  const activeWorkspace = workspaces.find((workspace) => workspace.isSelected) ?? null;
  return {
    sessionLoadState: activeWorkspace === null ? "selecting_workspace" : "ready",
    sessionVerificationState: "verified",
    isSessionVerified: true,
    sessionErrorMessage: "",
    sessionTechnicalError: null,
    session: createSession(),
    activeWorkspace,
    availableWorkspaces: workspaces,
    isChoosingWorkspace: false,
    workspaceSettings: null,
    cloudSettings: activeWorkspace === null ? null : {
      installationId: "55555555-5555-4555-8555-555555555555",
      cloudState: "linked",
      linkedUserId: "user-1",
      linkedWorkspaceId: activeWorkspace.workspaceId,
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

async function waitForCondition(description: string, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (predicate()) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error(description);
}

function setTextInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (valueSetter === undefined) {
    throw new Error("HTML input value setter is unavailable");
  }
  valueSetter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CatalogImportScreen", () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let appData: Mutable<AppDataContextValue>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, "", `/catalog/import/${packageVersionId}?source=exact#install`);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    appData = createAppData([createWorkspace("workspace-1", "Primary", true)]);
    useAppDataMock.mockReset();
    useAppDataMock.mockImplementation(() => appData);
    buildLoginUrlMock.mockReset();
    buildLoginUrlMock.mockReturnValue("https://auth.example.test/login");
    loadPublicCatalogMock.mockReset();
    loadPublicCatalogMock.mockResolvedValue(createCatalogSnapshot(true));
    getOptionalSessionMock.mockReset();
    getOptionalSessionMock.mockResolvedValue(createSession());
    previewCatalogPackageInstallMock.mockReset();
    previewCatalogPackageInstallMock.mockResolvedValue(createInstallPreview());
    confirmCatalogPackageInstallMock.mockReset();
    confirmCatalogPackageInstallMock.mockResolvedValue(createInstallResult(
      "44444444-4444-4444-8444-444444444444",
    ));
    vi.spyOn(crypto, "randomUUID").mockReturnValue("44444444-4444-4444-8444-444444444444");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderRoute(route: string): Promise<void> {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[route]}>
          <I18nProvider>
            <AppErrorDialogProvider>
              <Routes>
                <Route path="/catalog/import/:packageVersionId" element={<CatalogImportScreen />} />
              </Routes>
            </AppErrorDialogProvider>
          </I18nProvider>
        </MemoryRouter>,
      );
    });
  }

  it("rejects a malformed package version before loading the catalog", async () => {
    await renderRoute("/catalog/import/not-a-uuid");
    await waitForCondition("Malformed version error was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-error']") !== null
    ));
    expect(loadPublicCatalogMock).not.toHaveBeenCalled();
  });

  it("reports a missing exact version before loading auth", async () => {
    loadPublicCatalogMock.mockResolvedValue(createCatalogSnapshot(false));
    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Missing version state was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-not-found']") !== null
    ));
    expect(getOptionalSessionMock).not.toHaveBeenCalled();
  });

  it("preserves the complete exact-version return URL for signed-out users", async () => {
    getOptionalSessionMock.mockResolvedValue(null);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Signed-out catalog state was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-signed-out']") !== null
    ));

    expect(container.querySelector("[data-testid='catalog-import-package-summary']")?.textContent).toBe("тест — 2 cards");
    expect(buildLoginUrlMock).toHaveBeenCalledWith(
      `http://localhost:3000/catalog/import/${packageVersionId}?source=exact#install`,
      "en",
    );
  });

  it("renders a fixed single workspace and an actionable multi-workspace selector", async () => {
    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Single workspace state was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-workspace-fixed']") !== null
    ));
    expect(container.querySelector("[data-testid='catalog-import-workspace-name']")?.textContent).toBe("Primary");

    appData = createAppData([
      createWorkspace("workspace-1", "Primary", true),
      createWorkspace("workspace-2", "Secondary", false),
    ]);
    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Multi-workspace selector was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-workspace-selector']") !== null
    ));
    const secondWorkspaceButton = container.querySelector(
      "[data-testid='catalog-import-workspace-option'][data-workspace-id='workspace-2']",
    );
    if (!(secondWorkspaceButton instanceof HTMLButtonElement)) {
      throw new Error("Secondary workspace button was not found");
    }
    await act(async () => secondWorkspaceButton.click());
    expect(appData.chooseWorkspace).toHaveBeenCalledWith("workspace-2");
  });

  it("locks workspace selection and import controls across conflicting operations", async () => {
    const previewDeferred = createDeferred<CatalogPackageInstallPreviewResponse>();
    const selectionDeferred = createDeferred<void>();
    const installDeferred = createDeferred<CatalogPackageInstallConfirmResponse>();
    previewCatalogPackageInstallMock.mockImplementationOnce(() => previewDeferred.promise);
    confirmCatalogPackageInstallMock.mockImplementationOnce(() => installDeferred.promise);
    appData = createAppData([
      createWorkspace("workspace-1", "Primary", true),
      createWorkspace("workspace-2", "Secondary", false),
    ]);
    appData.chooseWorkspace = vi.fn(() => selectionDeferred.promise);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Initial catalog preview did not start", () => (
      previewCatalogPackageInstallMock.mock.calls.length === 1
    ));
    const secondWorkspaceButton = container.querySelector(
      "[data-testid='catalog-import-workspace-option'][data-workspace-id='workspace-2']",
    );
    const previewButton = container.querySelector("[data-testid='workspace-package-import-button']");
    if (!(secondWorkspaceButton instanceof HTMLButtonElement) || !(previewButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog import locking controls were not found");
    }
    expect(secondWorkspaceButton.disabled).toBe(true);
    expect(previewButton.disabled).toBe(true);

    await act(async () => previewDeferred.resolve(createInstallPreview()));
    await waitForCondition("Catalog preview did not finish", () => (
      container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    await act(async () => secondWorkspaceButton.click());
    await waitForCondition("Workspace selection did not start", () => (
      vi.mocked(appData.chooseWorkspace).mock.calls.length === 1
    ));
    const tagCheckbox = container.querySelector("[data-testid='workspace-package-import-tag-checkbox']");
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(tagCheckbox instanceof HTMLInputElement) || !(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog import controls were not rendered during workspace selection");
    }
    expect(secondWorkspaceButton.disabled).toBe(true);
    expect(tagCheckbox.disabled).toBe(true);
    expect(confirmButton.disabled).toBe(true);

    await act(async () => selectionDeferred.resolve());
    await waitForCondition("Catalog preview did not recover after workspace selection", () => (
      previewCatalogPackageInstallMock.mock.calls.length === 2
      && container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const recoveredConfirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(recoveredConfirmButton instanceof HTMLButtonElement)) {
      throw new Error("Recovered catalog confirm button was not found");
    }
    await act(async () => recoveredConfirmButton.click());
    await waitForCondition("Catalog install did not start", () => (
      confirmCatalogPackageInstallMock.mock.calls.length === 1
    ));
    expect(secondWorkspaceButton.disabled).toBe(true);

    await act(async () => installDeferred.resolve(createInstallResult(
      "44444444-4444-4444-8444-444444444444",
    )));
  });

  it("ignores an install result after the workspace identity changes", async () => {
    const installDeferred = createDeferred<CatalogPackageInstallConfirmResponse>();
    confirmCatalogPackageInstallMock.mockImplementationOnce(() => installDeferred.promise);
    appData = createAppData([
      createWorkspace("workspace-1", "Primary", true),
      createWorkspace("workspace-2", "Secondary", false),
    ]);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog preview was not rendered", () => (
      container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog confirm button was not found");
    }
    await act(async () => confirmButton.click());
    await waitForCondition("Catalog install did not start", () => (
      confirmCatalogPackageInstallMock.mock.calls.length === 1
    ));

    appData = createAppData([
      createWorkspace("workspace-1", "Primary", false),
      createWorkspace("workspace-2", "Secondary", true),
    ]);
    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("The new workspace preview did not load", () => (
      previewCatalogPackageInstallMock.mock.calls.some(([workspaceId]) => workspaceId === "workspace-2")
    ));

    await act(async () => installDeferred.resolve(createInstallResult(
      "44444444-4444-4444-8444-444444444444",
    )));
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-testid='workspace-import-success']")).toBeNull();
    expect(appData.refreshLocalData).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='workspace-package-import-preview']")).not.toBeNull();
  });

  it("waits for first workspace bootstrap and submits the derived replica identity", async () => {
    const bootstrapDeferred = createDeferred<void>();
    appData.refreshLocalData = vi.fn()
      .mockImplementationOnce(() => bootstrapDeferred.promise)
      .mockResolvedValue(undefined);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog preview was not rendered", () => (
      container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog confirm button was not found");
    }

    await act(async () => confirmButton.click());
    await waitForCondition("Workspace bootstrap readiness was not requested", () => (
      vi.mocked(appData.refreshLocalData).mock.calls.length === 1
    ));
    expect(confirmCatalogPackageInstallMock).not.toHaveBeenCalled();
    expect(confirmButton.disabled).toBe(true);

    await act(async () => bootstrapDeferred.resolve());
    await waitForCondition("Catalog install did not start after workspace bootstrap", () => (
      confirmCatalogPackageInstallMock.mock.calls.length === 1
    ));
    expect(confirmCatalogPackageInstallMock.mock.calls[0]?.[2].lastModifiedByReplicaId).toBe(workspaceReplicaId);
  });

  it("submits selected tag options, shows success, and completes normal sync", async () => {
    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog preview was not rendered", () => (
      container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const importTagInput = container.querySelector("[data-testid='workspace-package-import-tag-input']");
    const geographyCheckbox = container.querySelector(
      "[data-testid='workspace-package-remove-tag-checkbox'][data-tag='geography']",
    );
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(importTagInput instanceof HTMLInputElement)
      || !(geographyCheckbox instanceof HTMLInputElement)
      || !(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog import controls were not found");
    }

    await act(async () => setTextInputValue(importTagInput, "custom-tag"));
    await act(async () => geographyCheckbox.click());
    await act(async () => confirmButton.click());
    await waitForCondition("Catalog import success was not rendered", () => (
      container.querySelector("[data-testid='workspace-import-success']") !== null
    ));

    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledWith(
      "workspace-1",
      packageVersionId,
      expect.objectContaining({
        addImportTag: true,
        importTag: "custom-tag",
        removeTags: ["temporary", "geography"],
        installId: "44444444-4444-4444-8444-444444444444",
        operationIdPrefix: "44444444-4444-4444-8444-444444444444",
        lastModifiedByReplicaId: workspaceReplicaId,
      }),
    );
    expect(appData.refreshLocalData).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-testid='workspace-import-success']")?.textContent).toContain("Imported 2 cards with tag custom-tag");
  });

  it.each([
    "CATALOG_PACKAGE_INSTALL_ID_ALREADY_EXISTS",
    "CATALOG_PACKAGE_INSTALL_OPERATION_ALREADY_EXISTS",
  ])("reuses one install identity after an ambiguous response and reconciles %s", async (conflictCode) => {
    confirmCatalogPackageInstallMock
      .mockRejectedValueOnce(new Error("Catalog install response was lost"))
      .mockRejectedValueOnce(createCatalogInstallConflict(conflictCode));

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog preview was not rendered", () => (
      container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog confirm button was not found");
    }
    await act(async () => confirmButton.click());
    await waitForCondition("Ambiguous catalog install failure was not rendered", () => (
      container.querySelector("[data-testid='workspace-import-error']") !== null
    ));
    const lockedTagInput = container.querySelector("[data-testid='workspace-package-import-tag-input']");
    if (!(lockedTagInput instanceof HTMLInputElement)) {
      throw new Error("Catalog import tag input was not found after failure");
    }
    expect(lockedTagInput.disabled).toBe(true);
    expect(confirmButton.disabled).toBe(false);

    await act(async () => confirmButton.click());
    await waitForCondition("Catalog install conflict was not reconciled", () => (
      container.querySelector("[data-testid='workspace-import-success']") !== null
      && vi.mocked(appData.refreshLocalData).mock.calls.length === 2
    ));

    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(2);
    const firstOptions = confirmCatalogPackageInstallMock.mock.calls[0]?.[2];
    const retryOptions = confirmCatalogPackageInstallMock.mock.calls[1]?.[2];
    expect(firstOptions?.installId).toBe("44444444-4444-4444-8444-444444444444");
    expect(retryOptions).toEqual(firstOptions);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("creates a new install identity only after an explicit repeat preview", async () => {
    const firstInstallId = "44444444-4444-4444-8444-444444444444";
    const secondInstallId = "66666666-6666-4666-8666-666666666666";
    vi.mocked(crypto.randomUUID)
      .mockReturnValueOnce(firstInstallId)
      .mockReturnValueOnce(secondInstallId);
    confirmCatalogPackageInstallMock
      .mockResolvedValueOnce(createInstallResult(firstInstallId))
      .mockResolvedValueOnce(createInstallResult(secondInstallId));

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog preview was not rendered", () => (
      container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const firstConfirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(firstConfirmButton instanceof HTMLButtonElement)) {
      throw new Error("First catalog confirm button was not found");
    }
    await act(async () => firstConfirmButton.click());
    await waitForCondition("First catalog install did not finish", () => (
      container.querySelector("[data-testid='workspace-import-success']") !== null
      && vi.mocked(appData.refreshLocalData).mock.calls.length === 2
    ));

    const repeatButton = container.querySelector("[data-testid='workspace-package-import-button']");
    if (!(repeatButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog repeat preview button was not found");
    }
    await act(async () => repeatButton.click());
    await waitForCondition("Repeat catalog preview was not rendered", () => (
      previewCatalogPackageInstallMock.mock.calls.length === 2
      && container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const secondConfirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(secondConfirmButton instanceof HTMLButtonElement)) {
      throw new Error("Second catalog confirm button was not found");
    }
    await act(async () => secondConfirmButton.click());
    await waitForCondition("Second catalog install did not finish", () => (
      confirmCatalogPackageInstallMock.mock.calls.length === 2
      && vi.mocked(appData.refreshLocalData).mock.calls.length === 4
    ));

    expect(confirmCatalogPackageInstallMock.mock.calls.map((call) => call[2].installId)).toEqual([
      firstInstallId,
      secondInstallId,
    ]);
  });

  it("keeps a queued post-install sync failure retryable without repeating the install", async () => {
    const queuedSyncDeferred = createDeferred<void>();
    appData.refreshLocalData = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => queuedSyncDeferred.promise)
      .mockResolvedValueOnce(undefined);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog preview was not rendered", () => (
      container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog confirm button was not found");
    }
    await act(async () => confirmButton.click());
    await waitForCondition("Queued catalog sync did not start", () => (
      vi.mocked(appData.refreshLocalData).mock.calls.length === 2
      && container.querySelector("[data-testid='catalog-import-syncing']") !== null
    ));
    await act(async () => queuedSyncDeferred.reject(new Error("Queued sync unavailable")));
    await waitForCondition("Catalog sync failure was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-sync-error']") !== null
    ));
    expect(container.querySelector("[data-testid='workspace-import-success']")).not.toBeNull();

    const syncRetryButton = container.querySelector("[data-testid='catalog-import-sync-retry']");
    if (!(syncRetryButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog sync retry button was not found");
    }
    await act(async () => syncRetryButton.click());
    await waitForCondition("Catalog sync retry did not finish", () => (
      vi.mocked(appData.refreshLocalData).mock.calls.length === 3
      && container.querySelector("[data-testid='catalog-import-sync-error']") === null
    ));

    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='workspace-import-success']")).not.toBeNull();
  });

  it("keeps preview failures retryable in place", async () => {
    previewCatalogPackageInstallMock
      .mockRejectedValueOnce(new Error("Preview failed"))
      .mockResolvedValueOnce(createInstallPreview());

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Preview error was not rendered", () => (
      container.querySelector("[data-testid='workspace-import-error']") !== null
    ));
    const retryButton = container.querySelector("[data-testid='workspace-package-import-button']");
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error("Preview retry button was not found");
    }
    await act(async () => retryButton.click());
    await waitForCondition("Preview retry did not succeed", () => (
      previewCatalogPackageInstallMock.mock.calls.length === 2
      && container.querySelector("[data-testid='workspace-package-import-preview']") !== null
    ));
  });
});
