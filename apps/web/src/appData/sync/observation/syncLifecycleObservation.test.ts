// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webAppVersion } from "../../../clientIdentity";
import { clearWebSyncCache } from "../../../localDb/cache";
import { applyHotSyncPage } from "../../../localDb/cards/workspace";
import type { PersistentStorageState } from "../../../localDb/sync/cloudSettings";
import { runWorkspaceRemoteSync, type WorkspaceRemoteSyncInput } from "../remote/syncRemote";
import {
  observeSlowHotBootstrap,
} from "./syncLifecycleObservation";
import {
  loadSyncRestoreHistoryEntry,
  storeSyncRestoreHistoryEntry,
} from "../restore/syncRestoreHistory";

const observabilityMocks = vi.hoisted(() => ({
  addWebBreadcrumbMock: vi.fn(),
  captureWebWarningMock: vi.fn(),
}));

const apiMocks = vi.hoisted(() => ({
  bootstrapPullSyncStateMock: vi.fn(),
  pullReviewHistorySyncMock: vi.fn(),
  pullSyncChangesMock: vi.fn(),
  pushSyncOperationsMock: vi.fn(),
}));

vi.mock("../../../observability/webObservability", () => ({
  addWebBreadcrumb: observabilityMocks.addWebBreadcrumbMock,
  captureWebWarning: observabilityMocks.captureWebWarningMock,
}));

