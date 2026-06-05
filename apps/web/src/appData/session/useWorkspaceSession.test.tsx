// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, useEffect, useState, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  isBrowserReauthRequired,
  markBrowserReauthRequired,
} from "../../accountDeletion";
import { setNavigationHandlerForTests, resetApiClientStateForTests } from "../../api";
import { INSTALLATION_ID_STORAGE_KEY } from "../../clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../../i18n/runtime";
import { loadWarmStartSnapshot, WARM_START_SNAPSHOT_STORAGE_KEY } from "./activation/warmStart";
import { useWorkspaceSession } from "./useWorkspaceSession";
import { captureWorkspaceTransitionError } from "./observation/workspaceSessionObservation";
import { putCloudSettings, loadCloudSettings } from "../../localDb/sync/cloudSettings";
import type { CloudSettings, SessionInfo, WorkspaceSummary } from "../../types";
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

type HarnessSnapshot = Readonly<{
  sessionLoadState: SessionLoadState;
  sessionVerificationState: SessionVerificationState;
  sessionErrorMessage: string;
  session: SessionInfo | null;
  activeWorkspace: WorkspaceSummary | null;
  availableWorkspaces: ReadonlyArray<WorkspaceSummary>;
  cloudSettings: CloudSettings | null;
  errorMessage: string;
}>;

type HarnessActions = Readonly<{
  deleteWorkspace: (workspaceId: string, confirmationText: string) => Promise<void>;
}>;

type CapturedWebBreadcrumb = Readonly<{
  action: string;
  details?: Readonly<{
    eventName?: string;
  }>;
}>;

type DiscardAllSyncWorkForTest = (runWhileDiscarding: () => Promise<void>) => Promise<void>;

type TestHarnessProps = Readonly<{
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

type DeferredVoidPromise = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}>;

const reviewRouteUrl = "http://localhost:3000/review";

const seededSession: SessionInfo = {
  userId: "user-1",
  selectedWorkspaceId: "workspace-1",
  authTransport: "session",
  csrfToken: "csrf-seeded",
  profile: {
    email: "user@example.com",
    locale: "en",
    createdAt: "2026-04-10T00:00:00.000Z",
  },
};

const seededWorkspace: WorkspaceSummary = {
  workspaceId: "workspace-1",
  name: "Personal",
  createdAt: "2026-04-10T00:00:00.000Z",
  isSelected: true,
};

const replacementWorkspace: WorkspaceSummary = {
  workspaceId: "workspace-2",
  name: "Work",
  createdAt: "2026-04-11T00:00:00.000Z",
  isSelected: true,
};

const seededCloudSettings: CloudSettings = {
  installationId: "installation-1",
  cloudState: "linked",
  linkedUserId: "user-1",
  linkedWorkspaceId: "workspace-1",
  linkedEmail: "user@example.com",
  onboardingCompleted: true,
  updatedAt: "2026-04-10T00:00:00.000Z",
};

