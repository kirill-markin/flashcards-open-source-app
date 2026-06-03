import {
  addWebBreadcrumb,
  captureWebWarning,
  type SyncRestoreLocalBootstrapState,
  type WebObservationScope,
} from "../../observability/webObservability";
import type { PersistentStorageState } from "../../localDb/cloudSettings";
import type { SyncRestoreHistoryEntry } from "./syncRestoreHistory";

export type HotBootstrapSlowObservationInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
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
  localBootstrapState: SyncRestoreLocalBootstrapState;
  localCardCountBefore: number;
  previousRestoreHistory: SyncRestoreHistoryEntry;
  currentWebAppVersion: string;
  persistentStorageState: PersistentStorageState;
}>;

export type PersistentStorageObservationInput = Readonly<{
  userId: string;
  workspaceId: string;
  installationId: string;
  persistentStorageState: PersistentStorageState;
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

export function observeSlowHotBootstrap(input: HotBootstrapSlowObservationInput): void {
  captureWebWarning({
    action: "sync_restore_slow",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "sync_hot_bootstrap_slow",
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
    },
  });
}

export function observeLocalDbMissing(input: LocalDbMissingObservationInput): void {
  captureWebWarning({
    action: "sync_local_db_missing",
    scope: buildSyncObservationScope(input.userId, input.workspaceId, input.installationId),
    details: {
      eventName: "sync_local_db_missing",
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      localBootstrapState: input.localBootstrapState,
      localCardCountBefore: input.localCardCountBefore,
      previousHydratedAt: input.previousRestoreHistory.hydratedAt,
      previousWebAppVersion: input.previousRestoreHistory.webAppVersion,
      previousLastAppliedHotChangeId: input.previousRestoreHistory.lastAppliedHotChangeId,
      previousLocalCardCount: input.previousRestoreHistory.localCardCount,
      currentWebAppVersion: input.currentWebAppVersion,
      storagePersisted: input.persistentStorageState.persisted,
      storageUsage: input.persistentStorageState.usage,
      storageQuota: input.persistentStorageState.quota,
      storageErrorName: input.persistentStorageState.errorName,
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
    },
  });
}
