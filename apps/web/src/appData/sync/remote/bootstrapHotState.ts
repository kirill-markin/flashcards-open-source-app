import { bootstrapPullSyncState } from "../../../api";
import { webAppVersion } from "../../../clientIdentity";
import { loadActiveCardCount } from "../../../localDb/cards/cards";
import { applyHotSyncPage, loadWorkspaceSyncState } from "../../../localDb/cards/workspace";
import { readIndexedDbOpenLifecycleSnapshotForDiagnostics } from "../../../localDb/core/database";
import {
  ensurePersistentStorage,
  readPersistentStorageState,
  type PersistentStorageState,
} from "../../../localDb/sync/cloudSettings";
import type {
  SyncBootstrapTimingDetails,
  SyncLocalDbRecoveryFailurePhase,
  SyncRestoreLocalBootstrapState,
} from "../../../observability/webObservability";
import { seedDemoCardForNewWorkspace } from "../local/demoCard";
import {
  observeLocalDbMissing,
  observeLocalDbRecoveryFailed,
  observeLocalDbRecoverySucceeded,
  observePersistentStorageState,
  observeSlowHotBootstrap,
  observeToleratedSlowHotBootstrap,
} from "../observation/syncLifecycleObservation";
import {
  loadSyncRestoreHistoryEntry,
  storeSyncRestoreHistoryEntry,
  type SyncRestoreHistoryEntry,
} from "../restore/syncRestoreHistory";
import {
  slowHotBootstrapBaseWarningBudgetMs,
  slowHotBootstrapBreadcrumbThresholdMs,
  slowHotBootstrapMinimumWarningThresholdMs,
  slowHotBootstrapPerEntryWarningBudgetMs,
  slowHotBootstrapPerPageWarningBudgetMs,
  syncBootstrapPageSize,
} from "./constants";
import {
  doHotSyncEntriesAffectReviewSchedule,
  publishWorkspaceSettingsFromEntries,
} from "./hotSyncEntries";
import type {
  RemoteSyncFlags,
  WorkspaceRemoteSyncInput,
} from "./types";

const maximumBootstrapPageDurationCount = 20;

function appendBootstrapPageDurationMs(
  bootstrapPageDurationMs: ReadonlyArray<number>,
  durationMs: number,
): ReadonlyArray<number> {
  if (bootstrapPageDurationMs.length >= maximumBootstrapPageDurationCount) {
    return bootstrapPageDurationMs;
  }

  return [...bootstrapPageDurationMs, durationMs];
}

function isEmptyRemoteBootstrapNoise(
  remoteIsEmpty: boolean | null,
  entriesCount: number,
  localCardCountAfter: number,
): boolean {
  return remoteIsEmpty === true && localCardCountAfter === 0 && entriesCount <= 1;
}

type HotBootstrapObservationGateInput = Readonly<{
  durationMs: number;
  pageCount: number;
  entriesCount: number;
  localCardCountAfter: number;
  remoteIsEmpty: boolean | null;
}>;

function calculateSlowHotBootstrapWarningThresholdMs(input: Readonly<{
  pageCount: number;
  entriesCount: number;
}>): number {
  const warningBudgetMs = Math.ceil(
    slowHotBootstrapBaseWarningBudgetMs
    + input.pageCount * slowHotBootstrapPerPageWarningBudgetMs
    + input.entriesCount * slowHotBootstrapPerEntryWarningBudgetMs,
  );
  return Math.max(slowHotBootstrapMinimumWarningThresholdMs, warningBudgetMs);
}

function shouldObserveHotBootstrap(input: HotBootstrapObservationGateInput): boolean {
  if (isEmptyRemoteBootstrapNoise(input.remoteIsEmpty, input.entriesCount, input.localCardCountAfter)) {
    return false;
  }

  return input.durationMs >= calculateSlowHotBootstrapWarningThresholdMs(input);
}

// Tolerated-slow band: a non-empty bootstrap that is slow enough to record
// (>= the breadcrumb floor) but below the volume-aware warning threshold. The warning
// gate takes precedence, so the two paths stay mutually exclusive.
function shouldBreadcrumbSlowHotBootstrap(input: HotBootstrapObservationGateInput): boolean {
  if (isEmptyRemoteBootstrapNoise(input.remoteIsEmpty, input.entriesCount, input.localCardCountAfter)) {
    return false;
  }

  const warningThresholdMs = calculateSlowHotBootstrapWarningThresholdMs(input);
  return input.durationMs >= slowHotBootstrapBreadcrumbThresholdMs
    && input.durationMs < warningThresholdMs;
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
  if (input.hasFailed()) {
    return;
  }
  await storeCurrentWorkspaceRestoreHistory(input, lastAppliedHotChangeId, localCardCount, persistentStorageState);
}

