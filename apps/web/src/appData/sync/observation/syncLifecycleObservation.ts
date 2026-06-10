import {
  addWebBreadcrumb,
  captureWebWarning,
  type SyncBootstrapTimingDetails,
  type SyncLocalDbRecoveryFailurePhase,
  type SyncRestoreLocalBootstrapState,
  type WebObservationScope,
} from "../../../observability/webObservability";
import type { IndexedDbOpenLifecycleSnapshot } from "../../../localDb/core/database";
import type { PersistentStorageState } from "../../../localDb/sync/cloudSettings";
import type { SyncRestoreHistoryEntry } from "../restore/syncRestoreHistory";

export type HotBootstrapSlowObservationInput = SyncBootstrapTimingDetails & Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  syncRunId: string;
  durationMs: number;
  pageSize: number;
  pageCount: number;
  entriesCount: number;
  localCardCountBefore: number;
  localCardCountAfter: number;
  localBootstrapState: SyncRestoreLocalBootstrapState;
  lastAppliedHotChangeIdBefore: number | null;
  nextHotChangeId: number | null;
  remoteIsEmpty: boolean | null;
}>;

export type LocalDbMissingObservationInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  syncRunId: string;
  localBootstrapState: SyncRestoreLocalBootstrapState;
  localCardCountBefore: number;
  previousRestoreHistory: SyncRestoreHistoryEntry;
  currentWebAppVersion: string;
  persistentStorageState: PersistentStorageState;
  indexedDbOpenLifecycleSnapshot: IndexedDbOpenLifecycleSnapshot | null;
}>;

export type PersistentStorageObservationInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  persistentStorageState: PersistentStorageState;
}>;

export type LocalDbRecoveryObservationInput = SyncBootstrapTimingDetails & Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  syncRunId: string;
  localBootstrapState: SyncRestoreLocalBootstrapState;
  localCardCountBefore: number;
  localCardCountAfter: number | null;
  previousRestoreHistory: SyncRestoreHistoryEntry;
  currentWebAppVersion: string;
  durationMs: number;
  pageSize: number;
  pageCount: number;
  entriesCount: number;
  lastAppliedHotChangeIdBefore: number | null;
  nextHotChangeId: number | null;
  remoteIsEmpty: boolean | null;
  persistentStorageStateBefore: PersistentStorageState | null;
  persistentStorageStateAfter: PersistentStorageState | null;
  indexedDbOpenLifecycleSnapshot: IndexedDbOpenLifecycleSnapshot | null;
}>;

export type LocalDbRecoveryFailedObservationInput = LocalDbRecoveryObservationInput & Readonly<{
  failurePhase: SyncLocalDbRecoveryFailurePhase;
  errorName: string;
}>;