function createStorageMock(): Storage {
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

function createDeferredVoidPromise(): DeferredVoidPromise {
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

function createDiscardAllSyncWorkMock(): Mock<DiscardAllSyncWorkForTest> {
  return vi.fn(async (runWhileDiscarding: () => Promise<void>): Promise<void> => {
    await runWhileDiscarding();
  });
}

function buildSessionResponseForUser(userId: string, selectedWorkspaceId: string | null, csrfToken: string): Response {
  return new Response(JSON.stringify({
    userId,
    selectedWorkspaceId,
    authTransport: "session",
    csrfToken,
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

function buildSessionResponse(selectedWorkspaceId: string | null, csrfToken: string): Response {
  return buildSessionResponseForUser("user-1", selectedWorkspaceId, csrfToken);
}

function buildWorkspacesResponse(workspaces: ReadonlyArray<WorkspaceSummary>): Response {
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

function buildDeleteWorkspaceResponse(deletedWorkspaceId: string, workspace: WorkspaceSummary): Response {
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

function TestHarness(props: TestHarnessProps): ReactElement {
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
  const [session, setSession] = useState<SessionInfo | null>(initialSession);
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceSummary | null>(initialActiveWorkspace);
  const [availableWorkspaces, setAvailableWorkspaces] = useState<ReadonlyArray<WorkspaceSummary>>(initialAvailableWorkspaces);
  const [, setIsChoosingWorkspace] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
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
    setSession,
    setActiveWorkspace,
    setAvailableWorkspaces,
    setIsChoosingWorkspace,
    setErrorMessage,
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
    });
  }, [actions.deleteWorkspace, onActionsChange]);

  useEffect(() => {
    onStateChange({
      sessionLoadState,
      sessionVerificationState,
      sessionErrorMessage,
      session,
      activeWorkspace,
      availableWorkspaces,
      cloudSettings,
      errorMessage,
    });
  }, [
    activeWorkspace,
    availableWorkspaces,
    cloudSettings,
    errorMessage,
    onStateChange,
    session,
    sessionErrorMessage,
    sessionLoadState,
    sessionVerificationState,
  ]);

  return <div data-testid="workspace-session-test-harness" />;
}

function seedWarmStartSnapshot(): void {
  window.localStorage.setItem(WARM_START_SNAPSHOT_STORAGE_KEY, JSON.stringify({
    version: 1,
    session: seededSession,
    activeWorkspace: seededWorkspace,
    availableWorkspaces: [seededWorkspace],
    savedAt: "2026-04-16T10:00:00.000Z",
  }));
}

function seedBrowserStorage(): void {
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

async function seedIndexedDbState(): Promise<void> {
  await putCloudSettings(seededCloudSettings);
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function getWorkspaceTransitionEventNames(): ReadonlyArray<string> {
  return observabilityMocks.addWebBreadcrumbMock.mock.calls
    .map((call) => call[0] as CapturedWebBreadcrumb)
    .filter((event) => event.action === "workspace_transition")
    .map((event) => event.details?.eventName ?? "");
}

describe("useWorkspaceSession bootstrap", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let latestState: HarnessSnapshot | null = null;
  let redirectedUrl: string | null = null;

  beforeEach(async () => {
    await clearWebSyncCache();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
    window.localStorage.clear();
    resetApiClientStateForTests();
    document.cookie = "logged_in=; Max-Age=0; Path=/";
    window.history.replaceState({}, document.title, reviewRouteUrl);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    latestState = null;
    redirectedUrl = null;
    observabilityMocks.addWebBreadcrumbMock.mockReset();
    observabilityMocks.captureWebExceptionMock.mockReset();
    observabilityMocks.captureWebWarningMock.mockReset();
    observabilityMocks.setWebObservabilityUserMock.mockReset();
    setNavigationHandlerForTests((url: string) => {
      redirectedUrl = url;
    });
  });

  afterEach(async () => {
    if (root !== null) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    root = null;
    container = null;
    latestState = null;
    redirectedUrl = null;
    setNavigationHandlerForTests(null);
    resetApiClientStateForTests();
    document.cookie = "logged_in=; Max-Age=0; Path=/";
    window.localStorage.clear();
    vi.restoreAllMocks();
    await clearWebSyncCache();
  });

  it("suppresses warm start while browser reauth is required", () => {
    seedWarmStartSnapshot();
    document.cookie = "logged_in=1; Path=/";
    markBrowserReauthRequired();

    expect(loadWarmStartSnapshot()).toBeNull();
  });

  it("captures workspace activation bootstrap phase and sync run id", () => {
    const syncError = Object.assign(new Error("Sync failed"), {
      syncRunId: "sync-run-1",
    });

    captureWorkspaceTransitionError("workspace_activate_bootstrap_failed", {
      workspaceId: "workspace-1",
      sessionVerificationState: "verified",
      bootstrapPhase: "run_sync",
    }, syncError);

    expect(observabilityMocks.captureWebExceptionMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "workspace_activation_failed",
      details: expect.objectContaining({
        operation: "workspace_activate_bootstrap_failed",
        workspaceId: "workspace-1",
        bootstrapPhase: "run_sync",
        syncRunId: "sync-run-1",
      }),
    }));
  });

  it("redirects after unrecoverable bootstrap auth failure, preserves local data, and skips the generic error state", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Refresh token missing",
        code: "REFRESH_TOKEN_MISSING",
      }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const refreshWorkspaceViewMock = vi.fn(async (): Promise<void> => {});
    const runSyncMock = vi.fn(async (): Promise<void> => {});
    const runSyncSilentlyMock = vi.fn(async (): Promise<void> => {});
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {});

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={refreshWorkspaceViewMock}
          runSyncMock={runSyncMock}
          runSyncSilentlyMock={runSyncSilentlyMock}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={vi.fn((): void => {})}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("redirecting");
    });
    await flushEffects();

    expect(latestState?.sessionErrorMessage).toBe("");
    expect(latestState?.session).toBeNull();
    expect(latestState?.activeWorkspace).toBeNull();
    expect(latestState?.availableWorkspaces).toEqual([]);
    expect(redirectedUrl).not.toBeNull();
    expect(new URL(redirectedUrl as string).searchParams.get("redirect_uri")).toBe(reviewRouteUrl);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem("selected-review-filter")).not.toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).not.toBeNull();
    expect(window.localStorage.getItem("flashcards-ai-chat-config")).not.toBeNull();
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("es-MX");
    expect(isBrowserReauthRequired()).toBe(true);
    await expect(loadCloudSettings()).resolves.toEqual(seededCloudSettings);
    expect(refreshWorkspaceViewMock).not.toHaveBeenCalled();
    expect(runSyncForWorkspaceMock).not.toHaveBeenCalled();
  });

  it("clears a same-user reauth marker without deleting local data during bootstrap", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();
    markBrowserReauthRequired();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const resetUserScopedUiStateMock = vi.fn((): void => {});

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={vi.fn(async (): Promise<void> => {})}
          runSyncForWorkspaceMock={vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {})}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={resetUserScopedUiStateMock}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).not.toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).not.toBeNull();
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("es-MX");
    expect(isBrowserReauthRequired()).toBe(false);
    expect(resetUserScopedUiStateMock).not.toHaveBeenCalled();
  });

  it("clears local data only after bootstrap confirms a different user", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();
    markBrowserReauthRequired();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const resetUserScopedUiStateMock = vi.fn((): void => {});

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponseForUser("user-2", "workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={vi.fn(async (): Promise<void> => {})}
          runSyncForWorkspaceMock={vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {})}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={resetUserScopedUiStateMock}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(deleteDatabaseSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      fetchMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("es-MX");
    expect(isBrowserReauthRequired()).toBe(false);
    expect(resetUserScopedUiStateMock).toHaveBeenCalledTimes(1);
    await expect(loadCloudSettings()).resolves.toEqual(expect.objectContaining({
      linkedUserId: "user-2",
      linkedWorkspaceId: "workspace-1",
    }));
  });

  it("clears reauth data when local ownership is unknown", async () => {
    seedBrowserStorage();
    markBrowserReauthRequired();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const resetUserScopedUiStateMock = vi.fn((): void => {});

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={vi.fn(async (): Promise<void> => {})}
          runSyncForWorkspaceMock={vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {})}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={resetUserScopedUiStateMock}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });

    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
    expect(isBrowserReauthRequired()).toBe(false);
    expect(resetUserScopedUiStateMock).toHaveBeenCalledTimes(1);
    await expect(loadCloudSettings()).resolves.toEqual(expect.objectContaining({
      linkedUserId: "user-1",
      linkedWorkspaceId: "workspace-1",
    }));
  });

  it("recovers an expired session during bootstrap and continues normal workspace initialization", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-retry"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    const initialLocalRefreshDeferred = createDeferredVoidPromise();
    const refreshWorkspaceViewMock = vi.fn(async (): Promise<void> => {
      await initialLocalRefreshDeferred.promise;
    });
    const runSyncMock = vi.fn(async (): Promise<void> => {});
    const runSyncSilentlyMock = vi.fn(async (): Promise<void> => {});
    const initialVerifiedSyncDeferred = createDeferredVoidPromise();
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {
      await initialVerifiedSyncDeferred.promise;
    });

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={refreshWorkspaceViewMock}
          runSyncMock={runSyncMock}
          runSyncSilentlyMock={runSyncSilentlyMock}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={vi.fn((): void => {})}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });
    await flushEffects();

    expect(redirectedUrl).toBeNull();
    expect(latestState?.sessionErrorMessage).toBe("");
    expect(latestState?.activeWorkspace?.workspaceId).toBe("workspace-1");
    expect(latestState?.session?.csrfToken).toBe("csrf-retry");
    expect(latestState?.cloudSettings?.cloudState).toBe("linked");
    expect(runSyncForWorkspaceMock).not.toHaveBeenCalled();
    initialLocalRefreshDeferred.resolve();
    await act(async () => {
      await initialLocalRefreshDeferred.promise;
    });
    await vi.waitFor(() => {
      expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(1);
    });
    expect(runSyncForWorkspaceMock).toHaveBeenLastCalledWith(seededWorkspace);
    expect(getWorkspaceTransitionEventNames()).toContain("workspace_activate_bootstrap_deferred");
    expect(getWorkspaceTransitionEventNames()).not.toContain("workspace_activate_bootstrap_succeeded");
    initialVerifiedSyncDeferred.resolve();
    await vi.waitFor(() => {
      expect(getWorkspaceTransitionEventNames()).toContain("workspace_activate_bootstrap_succeeded");
    });
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).not.toBeNull();
    await expect(loadCloudSettings()).resolves.toEqual(expect.objectContaining({
      cloudState: "linked",
      linkedWorkspaceId: "workspace-1",
      linkedUserId: "user-1",
    }));
  });

  it("clears a reauth marker after resume confirms the same user", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]))
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-resume"));
    vi.stubGlobal("fetch", fetchMock);

    const runSyncSilentlyMock = vi.fn(async (): Promise<void> => {});
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {});

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={runSyncSilentlyMock}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={vi.fn((): void => {})}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionVerificationState).toBe("verified");
      expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    markBrowserReauthRequired();
    expect(isBrowserReauthRequired()).toBe(true);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => {
      expect(runSyncSilentlyMock).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(latestState?.session?.userId).toBe("user-1");
    expect(latestState?.session?.csrfToken).toBe("csrf-resume");
    expect(isBrowserReauthRequired()).toBe(false);
  });

  it("clears local data when resume confirms a different user", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();
    const deleteDatabaseSpy = vi.spyOn(indexedDB, "deleteDatabase");
    const syncDiscardDeferred = createDeferredVoidPromise();
    const discardAllSyncWorkMock = vi.fn(async (
      runWhileDiscarding: () => Promise<void>,
    ): Promise<void> => {
      await syncDiscardDeferred.promise;
      await runWhileDiscarding();
    });
    const resetUserScopedUiStateMock = vi.fn((): void => {});

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]))
      .mockResolvedValueOnce(buildSessionResponseForUser("user-2", "workspace-2", "csrf-user-2"))
      .mockResolvedValueOnce(buildWorkspacesResponse([replacementWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    const runSyncSilentlyMock = vi.fn(async (): Promise<void> => {});
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {});

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={runSyncSilentlyMock}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={discardAllSyncWorkMock}
          resetUserScopedUiStateMock={resetUserScopedUiStateMock}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.session?.userId).toBe("user-1");
      expect(latestState?.sessionVerificationState).toBe("verified");
      expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => {
      expect(discardAllSyncWorkMock).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(latestState?.session).toBeNull();
      expect(latestState?.activeWorkspace).toBeNull();
      expect(latestState?.availableWorkspaces).toEqual([]);
      expect(latestState?.sessionLoadState).toBe("loading");
      expect(latestState?.sessionVerificationState).toBe("unverified");
    });
    expect(deleteDatabaseSpy).not.toHaveBeenCalled();

    syncDiscardDeferred.resolve();
    await act(async () => {
      await syncDiscardDeferred.promise;
    });

    await vi.waitFor(() => {
      expect(latestState?.session?.userId).toBe("user-2");
      expect(latestState?.activeWorkspace?.workspaceId).toBe("workspace-2");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });

    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(discardAllSyncWorkMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteDatabaseSpy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(resetUserScopedUiStateMock).toHaveBeenCalledTimes(1);
    expect(observabilityMocks.setWebObservabilityUserMock).toHaveBeenCalledWith({ id: "user-2" });
    expect(runSyncSilentlyMock).not.toHaveBeenCalled();
    expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(runSyncForWorkspaceMock).toHaveBeenLastCalledWith(replacementWorkspace);
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).toBeNull();
    await expect(loadCloudSettings()).resolves.toEqual(expect.objectContaining({
      linkedUserId: "user-2",
      linkedWorkspaceId: "workspace-2",
    }));
  });

  it("shows an error when resume account switch bootstrap fails", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();
    const discardAllSyncWorkMock = createDiscardAllSyncWorkMock();
    const resetUserScopedUiStateMock = vi.fn((): void => {});

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]))
      .mockResolvedValueOnce(buildSessionResponseForUser("user-2", "workspace-2", "csrf-user-2"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Switch bootstrap failed",
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const runSyncSilentlyMock = vi.fn(async (): Promise<void> => {});
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {});

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={runSyncSilentlyMock}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={discardAllSyncWorkMock}
          resetUserScopedUiStateMock={resetUserScopedUiStateMock}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.session?.userId).toBe("user-1");
      expect(latestState?.sessionVerificationState).toBe("verified");
      expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("error");
      expect(latestState?.sessionErrorMessage).toBe("Switch bootstrap failed");
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(discardAllSyncWorkMock).toHaveBeenCalledTimes(1);
    expect(resetUserScopedUiStateMock).toHaveBeenCalledTimes(1);
    expect(observabilityMocks.setWebObservabilityUserMock).toHaveBeenCalledWith({ id: "user-2" });
    expect(runSyncSilentlyMock).not.toHaveBeenCalled();
    expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(1);
  });

  it("shows the generic bootstrap error state for real backend failures instead of redirecting", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "Bootstrap backend failed",
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={vi.fn(async (): Promise<void> => {})}
          runSyncForWorkspaceMock={vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {})}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={vi.fn((): void => {})}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("error");
    });

    expect(latestState?.sessionErrorMessage).toBe("Bootstrap backend failed");
    expect(redirectedUrl).toBeNull();
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).not.toBeNull();
    await expect(loadCloudSettings()).resolves.toEqual(seededCloudSettings);
  });

  it("discards deleted workspace sync before activating the replacement workspace", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const unselectedReplacementWorkspace: WorkspaceSummary = {
      ...replacementWorkspace,
      isSelected: false,
    };
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace, unselectedReplacementWorkspace]))
      .mockResolvedValueOnce(buildDeleteWorkspaceResponse("workspace-1", replacementWorkspace));
    vi.stubGlobal("fetch", fetchMock);

    const refreshWorkspaceViewMock = vi.fn(async (_workspaceId: string): Promise<void> => {});
    const runSyncMock = vi.fn(async (): Promise<void> => {});
    const runSyncSilentlyMock = vi.fn(async (): Promise<void> => {});
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {});
    const discardWorkspaceSyncMock = vi.fn((_workspaceId: string): void => {});
    let latestActions: HarnessActions | null = null;

    await act(async () => {
      root?.render(
        <TestHarness
          initialSessionLoadState="ready"
          initialSessionVerificationState="unverified"
          initialSession={seededSession}
          initialActiveWorkspace={seededWorkspace}
          initialAvailableWorkspaces={[seededWorkspace]}
          onStateChange={(snapshot: HarnessSnapshot): void => {
            latestState = snapshot;
          }}
          refreshWorkspaceViewMock={refreshWorkspaceViewMock}
          runSyncMock={runSyncMock}
          runSyncSilentlyMock={runSyncSilentlyMock}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={discardWorkspaceSyncMock}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={vi.fn((): void => {})}
          onActionsChange={(actions: HarnessActions): void => {
            latestActions = actions;
          }}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
      expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    if (latestActions === null) {
      throw new Error("Workspace session actions were not published");
    }

    await act(async () => {
      await latestActions.deleteWorkspace("workspace-1", "delete Personal");
    });

    expect(discardWorkspaceSyncMock).toHaveBeenCalledWith("workspace-1");
    expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(runSyncForWorkspaceMock).toHaveBeenLastCalledWith(replacementWorkspace);
    expect(discardWorkspaceSyncMock.mock.invocationCallOrder[0]).toBeLessThan(
      runSyncForWorkspaceMock.mock.invocationCallOrder[1],
    );
    expect(getWorkspaceTransitionEventNames()).toContain("workspace_activate_bootstrap_succeeded");
    expect(latestState?.activeWorkspace?.workspaceId).toBe("workspace-2");
    expect(latestState?.availableWorkspaces.map((workspace) => workspace.workspaceId)).toEqual(["workspace-2"]);
    await expect(loadCloudSettings()).resolves.toEqual(expect.objectContaining({
      cloudState: "linked",
      linkedWorkspaceId: "workspace-2",
      linkedUserId: "user-1",
    }));
  });
});
