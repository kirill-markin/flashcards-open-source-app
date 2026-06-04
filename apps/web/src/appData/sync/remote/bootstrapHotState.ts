import { bootstrapPullSyncState } from "../../../api";
import { webAppVersion } from "../../../clientIdentity";
import { loadActiveCardCount } from "../../../localDb/cards/cards";
import { applyHotSyncPage, loadWorkspaceSyncState } from "../../../localDb/cards/workspace";
import {
  ensurePersistentStorage,
  readPersistentStorageState,
  type PersistentStorageState,
} from "../../../localDb/sync/cloudSettings";
import type {
  SyncLocalDbRecoveryFailurePhase,
  SyncRestoreLocalBootstrapState,
} from "../../../observability/webObservability";
import {
  observeLocalDbMissing,
  observeLocalDbRecoveryFailed,
  observeLocalDbRecoverySucceeded,
  observePersistentStorageState,
  observeSlowHotBootstrap,
} from "../observation/syncLifecycleObservation";
import {
  loadSyncRestoreHistoryEntry,
  storeSyncRestoreHistoryEntry,
  type SyncRestoreHistoryEntry,
} from "../restore/syncRestoreHistory";
import {
  slowHotBootstrapWarningThresholdMs,
  syncPageSize,
} from "./constants";
import {
  doHotSyncEntriesAffectReviewSchedule,
  publishWorkspaceSettingsFromEntries,
} from "./hotSyncEntries";
import type {
  RemoteSyncFlags,
  WorkspaceRemoteSyncInput,
} from "./types";

function isEmptyRemoteBootstrapNoise(
  remoteIsEmpty: boolean | null,
  entriesCount: number,
  localCardCountAfter: number,
): boolean {
  return remoteIsEmpty === true && localCardCountAfter === 0 && entriesCount <= 1;
}

function shouldObserveHotBootstrap(input: Readonly<{
  durationMs: number;
  pageCount: number;
  entriesCount: number;
  localCardCountAfter: number;
  remoteIsEmpty: boolean | null;
}>): boolean {
  if (isEmptyRemoteBootstrapNoise(input.remoteIsEmpty, input.entriesCount, input.localCardCountAfter)) {
    return false;
  }

  return input.durationMs >= slowHotBootstrapWarningThresholdMs || input.pageCount > 1;
}

function determineLocalBootstrapState(
  syncStateBefore: Awaited<ReturnType<typeof loadWorkspaceSyncState>>,
  localCardCountBefore: number,
): SyncRestoreLocalBootstrapState {
  if (syncStateBefore === null) {
    return localCardCountBefore === 0 ? "no_sync_state_no_cards" : "no_sync_state_with_cards";
  }

  return localCardCountBefore === 0 ? "unhydrated_sync_state" : "unhydrated_with_cards";
}

function loadWorkspaceRestoreHistory(input: WorkspaceRemoteSyncInput): SyncRestoreHistoryEntry | null {
  return loadSyncRestoreHistoryEntry({
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
  });
}

async function storeCurrentWorkspaceRestoreHistory(
  input: WorkspaceRemoteSyncInput,
  lastAppliedHotChangeId: number,
  localCardCount: number,
  persistentStorageState: PersistentStorageState,
): Promise<void> {
  storeSyncRestoreHistoryEntry({
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    lastAppliedHotChangeId,
    localCardCount,
    persistentStorageState,
  });
}

async function loadAndStoreCurrentWorkspaceRestoreHistory(
  input: WorkspaceRemoteSyncInput,
  lastAppliedHotChangeId: number,
  persistentStorageState: PersistentStorageState,
): Promise<void> {
  const localCardCount = await loadActiveCardCount(input.workspaceId);
  await storeCurrentWorkspaceRestoreHistory(input, lastAppliedHotChangeId, localCardCount, persistentStorageState);
}

async function observePersistentStorageForHydratedWorkspace(
  input: WorkspaceRemoteSyncInput,
): Promise<PersistentStorageState> {
  const persistentStorageState = await ensurePersistentStorage();
  observePersistentStorageState({
    userId: input.userId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    persistentStorageState,
  });
  return persistentStorageState;
}

function readErrorName(error: unknown): string {
  if (typeof error !== "object" || error === null || "name" in error === false) {
    return "Error";
  }

  const errorName = (error as Readonly<{ name: unknown }>).name;
  return typeof errorName === "string" && errorName.trim() !== "" ? errorName : "Error";
}

