package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.TimeProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class ProgressSummaryHandledInputs(
    val previousStoreState: ProgressSummaryStoreState?,
    val currentStoreState: ProgressSummaryStoreState
)

internal class ProgressSummaryOrchestration(
    private val database: AppDatabase,
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val timeProvider: TimeProvider,
    private val cacheReadinessCoordinator: ProgressLocalCacheReadinessCoordinator,
    private val backgroundLauncher: ProgressBackgroundLauncher
) {
    private val snapshotMutable = MutableStateFlow<ProgressSummarySnapshot?>(null)
    private val latestInputsMutable = MutableStateFlow<ProgressObservedInputs?>(null)
    private val latestStoreStateMutable = MutableStateFlow<ProgressSummaryStoreState?>(null)
    private val refreshCoordinator = ProgressRefreshCoordinator()

    fun observeSnapshot(): Flow<ProgressSummarySnapshot?> {
        return snapshotMutable.asStateFlow()
    }

    fun handleInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressSummaryHandledInputs {
        latestInputsMutable.value = inputs
        val previousStoreState = latestStoreStateMutable.value
        val currentStoreState = createProgressSummaryStoreState(
            inputs = createStoreInputs(
                inputs = inputs,
                clockSnapshot = clockSnapshot
            )
        )
        latestStoreStateMutable.value = currentStoreState
        publishSnapshotIfChanged(snapshot = currentStoreState.snapshot)
        return ProgressSummaryHandledInputs(
            previousStoreState = previousStoreState,
            currentStoreState = currentStoreState
        )
    }

    fun launchSyncCompletedRefreshIfNeeded(
        handledInputs: ProgressSummaryHandledInputs
    ) {
        val currentStoreState = handledInputs.currentStoreState
        if (
            didSyncCompleteWithReviewHistoryChange(
                previousSuccessfulSyncAtMillis =
                    handledInputs.previousStoreState?.syncStatus?.lastSuccessfulSyncAtMillis,
                currentSuccessfulSyncAtMillis = currentStoreState.syncStatus.lastSuccessfulSyncAtMillis,
                previousReviewHistoryFingerprint = handledInputs.previousStoreState?.reviewHistoryFingerprint,
                currentReviewHistoryFingerprint = currentStoreState.reviewHistoryFingerprint
            ).not()
        ) {
            return
        }

        backgroundLauncher.launchAndLogFailure(
            event = "progress_summary_background_refresh_failed",
            fields = listOf(
                "scopeKey" to serializeProgressSummaryScopeKey(scopeKey = currentStoreState.scopeKey)
            )
        ) {
            refreshFromStoreState(
                storeState = currentStoreState,
                refreshReason = ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE
            )
        }
    }

    suspend fun refreshIfInvalidated() {
        var storeState = currentStoreState() ?: return
        if (storeState.isLocalCacheReady.not()) {
            cacheReadinessCoordinator.ensureLocalCacheReady(timeZone = storeState.scopeKey.timeZone)
            storeState = currentStoreState() ?: return
            if (storeState.isLocalCacheReady.not()) {
                return
            }
        }

        val snapshot = requireNotNull(storeState.snapshot) {
            "Progress summary snapshot is required once the local progress cache is ready."
        }
        val existingSnapshot = snapshotMutable.value
        val refreshReason = when {
            supportsServerRefresh(cloudState = storeState.cloudState).not() -> null
            existingSnapshot == null -> {
                if (snapshot.serverBase == null) {
                    ProgressRefreshReason.MISSING_SERVER_BASE
                } else {
                    null
                }
            }
            existingSnapshot.scopeKey != storeState.scopeKey -> ProgressRefreshReason.LOCAL_CONTEXT_CHANGED
            snapshot.serverBase == null -> ProgressRefreshReason.MISSING_SERVER_BASE
            else -> null
        }
        publishSnapshotIfChanged(snapshot = snapshot)
        val resolvedRefreshReason = refreshReason ?: return

        refreshFromStoreState(
            storeState = storeState,
            refreshReason = resolvedRefreshReason
        )
    }

    suspend fun refreshManually() {
        var storeState = currentStoreState() ?: return
        if (storeState.isLocalCacheReady.not()) {
            cacheReadinessCoordinator.ensureLocalCacheReady(timeZone = storeState.scopeKey.timeZone)
            storeState = currentStoreState() ?: return
            if (storeState.isLocalCacheReady.not()) {
                return
            }
        }

        publishSnapshotIfChanged(
            snapshot = requireNotNull(storeState.snapshot) {
                "Progress summary snapshot is required once the local progress cache is ready."
            }
        )
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        refreshFromStoreState(
            storeState = storeState,
            refreshReason = ProgressRefreshReason.MANUAL
        )
    }

    private suspend fun refreshFromStoreState(
        storeState: ProgressSummaryStoreState,
        refreshReason: ProgressRefreshReason
    ) {
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        val serializedScopeKey = serializeProgressSummaryScopeKey(scopeKey = storeState.scopeKey)
        var syncMode = createProgressRemoteRefreshSyncMode(refreshReason = refreshReason)
        if (
            refreshCoordinator.beginRefresh(
                scopeKey = serializedScopeKey,
                syncMode = syncMode
            ).not()
        ) {
            return
        }

        var refreshStoreState = storeState
        while (true) {
            try {
                performRefresh(
                    refreshStoreState = refreshStoreState,
                    initialStoreState = storeState,
                    syncMode = syncMode
                )
            } catch (error: Throwable) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            }

            val queuedSyncMode = refreshCoordinator.completeRefreshIteration(
                scopeKey = serializedScopeKey
            ) ?: return
            val latestStoreState = currentStoreState()
            if (latestStoreState == null) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (serializeProgressSummaryScopeKey(scopeKey = latestStoreState.scopeKey) != serializedScopeKey) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (supportsServerRefresh(cloudState = latestStoreState.cloudState).not()) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            refreshStoreState = latestStoreState
            syncMode = queuedSyncMode
        }
    }

    private suspend fun performRefresh(
        refreshStoreState: ProgressSummaryStoreState,
        initialStoreState: ProgressSummaryStoreState,
        syncMode: ProgressRemoteRefreshSyncMode
    ) {
        var resolvedRefreshStoreState = refreshStoreState
        if (resolvedRefreshStoreState.isLocalCacheReady.not()) {
            return
        }
        if (syncMode == ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD) {
            try {
                syncRepository.syncNow()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logProgressRepositoryWarning(
                    event = "progress_summary_sync_before_remote_load_failed",
                    fields = listOf(
                        "scopeKey" to serializeProgressSummaryScopeKey(
                            scopeKey = resolvedRefreshStoreState.scopeKey
                        ),
                        "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone
                    ),
                    error = error
                )
                return
            }
            resolvedRefreshStoreState = currentStoreState() ?: return
            if (resolvedRefreshStoreState.scopeKey != initialStoreState.scopeKey) {
                return
            }
            if (supportsServerRefresh(cloudState = resolvedRefreshStoreState.cloudState).not()) {
                return
            }
            if (resolvedRefreshStoreState.isLocalCacheReady.not()) {
                return
            }
        }

        val remoteSummary = try {
            cloudAccountRepository.loadProgressSummary(
                timeZone = resolvedRefreshStoreState.scopeKey.timeZone
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logProgressRepositoryWarning(
                event = "progress_summary_remote_load_failed",
                fields = listOf(
                    "scopeKey" to serializeProgressSummaryScopeKey(
                        scopeKey = resolvedRefreshStoreState.scopeKey
                    ),
                    "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone
                ),
                error = error
            )
            return
        }

        val latestStoreState = currentStoreState() ?: return
        if (latestStoreState.scopeKey != resolvedRefreshStoreState.scopeKey) {
            return
        }

        database.progressRemoteCacheDao().insertProgressSummaryCache(
            entry = remoteSummary.toCacheEntity(
                scopeKey = latestStoreState.scopeKey,
                updatedAtMillis = timeProvider.currentTimeMillis()
            )
        )
    }

    private fun publishSnapshotIfChanged(
        snapshot: ProgressSummarySnapshot?
    ) {
        if (snapshotMutable.value == snapshot) {
            return
        }

        snapshotMutable.value = snapshot
    }

    private fun currentStoreState(): ProgressSummaryStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createProgressSummaryStoreState(
            inputs = createStoreInputs(
                inputs = latestInputs,
                clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
            )
        )
    }

    private fun createStoreInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressSummaryStoreInputs {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = inputs.cloudSettings,
            today = clockSnapshot.today,
            zoneId = clockSnapshot.zoneId
        )
        val workspaceIds: List<String> = inputs.workspaces.map(WorkspaceEntity::workspaceId)
        val pendingReviewFingerprintEntries = createProgressPendingReviewFingerprintEntries(
            pendingReviewOutboxEntries = inputs.pendingReviewOutboxEntries,
            workspaceIds = workspaceIds
        )
        val isLocalCacheReady = isProgressLocalCacheReady(
            reviewHistoryStates = inputs.reviewHistoryStates,
            localCacheStates = inputs.localCacheStates,
            workspaceIds = workspaceIds,
            timeZone = scopeKey.timeZone
        )
        return ProgressSummaryStoreInputs(
            scopeKey = scopeKey,
            cloudState = inputs.cloudSettings.cloudState,
            workspaceIds = workspaceIds,
            localDayCounts = inputs.localDayCounts,
            isLocalCacheReady = isLocalCacheReady,
            serverBase = inputs.summaryCaches.firstOrNull { entry ->
                entry.scopeKey == serializeProgressSummaryScopeKey(scopeKey = scopeKey)
            }?.toCloudProgressSummaryOrNull(),
            reviewHistoryFingerprint = createReviewHistoryFingerprint(
                reviewHistoryStates = inputs.reviewHistoryStates,
                pendingReviewEntries = pendingReviewFingerprintEntries,
                syncStates = inputs.syncStates,
                workspaceIds = workspaceIds
            ),
            syncStatus = inputs.syncStatus,
            today = clockSnapshot.today
        )
    }
}
