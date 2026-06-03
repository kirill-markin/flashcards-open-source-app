// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDataContextValue } from "../../appData";
import { INSTALLATION_ID_STORAGE_KEY } from "../../clientIdentity";
import { I18nProvider } from "../../i18n";
import { createStorageMock } from "../../api/ApiTestSupport";
import type {
  Card,
  Deck,
  FeedbackSubmissionRequest,
  ResetWorkspaceProgressResponse,
  ReviewFilter,
  WorkspaceResetProgressPreview,
} from "../../types";

const {
  submitFeedbackMock,
  useAppDataMock,
} = vi.hoisted(() => ({
  submitFeedbackMock: vi.fn(),
  useAppDataMock: vi.fn(),
}));

vi.mock("../../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api")>();
  return {
    ...actual,
    submitFeedback: submitFeedbackMock,
  };
});

vi.mock("../../appData", () => ({
  useAppData: useAppDataMock,
}));

vi.mock("../../testMode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../testMode")>();
  return {
    ...actual,
    useTestMode: () => ({
      isTestModeEnabled: false,
    }),
  };
});

import { SettingsScreen } from "./SettingsScreen";

type Mutable<Type> = {
  -readonly [Key in keyof Type]: Type[Key];
};

type SettingsScreenTestHarness = Readonly<{
  clickFeedbackRow: () => Promise<void>;
  clickSubmit: () => Promise<void>;
  getContainer: () => HTMLDivElement;
  renderSettingsScreen: () => Promise<void>;
  setFeedbackText: (value: string) => Promise<void>;
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
    setErrorMessage: vi.fn(),
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

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function setupSettingsScreenTest(): SettingsScreenTestHarness {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    vi.stubGlobal("crypto", {
      ...globalThis.crypto,
      randomUUID: vi.fn(() => "feedback-submission-1"),
    });
    window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, "installation-1");
    submitFeedbackMock.mockReset();
    submitFeedbackMock.mockResolvedValue({
      automaticPromptCooldownDays: 30,
      lastAutomaticPromptShownAt: null,
      lastFeedbackSubmittedAt: "2026-04-18T09:00:00.000Z",
      nextAutomaticPromptAt: null,
    });
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
    vi.unstubAllGlobals();
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
          <MemoryRouter>
            <SettingsScreen />
          </MemoryRouter>
        </I18nProvider>,
      );
    });
  }

  async function clickFeedbackRow(): Promise<void> {
    const feedbackRow = getContainer().querySelector("[data-testid='settings-feedback-row']");
    if (!(feedbackRow instanceof HTMLButtonElement)) {
      throw new Error("Settings feedback row was not found");
    }

    await act(async () => {
      clickElement(feedbackRow);
    });
  }

  async function setFeedbackText(value: string): Promise<void> {
    const textarea = getContainer().querySelector("[data-testid='feedback-message']");
    if (!(textarea instanceof HTMLTextAreaElement)) {
      throw new Error("Feedback textarea was not found");
    }

    await act(async () => {
      setTextAreaValue(textarea, value);
    });
  }

  async function clickSubmit(): Promise<void> {
    const submitButton = getContainer().querySelector("[data-testid='feedback-submit']");
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error("Feedback submit button was not found");
    }

    await act(async () => {
      clickElement(submitButton);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  return {
    clickFeedbackRow,
    clickSubmit,
    getContainer,
    renderSettingsScreen,
    setFeedbackText,
  };
}

const {
  clickFeedbackRow,
  clickSubmit,
  getContainer,
  renderSettingsScreen,
  setFeedbackText,
} = setupSettingsScreenTest();

describe("SettingsScreen feedback", () => {
  it("opens the feedback form from the Settings row", async () => {
    await renderSettingsScreen();
    await clickFeedbackRow();

    expect(getContainer().querySelector("[data-testid='feedback-dialog']")).not.toBeNull();
    expect(getContainer().textContent).toContain("Have an idea for Flashcards?");
  });

  it("keeps empty trimmed feedback from submitting", async () => {
    await renderSettingsScreen();
    await clickFeedbackRow();
    await setFeedbackText("   ");

    const submitButton = getContainer().querySelector("[data-testid='feedback-submit']");
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error("Feedback submit button was not found");
    }

    expect(submitButton.disabled).toBe(true);
    await clickSubmit();
    expect(submitFeedbackMock).not.toHaveBeenCalled();
  });

  it("submits Settings feedback with trigger metadata and shows success", async () => {
    await renderSettingsScreen();
    await clickFeedbackRow();
    await setFeedbackText("  Please add faster review controls.  ");
    await clickSubmit();

    await vi.waitFor(() => {
      expect(submitFeedbackMock).toHaveBeenCalledTimes(1);
    });
    const submissionRequest = submitFeedbackMock.mock.calls[0]?.[0] as FeedbackSubmissionRequest | undefined;
    expect(submissionRequest).toEqual(expect.objectContaining({
      feedbackSubmissionId: "feedback-submission-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      platform: "web",
      locale: "en",
      trigger: "settings",
      message: "Please add faster review controls.",
    }));
    expect(submissionRequest?.timezone).toEqual(expect.any(String));
    await vi.waitFor(() => {
      expect(getContainer().querySelector("[data-testid='feedback-dialog']")).toBeNull();
    });
    expect(getContainer().textContent).toContain("Thanks. Your feedback was sent.");
  });
});
