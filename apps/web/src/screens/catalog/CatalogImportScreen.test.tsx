// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, useEffect, useState, type ReactElement, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, Route, Routes, useParams } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishAnalyticsConsentJurisdiction } from "../../analytics/consent";
import { ApiError } from "../../api";
import type { AppDataContextValue } from "../../appData";
import { loadSelectedReviewFilterForWorkspace, storeSelectedReviewFilterForWorkspace } from "../../appData/context/reviewFilterPersistence";
import { AppErrorDialogProvider } from "../../appError/AppErrorContext";
import { I18nProvider } from "../../i18n";
import { replaceCards } from "../../localDb/cards/cards";
import { clearWebSyncCache } from "../../localDb/core/cache";
import { makeCard } from "../../localDb/core/testSupport";
import { loadReviewQueueSnapshot } from "../../localDb/reviews/reviews";
import type {
  Card,
  CatalogPackageInstallConfirmOptions,
  CatalogPackageInstallConfirmResponse,
  CatalogPackageInstallContext,
  CatalogPackageInstallPreviewResponse,
  CatalogPublicPackageVersion,
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
  confirmCatalogPackageInstallMock,
  loadCatalogPackageInstallContextMock,
  loadPublicCatalogPackageVersionMock,
  previewCatalogPackageInstallMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  confirmCatalogPackageInstallMock: vi.fn<(
    workspaceId: string,
    requestedPackageVersionId: string,
    options: CatalogPackageInstallConfirmOptions,
  ) => Promise<CatalogPackageInstallConfirmResponse>>(),
  loadCatalogPackageInstallContextMock: vi.fn<(
    requestedPackageVersionId: string,
  ) => Promise<CatalogPackageInstallContext>>(),
  loadPublicCatalogPackageVersionMock: vi.fn<(
    requestedPackageVersionId: string,
  ) => Promise<CatalogPublicPackageVersion>>(),
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
    confirmCatalogPackageInstall: confirmCatalogPackageInstallMock,
    isAuthRedirectError: (_error: unknown): boolean => false,
    loadCatalogPackageInstallContext: loadCatalogPackageInstallContextMock,
    loadPublicCatalogPackageVersion: loadPublicCatalogPackageVersionMock,
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
    preferences: {
      accentColor: "#FF6719",
      reviewReactionAnimationsEnabled: true,
      firstReviewOnboardingCompleted: true,
      analyticsConsent: null,
      productAnalyticsEnabled: null,
    },
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

function createInstallContext(workspaces: ReadonlyArray<WorkspaceSummary>): CatalogPackageInstallContext {
  return {
    workspaces: workspaces.map((workspace) => ({
      workspaceId: workspace.workspaceId,
      name: workspace.name,
      createdAt: workspace.createdAt,
      isSelected: workspace.isSelected,
      cardCount: 0,
      lastReviewedAt: null,
      onboardingEligibility: "ineligible",
      previousInstall: null,
    })),
  };
}

function createCatalogPackageVersion(): CatalogPublicPackageVersion {
  return {
    packageVersionId,
    packageId,
    versionNumber: 1,
    slug: "test-package",
    title: "тест",
    summary: "Test package",
    languageTags: ["ru"],
    cardCount: 2,
    publishedAt: "2026-08-01T10:00:00.000Z",
    author: {
      authorId,
      slug: "test-author",
      displayName: "Test Author",
    },
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
      addImportTag: false,
      suggestedImportTag: "import:2026-08-02",
      keptTags: ["geography"],
      removedTags: ["temporary"],
    },
  };
}

function createImportedCards(installId: string): ReadonlyArray<Card> {
  return ["imported-1", "imported-2"].map((cardId) => makeCard({
    cardId,
    frontText: `Question ${cardId}`,
    backText: `Answer ${cardId}`,
    tags: ["geography"],
    dueAt: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    metadata: {
      version: 1,
      source: {
        label: "тест", author: "Test Author", comment: null, createdAt: null,
        importedAt: "2026-08-02T10:00:00.000Z", importId: installId,
      },
    },
  }));
}