vi.mock("../../../api", () => ({
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
    syncRunId: "sync-run-1",
    requireWorkspaceSyncNotDiscarded: (_workspaceId: string): void => {},
    publishWorkspaceSettings: (_workspaceId, _settings): void => {},
    refreshWorkspaceView: async (_workspaceId: string): Promise<void> => {},
  };
}

function createPersistentStorageState(
  persisted: boolean | null,
  usage: number | null,
  quota: number | null,
  errorName: string | null,
  persistAttempted: boolean,
  persistGranted: boolean | null,
): PersistentStorageState {
  return {
    persisted,
    usage,
    quota,
    errorName,
    persistAttempted,
    persistGranted,
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

type PersistentStorageMock = Readonly<{
  persistedMock: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  persistMock: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  estimateMock: ReturnType<typeof vi.fn<() => Promise<StorageEstimate>>>;
}>;

function installPersistentStorageMock(): PersistentStorageMock {
  let persisted = false;
  const persistedMock = vi.fn<() => Promise<boolean>>().mockImplementation(async () => persisted);
  const persistMock = vi.fn<() => Promise<boolean>>().mockImplementation(async () => {
    persisted = true;
    return persisted;
  });
  const estimateMock = vi.fn<() => Promise<StorageEstimate>>().mockResolvedValue({
    quota: 456,
    usage: 123,
  });
  const storageManager = {
    persisted: persistedMock,
    persist: persistMock,
    estimate: estimateMock,
  } satisfies Partial<StorageManager>;

  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: storageManager,
  });

  return {
    persistedMock,
    persistMock,
    estimateMock,
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
    installPersistentStorageMock();
    observabilityMocks.addWebBreadcrumbMock.mockReset();
    observabilityMocks.captureWebWarningMock.mockReset();
    apiMocks.bootstrapPullSyncStateMock.mockReset();
    apiMocks.pullReviewHistorySyncMock.mockReset();
    apiMocks.pullSyncChangesMock.mockReset();
    apiMocks.pushSyncOperationsMock.mockReset();
    primeEmptyRemoteSync();
  });

  afterEach(async () => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: undefined,
    });
    vi.restoreAllMocks();
    await clearWebSyncCache();
  });

  it("includes page size and local bootstrap state in slow restore warnings", () => {
    observeSlowHotBootstrap({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      syncRunId: "sync-run-1",
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
    const persistentStorageMock = installPersistentStorageMock();

    storeSyncRestoreHistoryEntry({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      lastAppliedHotChangeId: 301,
      localCardCount: 42,
      persistentStorageState: createPersistentStorageState(true, 321, 654, null, true, true),
    });

    await runWorkspaceRemoteSync(createRemoteSyncInput());

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_local_db_missing",
      details: expect.objectContaining({
        eventName: "sync_local_db_missing",
        syncRunId: "sync-run-1",
        workspaceId: "workspace-1",
        installationId: "installation-1",
        localBootstrapState: "no_sync_state_no_cards",
        localCardCountBefore: 0,
        previousLastAppliedHotChangeId: 301,
        previousLocalCardCount: 42,
        previousPersistentStoragePersisted: true,
        previousPersistentStorageUsage: 321,
        previousPersistentStorageQuota: 654,
        previousPersistentStorageErrorName: null,
        previousPersistentStoragePersistAttempted: true,
        previousPersistentStoragePersistGranted: true,
        currentWebAppVersion: webAppVersion,
        storagePersisted: false,
        storageUsage: 123,
        storageQuota: 456,
        storageErrorName: null,
        storagePersistAttempted: false,
        storagePersistGranted: null,
      }),
    }));
    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_local_db_recovery_succeeded",
      details: expect.objectContaining({
        eventName: "sync_local_db_recovery_succeeded",
        syncRunId: "sync-run-1",
        localCardCountBefore: 0,
        localCardCountAfter: 0,
        storagePersistedBefore: false,
        storagePersistedAfter: true,
        storagePersistAttemptedAfter: true,
        storagePersistGrantedAfter: true,
      }),
    }));
    expect(persistentStorageMock.persistMock).toHaveBeenCalledTimes(1);
  });

  it("parses old restore history entries without persistent storage fields", () => {
    window.localStorage.setItem("flashcards-sync-restore-history-v1", JSON.stringify({
      version: 1,
      entries: [
        {
          userId: "user-1",
          workspaceId: "workspace-1",
          installationId: "installation-1",
          hydratedAt: "2026-05-01T00:00:00.000Z",
          webAppVersion: "web@old",
          lastAppliedHotChangeId: 77,
          localCardCount: 5,
        },
      ],
    }));

    expect(loadSyncRestoreHistoryEntry({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
    })).toEqual(expect.objectContaining({
      lastAppliedHotChangeId: 77,
      persistentStorageCheckedAt: null,
      persistentStoragePersisted: null,
      persistentStorageUsage: null,
      persistentStorageQuota: null,
      persistentStorageErrorName: null,
      persistentStoragePersistAttempted: null,
      persistentStoragePersistGranted: null,
    }));
  });

  it("stores restore history after a successful hot bootstrap", async () => {
    const persistentStorageMock = installPersistentStorageMock();

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
      persistentStoragePersisted: true,
      persistentStorageUsage: 123,
      persistentStorageQuota: 456,
      persistentStorageErrorName: null,
      persistentStoragePersistAttempted: true,
      persistentStoragePersistGranted: true,
    }));
    expect(persistentStorageMock.persistMock).toHaveBeenCalledTimes(1);
    expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "persistent_storage",
      details: expect.objectContaining({
        eventName: "persistent_storage_checked",
        storagePersisted: true,
        storageUsage: 123,
        storageQuota: 456,
        storageErrorName: null,
        storagePersistAttempted: true,
        storagePersistGranted: true,
      }),
    }));
  });

  it("backfills restore history for an already hydrated local database without warning", async () => {
    const persistentStorageMock = installPersistentStorageMock();

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
      persistentStoragePersisted: true,
      persistentStoragePersistAttempted: true,
      persistentStoragePersistGranted: true,
    }));
    expect(persistentStorageMock.persistMock).toHaveBeenCalledTimes(1);
  });

  it("emits recovery failure details and rethrows when rebuilding a missing local database fails", async () => {
    storeSyncRestoreHistoryEntry({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      lastAppliedHotChangeId: 301,
      localCardCount: 42,
      persistentStorageState: createPersistentStorageState(true, 321, 654, null, true, true),
    });
    apiMocks.bootstrapPullSyncStateMock.mockRejectedValue(new DOMException("Bootstrap failed", "NetworkError"));

    await expect(runWorkspaceRemoteSync(createRemoteSyncInput())).rejects.toThrow("Bootstrap failed");

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_local_db_recovery_failed",
      details: expect.objectContaining({
        eventName: "sync_local_db_recovery_failed",
        syncRunId: "sync-run-1",
        failurePhase: "bootstrap_pull",
        errorName: "NetworkError",
        localCardCountBefore: 0,
        localCardCountAfter: null,
        pageCount: 0,
        entriesCount: 0,
        storagePersistedBefore: false,
        storagePersistedAfter: null,
      }),
    }));
  });

  it("does not warn for a slow empty remote bootstrap", async () => {
    let nowMs = 0;
    vi.spyOn(Date, "now")
      .mockImplementation(() => nowMs);
    apiMocks.bootstrapPullSyncStateMock.mockResolvedValue({
      entries: [],
      bootstrapHotChangeId: 12,
      nextCursor: null,
      hasMore: false,
      remoteIsEmpty: true,
    });

    await runWorkspaceRemoteSync({
      ...createRemoteSyncInput(),
      refreshWorkspaceView: async (_workspaceId: string): Promise<void> => {
        nowMs = 3000;
      },
    });

    expect(findCapturedWarning("sync_restore_slow")).toBeNull();
  });

  it("keeps warning for a slow non-empty remote bootstrap", async () => {
    let nowMs = 0;
    vi.spyOn(Date, "now")
      .mockImplementation(() => nowMs);
    apiMocks.bootstrapPullSyncStateMock.mockResolvedValue({
      entries: [],
      bootstrapHotChangeId: 12,
      nextCursor: null,
      hasMore: false,
      remoteIsEmpty: false,
    });

    await runWorkspaceRemoteSync({
      ...createRemoteSyncInput(),
      refreshWorkspaceView: async (_workspaceId: string): Promise<void> => {
        nowMs = 3000;
      },
    });

    expect(findCapturedWarning("sync_restore_slow")).toEqual(expect.objectContaining({
      action: "sync_restore_slow",
    }));
  });

  it("does not fail sync when persistent storage observation fails", async () => {
    const persistedMock = vi.fn<() => Promise<boolean>>().mockRejectedValue(new DOMException("Denied", "SecurityError"));
    const persistMock = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const estimateMock = vi.fn<() => Promise<StorageEstimate>>().mockResolvedValue({
      quota: 456,
      usage: 123,
    });
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persisted: persistedMock,
        persist: persistMock,
        estimate: estimateMock,
      } satisfies Partial<StorageManager>,
    });

    await expect(runWorkspaceRemoteSync(createRemoteSyncInput())).resolves.toEqual({
      didChangeProgressHistory: false,
      didChangeReviewSchedule: false,
    });
    expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "persistent_storage",
      details: expect.objectContaining({
        storagePersisted: null,
        storageUsage: null,
        storageQuota: null,
        storageErrorName: "SecurityError",
        storagePersistAttempted: false,
        storagePersistGranted: null,
      }),
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
