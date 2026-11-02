package com.flashcardsopensourceapp.data.local.repository.progress.orchestration

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.progress.ProgressCloudIdentityTransitionException
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import com.flashcardsopensourceapp.data.local.repository.progress.cache.ProgressLocalCacheReadinessCoordinator
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCacheEntity
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCloudProgressSeriesOrNull
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCloudProgressSummaryOrNull
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressObservedInputs
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressPendingReviewLocalDate
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressPendingReviewFingerprintEntries
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressPendingReviewLocalDate
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressPendingReviewLocalDates
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressBackgroundLauncher
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressObservationVersions
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressRefreshCoordinator
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressRefreshReason
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressRemoteRefreshSyncMode
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.createProgressRemoteRefreshSyncMode
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.logProgressRemoteLoadFailure
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.logProgressSyncBeforeRemoteLoadFailure
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.supportsServerRefresh
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressSummaryStoreInputs
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressSummaryStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createProgressSummaryStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createReviewHistoryFingerprint
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.didSyncCompleteWithReviewHistoryChange
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.isProgressLocalCacheReady
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.serializeProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.serializeProgressSummaryScopeKey
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

internal data class ProgressSummaryHandledInputs(
    val previousStoreState: ProgressSummaryStoreState?,
    val currentStoreState: ProgressSummaryStoreState
)

// A committed rating's local date, kept until the observed day counts cover it.
private data class ProgressSummaryRatingPatch(
    val scopeKey: ProgressSummaryScopeKey,
    val localDate: ProgressPendingReviewLocalDate
)

internal class ProgressSummaryOrchestration(
    private val database: AppDatabase,
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val timeProvider: TimeProvider,
    private val cacheReadinessCoordinator: ProgressLocalCacheReadinessCoordinator,
    private val backgroundLauncher: ProgressBackgroundLauncher,
    private val observability: AppObservability,
    private val observationVersions: ProgressObservationVersions
) {
    private val snapshotMutable = MutableStateFlow<ProgressSummarySnapshot?>(null)
    private val latestInputsMutable = MutableStateFlow<ProgressObservedInputs?>(null)
    private val latestStoreStateMutable = MutableStateFlow<ProgressSummaryStoreState?>(null)
    private val refreshCoordinator = ProgressRefreshCoordinator()
    // Guards ratingPatches and orders their updates with observed inputs. Every store state
    // built under it merges the patches, so an observed emission that still lacks a rating
    // (Room re-queries each table separately) cannot publish the badge without it.
    private val snapshotPublishLock = Any()
    private var ratingPatches: List<ProgressSummaryRatingPatch> = emptyList()

    fun observeSnapshot(): Flow<ProgressSummarySnapshot?> {
        return snapshotMutable.asStateFlow()
    }

    fun handleInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressSummaryHandledInputs {
        synchronized(snapshotPublishLock) {
            latestInputsMutable.value = inputs
            ratingPatches = retainUncoveredRatingPatches(
                inputs = inputs,
                clockSnapshot = clockSnapshot
            )
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
    }

    // Publishes the badge fields (streak, reviewed today) for a just-committed review and keeps
    // its local date as a patch until observed day counts cover it. The summary depends only on
    // which dates are active, so a date both patched and observed counts once.
    fun applyRating(
        reviewLog: ReviewLogEntity,
        clockSnapshot: ProgressClockSnapshot
    ) {
        synchronized(snapshotPublishLock) {
            val latestInputs = latestInputsMutable.value ?: return
            val scopeKey = createProgressSummaryScopeKey(
                cloudSettings = latestInputs.cloudSettings,
                today = clockSnapshot.today,
                zoneId = clockSnapshot.zoneId
            )
            ratingPatches = ratingPatches + ProgressSummaryRatingPatch(
                scopeKey = scopeKey,
                localDate = createProgressPendingReviewLocalDate(
                    reviewLog = reviewLog,
                    fallbackTimeZone = scopeKey.timeZone
                )
            )
            val storeInputs = createStoreInputs(
                inputs = latestInputs,
                clockSnapshot = clockSnapshot
            )
            if (storeInputs.isLocalCacheReady.not()) {
                return
            }
            publishSnapshotIfChanged(
                snapshot = createProgressSummaryStoreState(inputs = storeInputs).snapshot
            )
        }
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
                logProgressSyncBeforeRemoteLoadFailure(
                    observability = observability,
                    observationVersions = observationVersions,
                    event = "progress_summary_sync_before_remote_load_failed",
                    scopeId = resolvedRefreshStoreState.scopeKey.scopeId,
                    source = "summary_sync_before_remote_load",
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
            if (
                error is ProgressCloudIdentityTransitionException &&
                resolvedRefreshStoreState.cloudState == CloudAccountState.LINKED
            ) {
                return
            }
            logProgressRemoteLoadFailure(
                observability = observability,
                observationVersions = observationVersions,
                event = "progress_summary_remote_load_failed",
                scopeId = resolvedRefreshStoreState.scopeKey.scopeId,
                source = "summary_remote_load",
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
        synchronized(snapshotPublishLock) {
            val latestInputs = latestInputsMutable.value ?: return null
            return createProgressSummaryStoreState(
                inputs = createStoreInputs(
                    inputs = latestInputs,
                    clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
                )
            )
        }
    }

    // Call with snapshotPublishLock held. A patch is dropped once the day counts the rating's
    // transaction wrote are observed, or when the scope (account, time zone, today) changes.
    private fun retainUncoveredRatingPatches(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): List<ProgressSummaryRatingPatch> {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = inputs.cloudSettings,
            today = clockSnapshot.today,
            zoneId = clockSnapshot.zoneId
        )
        return ratingPatches.filter { patch ->
            patch.scopeKey == scopeKey && inputs.localDayCounts.none { dayCount ->
                dayCount.timeZone == scopeKey.timeZone &&
                    dayCount.workspaceId == patch.localDate.workspaceId &&
                    dayCount.localDate == patch.localDate.localDate &&
                    dayCount.reviewCount > 0
            }
        }
    }

    // Call with snapshotPublishLock held: it merges ratingPatches.
    private fun createStoreInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressSummaryStoreInputs {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = inputs.cloudSettings,
            today = clockSnapshot.today,
            zoneId = clockSnapshot.zoneId
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
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
            seriesScopeKey = seriesScopeKey,
            seriesServerBase = inputs.seriesCaches.firstOrNull { entry ->
                entry.scopeKey == serializeProgressSeriesScopeKey(scopeKey = seriesScopeKey)
            }?.toCloudProgressSeriesOrNull(),
            pendingReviewLocalDates = if (isLocalCacheReady) {
                createProgressPendingReviewLocalDates(
                    pendingReviewOutboxEntries = inputs.pendingReviewOutboxEntries,
                    workspaceIds = workspaceIds,
                    timeZone = scopeKey.timeZone
                ) + ratingPatches.filter { patch ->
                    patch.scopeKey == scopeKey
                }.map(ProgressSummaryRatingPatch::localDate)
            } else {
                emptyList()
            },
            // Outbox entries only, never ratingPatches: a patch must not look like a sync change.
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
