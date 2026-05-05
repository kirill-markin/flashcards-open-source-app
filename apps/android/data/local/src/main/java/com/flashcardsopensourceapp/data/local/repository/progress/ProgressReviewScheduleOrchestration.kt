package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.TimeProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class ProgressReviewScheduleHandledInputs(
    val previousStoreState: ProgressReviewScheduleStoreState?,
    val currentStoreState: ProgressReviewScheduleStoreState,
    val shouldRefreshAfterSync: Boolean
)

internal class ProgressReviewScheduleOrchestration(
    private val database: AppDatabase,
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val timeProvider: TimeProvider,
    private val backgroundLauncher: ProgressBackgroundLauncher
) {
    private val snapshotMutable = MutableStateFlow<ProgressReviewScheduleSnapshot?>(null)
    private val latestInputsMutable = MutableStateFlow<ProgressObservedInputs?>(null)
    private val latestStoreStateMutable = MutableStateFlow<ProgressReviewScheduleStoreState?>(null)
    private val refreshCoordinator = ProgressRefreshCoordinator()
    private var syncRefreshTrackerState: ProgressReviewScheduleSyncRefreshTrackerState? = null

    fun observeSnapshot(): Flow<ProgressReviewScheduleSnapshot?> {
        return snapshotMutable.asStateFlow()
    }

    fun handleInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressReviewScheduleHandledInputs {
        latestInputsMutable.value = inputs
        val previousStoreState = latestStoreStateMutable.value
        val currentStoreState = createProgressReviewScheduleStoreState(
            inputs = createStoreInputs(
                inputs = inputs,
                clockSnapshot = clockSnapshot
            )
        )
        latestStoreStateMutable.value = currentStoreState
        publishSnapshotIfChanged(snapshot = currentStoreState.snapshot)
        val syncRefreshTrackerResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = syncRefreshTrackerState,
            serializedScopeKey = serializeProgressReviewScheduleScopeKey(
                scopeKey = currentStoreState.scopeKey
            ),
            reviewScheduleFingerprint = currentStoreState.reviewScheduleFingerprint,
            hasPendingScheduleImpactingCardChanges =
                currentStoreState.hasPendingScheduleImpactingCardChanges,
            currentSuccessfulSyncAtMillis = currentStoreState.syncStatus.lastSuccessfulSyncAtMillis
        )
        syncRefreshTrackerState = syncRefreshTrackerResult.state

        return ProgressReviewScheduleHandledInputs(
            previousStoreState = previousStoreState,
            currentStoreState = currentStoreState,
            shouldRefreshAfterSync = syncRefreshTrackerResult.shouldRefresh
        )
    }

    fun launchSyncCompletedRefreshIfNeeded(
        handledInputs: ProgressReviewScheduleHandledInputs
    ) {
        val currentStoreState = handledInputs.currentStoreState
        val didSyncCompleteWithScheduleChange = didSyncCompleteWithReviewScheduleChange(
            previousSuccessfulSyncAtMillis =
                handledInputs.previousStoreState?.syncStatus?.lastSuccessfulSyncAtMillis,
            currentSuccessfulSyncAtMillis = currentStoreState.syncStatus.lastSuccessfulSyncAtMillis,
            previousReviewScheduleFingerprint = handledInputs.previousStoreState?.reviewScheduleFingerprint,
            currentReviewScheduleFingerprint = currentStoreState.reviewScheduleFingerprint
        )
        if (didSyncCompleteWithScheduleChange.not() && handledInputs.shouldRefreshAfterSync.not()) {
            return
        }

        backgroundLauncher.launchAndLogFailure(
            event = "progress_review_schedule_background_refresh_failed",
            fields = listOf(
                "scopeKey" to serializeProgressReviewScheduleScopeKey(scopeKey = currentStoreState.scopeKey)
            )
        ) {
            refreshFromStoreState(
                storeState = currentStoreState,
                refreshReason = ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE
            )
        }
    }

    suspend fun refreshIfInvalidated() {
        val storeState = currentStoreState() ?: return
        val snapshot = storeState.snapshot
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
        val storeState = currentStoreState() ?: return
        publishSnapshotIfChanged(snapshot = storeState.snapshot)
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        refreshFromStoreState(
            storeState = storeState,
            refreshReason = ProgressRefreshReason.MANUAL
        )
    }

    private suspend fun refreshFromStoreState(
        storeState: ProgressReviewScheduleStoreState,
        refreshReason: ProgressRefreshReason
    ) {
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        val serializedScopeKey = serializeProgressReviewScheduleScopeKey(scopeKey = storeState.scopeKey)
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
            if (serializeProgressReviewScheduleScopeKey(scopeKey = latestStoreState.scopeKey) != serializedScopeKey) {
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
        refreshStoreState: ProgressReviewScheduleStoreState,
        initialStoreState: ProgressReviewScheduleStoreState,
        syncMode: ProgressRemoteRefreshSyncMode
    ) {
        var resolvedRefreshStoreState = refreshStoreState
        if (syncMode == ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD) {
            try {
                syncRepository.syncNow()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logProgressRepositoryWarning(
                    event = "progress_review_schedule_sync_before_remote_load_failed",
                    fields = listOf(
                        "scopeKey" to serializeProgressReviewScheduleScopeKey(
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
        }

        val remoteSchedule = try {
            cloudAccountRepository.loadProgressReviewSchedule(
                timeZone = resolvedRefreshStoreState.scopeKey.timeZone
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logProgressRepositoryWarning(
                event = "progress_review_schedule_remote_load_failed",
                fields = listOf(
                    "scopeKey" to serializeProgressReviewScheduleScopeKey(
                        scopeKey = resolvedRefreshStoreState.scopeKey
                    ),
                    "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone
                ),
                error = error
            )
            return
        }
        try {
            validateProgressReviewScheduleResponseTimeZone(
                schedule = remoteSchedule,
                scopeKey = resolvedRefreshStoreState.scopeKey
            )
            validateProgressReviewScheduleBuckets(
                buckets = remoteSchedule.buckets,
                totalCards = remoteSchedule.totalCards
            )
        } catch (error: IllegalArgumentException) {
            logProgressRepositoryWarning(
                event = "progress_review_schedule_remote_response_invalid",
                fields = listOf(
                    "scopeKey" to serializeProgressReviewScheduleScopeKey(
                        scopeKey = resolvedRefreshStoreState.scopeKey
                    ),
                    "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone,
                    "responseTimeZone" to remoteSchedule.timeZone
                ),
                error = error
            )
            return
        }

        val latestStoreState = currentStoreState() ?: return
        if (latestStoreState.scopeKey != resolvedRefreshStoreState.scopeKey) {
            return
        }

        database.progressRemoteCacheDao().insertProgressReviewScheduleCache(
            entry = remoteSchedule.toCacheEntity(
                scopeKey = latestStoreState.scopeKey,
                updatedAtMillis = timeProvider.currentTimeMillis()
            )
        )
    }

    private fun publishSnapshotIfChanged(
        snapshot: ProgressReviewScheduleSnapshot?
    ) {
        if (snapshotMutable.value == snapshot) {
            return
        }

        snapshotMutable.value = snapshot
    }

    private fun currentStoreState(): ProgressReviewScheduleStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createProgressReviewScheduleStoreState(
            inputs = createStoreInputs(
                inputs = latestInputs,
                clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
            )
        )
    }

    private fun createStoreInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressReviewScheduleStoreInputs {
        val workspaceIds: List<String> = inputs.workspaces.map(WorkspaceEntity::workspaceId)
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = inputs.cloudSettings,
            today = clockSnapshot.today,
            zoneId = clockSnapshot.zoneId,
            workspaceIds = workspaceIds
        )
        val hasPendingScheduleImpactingCardChanges = hasPendingProgressReviewScheduleCardChanges(
            pendingCardUpsertOutboxEntries = inputs.pendingCardUpsertOutboxEntries,
            workspaceIds = workspaceIds
        )
        return ProgressReviewScheduleStoreInputs(
            scopeKey = scopeKey,
            cloudState = inputs.cloudSettings.cloudState,
            workspaceIds = workspaceIds,
            reviewScheduleCards = inputs.reviewScheduleCards,
            serverBase = findProgressReviewScheduleServerBase(
                reviewScheduleCaches = inputs.reviewScheduleCaches,
                scopeKey = scopeKey
            ),
            hasPendingScheduleImpactingCardChanges = hasPendingScheduleImpactingCardChanges,
            pendingCardUpsertOutboxEntries = inputs.pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = isProgressReviewScheduleLocalScopeHydrated(
                syncStates = inputs.syncStates,
                workspaceIds = workspaceIds
            ),
            reviewScheduleFingerprint = createReviewScheduleFingerprint(
                reviewScheduleCards = inputs.reviewScheduleCards,
                pendingCardUpsertOutboxEntries = inputs.pendingCardUpsertOutboxEntries,
                workspaceIds = workspaceIds
            ),
            syncStatus = inputs.syncStatus,
            today = clockSnapshot.today,
            zoneId = clockSnapshot.zoneId
        )
    }
}
