import { act, useEffect, useState, type ReactElement } from "react";
import { vi, type Mock } from "vitest";
import { setNavigationHandlerForTests, resetApiClientStateForTests } from "../../api";
import { INSTALLATION_ID_STORAGE_KEY } from "../../clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../../i18n/runtime";
import { WARM_START_SNAPSHOT_STORAGE_KEY } from "./activation/warmStart";
import { useWorkspaceSession } from "./useWorkspaceSession";
import { putCloudSettings } from "../../localDb/sync/cloudSettings";
import type {
  CloudSettings,
  ResetWorkspaceProgressResponse,
  SessionInfo,
  WorkspaceSummary,
} from "../../types";
import type { TranslationKey } from "../../i18n";
import type { SessionLoadState } from "../context/types";
import type { SessionVerificationState } from "./workspaceSessionTypes";
import { clearWebSyncCache } from "../../localDb/cache";

const observabilityMocks = vi.hoisted(() => ({
  addWebBreadcrumbMock: vi.fn(),
  captureWebExceptionMock: vi.fn(),
  captureWebWarningMock: vi.fn(),
  setWebObservabilityUserMock: vi.fn(),
}));

vi.mock("../../observability/webObservability", () => ({
  addWebBreadcrumb: observabilityMocks.addWebBreadcrumbMock,
  captureWebException: observabilityMocks.captureWebExceptionMock,
  captureWebWarning: observabilityMocks.captureWebWarningMock,
  normalizeCaughtError: (error: unknown): Error => error instanceof Error ? error : new Error(`Caught non-Error value of type ${typeof error}`),
  setWebObservabilityUser: observabilityMocks.setWebObservabilityUserMock,
}));

export function getObservabilityMocks(): typeof observabilityMocks {
  return observabilityMocks;
}

export type HarnessSnapshot = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  sessionErrorMessage: string;
  sessionTechnicalError: Error | null;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
  errorMessage: string;
  technicalError: Error | null;
}>;

export type HarnessActions = Readonly<{
  deleteWorkspace: (workspaceId: string, confirmationText: string) => Promise<void>;
  resetWorkspaceProgress: (
    workspaceId: string,
    confirmationText: string,
  ) => Promise<ResetWorkspaceProgressResponse>;
}>;

export type CapturedWebBreadcrumb = Readonly<{
  action: string;
  details?: Readonly<{
    eventName?: string;
  }>;
}>;

export type DiscardAllSyncWorkForTest = (runWhileDiscarding: () => Promise<void>) => Promise<void>;

export type TestHarnessProps = Readonly<{
  initialSessionLoadState: SessionLoadState;
  initialSessionVerificationState: SessionVerificationState;
  initialSession: SessionInfo | null;
  initialActiveWorkspace: WorkspaceSummary | null;
  initialAvailableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  onStateChange: (snapshot: HarnessSnapshot) => void;
  refreshWorkspaceViewMock: Mock<() => Promise<void>>;
  runSyncMock: Mock<() => Promise<void>>;
  runSyncSilentlyMock: Mock<() => Promise<void>>;
  runSyncForWorkspaceMock: Mock<(workspace: WorkspaceSummary) => Promise<void>>;
  discardWorkspaceSyncMock: Mock<(workspaceId: string) => void>;
  discardAllSyncWorkMock: Mock<DiscardAllSyncWorkForTest>;
  resetUserScopedUiStateMock: Mock<() => void>;
  onActionsChange: ((actions: HarnessActions) => void) | null;
}>;

export type DeferredVoidPromise = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}>;

export const reviewRouteUrl = "http://localhost:3000/review";

export const seededSession: SessionInfo = {
  userId: "user-1",
  selectedWorkspaceId: "workspace-1",
  authTransport: "session",
  csrfToken: "csrf-seeded",
  preferences: {
    reviewReactionAnimationsEnabled: true,
  },
  profile: {
    email: "user@example.com",
    locale: "en",
    createdAt: "2026-04-10T00:00:00.000Z",
  },
};