function getCurrentRoute(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function buildSyncObservationScope(
  userId: string,
  workspaceId: string,
  installationId: string,
): WebObservationScope {
  return {
    app: "web",
    feature: "sync",
    userId,
    workspaceId,
    installationId,
    route: getCurrentRoute(),
    requestId: null,
    statusCode: null,
    code: null,
  };
}

function buildSyncBootstrapTimingDetails(input: SyncBootstrapTimingDetails): SyncBootstrapTimingDetails {
  return {
    bootstrapPullDurationMs: input.bootstrapPullDurationMs,
    applyHotPagesDurationMs: input.applyHotPagesDurationMs,
    finalRefreshDurationMs: input.finalRefreshDurationMs,
    persistentStorageDurationMs: input.persistentStorageDurationMs,
    bootstrapPageDurationMs: input.bootstrapPageDurationMs,
  };
}

type IndexedDbOpenLifecycleObservationFields = Readonly<{
  indexedDbOpenObservedAt: string | null;
  indexedDbOpenOldVersion: number | null;
  indexedDbOpenNewVersion: number | null;
  indexedDbDatabaseCreated: boolean | null;
  indexedDbDatabaseUpgraded: boolean | null;
}>;

function buildIndexedDbOpenLifecycleObservationFields(
  snapshot: IndexedDbOpenLifecycleSnapshot | null,
): IndexedDbOpenLifecycleObservationFields {
  if (snapshot === null) {
    return {
      indexedDbOpenObservedAt: null,
      indexedDbOpenOldVersion: null,
      indexedDbOpenNewVersion: null,
      indexedDbDatabaseCreated: null,
      indexedDbDatabaseUpgraded: null,
    };
  }

  return {
    indexedDbOpenObservedAt: snapshot.observedAt,
    indexedDbOpenOldVersion: snapshot.oldVersion,
    indexedDbOpenNewVersion: snapshot.newVersion,
    indexedDbDatabaseCreated: snapshot.databaseCreated,
    indexedDbDatabaseUpgraded: snapshot.databaseUpgraded,
  };
}

export function observeSlowHotBootstrap(input: HotBootstrapSlowObservationInput): void {
  captureWebWarning({
    action: "sync_restore_slow",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "sync_hot_bootstrap_slow",
      syncRunId: input.syncRunId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      durationMs: input.durationMs,
      pageSize: input.pageSize,
      pageCount: input.pageCount,
      entriesCount: input.entriesCount,
      localCardCountBefore: input.localCardCountBefore,
      localCardCountAfter: input.localCardCountAfter,
      localBootstrapState: input.localBootstrapState,
      lastAppliedHotChangeIdBefore: input.lastAppliedHotChangeIdBefore,
      nextHotChangeId: input.nextHotChangeId,
      remoteIsEmpty: input.remoteIsEmpty,
      ...buildSyncBootstrapTimingDetails(input),
    },
  });
}

// Expected, self-healing condition: the browser evicted the best-effort local
// IndexedDB cache and we are about to transparently re-hydrate from the backend
// (the source of truth). Emitted as a silent breadcrumb, not a warning, so it never
// raises a Sentry issue on its own — it only adds context to a later capture. See
// bootstrapHotState for the full rationale; a failed re-hydration is reported as a
// warning by observeLocalDbRecoveryFailed.
export function observeLocalDbMissing(input: LocalDbMissingObservationInput): void {
  const indexedDbOpenLifecycleFields = buildIndexedDbOpenLifecycleObservationFields(
    input.indexedDbOpenLifecycleSnapshot,
  );
  addWebBreadcrumb({
    action: "sync_local_db_missing",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "sync_local_db_missing",
      syncRunId: input.syncRunId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      localBootstrapState: input.localBootstrapState,
      localCardCountBefore: input.localCardCountBefore,
      previousHydratedAt: input.previousRestoreHistory.hydratedAt,
      previousWebAppVersion: input.previousRestoreHistory.webAppVersion,
      previousLastAppliedHotChangeId: input.previousRestoreHistory.lastAppliedHotChangeId,
      previousLocalCardCount: input.previousRestoreHistory.localCardCount,
      previousPersistentStorageCheckedAt: input.previousRestoreHistory.persistentStorageCheckedAt,
      previousPersistentStoragePersisted: input.previousRestoreHistory.persistentStoragePersisted,
      previousPersistentStorageUsage: input.previousRestoreHistory.persistentStorageUsage,
      previousPersistentStorageQuota: input.previousRestoreHistory.persistentStorageQuota,
      previousPersistentStorageErrorName: input.previousRestoreHistory.persistentStorageErrorName,
      previousPersistentStoragePersistAttempted: input.previousRestoreHistory.persistentStoragePersistAttempted,
      previousPersistentStoragePersistGranted: input.previousRestoreHistory.persistentStoragePersistGranted,
      currentWebAppVersion: input.currentWebAppVersion,
      storagePersisted: input.persistentStorageState.persisted,
      storageUsage: input.persistentStorageState.usage,
      storageQuota: input.persistentStorageState.quota,
      storageErrorName: input.persistentStorageState.errorName,
      storagePersistAttempted: input.persistentStorageState.persistAttempted,
      storagePersistGranted: input.persistentStorageState.persistGranted,
      ...indexedDbOpenLifecycleFields,
    },
  });
}

