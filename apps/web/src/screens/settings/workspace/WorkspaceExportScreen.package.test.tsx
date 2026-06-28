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
  WorkspaceResetProgressPreview,
} from "../../../types";
import { writeFlashcardsPackageZip, type FlashcardsPackageV1 } from "../../../workspacePackage";
import { WorkspaceExportScreen } from "./WorkspaceExportScreen";

const {
  importWorkspacePackageCardsLocallyMock,
  loadAllActiveCardsForSqlMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  importWorkspacePackageCardsLocallyMock: vi.fn(),
  loadAllActiveCardsForSqlMock: vi.fn(),
  useAppDataMock: vi.fn(),
}));

vi.mock("../../../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("../../../appData/sync/local/syncLocalMutations", () => ({
  importWorkspacePackageCardsLocally: importWorkspacePackageCardsLocallyMock,
}));

vi.mock("../../../localDb/cards/cards", () => ({
  loadAllActiveCardsForSql: loadAllActiveCardsForSqlMock,
}));

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

type WorkspaceExportScreenHarness = Readonly<{
  getContainer: () => HTMLDivElement;
  renderScreen: () => Promise<void>;
}>;

function throwNotUsed(functionName: string): never {
  throw new Error(`${functionName} was not expected in this test`);
}

function createPackageData(): FlashcardsPackageV1 {
  return {
    formatVersion: 1,
    cards: [
      {
        frontText: "Capital of Spain?",
        backText: "Madrid",
        tags: ["geography"],
        cardType: "basic",
        metadata: {
          version: 1,
          source: null,
        },
      },
    ],
  };
}

function createExistingCard(): Card {
  return {
    cardId: "existing-card-1",
    frontText: "Existing",
    backText: "Card",
    cardType: "basic",
    metadata: {
      version: 1,
      source: null,
    },
    tags: ["import:2026-06-28-0"],
    dueAt: null,
    createdAt: "2026-06-01T09:00:00.000Z",
    reps: 0,
    lapses: 0,
    fsrsCardState: "new",
    fsrsStepIndex: null,
    fsrsStability: null,
    fsrsDifficulty: null,
    fsrsLastReviewedAt: null,
    fsrsScheduledDays: null,
    clientUpdatedAt: "2026-06-01T09:00:00.000Z",
    lastModifiedByReplicaId: "replica-1",
    lastOperationId: "operation-1",
    updatedAt: "2026-06-01T09:00:00.000Z",
    deletedAt: null,
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
      installationId: "installation-1",
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
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    useAppDataMock.mockReset();
    loadAllActiveCardsForSqlMock.mockReset();
    importWorkspacePackageCardsLocallyMock.mockReset();
    useAppDataMock.mockReturnValue(createAppData());
    loadAllActiveCardsForSqlMock.mockResolvedValue([createExistingCard()]);
    importWorkspacePackageCardsLocallyMock.mockResolvedValue({
      cards: [],
      didChangeProgressHistory: false,
      didChangeReviewSchedule: true,
    });
    vi.spyOn(crypto, "randomUUID").mockReturnValue("import-id-1");
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
    container = null;
    root = null;
    vi.restoreAllMocks();
  });

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
    getContainer,
    renderScreen,
  };
}

const {
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

async function waitForImport(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (importWorkspacePackageCardsLocallyMock.mock.calls.length > 0) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }

  throw new Error("Package import did not finish");
}

function formatImportDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

describe("WorkspaceExportScreen package import", () => {
  it("keeps the import tag option enabled by default", async () => {
    await renderScreen();

    const checkbox = requireElement("[data-testid='workspace-package-import-tag-checkbox']", HTMLInputElement);

    expect(checkbox.checked).toBe(true);
  });

  it("imports a package with a generated import tag", async () => {
    const today = formatImportDate(new Date());
    loadAllActiveCardsForSqlMock.mockResolvedValue([{
      ...createExistingCard(),
      tags: [`import:${today}-0`],
    }]);
    const zipBytes = writeFlashcardsPackageZip(createPackageData());
    const file = new File([zipBytes], "flashcards.zip", { type: "application/zip" });

    await renderScreen();

    const input = requireElement("[data-testid='workspace-package-import-file-input']", HTMLInputElement);
    setInputFiles(input, [file]);
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForImport();

    expect(importWorkspacePackageCardsLocallyMock).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      clientUpdatedAt: expect.any(String),
      cards: [
        expect.objectContaining({
          frontText: "Capital of Spain?",
          backText: "Madrid",
          tags: ["geography", `import:${today}-1`],
          metadata: {
            version: 1,
            source: {
              label: null,
              author: null,
              comment: null,
              createdAt: null,
              importedAt: expect.any(String),
              importId: "import-id-1",
            },
          },
        }),
      ],
    });
    expect(getContainer().querySelector("[data-testid='workspace-export-success']")?.textContent).toContain(`import:${today}-1`);
  });
});
