// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  TestHarness,
  buildSessionResponse,
  buildSessionResponseForUser,
  buildWorkspacesResponse,
  cleanupWorkspaceSessionTestEnvironment,
  createDeferredVoidPromise,
  createDiscardAllSyncWorkMock,
  flushEffects,
  getObservabilityMocks,
  getWorkspaceTransitionEventNames,
  resetWorkspaceSessionTestEnvironment,
  reviewRouteUrl,
  seedBrowserStorage,
  seedIndexedDbState,
  seedWarmStartSnapshot,
  seededCloudSettings,
  seededSession,
  seededWorkspace,
  type HarnessSnapshot,
} from "./useWorkspaceSessionTestSupport";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBrowserReauthRequired,
  markBrowserReauthRequired,
} from "../../accountDeletion";
import { INSTALLATION_ID_STORAGE_KEY } from "../../clientIdentity";
import { LOCALE_PREFERENCE_STORAGE_KEY } from "../../i18n/runtime";
import { loadCloudSettings } from "../../localDb/sync/cloudSettings";
import type { WorkspaceSummary } from "../../types";
import { loadWarmStartSnapshot, WARM_START_SNAPSHOT_STORAGE_KEY } from "./activation/warmStart";
import { captureWorkspaceTransitionError } from "./observation/workspaceSessionObservation";

const observabilityMocks = getObservabilityMocks();

function buildApiErrorResponse(message: string, code: string, status: number): Response {
  return new Response(JSON.stringify({
    error: message,
    code,
    requestId: "request-1",
  }), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("useWorkspaceSession bootstrap", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let latestState: HarnessSnapshot | null = null;
  let redirectedUrl: string | null = null;

  beforeEach(async () => {
    latestState = null;
    redirectedUrl = null;
    await resetWorkspaceSessionTestEnvironment((url: string): void => {
      redirectedUrl = url;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    vi.useRealTimers();
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
    await cleanupWorkspaceSessionTestEnvironment();
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

  it("does not recapture already observed workspace activation sync failures", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    const observedSyncError = Object.assign(new Error("Captured sync failed"), {
      syncFailureWasCaptured: true,
    });
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {
      throw observedSyncError;
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
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={vi.fn(async (): Promise<void> => {})}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={vi.fn((): void => {})}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionErrorMessage).toBe("Captured sync failed");
    });

    expect(observabilityMocks.captureWebExceptionMock).not.toHaveBeenCalled();
    expect(latestState?.sessionTechnicalError).toBe(observedSyncError);
    expect(latestState?.technicalError).toBe(observedSyncError);
  });

  it("keeps expected workspace activation sync failures inline without technical details", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    const expectedSyncError = Object.assign(new Error("Expected sync state"), {
      syncFailureWasCaptured: false,
    });
    const runSyncForWorkspaceMock = vi.fn(async (_workspace: WorkspaceSummary): Promise<void> => {
      throw expectedSyncError;
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
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={vi.fn(async (): Promise<void> => {})}
          runSyncSilentlyMock={vi.fn(async (): Promise<void> => {})}
          runSyncForWorkspaceMock={runSyncForWorkspaceMock}
          discardWorkspaceSyncMock={vi.fn((_workspaceId: string): void => {})}
          discardAllSyncWorkMock={createDiscardAllSyncWorkMock()}
          resetUserScopedUiStateMock={vi.fn((): void => {})}
          onActionsChange={null}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(latestState?.sessionErrorMessage).toBe("Expected sync state");
    });

    expect(observabilityMocks.captureWebExceptionMock).not.toHaveBeenCalled();
    expect(latestState?.sessionTechnicalError).toBeNull();
    expect(latestState?.technicalError).toBeNull();
  });

  it("keeps expected bootstrap workspace selection failures inline without technical details", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const workspaceNotFoundMessage = "Workspace not found";
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse(null, "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]))
      .mockResolvedValueOnce(buildApiErrorResponse(workspaceNotFoundMessage, "WORKSPACE_NOT_FOUND", 404));
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
      expect(latestState?.sessionErrorMessage).toBe(workspaceNotFoundMessage);
    });

    expect(observabilityMocks.captureWebExceptionMock).not.toHaveBeenCalled();
    expect(latestState?.sessionTechnicalError).toBeNull();
    expect(latestState?.technicalError).toBeNull();
  });

  it("catches rejecting visible interval sync tasks", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    let intervalHandler: (() => void) | null = null;
    vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler): number => {
      if (typeof handler === "string") {
        throw new Error("String interval handlers are not supported in this test");
      }

      intervalHandler = handler;
      return 1;
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: (): DocumentVisibilityState => "visible",
    });

    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]));
    vi.stubGlobal("fetch", fetchMock);

    const intervalSyncError = new Error("Interval sync failed");
    const runSyncMock = vi.fn(async (): Promise<void> => {
      throw intervalSyncError;
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
          refreshWorkspaceViewMock={vi.fn(async (): Promise<void> => {})}
          runSyncMock={runSyncMock}
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
      expect(latestState?.sessionLoadState).toBe("ready");
      expect(latestState?.sessionVerificationState).toBe("verified");
      expect(intervalHandler).not.toBeNull();
    });

    const visibleIntervalHandler = intervalHandler;
    if (visibleIntervalHandler === null) {
      throw new Error("Visible sync interval handler was not registered");
    }

    await act(async () => {
      visibleIntervalHandler();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(latestState?.sessionLoadState).toBe("ready");
    expect(latestState?.sessionVerificationState).toBe("verified");
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
 });