function nullPersistentStorageState(): PersistentStorageState {
  return {
    persisted: null,
    usage: null,
    quota: null,
    errorName: null,
    persistAttempted: false,
    persistGranted: null,
  };
}

function persistentStorageStateOrNull(state: PersistentStorageState | null): PersistentStorageState {
  return state ?? nullPersistentStorageState();
}

// Successful transparent re-hydration after the browser evicted the local cache.
// Like observeLocalDbMissing, this is a silent breadcrumb (no Sentry issue): the app
// behaved exactly as designed, so it must not raise a warning.
export function observeLocalDbRecoverySucceeded(input: LocalDbRecoveryObservationInput): void {
  const persistentStorageStateBefore = persistentStorageStateOrNull(input.persistentStorageStateBefore);
  const persistentStorageStateAfter = persistentStorageStateOrNull(input.persistentStorageStateAfter);
  const indexedDbOpenLifecycleFields = buildIndexedDbOpenLifecycleObservationFields(
    input.indexedDbOpenLifecycleSnapshot,
  );
  addWebBreadcrumb({
    action: "sync_local_db_recovery_succeeded",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "sync_local_db_recovery_succeeded",
      syncRunId: input.syncRunId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      localBootstrapState: input.localBootstrapState,
      localCardCountBefore: input.localCardCountBefore,
      localCardCountAfter: input.localCardCountAfter ?? 0,
      previousHydratedAt: input.previousRestoreHistory.hydratedAt,
      previousWebAppVersion: input.previousRestoreHistory.webAppVersion,
      previousLastAppliedHotChangeId: input.previousRestoreHistory.lastAppliedHotChangeId,
      previousLocalCardCount: input.previousRestoreHistory.localCardCount,
      previousPersistentStorageCheckedAt: input.previousRestoreHistory.persistentStorageCheckedAt,
      previousPersistentStoragePersisted: input.previousRestoreHistory.persistentStoragePersisted,
      previousPersistentStorageUsage: input.previousRestoreHistory.persistentStorageUsage,
      previousPersistentStorageQuota: input.previousRestoreHistory.persistentStorageQuota,
      previousPersistentStorageErrorName: input.previousRestoreHistory.persistentStorageErrorName,
      previousPersistentStoragePersistAttempted: input.previousRestoreHistory.persistentStoragePersistAttempted,
      previousPersistentStoragePersistGranted: input.previousRestoreHistory.persistentStoragePersistGranted,
      currentWebAppVersion: input.currentWebAppVersion,
      durationMs: input.durationMs,
      pageSize: input.pageSize,
      pageCount: input.pageCount,
      entriesCount: input.entriesCount,
      lastAppliedHotChangeIdBefore: input.lastAppliedHotChangeIdBefore,
      nextHotChangeId: input.nextHotChangeId,
      remoteIsEmpty: input.remoteIsEmpty,
      storagePersistedBefore: persistentStorageStateBefore.persisted,
      storageUsageBefore: persistentStorageStateBefore.usage,
      storageQuotaBefore: persistentStorageStateBefore.quota,
      storageErrorNameBefore: persistentStorageStateBefore.errorName,
      storagePersistAttemptedBefore: persistentStorageStateBefore.persistAttempted,
      storagePersistGrantedBefore: persistentStorageStateBefore.persistGranted,
      storagePersistedAfter: persistentStorageStateAfter.persisted,
      storageUsageAfter: persistentStorageStateAfter.usage,
      storageQuotaAfter: persistentStorageStateAfter.quota,
      storageErrorNameAfter: persistentStorageStateAfter.errorName,
      storagePersistAttemptedAfter: persistentStorageStateAfter.persistAttempted,
      storagePersistGrantedAfter: persistentStorageStateAfter.persistGranted,
      ...buildSyncBootstrapTimingDetails(input),
      ...indexedDbOpenLifecycleFields,
    },
  });
}

