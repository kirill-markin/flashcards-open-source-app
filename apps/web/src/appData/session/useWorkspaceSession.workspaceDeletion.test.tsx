// @vitest-environment jsdom
import "fake-indexeddb/auto";
import {
  TestHarness,
  buildDeleteWorkspaceResponse,
  buildSessionResponse,
  buildWorkspacesResponse,
  cleanupWorkspaceSessionTestEnvironment,
  createDiscardAllSyncWorkMock,
  flushEffects,
  getObservabilityMocks,
  getWorkspaceTransitionEventNames,
  replacementWorkspace,
  resetWorkspaceSessionTestEnvironment,
  seedBrowserStorage,
  seedIndexedDbState,
  seededSession,
  seededWorkspace,
  type HarnessActions,
  type HarnessSnapshot,
} from "./useWorkspaceSessionTestSupport";
import { act } from "react";
import ReactDOM from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadCloudSettings } from "../../localDb/sync/cloudSettings";
import type { WorkspaceSummary } from "../../types";

function buildWorkspaceDeleteErrorResponse(message: string, code: string): Response {
  return new Response(JSON.stringify({
    error: message,
    code,
    requestId: "request-1",
  }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("useWorkspaceSession workspace deletion", () => {
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

  it("keeps expected delete failures inline without technical details or capture", async () => {
    seedBrowserStorage();
    await seedIndexedDbState();

    const deleteErrorMessage = "Confirmation text did not match.";
    const fetchMock = vi.fn<(...args: Array<unknown>) => Promise<Response>>()
      .mockResolvedValueOnce(buildSessionResponse("workspace-1", "csrf-refresh"))
      .mockResolvedValueOnce(buildWorkspacesResponse([seededWorkspace]))
      .mockResolvedValueOnce(buildWorkspaceDeleteErrorResponse(
        deleteErrorMessage,
        "WORKSPACE_DELETE_CONFIRMATION_INVALID",
      ));
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

    let caughtError: unknown = null;
    await act(async () => {
      try {
        await latestActions.deleteWorkspace("workspace-1", "wrong confirmation");
      } catch (error) {
        caughtError = error;
      }
    });

    expect(caughtError).toBeInstanceOf(Error);
    expect(latestState?.errorMessage).toBe(deleteErrorMessage);
    expect(latestState?.technicalError).toBeNull();
    expect(getObservabilityMocks().captureWebExceptionMock).not.toHaveBeenCalled();
  });
 });