export async function bootstrapHotState(input: WorkspaceRemoteSyncInput): Promise<RemoteSyncFlags> {
  const syncStateBefore = await loadWorkspaceSyncState(input.workspaceId);
  const hotStateHydrated = syncStateBefore?.hasHydratedHotState ?? false;
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  if (hotStateHydrated) {
    if (syncStateBefore === null) {
      throw new Error(`Workspace ${input.workspaceId} hot state is hydrated without sync state`);
    }

    const persistentStorageState = await observePersistentStorageForHydratedWorkspace(input);
    await loadAndStoreCurrentWorkspaceRestoreHistory(
      input,
      syncStateBefore.lastAppliedHotChangeId,
      persistentStorageState,
    );
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    return {
      didChangeProgressHistory: false,
      didChangeReviewSchedule: false,
    };
  }

  const startedAtMs = Date.now();
  const localCardCountBefore = await loadActiveCardCount(input.workspaceId);
  const localBootstrapState = determineLocalBootstrapState(syncStateBefore, localCardCountBefore);
  const lastAppliedHotChangeIdBefore = syncStateBefore?.lastAppliedHotChangeId ?? null;
  const restoreHistoryBefore = loadWorkspaceRestoreHistory(input);
  let didChangeReviewSchedule = false;
  let bootstrapCursor: string | null = null;
  let pageCount = 0;
  let entriesCount = 0;
  let nextHotChangeId: number | null = null;
  let remoteIsEmpty: boolean | null = null;
  let localCardCountAfter: number | null = null;
  let persistentStorageStateBeforeRecovery: PersistentStorageState | null = null;
  let persistentStorageStateAfterRecovery: PersistentStorageState | null = null;
  let recoveryFailurePhase: SyncLocalDbRecoveryFailurePhase = "pre_bootstrap_storage_read";
  const isLocalDbRecovery = syncStateBefore === null
    && localCardCountBefore === 0
    && restoreHistoryBefore !== null;

  try {
    if (isLocalDbRecovery && restoreHistoryBefore !== null) {
      recoveryFailurePhase = "pre_bootstrap_storage_read";
      persistentStorageStateBeforeRecovery = await readPersistentStorageState();
      observeLocalDbMissing({
        userId: input.userId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        syncRunId: input.syncRunId,
        localBootstrapState,
        localCardCountBefore,
        previousRestoreHistory: restoreHistoryBefore,
        currentWebAppVersion: webAppVersion,
        persistentStorageState: persistentStorageStateBeforeRecovery,
      });
    }

    while (true) {
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      recoveryFailurePhase = "bootstrap_pull";
      const bootstrapResult = await bootstrapPullSyncState(
        input.workspaceId,
        input.installationId,
        "web",
        webAppVersion,
        bootstrapCursor,
        syncPageSize,
      );
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      pageCount += 1;
      entriesCount += bootstrapResult.entries.length;
      nextHotChangeId = bootstrapResult.bootstrapHotChangeId;
      remoteIsEmpty = bootstrapResult.remoteIsEmpty;

      if (await doHotSyncEntriesAffectReviewSchedule(input.workspaceId, bootstrapResult.entries)) {
        didChangeReviewSchedule = true;
      }
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

      recoveryFailurePhase = "apply_hot_page";
      await applyHotSyncPage(
        input.workspaceId,
        bootstrapResult.entries,
        bootstrapResult.hasMore
          ? null
          : {
            lastAppliedHotChangeId: bootstrapResult.bootstrapHotChangeId,
            markHotStateHydrated: true,
          },
      );
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      publishWorkspaceSettingsFromEntries(input, bootstrapResult.entries);

      bootstrapCursor = bootstrapResult.nextCursor;
      if (bootstrapResult.hasMore === false) {
        break;
      }
    }

    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    recoveryFailurePhase = "final_refresh";
    await input.refreshWorkspaceView(input.workspaceId);
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const durationMs = Date.now() - startedAtMs;
    recoveryFailurePhase = "local_card_count_after";
    localCardCountAfter = await loadActiveCardCount(input.workspaceId);
    recoveryFailurePhase = "validate_bootstrap_result";
    if (nextHotChangeId === null) {
      throw new Error(`Workspace ${input.workspaceId} bootstrap did not return a hot change id`);
    }

    recoveryFailurePhase = "persistent_storage";
    persistentStorageStateAfterRecovery = await observePersistentStorageForHydratedWorkspace(input);
    recoveryFailurePhase = "restore_history_store";
    await storeCurrentWorkspaceRestoreHistory(
      input,
      nextHotChangeId,
      localCardCountAfter,
      persistentStorageStateAfterRecovery,
    );

    if (isLocalDbRecovery && restoreHistoryBefore !== null) {
      observeLocalDbRecoverySucceeded({
        userId: input.userId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        syncRunId: input.syncRunId,
        localBootstrapState,
        localCardCountBefore,
        localCardCountAfter,
        previousRestoreHistory: restoreHistoryBefore,
        currentWebAppVersion: webAppVersion,
        durationMs,
        pageSize: syncPageSize,
        pageCount,
        entriesCount,
        lastAppliedHotChangeIdBefore,
        nextHotChangeId,
        remoteIsEmpty,
        persistentStorageStateBefore: persistentStorageStateBeforeRecovery,
        persistentStorageStateAfter: persistentStorageStateAfterRecovery,
      });
    }

    recoveryFailurePhase = "slow_bootstrap_observation";
    if (shouldObserveHotBootstrap({
      durationMs,
      pageCount,
      entriesCount,
      localCardCountAfter,
      remoteIsEmpty,
    })) {
      observeSlowHotBootstrap({
        userId: input.userId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        syncRunId: input.syncRunId,
        durationMs,
        pageSize: syncPageSize,
        pageCount,
        entriesCount,
        localCardCountBefore,
        localCardCountAfter,
        localBootstrapState,
        lastAppliedHotChangeIdBefore,
        nextHotChangeId,
        remoteIsEmpty,
      });
    }

    return {
      didChangeProgressHistory: false,
      didChangeReviewSchedule,
    };
  } catch (error) {
    if (isLocalDbRecovery && restoreHistoryBefore !== null) {
      observeLocalDbRecoveryFailed({
        userId: input.userId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        syncRunId: input.syncRunId,
        failurePhase: recoveryFailurePhase,
        errorName: readErrorName(error),
        localBootstrapState,
        localCardCountBefore,
        localCardCountAfter,
        previousRestoreHistory: restoreHistoryBefore,
        currentWebAppVersion: webAppVersion,
        durationMs: Date.now() - startedAtMs,
        pageSize: syncPageSize,
        pageCount,
        entriesCount,
        lastAppliedHotChangeIdBefore,
        nextHotChangeId,
        remoteIsEmpty,
        persistentStorageStateBefore: persistentStorageStateBeforeRecovery,
        persistentStorageStateAfter: persistentStorageStateAfterRecovery,
      });
    }

    throw error;
  }
}
