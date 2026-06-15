// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webAppVersion } from "../../../clientIdentity";
import { clearWebSyncCache } from "../../../localDb/cache";
import { applyHotSyncPage } from "../../../localDb/cards/workspace";
import { loadCloudSettings, type PersistentStorageState } from "../../../localDb/sync/cloudSettings";
import type {
  SyncBootstrapEntry,
  SyncBootstrapPullResult,
} from "../../../types";
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

const currentWebSyncDatabaseVersion = 14;

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

function createBootstrapPullResult(input: Readonly<{
  entries: ReadonlyArray<SyncBootstrapEntry>;
  bootstrapHotChangeId: number;
  nextCursor: string | null;
  hasMore: boolean;
  remoteIsEmpty: boolean;
}>): SyncBootstrapPullResult {
  return {
    mode: "pull",
    entries: input.entries,
    bootstrapHotChangeId: input.bootstrapHotChangeId,
    nextCursor: input.nextCursor,
    hasMore: input.hasMore,
    remoteIsEmpty: input.remoteIsEmpty,
  };
}

function createDeckBootstrapEntry(workspaceId: string): SyncBootstrapEntry {
  const timestamp = "2026-05-01T00:00:00.000Z";
  return {
    entityType: "deck",
    entityId: "deck-1",
    action: "upsert",
    payload: {
      deckId: "deck-1",
      workspaceId,
      name: "Deck",
      filterDefinition: {
        version: 2,
        effortLevels: [],
        tags: [],
      },
      createdAt: timestamp,
      clientUpdatedAt: timestamp,
      lastModifiedByReplicaId: "replica-1",
      lastOperationId: "operation-1",
      updatedAt: timestamp,
      deletedAt: null,
    },
  };
}

type TestClock = Readonly<{
  advance: (durationMs: number) => void;
}>;