async function observePersistentStorageForHydratedWorkspace(
  input: WorkspaceRemoteSyncInput,
): Promise<PersistentStorageState | null> {
  const persistentStorageState = await ensurePersistentStorage();
  if (input.hasFailed()) {
    return null;
  }
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
  if (input.hasFailed()) {
    return {
      didChangeProgressHistory: false,
      didChangeReviewSchedule: false,
    };
  }
  const indexedDbOpenLifecycleSnapshot = readIndexedDbOpenLifecycleSnapshotForDiagnostics();
  const hotStateHydrated = syncStateBefore?.hasHydratedHotState ?? false;
  input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
  if (hotStateHydrated) {
    if (syncStateBefore === null) {
      throw new Error(`Workspace ${input.workspaceId} hot state is hydrated without sync state`);
    }

    const persistentStorageState = await observePersistentStorageForHydratedWorkspace(input);
    if (input.hasFailed() || persistentStorageState === null) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule: false,
      };
    }
    await loadAndStoreCurrentWorkspaceRestoreHistory(
      input,
      syncStateBefore.lastAppliedHotChangeId,
      persistentStorageState,
    );
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule: false,
      };
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    return {
      didChangeProgressHistory: false,
      didChangeReviewSchedule: false,
    };
  }

  const startedAtMs = Date.now();
  const localCardCountBefore = await loadActiveCardCount(input.workspaceId);
  if (input.hasFailed()) {
    return {
      didChangeProgressHistory: false,
      didChangeReviewSchedule: false,
    };
  }
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
  let bootstrapPullDurationMs = 0;
  let applyHotPagesDurationMs = 0;
  let finalRefreshDurationMs = 0;
  let persistentStorageDurationMs = 0;
  let bootstrapPageDurationMs: ReadonlyArray<number> = [];
  const readBootstrapTimingDetails = (): SyncBootstrapTimingDetails => ({
    bootstrapPullDurationMs,
    applyHotPagesDurationMs,
    finalRefreshDurationMs,
    persistentStorageDurationMs,
    bootstrapPageDurationMs,
  });
  let recoveryFailurePhase: SyncLocalDbRecoveryFailurePhase = "pre_bootstrap_storage_read";
  // The local IndexedDB is a best-effort cache, never a source of truth. Browsers can
  // evict it at any time — storage pressure, a denied navigator.storage.persist()
  // grant, or the user clearing site data — so finding it empty while restore history
  // shows it once held data is an expected condition, not a failure. The backend is the
  // source of truth and the loop below transparently re-hydrates the full hot state
  // from it. Because this path self-heals, the "missing" and "recovered" signals are
  // emitted as silent breadcrumbs (no Sentry issue); only a failed re-hydration (catch
  // block) escalates to a warning.
  const isLocalDbRecovery = syncStateBefore === null
    && localCardCountBefore === 0
    && restoreHistoryBefore !== null;

  try {
    if (isLocalDbRecovery && restoreHistoryBefore !== null) {
      recoveryFailurePhase = "pre_bootstrap_storage_read";
      persistentStorageStateBeforeRecovery = await readPersistentStorageState();
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
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
        indexedDbOpenLifecycleSnapshot,
      });
    }

    while (true) {
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      recoveryFailurePhase = "bootstrap_pull";
      const bootstrapPullStartedAtMs = Date.now();
      const bootstrapResult = await bootstrapPullSyncState(
        input.workspaceId,
        input.installationId,
        "web",
        webAppVersion,
        bootstrapCursor,
        syncBootstrapPageSize,
        true,
      );
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
      const bootstrapPullElapsedMs = Date.now() - bootstrapPullStartedAtMs;
      bootstrapPullDurationMs += bootstrapPullElapsedMs;
      bootstrapPageDurationMs = appendBootstrapPageDurationMs(bootstrapPageDurationMs, bootstrapPullElapsedMs);
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      pageCount += 1;
      entriesCount += bootstrapResult.entries.length;
      nextHotChangeId = bootstrapResult.bootstrapHotChangeId;
      remoteIsEmpty = bootstrapResult.remoteIsEmpty;

      if (await doHotSyncEntriesAffectReviewSchedule(input.workspaceId, bootstrapResult.entries)) {
        didChangeReviewSchedule = true;
      }
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);

      recoveryFailurePhase = "apply_hot_page";
      const applyHotPageStartedAtMs = Date.now();
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
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
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
      applyHotPagesDurationMs += Date.now() - applyHotPageStartedAtMs;
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      publishWorkspaceSettingsFromEntries(input, bootstrapResult.entries);

      bootstrapCursor = bootstrapResult.nextCursor;
      if (bootstrapResult.hasMore === false) {
        break;
      }
    }

    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    recoveryFailurePhase = "final_refresh";
    const finalRefreshStartedAtMs = Date.now();
    await input.refreshWorkspaceView(input.workspaceId);
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    finalRefreshDurationMs = Date.now() - finalRefreshStartedAtMs;
    input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
    const durationMs = Date.now() - startedAtMs;
    recoveryFailurePhase = "local_card_count_after";
    localCardCountAfter = await loadActiveCardCount(input.workspaceId);
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    recoveryFailurePhase = "validate_bootstrap_result";
    if (nextHotChangeId === null) {
      throw new Error(`Workspace ${input.workspaceId} bootstrap did not return a hot change id`);
    }

    recoveryFailurePhase = "persistent_storage";
    const persistentStorageStartedAtMs = Date.now();
    persistentStorageStateAfterRecovery = await observePersistentStorageForHydratedWorkspace(input);
    if (input.hasFailed() || persistentStorageStateAfterRecovery === null) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    persistentStorageDurationMs = Date.now() - persistentStorageStartedAtMs;
    recoveryFailurePhase = "restore_history_store";
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }
    await storeCurrentWorkspaceRestoreHistory(
      input,
      nextHotChangeId,
      localCardCountAfter,
      persistentStorageStateAfterRecovery,
    );
    if (input.hasFailed()) {
      return {
        didChangeProgressHistory: false,
        didChangeReviewSchedule,
      };
    }

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
        pageSize: syncBootstrapPageSize,
        pageCount,
        entriesCount,
        lastAppliedHotChangeIdBefore,
        nextHotChangeId,
        remoteIsEmpty,
        persistentStorageStateBefore: persistentStorageStateBeforeRecovery,
        persistentStorageStateAfter: persistentStorageStateAfterRecovery,
        ...readBootstrapTimingDetails(),
        indexedDbOpenLifecycleSnapshot,
      });
    }

    recoveryFailurePhase = "slow_bootstrap_observation";
    if (isLocalDbRecovery === false) {
      const slowBootstrapObservation = {
        durationMs,
        pageCount,
        entriesCount,
        localCardCountAfter,
        remoteIsEmpty,
      };
      const slowHotBootstrapDetails = {
        userId: input.userId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        syncRunId: input.syncRunId,
        durationMs,
        pageSize: syncBootstrapPageSize,
        pageCount,
        entriesCount,
        localCardCountBefore,
        localCardCountAfter,
        localBootstrapState,
        lastAppliedHotChangeIdBefore,
        nextHotChangeId,
        remoteIsEmpty,
        ...readBootstrapTimingDetails(),
      };
      // Warning wins: durations above the volume-aware budget raise a Sentry issue;
      // tolerated-slow restores only add a silent breadcrumb. The two predicates never
      // overlap, so at most one fires.
      if (shouldObserveHotBootstrap(slowBootstrapObservation)) {
        observeSlowHotBootstrap(slowHotBootstrapDetails);
      } else if (shouldBreadcrumbSlowHotBootstrap(slowBootstrapObservation)) {
        observeToleratedSlowHotBootstrap(slowHotBootstrapDetails);
      }
    }

    // Brand-new user: the first successful bootstrap of the account's only workspace, when
    // that workspace is empty on the backend and holds no local cards. isOnlyWorkspaceForUser
    // is what makes this a new-user rule rather than a new-workspace rule, so an existing
    // user who deliberately creates another empty workspace is not onboarded again.
    // isLocalDbRecovery excludes a re-hydration of an evicted local cache, which is by
    // definition a workspace this browser already bootstrapped once. The seed runs after the
    // observations above so it cannot change localCardCountAfter, and after the
    // restore-history write so both keep describing the bootstrap result itself.
    if (isLocalDbRecovery === false) {
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
      input.requireWorkspaceSyncNotDiscarded(input.workspaceId);
      const demoCardSeedResult = await seedDemoCardForNewWorkspace({
        userId: input.userId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        isOnlyWorkspaceForUser: input.isOnlyWorkspaceForUser,
        remoteIsEmpty,
        localCardCount: localCardCountAfter,
      });
      if (input.hasFailed()) {
        return {
          didChangeProgressHistory: false,
          didChangeReviewSchedule,
        };
      }
      if (demoCardSeedResult !== null && demoCardSeedResult.didChangeReviewSchedule) {
        didChangeReviewSchedule = true;
      }
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
        pageSize: syncBootstrapPageSize,
        pageCount,
        entriesCount,
        lastAppliedHotChangeIdBefore,
        nextHotChangeId,
        remoteIsEmpty,
        persistentStorageStateBefore: persistentStorageStateBeforeRecovery,
        persistentStorageStateAfter: persistentStorageStateAfterRecovery,
        ...readBootstrapTimingDetails(),
        indexedDbOpenLifecycleSnapshot,
      });
    }

    throw error;
  }
}
