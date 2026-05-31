// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webAppVersion } from "../../clientIdentity";
import { clearWebSyncCache } from "../../localDb/cache";
import { applyHotSyncPage } from "../../localDb/workspace";
import { runWorkspaceRemoteSync, type WorkspaceRemoteSyncInput } from "./syncRemote";
import {
  observeSlowHotBootstrap,
} from "./syncLifecycleObservation";
import {
  loadSyncRestoreHistoryEntry,
  storeSyncRestoreHistoryEntry,
} from "./syncRestoreHistory";

const observabilityMocks = vi.hoisted(() => ({
  captureWebWarningMock: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  bootstrapPullSyncStateMock: vi.fn(),
  pullReviewHistorySyncMock: vi.fn(),
  pullSyncChangesMock: vi.fn(),
  pushSyncOperationsMock: vi.fn(),
}));

vi.mock("../../observability/webObservability", () => ({
  captureWebWarning: observabilityMocks.captureWebWarningMock,
}));

vi.mock("../../api", () => ({
  bootstrapPullSyncState: apiMocks.bootstrapPullSyncStateMock,
  pullReviewHistorySync: apiMocks.pullReviewHistorySyncMock,
  pullSyncChanges: apiMocks.pullSyncChangesMock,
  pushSyncOperations: apiMocks.pushSyncOperationsMock,
}));

function createRemoteSyncInput(): WorkspaceRemoteSyncInput {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    installationId: "installation-1",
    requireWorkspaceSyncNotDiscarded: (_workspaceId: string): void => {},
    publishWorkspaceSettings: (_workspaceId, _settings): void => {},
    refreshWorkspaceView: async (_workspaceId: string): Promise<void> => {},
  };
}

function createStorageMock(
  options: Readonly<{
    throwOnSetItem: boolean;
  }>,
): Storage {
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
      if (options.throwOnSetItem) {
        throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      }

      state.set(key, value);
    },
  };
}

function primeEmptyRemoteSync(): void {
  apiMocks.bootstrapPullSyncStateMock.mockResolvedValue({
    entries: [],
    bootstrapHotChangeId: 12,
    nextCursor: null,
    hasMore: false,
    remoteIsEmpty: false,
  });
  apiMocks.pullSyncChangesMock.mockResolvedValue({
    changes: [],
    nextHotChangeId: 12,
    hasMore: false,
  });
  apiMocks.pullReviewHistorySyncMock.mockResolvedValue({
    reviewEvents: [],
    nextReviewSequenceId: 0,
    hasMore: false,
  });
  apiMocks.pushSyncOperationsMock.mockResolvedValue({
    operations: [],
  });
}

function findCapturedWarning(action: string): unknown {
  return observabilityMocks.captureWebWarningMock.mock.calls
    .map((call) => call[0] as Readonly<{ action: string }>)
    .find((event) => event.action === action) ?? null;
}

describe("sync lifecycle observation", () => {
  beforeEach(async () => {
    await clearWebSyncCache();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock({
        throwOnSetItem: false,
      }),
    });
    window.localStorage.clear();
    observabilityMocks.captureWebWarningMock.mockReset();
    apiMocks.bootstrapPullSyncStateMock.mockReset();
    apiMocks.pullReviewHistorySyncMock.mockReset();
    apiMocks.pullSyncChangesMock.mockReset();
    apiMocks.pushSyncOperationsMock.mockReset();
    primeEmptyRemoteSync();
  });

  afterEach(async () => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    await clearWebSyncCache();
  });

  it("includes page size and local bootstrap state in slow restore warnings", () => {
    observeSlowHotBootstrap({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      durationMs: 3000,
      pageSize: 500,
      pageCount: 5,
      entriesCount: 2026,
      localCardCountBefore: 0,
      localCardCountAfter: 1963,
      localBootstrapState: "no_sync_state_no_cards",
      lastAppliedHotChangeIdBefore: null,
      nextHotChangeId: 30147,
      remoteIsEmpty: false,
    });

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_restore_slow",
      details: expect.objectContaining({
        pageSize: 500,
        localBootstrapState: "no_sync_state_no_cards",
      }),
    }));
  });

  it("does not warn when an empty local database has no restore history", async () => {
    await runWorkspaceRemoteSync(createRemoteSyncInput());

    expect(findCapturedWarning("sync_local_db_missing")).toBeNull();
  });

  it("warns when an empty local database had previous restore history", async () => {
    storeSyncRestoreHistoryEntry({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      lastAppliedHotChangeId: 301,
      localCardCount: 42,
    });

    await runWorkspaceRemoteSync(createRemoteSyncInput());

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_local_db_missing",
      details: expect.objectContaining({
        eventName: "sync_local_db_missing",
        workspaceId: "workspace-1",
        installationId: "installation-1",
        localBootstrapState: "no_sync_state_no_cards",
        localCardCountBefore: 0,
        previousLastAppliedHotChangeId: 301,
        previousLocalCardCount: 42,
        currentWebAppVersion: webAppVersion,
      }),
    }));
  });

  it("stores restore history after a successful hot bootstrap", async () => {
    await runWorkspaceRemoteSync(createRemoteSyncInput());

    expect(loadSyncRestoreHistoryEntry({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
    })).toEqual(expect.objectContaining({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      webAppVersion,
      lastAppliedHotChangeId: 12,
      localCardCount: 0,
    }));
  });

  it("backfills restore history for an already hydrated local database without warning", async () => {
    await applyHotSyncPage("workspace-1", [], {
      lastAppliedHotChangeId: 88,
      markHotStateHydrated: true,
    });

    await runWorkspaceRemoteSync(createRemoteSyncInput());

    expect(apiMocks.bootstrapPullSyncStateMock).not.toHaveBeenCalled();
    expect(findCapturedWarning("sync_local_db_missing")).toBeNull();
    expect(loadSyncRestoreHistoryEntry({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
    })).toEqual(expect.objectContaining({
      lastAppliedHotChangeId: 88,
    }));
  });

  it("does not fail sync when restore history storage cannot be written", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createStorageMock({
        throwOnSetItem: true,
      }),
    });

    await expect(runWorkspaceRemoteSync(createRemoteSyncInput())).resolves.toEqual({
      didChangeProgressHistory: false,
      didChangeReviewSchedule: false,
    });
  });
});