function installMutableDateNow(initialNowMs: number): TestClock {
  let nowMs = initialNowMs;
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);

  return {
    advance: (durationMs: number): void => {
      if (Number.isFinite(durationMs) === false || durationMs < 0) {
        throw new Error(`Invalid test clock duration: ${durationMs}`);
      }

      nowMs += durationMs;
    },
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

function installPersistentStorageMockWithClock(
  clock: TestClock,
  persistedDurationMs: number,
  persistDurationMs: number,
  estimateDurationMs: number,
): PersistentStorageMock {
  let persisted = false;
  const persistedMock = vi.fn<() => Promise<boolean>>().mockImplementation(async () => {
    clock.advance(persistedDurationMs);
    return persisted;
  });
  const persistMock = vi.fn<() => Promise<boolean>>().mockImplementation(async () => {
    clock.advance(persistDurationMs);
    persisted = true;
    return persisted;
  });
  const estimateMock = vi.fn<() => Promise<StorageEstimate>>().mockImplementation(async () => {
    clock.advance(estimateDurationMs);
    return {
      quota: 456,
      usage: 123,
    };
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
  apiMocks.bootstrapPullSyncStateMock.mockResolvedValue(createBootstrapPullResult({
    entries: [],
    bootstrapHotChangeId: 12,
    nextCursor: null,
    hasMore: false,
    remoteIsEmpty: false,
  }));
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
      pageSize: 1000,
      pageCount: 5,
      entriesCount: 2026,
      localCardCountBefore: 0,
      localCardCountAfter: 1963,
      localBootstrapState: "no_sync_state_no_cards",
      lastAppliedHotChangeIdBefore: null,
      nextHotChangeId: 30147,
      remoteIsEmpty: false,
      bootstrapPullDurationMs: 1200,
      applyHotPagesDurationMs: 900,
      finalRefreshDurationMs: 400,
      persistentStorageDurationMs: 50,
      bootstrapPageDurationMs: [200, 250, 300, 450],
    });

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_restore_slow",
      details: expect.objectContaining({
        pageSize: 1000,
        localBootstrapState: "no_sync_state_no_cards",
        bootstrapPullDurationMs: 1200,
        applyHotPagesDurationMs: 900,
        finalRefreshDurationMs: 400,
        persistentStorageDurationMs: 50,
        bootstrapPageDurationMs: [200, 250, 300, 450],
      }),
    }));
  });

  it("does not warn when an empty local database has no restore history", async () => {
    await runWorkspaceRemoteSync(createRemoteSyncInput());

    expect(observabilityMocks.addWebBreadcrumbMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "sync_local_db_missing" }),
    );
  });

  it("uses separate page sizes for bootstrap and incremental pulls", async () => {
    await runWorkspaceRemoteSync(createRemoteSyncInput());

    expect(apiMocks.bootstrapPullSyncStateMock).toHaveBeenCalledWith(
      "workspace-1",
      "installation-1",
      "web",
      webAppVersion,
      null,
      1000,
    );
    expect(apiMocks.pullSyncChangesMock).toHaveBeenCalledWith(
      "workspace-1",
      "installation-1",
      "web",
      webAppVersion,
      12,
      500,
    );
    expect(apiMocks.pullReviewHistorySyncMock).toHaveBeenCalledWith(
      "workspace-1",
      "installation-1",
      "web",
      webAppVersion,
      0,
      500,
    );
  });

  it("emits recovery breadcrumbs and suppresses the slow warning for successful local database recovery", async () => {
    const clock = installMutableDateNow(0);
    const persistentStorageMock = installPersistentStorageMockWithClock(clock, 0, 7, 0);
    apiMocks.bootstrapPullSyncStateMock.mockImplementation(async () => {
      clock.advance(40);
      return createBootstrapPullResult({
        entries: [],
        bootstrapHotChangeId: 12,
        nextCursor: null,
        hasMore: false,
        remoteIsEmpty: false,
      });
    });

    storeSyncRestoreHistoryEntry({
      userId: "user-1",
      workspaceId: "workspace-1",
      installationId: "installation-1",
      lastAppliedHotChangeId: 301,
      localCardCount: 42,
      persistentStorageState: createPersistentStorageState(true, 321, 654, null, true, true),
    });
    await expect(loadCloudSettings()).resolves.toBeNull();

    await runWorkspaceRemoteSync({
      ...createRemoteSyncInput(),
      refreshWorkspaceView: async (_workspaceId: string): Promise<void> => {
        clock.advance(15);
      },
    });

    expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
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
        indexedDbOpenObservedAt: expect.any(String),
        indexedDbOpenOldVersion: 0,
        indexedDbOpenNewVersion: currentWebSyncDatabaseVersion,
        indexedDbDatabaseCreated: true,
        indexedDbDatabaseUpgraded: false,
      }),
    }));
    expect(observabilityMocks.addWebBreadcrumbMock).toHaveBeenCalledWith(expect.objectContaining({
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
        durationMs: 55,
        pageSize: 1000,
        bootstrapPullDurationMs: 40,
        applyHotPagesDurationMs: 0,
        finalRefreshDurationMs: 15,
        persistentStorageDurationMs: 7,
        bootstrapPageDurationMs: [40],
        indexedDbOpenObservedAt: expect.any(String),
        indexedDbOpenOldVersion: 0,
        indexedDbOpenNewVersion: currentWebSyncDatabaseVersion,
        indexedDbDatabaseCreated: true,
        indexedDbDatabaseUpgraded: false,
      }),
    }));
    expect(findCapturedWarning("sync_restore_slow")).toBeNull();
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
    expect(observabilityMocks.addWebBreadcrumbMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "sync_local_db_missing" }),
    );
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
    const clock = installMutableDateNow(0);
    installPersistentStorageMockWithClock(clock, 0, 7, 0);
    apiMocks.bootstrapPullSyncStateMock.mockImplementation(async () => {
      clock.advance(25);
      return createBootstrapPullResult({
        entries: [createDeckBootstrapEntry("other-workspace")],
        bootstrapHotChangeId: 44,
        nextCursor: null,
        hasMore: false,
        remoteIsEmpty: false,
      });
    });

    await expect(runWorkspaceRemoteSync(createRemoteSyncInput())).rejects.toThrow(
      "Deck sync payload workspace mismatch: other-workspace",
    );

    expect(observabilityMocks.captureWebWarningMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "sync_local_db_recovery_failed",
      details: expect.objectContaining({
        eventName: "sync_local_db_recovery_failed",
        syncRunId: "sync-run-1",
        failurePhase: "apply_hot_page",
        errorName: "Error",
        localCardCountBefore: 0,
        localCardCountAfter: null,
        pageCount: 1,
        entriesCount: 1,
        nextHotChangeId: 44,
        remoteIsEmpty: false,
        storagePersistedBefore: false,
        storagePersistedAfter: null,
        durationMs: 25,
        pageSize: 1000,
        bootstrapPullDurationMs: 25,
        applyHotPagesDurationMs: 0,
        finalRefreshDurationMs: 0,
        persistentStorageDurationMs: 0,
        bootstrapPageDurationMs: [25],
      }),
    }));
  });

  it("does not warn for a slow empty remote bootstrap", async () => {
    let nowMs = 0;
    vi.spyOn(Date, "now")
      .mockImplementation(() => nowMs);
    apiMocks.bootstrapPullSyncStateMock.mockResolvedValue(createBootstrapPullResult({
      entries: [],
      bootstrapHotChangeId: 12,
      nextCursor: null,
      hasMore: false,
      remoteIsEmpty: true,
    }));

    await runWorkspaceRemoteSync({
      ...createRemoteSyncInput(),
      refreshWorkspaceView: async (_workspaceId: string): Promise<void> => {
        nowMs = 3000;
      },
    });

    expect(findCapturedWarning("sync_restore_slow")).toBeNull();
  });

  it("keeps warning for a slow non-empty remote bootstrap", async () => {
    const clock = installMutableDateNow(0);
    installPersistentStorageMockWithClock(clock, 0, 7, 0);
    apiMocks.bootstrapPullSyncStateMock.mockImplementation(async () => {
      clock.advance(800);
      return createBootstrapPullResult({
        entries: [],
        bootstrapHotChangeId: 12,
        nextCursor: null,
        hasMore: false,
        remoteIsEmpty: false,
      });
    });

    await runWorkspaceRemoteSync({
      ...createRemoteSyncInput(),
      refreshWorkspaceView: async (_workspaceId: string): Promise<void> => {
        clock.advance(1200);
      },
    });

    expect(findCapturedWarning("sync_restore_slow")).toEqual(expect.objectContaining({
      action: "sync_restore_slow",
      details: expect.objectContaining({
        durationMs: 2000,
        pageSize: 1000,
        bootstrapPullDurationMs: 800,
        applyHotPagesDurationMs: 0,
        finalRefreshDurationMs: 1200,
        persistentStorageDurationMs: 7,
        bootstrapPageDurationMs: [800],
      }),
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
