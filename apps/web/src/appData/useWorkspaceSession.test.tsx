// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act, useEffect, useState, type ReactElement } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { isAuthResetRequired, markAuthResetRequired } from "../accountDeletion";
import { setNavigationHandlerForTests, resetApiClientStateForTests } from "../api";
import { INSTALLATION_ID_STORAGE_KEY } from "../clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../i18n/runtime";
import { WARM_START_SNAPSHOT_STORAGE_KEY } from "./warmStart";
import { useWorkspaceSession } from "./useWorkspaceSession";
import { putCloudSettings, loadCloudSettings } from "../localDb/cloudSettings";
import type { CloudSettings, SessionInfo, WorkspaceSummary } from "../types";
import type { TranslationKey } from "../i18n";
import type { SessionLoadState } from "./types";
import type { SessionVerificationState } from "./warmStart";
import { clearWebSyncCache } from "../localDb/cache";

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

function mockBlockedDeleteDatabase(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(indexedDB, "deleteDatabase").mockImplementation(() => {
    const request = {} as IDBOpenDBRequest;
    queueMicrotask(() => {
      request.onblocked?.(new Event("blocked"));
    });
    return request;
  });
}

function buildSessionResponse(selectedWorkspaceId: string | null, csrfToken: string): Response {
  return new Response(JSON.stringify({
    userId: "user-1",
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

  useWorkspaceSession({
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
  });

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
    provider: { id: "openai", label: "OpenAI" },
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
    window.history.replaceState({}, document.title, reviewRouteUrl);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    latestState = null;
    redirectedUrl = null;
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
    window.localStorage.clear();
    vi.restoreAllMocks();
    await clearWebSyncCache();
  });

  it("redirects after unrecoverable bootstrap auth failure, clears local browser state, and skips the generic error state", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

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
    await vi.waitFor(() => {
      expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).toBeNull();
      expect(window.localStorage.getItem("selected-review-filter")).toBeNull();
      expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
      expect(window.localStorage.getItem("flashcards-ai-chat-config")).toBeNull();
      expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
      expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("es-MX");
      expect(isAuthResetRequired()).toBe(false);
    });
    await vi.waitFor(async () => {
      expect(await loadCloudSettings()).toBeNull();
    });
    expect(refreshWorkspaceViewMock).not.toHaveBeenCalled();
    expect(runSyncForWorkspaceMock).not.toHaveBeenCalled();
  });

  it("retries and clears a pending auth reset before continuing bootstrap", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();
    markAuthResetRequired();

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
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("es-MX");
    expect(isAuthResetRequired()).toBe(false);
  });

  it("keeps a pending auth reset marker when IndexedDB cleanup is blocked during bootstrap", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();
    markAuthResetRequired();
    const deleteDatabaseSpy = mockBlockedDeleteDatabase();
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(deleteDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem("flashcards-chat-drafts::workspace-1")).toBeNull();
    expect(window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY)).toBe("installation-1");
    expect(window.localStorage.getItem(LOCALE_PREFERENCE_STORAGE_KEY)).toBe("es-MX");
    expect(isAuthResetRequired()).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalledWith("auth_reset_cleanup_deferred", {
      errorMessage: "Failed to delete IndexedDB: delete request was blocked",
    });
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
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
    });
    await vi.waitFor(() => {
      expect(runSyncForWorkspaceMock).toHaveBeenCalledTimes(1);
    });

    expect(redirectedUrl).toBeNull();
    expect(latestState?.sessionErrorMessage).toBe("");
    expect(latestState?.activeWorkspace?.workspaceId).toBe("workspace-1");
    expect(latestState?.session?.csrfToken).toBe("csrf-retry");
    expect(latestState?.cloudSettings?.cloudState).toBe("linked");
    expect(window.localStorage.getItem(WARM_START_SNAPSHOT_STORAGE_KEY)).not.toBeNull();
    await expect(loadCloudSettings()).resolves.toEqual(expect.objectContaining({
      cloudState: "linked",
      linkedWorkspaceId: "workspace-1",
      linkedUserId: "user-1",
    }));
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
});
