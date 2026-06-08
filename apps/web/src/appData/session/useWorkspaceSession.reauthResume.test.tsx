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
  replacementWorkspace,
  resetWorkspaceSessionTestEnvironment,
  seedBrowserStorage,
  seedIndexedDbState,
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
import { loadCloudSettings } from "../../localDb/sync/cloudSettings";
import type { WorkspaceSummary } from "../../types";
import { WARM_START_SNAPSHOT_STORAGE_KEY } from "./activation/warmStart";

const observabilityMocks = getObservabilityMocks();

describe("useWorkspaceSession reauth resume", () => {
  let container: HTMLDivElement | null = null;
  let root: ReactDOM.Root | null = null;
  let latestState: HarnessSnapshot | null = null;

  beforeEach(async () => {
    latestState = null;
    await resetWorkspaceSessionTestEnvironment((_url: string): void => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
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
    await cleanupWorkspaceSessionTestEnvironment();
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
 });
