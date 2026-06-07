// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDataContextValue } from "../../appData";
import { I18nProvider } from "../../i18n";
import {
  accountDangerZoneRoute,
  accountStatusRoute,
  settingsCurrentWorkspaceRoute,
  settingsFeedbackRoute,
  settingsLanguageRoute,
  settingsReviewAnimationsRoute,
  settingsSchedulerRoute,
  settingsServerRoute,
} from "../../routes";
import type {
  Card,
  Deck,
  ResetWorkspaceProgressResponse,
  ReviewFilter,
  WorkspaceResetProgressPreview,
} from "../../types";
import { SettingsScreen } from "./SettingsScreen";

const {
  useAppDataMock,
  isTestModeEnabledRef,
} = vi.hoisted(() => ({
  useAppDataMock: vi.fn(),
  isTestModeEnabledRef: { current: false },
}));

vi.mock("../../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("../../testMode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../testMode")>();
  return {
    ...actual,
    useTestMode: () => ({
      isTestModeEnabled: isTestModeEnabledRef.current,
    }),
  };
});

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

type SettingsScreenTestHarness = Readonly<{
  clickRow: (testId: string) => Promise<void>;
  getContainer: () => HTMLDivElement;
  renderSettingsScreen: () => Promise<void>;
}>;

function throwNotUsed(functionName: string): never {
  throw new Error(`${functionName} was not expected in this test`);
}

function createAppData(): Mutable<AppDataContextValue> {
  return {
    sessionLoadState: "ready",
    sessionVerificationState: "verified",
    isSessionVerified: true,
    sessionErrorMessage: "",
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
    workspaceSettings: {
      algorithm: "fsrs-6",
      desiredRetention: 0.9,
      learningStepsMinutes: [1, 10],
      relearningStepsMinutes: [10],
      maximumIntervalDays: 36500,
      enableFuzz: true,
      clientUpdatedAt: "2026-03-10T00:00:00.000Z",
      lastModifiedByReplicaId: "replica-1",
      lastOperationId: "operation-1",
      updatedAt: "2026-03-10T00:00:00.000Z",
    },
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
    setErrorMessage: vi.fn(),
    setAccountPreferences: vi.fn(),
    refreshAccountPreferences: vi.fn(async () => ({
      reviewReactionAnimationsEnabled: true,
    })),
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

function clickElement(element: Element): void {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function LocationProbe(): ReactElement {
  const location = useLocation();

  return <span data-testid="location-pathname">{location.pathname}</span>;
}

function setupSettingsScreenTest(): SettingsScreenTestHarness {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    isTestModeEnabledRef.current = false;
    useAppDataMock.mockReset();
    useAppDataMock.mockReturnValue(createAppData());
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
      throw new Error("Settings test container is not ready");
    }

    return container;
  }

  async function renderSettingsScreen(): Promise<void> {
    const currentRoot = root;
    if (currentRoot === null) {
      throw new Error("Settings test root is not ready");
    }

    await act(async () => {
      currentRoot.render(
        <I18nProvider>
          <MemoryRouter initialEntries={["/settings"]}>
            <SettingsScreen />
            <LocationProbe />
          </MemoryRouter>
        </I18nProvider>,
      );
    });
  }

  async function clickRow(testId: string): Promise<void> {
    const row = getContainer().querySelector(`[data-testid='${testId}']`);
    if (!(row instanceof HTMLAnchorElement)) {
      throw new Error(`Settings row ${testId} was not found`);
    }

    await act(async () => {
      clickElement(row);
    });
  }

  return {
    clickRow,
    getContainer,
    renderSettingsScreen,
  };
}

const {
  clickRow,
  getContainer,
  renderSettingsScreen,
} = setupSettingsScreenTest();

function textContent(): string {
  return getContainer().textContent ?? "";
}

function expectGroupLabelNotClickable(label: string): void {
  const heading = Array.from(getContainer().querySelectorAll("h2")).find((element) => element.textContent === label);
  expect(heading).toBeTruthy();
  expect(heading?.closest("a,button")).toBeNull();
}

function expectRowVisible(testId: string): void {
  expect(getContainer().querySelector(`[data-testid='${testId}']`)).not.toBeNull();
}

function rowIndex(testId: string): number {
  const rows = Array.from(getContainer().querySelectorAll("[data-testid]"));
  const index = rows.findIndex((row) => row.getAttribute("data-testid") === testId);
  if (index === -1) {
    throw new Error(`Settings row ${testId} was not found`);
  }

  return index;
}

function currentPathname(): string {
  const location = getContainer().querySelector("[data-testid='location-pathname']");
  if (location === null) {
    throw new Error("Location probe was not found");
  }

  return location.textContent ?? "";
}

describe("SettingsScreen navigation", () => {
  it("renders the shared first-level settings tree without clickable group labels", async () => {
    await renderSettingsScreen();

    expect(textContent()).toContain("Account");
    expect(textContent()).toContain("General");
    expect(textContent()).toContain("Support");
    expect(textContent()).toContain("Advanced");
    expectGroupLabelNotClickable("Account");
    expectGroupLabelNotClickable("General");
    expectGroupLabelNotClickable("Support");
    expectGroupLabelNotClickable("Advanced");

    [
      "settings-row-account-status",
      "settings-row-current-workspace",
      "settings-row-review-reminders",
      "settings-row-review-animations",
      "settings-row-language",
      "settings-row-access",
      "settings-row-decks",
      "settings-row-tags",
      "settings-row-export",
      "settings-row-feedback",
      "settings-row-legal-support",
      "settings-row-open-source",
      "settings-row-scheduling",
      "settings-row-agent-connections",
      "settings-row-server",
      "settings-row-device-diagnostics",
      "settings-row-reset-study-progress",
      "settings-row-delete-current-workspace",
      "settings-row-delete-account",
    ].forEach(expectRowVisible);
    expect(rowIndex("settings-row-review-reminders")).toBeLessThan(rowIndex("settings-row-review-animations"));
    expect(rowIndex("settings-row-review-animations")).toBeLessThan(rowIndex("settings-row-language"));
    expect(getContainer().querySelector("[data-testid='settings-row-test']")).toBeNull();
  });

  it("shows the Test row under Advanced when test mode is enabled", async () => {
    isTestModeEnabledRef.current = true;

    await renderSettingsScreen();

    expectRowVisible("settings-row-test");
  });

  it("navigates representative root rows to their detail routes", async () => {
    await renderSettingsScreen();

    await clickRow("settings-row-account-status");
    expect(currentPathname()).toBe(accountStatusRoute);

    await clickRow("settings-row-current-workspace");
    expect(currentPathname()).toBe(settingsCurrentWorkspaceRoute);

    await clickRow("settings-row-language");
    expect(currentPathname()).toBe(settingsLanguageRoute);

    await clickRow("settings-row-review-animations");
    expect(currentPathname()).toBe(settingsReviewAnimationsRoute);

    await clickRow("settings-row-scheduling");
    expect(currentPathname()).toBe(settingsSchedulerRoute);

    await clickRow("settings-row-server");
    expect(currentPathname()).toBe(settingsServerRoute);

    await clickRow("settings-row-delete-account");
    expect(currentPathname()).toBe(accountDangerZoneRoute);
  });

  it("navigates the Send feedback row to the feedback settings screen", async () => {
    await renderSettingsScreen();
    await clickRow("settings-row-feedback");

    expect(currentPathname()).toBe(settingsFeedbackRoute);
  });
});