function CatalogReviewDestination(): ReactElement {
  const { workspaceId } = useParams();
  const [cards, setCards] = useState<ReadonlyArray<Card> | null>(null);
  useEffect(() => {
    if (workspaceId === undefined) throw new Error("Review destination workspace was not found");
    const filter = loadSelectedReviewFilterForWorkspace(workspaceId);
    void loadReviewQueueSnapshot(workspaceId, filter, 20).then((snapshot) => setCards(snapshot.cards));
  }, [workspaceId]);
  return <div data-testid="catalog-review-destination" data-workspace-id={workspaceId}>
    {cards === null ? null : <div data-testid="catalog-review-cards">{cards.map((card) => card.frontText).join(",")}</div>}
  </div>;
}

function createInstallResult(installId: string): CatalogPackageInstallConfirmResponse {
  return {
    packageVersion: createInstallPreview().packageVersion,
    installedCards: createImportedCards(installId).map((card, ordinal) => ({
      packageCardId: `package-card-${ordinal}`, stableCardKey: `stable-${ordinal}`, ordinal: ordinal + 1, cardId: card.cardId,
    })),
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

function createCatalogPublicVersionNotFoundError(): ApiError {
  return new ApiError({
    statusCode: 404,
    message: "Published catalog package version not found.",
    code: "CATALOG_PUBLIC_PACKAGE_VERSION_NOT_FOUND",
    requestId: "request-1",
    retryAfterMs: null,
    endpoint: `GET /catalog/package-versions/${packageVersionId}`,
    responseBodyKind: "json",
  });
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
    firstReviewOnboardingCompleted: true,
    setFirstReviewOnboardingCompleted: vi.fn(async (): Promise<void> => undefined),
    refreshAccountPreferences: vi.fn(async () => ({ accentColor: "#FF6719", reviewReactionAnimationsEnabled: true, firstReviewOnboardingCompleted: true })),
    refreshConnectedAccount: vi.fn(async (): Promise<void> => undefined),
    initialize: vi.fn(async (): Promise<void> => undefined),
    chooseWorkspace: vi.fn(async (_workspaceId: string): Promise<void> => undefined),
    createWorkspace: vi.fn(async (_name: string): Promise<null> => null),
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

  beforeEach(async () => {
    window.localStorage.clear();
    await clearWebSyncCache();
    await replaceCards("workspace-1", [
      ...createImportedCards("44444444-4444-4444-8444-444444444444"),
      makeCard({
        cardId: "unrelated", frontText: "Unrelated question", backText: "Unrelated answer",
        tags: ["unrelated"], dueAt: null, createdAt: "2025-01-01T00:00:00.000Z",
      }),
    ]);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    publishAnalyticsConsentJurisdiction(false);
    window.history.replaceState(null, "", `/catalog/import/${packageVersionId}?source=exact#install`);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    appData = createAppData([createWorkspace("workspace-1", "Primary", true)]);
    useAppDataMock.mockReset();
    useAppDataMock.mockImplementation(() => appData);
    loadCatalogPackageInstallContextMock.mockReset();
    loadCatalogPackageInstallContextMock.mockImplementation(async () => createInstallContext(appData.availableWorkspaces));
    loadPublicCatalogPackageVersionMock.mockReset();
    loadPublicCatalogPackageVersionMock.mockResolvedValue(createCatalogPackageVersion());
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
                <Route path="/w/:workspaceId/review" element={<CatalogReviewDestination />} />
              </Routes>
            </AppErrorDialogProvider>
          </I18nProvider>
        </MemoryRouter>,
      );
    });
  }

  function isConfirmationReady(): boolean {
    const button = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    return button instanceof HTMLButtonElement && !button.disabled;
  }

  async function clickConfirm(): Promise<void> {
    await waitForCondition("Confirmation was not actionable", isConfirmationReady);
    const button = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Confirm button was not found");
    await act(async () => button.click());
  }

  async function clickWorkspaceOption(workspaceId: string): Promise<void> {
    const selector = `[data-testid='catalog-import-workspace-option'][data-workspace-id='${workspaceId}']`;
    await waitForCondition(`Workspace option was not actionable. workspaceId=${workspaceId}`, () => {
      const candidate = container.querySelector(selector);
      return candidate instanceof HTMLButtonElement && candidate.disabled === false;
    });
    const workspaceButton = container.querySelector(selector);
    if (!(workspaceButton instanceof HTMLButtonElement)) {
      throw new Error(`Workspace option was not found. workspaceId=${workspaceId}`);
    }
    await act(async () => workspaceButton.click());
  }

  it("rejects a malformed package version before loading the catalog", async () => {
    await renderRoute("/catalog/import/not-a-uuid");
    await waitForCondition("Malformed version error was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-error']") !== null
    ));
    expect(loadPublicCatalogPackageVersionMock).not.toHaveBeenCalled();
  });

  it("reports a missing exact version before loading auth", async () => {
    loadPublicCatalogPackageVersionMock.mockRejectedValue(createCatalogPublicVersionNotFoundError());
    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Missing version state was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-not-found']") !== null
    ));
    expect(useAppDataMock).not.toHaveBeenCalled();
  });

  it("preserves the complete exact-version URL when admitting a browser guest", async () => {
    appData.session = { ...createSession(), authTransport: "guest", browserGuestCapabilities: {
      isGuest: true, platformFundedAi: false, ownKeyAi: true, requiresAccountLinking: true,
    } };
    appData.cloudSettings = { ...appData.cloudSettings!, cloudState: "guest", linkedEmail: null };

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Guest catalog confirmation was not rendered", () => (
      container.querySelector("[data-testid='catalog-import-confirm']") !== null
    ));

    expect(container.querySelector("[data-testid='catalog-import-package-summary']")?.textContent).toBe("тест — 2 cards");
    expect(previewCatalogPackageInstallMock).toHaveBeenCalledWith("workspace-1", packageVersionId);
    expect(window.location.href).toBe(
      `http://localhost:3000/catalog/import/${packageVersionId}?source=exact#install`,
    );
  });

  it("confirms first, returns with Back and imports immediately into the selected fresh destination", async () => {
    const workspaces = [
      createWorkspace("workspace-1", "Primary", true),
      createWorkspace("workspace-2", "Secondary", false),
    ];
    const context = createInstallContext(workspaces);
    loadCatalogPackageInstallContextMock.mockResolvedValue({
      workspaces: context.workspaces.map((workspace) => ({
        ...workspace, cardCount: workspace.workspaceId === "workspace-1" ? 10 : 2,
        lastReviewedAt: workspace.workspaceId === "workspace-2" ? "2026-08-03T00:00:00.000Z" : null,
      })),
    });
    const chooseWorkspace = vi.mocked(appData.chooseWorkspace);
    chooseWorkspace.mockImplementation(async (workspaceId): Promise<void> => {
      appData = {
        ...createAppData(workspaces.map((workspace) => ({
          ...workspace, isSelected: workspace.workspaceId === workspaceId,
        }))),
        chooseWorkspace,
      };
    });
    await replaceCards("workspace-2", createImportedCards("44444444-4444-4444-8444-444444444444"));
    await renderRoute("/catalog/import/" + packageVersionId);
    expect(appData.availableWorkspaces).toHaveLength(1);
    await waitForCondition("First confirmation was not ready", isConfirmationReady);
    expect(container.querySelector("[data-testid='catalog-import-workspace-selector']")).toBeNull();
    expect(previewCatalogPackageInstallMock).not.toHaveBeenCalled();
    await clickConfirm();
    expect(container.querySelector("[data-testid='catalog-import-workspace-option']")?.getAttribute("data-workspace-id")).toBe("workspace-2");
    const back = container.querySelector("[data-testid='catalog-import-back']");
    if (!(back instanceof HTMLButtonElement)) throw new Error("Back was not found");
    await act(async () => back.click());
    expect(container.querySelector("[data-testid='catalog-import-confirm']")).not.toBeNull();
    expect(confirmCatalogPackageInstallMock).not.toHaveBeenCalled();
    await clickConfirm();
    await clickWorkspaceOption("workspace-2");
    await waitForCondition("Destination selection did not open imported cards", () => (
      container.querySelector("[data-testid='catalog-review-cards']") !== null
    ));
    expect(chooseWorkspace).toHaveBeenCalledWith("workspace-2");
    expect(previewCatalogPackageInstallMock).toHaveBeenCalledWith("workspace-2", packageVersionId);
    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(1);
    expect(confirmCatalogPackageInstallMock.mock.calls[0]?.[0]).toBe("workspace-2");
  });

  it("confirms before choosing a destination when the session has no selected workspace", async () => {
    const workspaces = [
      createWorkspace("workspace-1", "Primary", false),
      createWorkspace("workspace-2", "Secondary", false),
    ];
    appData = createAppData(workspaces);
    appData.session = { ...createSession(), selectedWorkspaceId: null };
    const choose = vi.mocked(appData.chooseWorkspace);
    choose.mockImplementation(async (workspaceId) => {
      appData = {
        ...createAppData(workspaces.map((workspace) => ({ ...workspace, isSelected: workspace.workspaceId === workspaceId }))),
        chooseWorkspace: choose,
      };
    });
    await renderRoute("/catalog/import/" + packageVersionId);
    await waitForCondition("Unselected session confirmation was not ready", isConfirmationReady);
    expect(previewCatalogPackageInstallMock).not.toHaveBeenCalled();
    await clickConfirm();
    await clickWorkspaceOption("workspace-1");
    await waitForCondition("Unselected session did not open imported cards", () => (
      container.querySelector("[data-testid='catalog-review-cards']") !== null
    ));
    expect(choose).toHaveBeenCalledWith("workspace-1");
    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(1);
    expect(confirmCatalogPackageInstallMock.mock.calls[0]?.[0]).toBe("workspace-1");
  });

  it("locks destination selection and repeated import actions across conflicting operations", async () => {
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
    await renderRoute("/catalog/import/" + packageVersionId);
    await clickConfirm();
    await clickWorkspaceOption("workspace-2");
    const secondWorkspaceButton = container.querySelector(
      "[data-testid='catalog-import-workspace-option'][data-workspace-id='workspace-2']",
    );
    if (!(secondWorkspaceButton instanceof HTMLButtonElement)) throw new Error("Destination option was not found");
    expect(secondWorkspaceButton.disabled).toBe(true);
    await act(async () => selectionDeferred.resolve());
    await waitForCondition("Destination options did not unlock", () => !secondWorkspaceButton.disabled);
    expect(confirmCatalogPackageInstallMock).not.toHaveBeenCalled();
    await clickWorkspaceOption("workspace-1");
    await waitForCondition("Destination preview did not start", () => previewCatalogPackageInstallMock.mock.calls.length === 1);
    await act(async () => previewDeferred.resolve(createInstallPreview()));
    await waitForCondition("Destination click did not start import", () => confirmCatalogPackageInstallMock.mock.calls.length === 1);
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    const back = container.querySelector("[data-testid='catalog-import-back']");
    if (!(confirmButton instanceof HTMLButtonElement) || !(back instanceof HTMLButtonElement)) {
      throw new Error("Import controls were not found");
    }
    expect(confirmButton.disabled).toBe(true);
    expect(back.disabled).toBe(true);
    await act(async () => confirmButton.click());
    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(1);
    await act(async () => installDeferred.resolve(createInstallResult("44444444-4444-4444-8444-444444444444")));
  });

  it("ignores an install result after the workspace identity changes", async () => {
    const installDeferred = createDeferred<CatalogPackageInstallConfirmResponse>();
    confirmCatalogPackageInstallMock.mockImplementationOnce(() => installDeferred.promise);
    appData = createAppData([
      createWorkspace("workspace-1", "Primary", true),
      createWorkspace("workspace-2", "Secondary", false),
    ]);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await clickConfirm();
    await clickWorkspaceOption("workspace-1");
    await waitForCondition("Catalog install did not start", () => (
      confirmCatalogPackageInstallMock.mock.calls.length === 1
    ));

    appData = createAppData([
      createWorkspace("workspace-1", "Primary", false),
      createWorkspace("workspace-2", "Secondary", true),
    ]);
    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("The new workspace confirmation was not ready", isConfirmationReady);

    await act(async () => installDeferred.resolve(createInstallResult(
      "44444444-4444-4444-8444-444444444444",
    )));
    await act(async () => Promise.resolve());
    expect(container.querySelector("[data-testid='workspace-import-success']")).toBeNull();
    expect(container.querySelector("[data-testid='catalog-review-cards']")).toBeNull();
    expect(appData.refreshLocalData).not.toHaveBeenCalled();
    expect(appData.openReview).not.toHaveBeenCalled();
    expect(loadSelectedReviewFilterForWorkspace("workspace-2")).toEqual({ kind: "allCards" });
    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-testid='catalog-import-confirm']")).not.toBeNull();
  });

  it("waits for first workspace bootstrap and submits the derived replica identity", async () => {
    const bootstrapDeferred = createDeferred<void>();
    appData.refreshLocalData = vi.fn()
      .mockImplementationOnce(() => bootstrapDeferred.promise)
      .mockResolvedValue(undefined);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog confirmation was not ready", isConfirmationReady);
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

  it("preserves package tags and persists the hydrated copy selection for review", async () => {
    storeSelectedReviewFilterForWorkspace("workspace-1", { kind: "tags", tags: [] });
    await renderRoute("/catalog/import/" + packageVersionId);
    await waitForCondition("Confirmation was not ready", isConfirmationReady);
    expect(container.querySelector("[data-testid='catalog-import-advanced']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-package-import-tag-checkbox']")).toBeNull();
    expect(container.querySelector("[data-testid='catalog-import-create-workspace']")).toBeNull();
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(confirmButton instanceof HTMLButtonElement)) throw new Error("Confirm button was not found");
    await act(async () => confirmButton.click());
    await waitForCondition("Imported cards did not open in review", () => (
      container.querySelector("[data-testid='catalog-review-cards']") !== null
    ));

    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledWith(
      "workspace-1",
      packageVersionId,
      expect.objectContaining({
        addImportTag: false,
        importTag: "",
        removeTags: [],
        installId: "44444444-4444-4444-8444-444444444444",
        operationIdPrefix: "44444444-4444-4444-8444-444444444444",
        lastModifiedByReplicaId: workspaceReplicaId,
      }),
    );
    expect(appData.refreshLocalData).toHaveBeenCalledTimes(2);
    const expectedFilter: ReviewFilter = {
      kind: "catalogImport", importId: "44444444-4444-4444-8444-444444444444", title: "тест",
    };
    expect(appData.openReview).toHaveBeenCalledWith(expectedFilter);
    expect(loadSelectedReviewFilterForWorkspace("workspace-1")).toEqual(expectedFilter);
    expect(container.querySelector("[data-testid='catalog-review-destination']")?.getAttribute("data-workspace-id")).toBe("workspace-1");
    expect(container.querySelector("[data-testid='catalog-review-cards']")?.textContent).toBe("Question imported-1,Question imported-2");
    expect(container.querySelector("[data-testid='catalog-import-success']")).toBeNull();
  });

  it("reuses one install identity after an ambiguous response and accepts the verified replay result", async () => {
    confirmCatalogPackageInstallMock
      .mockRejectedValueOnce(new Error("Catalog install response was lost"))
      .mockResolvedValueOnce(createInstallResult("44444444-4444-4444-8444-444444444444"));

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog confirmation was not ready", isConfirmationReady);
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog confirm button was not found");
    }
    await act(async () => confirmButton.click());
    await waitForCondition("Ambiguous catalog install failure was not rendered", () => (
      container.querySelector("[data-testid='workspace-import-error']") !== null
    ));
    const back = container.querySelector("[data-testid='catalog-import-back']");
    if (!(back instanceof HTMLButtonElement)) throw new Error("Back was not found");
    expect(back.disabled).toBe(true);
    expect(confirmButton.disabled).toBe(false);
    const mintCountBeforeRetry = vi.mocked(crypto.randomUUID).mock.calls.length;

    await act(async () => confirmButton.click());
    await waitForCondition("Catalog install conflict was not reconciled", () => (
      container.querySelector("[data-testid='catalog-review-destination']") !== null
      && vi.mocked(appData.refreshLocalData).mock.calls.length === 2
    ));

    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(2);
    const firstOptions = confirmCatalogPackageInstallMock.mock.calls[0]?.[2];
    const retryOptions = confirmCatalogPackageInstallMock.mock.calls[1]?.[2];
    expect(firstOptions?.installId).toBe("44444444-4444-4444-8444-444444444444");
    expect(retryOptions).toEqual(firstOptions);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(mintCountBeforeRetry);
  });

  it("keeps an unverified operation collision visible and does not start reconciliation sync", async () => {
    confirmCatalogPackageInstallMock.mockRejectedValueOnce(
      createCatalogInstallConflict("CATALOG_PACKAGE_INSTALL_OPERATION_ALREADY_EXISTS"),
    );

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog confirmation was not ready", isConfirmationReady);
    const confirmButton = container.querySelector("[data-testid='workspace-package-import-confirm-button']");
    if (!(confirmButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog confirm button was not found");
    }

    await act(async () => confirmButton.click());
    await waitForCondition("Catalog operation collision was not rendered", () => (
      container.querySelector("[data-testid='workspace-import-error']") !== null
    ));

    expect(container.querySelector("[data-testid='workspace-import-success']")).toBeNull();
    expect(vi.mocked(appData.refreshLocalData)).toHaveBeenCalledTimes(1);
    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(1);
  });

  it("keeps post-install sync and incomplete hydration retryable without repeating the install", async () => {
    await replaceCards("workspace-1", []);
    const queuedSyncDeferred = createDeferred<void>();
    appData.refreshLocalData = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => queuedSyncDeferred.promise)
      .mockResolvedValueOnce(undefined);

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Catalog confirmation was not ready", isConfirmationReady);
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
    expect(container.querySelector("[data-testid='catalog-review-destination']")).toBeNull();
    expect(container.querySelector("[data-testid='workspace-package-import-confirm-button']")).toBeNull();

    const syncRetryButton = container.querySelector("[data-testid='catalog-import-sync-retry']");
    if (!(syncRetryButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog sync retry button was not found");
    }
    await act(async () => syncRetryButton.click());
    await waitForCondition("Incomplete hydration did not remain retryable", () => (
      vi.mocked(appData.refreshLocalData).mock.calls.length === 3
      && container.querySelector("[data-testid='catalog-import-syncing']") === null
      && container.querySelector("[data-testid='catalog-import-sync-error']") !== null
    ));
    expect(appData.openReview).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='catalog-review-destination']")).toBeNull();

    await replaceCards("workspace-1", createImportedCards("44444444-4444-4444-8444-444444444444"));
    const hydrationRetryButton = container.querySelector("[data-testid='catalog-import-sync-retry']");
    if (!(hydrationRetryButton instanceof HTMLButtonElement)) {
      throw new Error("Catalog hydration retry button was not found");
    }
    await act(async () => hydrationRetryButton.click());
    await waitForCondition("Hydrated imported cards did not open", () => (
      vi.mocked(appData.refreshLocalData).mock.calls.length === 4
      && container.querySelector("[data-testid='catalog-review-cards']") !== null
    ));

    expect(confirmCatalogPackageInstallMock).toHaveBeenCalledTimes(1);
    expect(appData.openReview).toHaveBeenCalledWith({
      kind: "catalogImport", importId: "44444444-4444-4444-8444-444444444444", title: "тест",
    });
  });

  it("retries into a successfully created destination without creating it again", async () => {
    appData = createAppData([
      createWorkspace("workspace-1", "Primary", true),
      createWorkspace("workspace-2", "Secondary", false),
    ]);
    const create = vi.mocked(appData.createWorkspace);
    create.mockImplementation(async (name) => {
      const workspace = createWorkspace("workspace-3", name, true);
      appData = {
        ...createAppData([...appData.availableWorkspaces.map((item) => ({ ...item, isSelected: false })), workspace]),
        createWorkspace: create,
      };
      return workspace;
    });
    await replaceCards("workspace-3", createImportedCards("44444444-4444-4444-8444-444444444444"));
    confirmCatalogPackageInstallMock.mockRejectedValueOnce(new Error("Import response unavailable"));
    await renderRoute("/catalog/import/" + packageVersionId);
    await clickConfirm();
    expect(container.querySelector("[data-testid='catalog-import-workspace-name-input']")).toBeNull();
    const showCreateButton = container.querySelector("[data-testid='catalog-import-show-create-workspace']");
    if (!(showCreateButton instanceof HTMLButtonElement)) throw new Error("Create workspace option was not found");
    await act(async () => showCreateButton.click());
    const input = container.querySelector("[data-testid='catalog-import-workspace-name-input']");
    if (!(input instanceof HTMLInputElement)) throw new Error("Workspace name input was not found");
    await act(async () => setTextInputValue(input, "New study"));
    const createButton = container.querySelector("[data-testid='catalog-import-create-workspace']");
    if (!(createButton instanceof HTMLButtonElement)) throw new Error("Create button was not found");
    await act(async () => createButton.click());
    await waitForCondition("Created destination import did not fail visibly", () => (
      container.querySelector("[data-testid='workspace-import-error']") !== null
    ));
    expect(create).toHaveBeenCalledTimes(1);
    expect(confirmCatalogPackageInstallMock.mock.calls[0]?.[0]).toBe("workspace-3");
    await clickConfirm();
    await waitForCondition("Created destination retry did not open study", () => (
      container.querySelector("[data-testid='catalog-review-cards']") !== null
    ));
    expect(create).toHaveBeenCalledTimes(1);
    expect(confirmCatalogPackageInstallMock.mock.calls[1]?.[0]).toBe("workspace-3");
    expect(confirmCatalogPackageInstallMock.mock.calls[1]?.[2]).toEqual(confirmCatalogPackageInstallMock.mock.calls[0]?.[2]);
  });

  it("offers existing study before importing a duplicate in the selected destination", async () => {
    appData = createAppData([
      createWorkspace("workspace-1", "Primary", true),
      createWorkspace("workspace-2", "Secondary", false),
    ]);
    const context = createInstallContext(appData.availableWorkspaces);
    loadCatalogPackageInstallContextMock.mockResolvedValue({
      workspaces: context.workspaces.map((workspace) => ({
        ...workspace,
        previousInstall: workspace.workspaceId === "workspace-1" ? {
          installId: "44444444-4444-4444-8444-444444444444", packageVersionId, title: "тест", retainedCardCount: 2,
        } : null,
      })),
    });
    await renderRoute("/catalog/import/" + packageVersionId);
    await clickConfirm();
    await clickWorkspaceOption("workspace-1");
    await waitForCondition("Duplicate decision was not ready", isConfirmationReady);
    expect(appData.chooseWorkspace).not.toHaveBeenCalled();
    expect(confirmCatalogPackageInstallMock).not.toHaveBeenCalled();
    const study = container.querySelector("[data-testid='catalog-import-study-existing']");
    if (!(study instanceof HTMLButtonElement)) throw new Error("Study existing action was not found");
    expect(study.classList.contains("primary-btn")).toBe(true);
    await act(async () => study.click());
    await waitForCondition("Existing cards did not open", () => container.querySelector("[data-testid='catalog-review-cards']") !== null);
    expect(confirmCatalogPackageInstallMock).not.toHaveBeenCalled();
    expect(loadSelectedReviewFilterForWorkspace("workspace-1")).toEqual({
      kind: "catalogImport", importId: "44444444-4444-4444-8444-444444444444", title: "тест",
    });
  });

  it("keeps preview failures retryable in place", async () => {
    previewCatalogPackageInstallMock
      .mockRejectedValueOnce(new Error("Preview failed"))
      .mockResolvedValueOnce(createInstallPreview());

    await renderRoute(`/catalog/import/${packageVersionId}`);
    await waitForCondition("Preview error was not rendered", () => (
      container.querySelector("[data-testid='workspace-import-error']") !== null
    ));
    const retryButton = container.querySelector("[data-testid='catalog-import-preview-retry']");
    if (!(retryButton instanceof HTMLButtonElement)) {
      throw new Error("Preview retry button was not found");
    }
    await act(async () => retryButton.click());
    await waitForCondition("Preview retry did not succeed", () => (
      previewCatalogPackageInstallMock.mock.calls.length === 2
      && isConfirmationReady()
    ));
  });
});