export const seededWorkspace: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Personal",
  createdAt: "2026-04-10T00:00:00.000Z",
  isSelected: true,
};

export const replacementWorkspace: WorkspaceSummary = {
  workspaceId: "workspace-2",
  name: "Work",
  createdAt: "2026-04-11T00:00:00.000Z",
  isSelected: true,
};

export const seededCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-10T00:00:00.000Z",
};

export function createStorageMock(): Storage {
  const state = new Map<string, string>();

  return {
    get length(): number {
      return state.size;
    },
    clear(): void {
      state.clear();
    },
    getItem(key: string): string | null {
      return state.get(key) ?? null;
    },
    key(index: number): string | null {
      return [...state.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      state.delete(key);
    },
    setItem(key: string, value: string): void {
      state.set(key, value);
    },
  };
}

export function createDeferredVoidPromise(): DeferredVoidPromise {
  let resolvePromise: (() => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  if (resolvePromise === null || rejectPromise === null) {
    throw new Error("Deferred promise handlers were not initialized");
  }

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

export function createDiscardAllSyncWorkMock(): Mock<DiscardAllSyncWorkForTest> {
  return vi.fn(async (runWhileDiscarding: () => Promise<void>): Promise<void> => {
    await runWhileDiscarding();
  });
}

export function buildSessionResponseForUser(userId: string, selectedWorkspaceId: string | null, csrfToken: string): Response {
  return new Response(JSON.stringify({
    userId,
    selectedWorkspaceId,
    authTransport: "session",
    csrfToken,
    preferences: {
      reviewReactionAnimationsEnabled: true,
    },
    profile: {
      email: "user@example.com",
      locale: "en",
      createdAt: "2026-04-10T00:00:00.000Z",
    },
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function buildSessionResponse(selectedWorkspaceId: string | null, csrfToken: string): Response {
  return buildSessionResponseForUser("user-1", selectedWorkspaceId, csrfToken);
}

export function buildWorkspacesResponse(workspaces: ReadonlyArray<WorkspaceSummary>): Response {
  return new Response(JSON.stringify({
    workspaces,
    nextCursor: null,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function buildDeleteWorkspaceResponse(deletedWorkspaceId: string, workspace: WorkspaceSummary): Response {
  return new Response(JSON.stringify({
    ok: true,
    deletedWorkspaceId,
    deletedCardsCount: 2,
    workspace,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function TestHarness(props: TestHarnessProps): ReactElement {
  const {
    initialSessionLoadState,
    initialSessionVerificationState,
    initialSession,
    initialActiveWorkspace,
    initialAvailableWorkspaces,
    onStateChange,
    refreshWorkspaceViewMock,
    runSyncMock,
    runSyncSilentlyMock,
    runSyncForWorkspaceMock,
    discardWorkspaceSyncMock,
    discardAllSyncWorkMock,
    resetUserScopedUiStateMock,
    onActionsChange,
  } = props;
  const [sessionLoadState, setSessionLoadState] = useState<SessionLoadState>(initialSessionLoadState);
  const [sessionVerificationState, setSessionVerificationState] = useState<SessionVerificationState>(initialSessionVerificationState);
  const [sessionErrorMessage, setSessionErrorMessage] = useState<string>("");
  const [sessionTechnicalError, setSessionTechnicalError] = useState<Error | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(initialSession);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(initialActiveWorkspace);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>(initialAvailableWorkspaces);
  const [, setIsChoosingWorkspace] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [technicalError, setTechnicalError] = useState<Error | null>(null);
  const [cloudSettings, setCloudSettings] = useState<CloudSettings | null>(null);

  const actions = useWorkspaceSession({
    t: (key: TranslationKey): string => key,
    sessionLoadState,
    sessionVerificationState,
    session,
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    setSessionLoadState,
    setSessionVerificationState,
    setSessionErrorMessage,
    setSessionTechnicalError,
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
    setTechnicalError,
    setCloudSettings,
    refreshWorkspaceView: refreshWorkspaceViewMock,
    runSync: runSyncMock,
    runSyncSilently: runSyncSilentlyMock,
    runSyncForWorkspace: runSyncForWorkspaceMock,
    discardWorkspaceSync: discardWorkspaceSyncMock,
    discardAllSyncWork: discardAllSyncWorkMock,
    resetUserScopedUiState: resetUserScopedUiStateMock,
  });

  useEffect(() => {
    if (onActionsChange === null) {
      return;
    }

    onActionsChange({
      deleteWorkspace: actions.deleteWorkspace,
      resetWorkspaceProgress: actions.resetWorkspaceProgress,
    });
  }, [actions.deleteWorkspace, actions.resetWorkspaceProgress, onActionsChange]);

  useEffect(() => {
    onStateChange({
      sessionLoadState,
      sessionVerificationState,
      sessionErrorMessage,
      sessionTechnicalError,
      session,
      activeWorkspace,
      availableWorkspaces,
      cloudSettings,
      errorMessage,
      technicalError,
    });
  }, [
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    errorMessage,
    onStateChange,
    session,
    sessionErrorMessage,
    sessionTechnicalError,
    sessionLoadState,
    sessionVerificationState,
    technicalError,
  ]);

  return <div data-testid="workspace-session-test-harness" />;
}

export function seedWarmStartSnapshot(): void {
  window.localStorage.setItem(WARM_START_SNAPSHOT_STORAGE_KEY, JSON.stringify({
    version: 1,
    session: seededSession,
    activeWorkspace: seededWorkspace,
    availableWorkspaces: [seededWorkspace],
    savedAt: "2026-04-16T10:00:00.000Z",
  }));
}

export function seedBrowserStorage(): void {
  seedWarmStartSnapshot();
  window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, "installation-1");
  window.localStorage.setItem(LOCALE_PREFERENCE_STORAGE_KEY, "es-MX");
  window.localStorage.setItem("selected-review-filter", JSON.stringify({ kind: "allCards" }));
  window.localStorage.setItem("flashcards-chat-drafts::workspace-1", JSON.stringify({
    version: 1,
    draftsBySessionId: {
      "session-1": {
        inputText: "persisted draft",
        pendingAttachments: [],
        updatedAt: 1,
      },
    },
  }));
  window.localStorage.setItem("flashcards-ai-chat-config", JSON.stringify({
    features: {
      dictationEnabled: true,
      attachmentsEnabled: true,
    },
  }));
}

export async function seedIndexedDbState(): Promise<void> {
  await putCloudSettings(seededCloudSettings);
}

export async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

export function getWorkspaceTransitionEventNames(): ReadonlyArray<string> {
  return observabilityMocks.addWebBreadcrumbMock.mock.calls
    .map((call) => call[0] as CapturedWebBreadcrumb)
    .filter((event) => event.action === "workspace_transition")
    .map((event) => event.details?.eventName ?? "");
}

function resetObservabilityMocks(): void {
  observabilityMocks.addWebBreadcrumbMock.mockReset();
  observabilityMocks.captureWebExceptionMock.mockReset();
  observabilityMocks.captureWebWarningMock.mockReset();
  observabilityMocks.setWebObservabilityUserMock.mockReset();
}

export async function resetWorkspaceSessionTestEnvironment(setRedirectedUrl: (url: string) => void): Promise<void> {
  await clearWebSyncCache();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorageMock(),
  });
  window.localStorage.clear();
  resetApiClientStateForTests();
  document.cookie = "logged_in=; Max-Age=0; Path=/";
  window.history.replaceState({}, document.title, reviewRouteUrl);
  resetObservabilityMocks();
  setNavigationHandlerForTests((url: string) => {
    setRedirectedUrl(url);
  });
}

export async function cleanupWorkspaceSessionTestEnvironment(): Promise<void> {
  setNavigationHandlerForTests(null);
  resetApiClientStateForTests();
  document.cookie = "logged_in=; Max-Age=0; Path=/";
  window.localStorage.clear();
  vi.restoreAllMocks();
  await clearWebSyncCache();
}