// Real problem: re-hydrating the evicted local cache from the backend failed, so the
// user is left without their data. Unlike the missing/succeeded breadcrumbs above,
// this stays a warning so it surfaces as a Sentry issue.
export function observeLocalDbRecoveryFailed(input: LocalDbRecoveryFailedObservationInput): void {
  const persistentStorageStateBefore = persistentStorageStateOrNull(input.persistentStorageStateBefore);
  const persistentStorageStateAfter = persistentStorageStateOrNull(input.persistentStorageStateAfter);
  const indexedDbOpenLifecycleFields = buildIndexedDbOpenLifecycleObservationFields(
    input.indexedDbOpenLifecycleSnapshot,
  );
  captureWebWarning({
    action: "sync_local_db_recovery_failed",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "sync_local_db_recovery_failed",
      syncRunId: input.syncRunId,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      failurePhase: input.failurePhase,
      errorName: input.errorName,
      localBootstrapState: input.localBootstrapState,
      localCardCountBefore: input.localCardCountBefore,
      localCardCountAfter: input.localCardCountAfter,
      previousHydratedAt: input.previousRestoreHistory.hydratedAt,
      previousWebAppVersion: input.previousRestoreHistory.webAppVersion,
      previousLastAppliedHotChangeId: input.previousRestoreHistory.lastAppliedHotChangeId,
      previousLocalCardCount: input.previousRestoreHistory.localCardCount,
      previousPersistentStorageCheckedAt: input.previousRestoreHistory.persistentStorageCheckedAt,
      previousPersistentStoragePersisted: input.previousRestoreHistory.persistentStoragePersisted,
      previousPersistentStorageUsage: input.previousRestoreHistory.persistentStorageUsage,
      previousPersistentStorageQuota: input.previousRestoreHistory.persistentStorageQuota,
      previousPersistentStorageErrorName: input.previousRestoreHistory.persistentStorageErrorName,
      previousPersistentStoragePersistAttempted: input.previousRestoreHistory.persistentStoragePersistAttempted,
      previousPersistentStoragePersistGranted: input.previousRestoreHistory.persistentStoragePersistGranted,
      currentWebAppVersion: input.currentWebAppVersion,
      durationMs: input.durationMs,
      pageSize: input.pageSize,
      pageCount: input.pageCount,
      entriesCount: input.entriesCount,
      lastAppliedHotChangeIdBefore: input.lastAppliedHotChangeIdBefore,
      nextHotChangeId: input.nextHotChangeId,
      remoteIsEmpty: input.remoteIsEmpty,
      storagePersistedBefore: persistentStorageStateBefore.persisted,
      storageUsageBefore: persistentStorageStateBefore.usage,
      storageQuotaBefore: persistentStorageStateBefore.quota,
      storageErrorNameBefore: persistentStorageStateBefore.errorName,
      storagePersistAttemptedBefore: input.persistentStorageStateBefore === null
        ? null
        : persistentStorageStateBefore.persistAttempted,
      storagePersistGrantedBefore: persistentStorageStateBefore.persistGranted,
      storagePersistedAfter: persistentStorageStateAfter.persisted,
      storageUsageAfter: persistentStorageStateAfter.usage,
      storageQuotaAfter: persistentStorageStateAfter.quota,
      storageErrorNameAfter: persistentStorageStateAfter.errorName,
      storagePersistAttemptedAfter: input.persistentStorageStateAfter === null
        ? null
        : persistentStorageStateAfter.persistAttempted,
      storagePersistGrantedAfter: persistentStorageStateAfter.persistGranted,
      ...buildSyncBootstrapTimingDetails(input),
      ...indexedDbOpenLifecycleFields,
    },
  });
}

export function observePersistentStorageState(input: PersistentStorageObservationInput): void {
  addWebBreadcrumb({
    action: "persistent_storage",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "persistent_storage_checked",
      storagePersisted: input.persistentStorageState.persisted,
      storageUsage: input.persistentStorageState.usage,
      storageQuota: input.persistentStorageState.quota,
      storageErrorName: input.persistentStorageState.errorName,
      storagePersistAttempted: input.persistentStorageState.persistAttempted,
      storagePersistGranted: input.persistentStorageState.persistGranted,
    },
  });
}
