package com.flashcardsopensourceapp.data.local.repository.progress.orchestration

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import com.flashcardsopensourceapp.data.local.repository.progress.cache.findProgressLeaderboardServerBase
import com.flashcardsopensourceapp.data.local.repository.progress.cache.serializeProgressLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCacheEntity
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressObservedInputs
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressObservationVersions
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressRefreshCoordinator
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressRemoteRefreshSyncMode
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.logProgressRefreshWarning
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressLeaderboardStoreInputs
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressLeaderboardStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createProgressLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createProgressLeaderboardStoreState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

// Compact community leaderboard pipeline. Unlike the other progress surfaces there is
// no local fallback: the server snapshot is the only source of ranks and anonymous
// names, the device only caches the last payload and overlays the viewer count.
internal class ProgressLeaderboardOrchestration(
    private val database: AppDatabase,
    private val cloudAccountRepository: CloudAccountRepository,
    private val timeProvider: TimeProvider,
    private val observability: AppObservability,
    private val observationVersions: ProgressObservationVersions
) {
    private val snapshotMutable = MutableStateFlow<ProgressLeaderboardSnapshot?>(null)
    private val latestInputsMutable = MutableStateFlow<ProgressObservedInputs?>(null)
    private val failedRemoteLoadScopeKeyMutable = MutableStateFlow<String?>(null)
    private val refreshCoordinator = ProgressRefreshCoordinator()

    fun observeSnapshot(): Flow<ProgressLeaderboardSnapshot?> {
        return snapshotMutable.asStateFlow()
    }

    fun handleInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressLeaderboardStoreState {
        latestInputsMutable.value = inputs
        val currentStoreState = createStoreState(
            inputs = inputs,
            clockSnapshot = clockSnapshot
        )
        publishSnapshotIfChanged(snapshot = currentStoreState.snapshot)
        return currentStoreState
    }

    suspend fun refreshIfInvalidated() {
        refreshFromCurrentStoreState()
    }

    suspend fun refreshManually() {
        refreshFromCurrentStoreState()
    }

    // The whole five-window payload arrives in one request and the server regenerates
    // snapshots hourly, so both refresh entry points respect nextRefreshAfter instead
    // of re-fetching per period or per pull-to-refresh.
    private suspend fun refreshFromCurrentStoreState() {
        val storeState = currentStoreState() ?: return
        publishSnapshotIfChanged(snapshot = storeState.snapshot)
        if (storeState.cloudState != CloudAccountState.LINKED) {
            return
        }
        if (storeState.snapshot.leaderboard != null && storeState.snapshot.isRefreshDue.not()) {
            return
        }

        val serializedScopeKey = serializeProgressLeaderboardScopeKey(scopeKey = storeState.scopeKey)
        if (
            refreshCoordinator.beginRefresh(
                scopeKey = serializedScopeKey,
                syncMode = ProgressRemoteRefreshSyncMode.SKIP_SYNC
            ).not()
        ) {
            return
        }

        var refreshStoreState = storeState
        while (true) {
            try {
                performRefresh(refreshStoreState = refreshStoreState)
            } catch (error: Throwable) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            }

            refreshCoordinator.completeRefreshIteration(scopeKey = serializedScopeKey) ?: return
            val latestStoreState = currentStoreState()
            if (latestStoreState == null) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (serializeProgressLeaderboardScopeKey(scopeKey = latestStoreState.scopeKey) != serializedScopeKey) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (latestStoreState.cloudState != CloudAccountState.LINKED) {
                refreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            refreshStoreState = latestStoreState
        }
    }

    private suspend fun performRefresh(
        refreshStoreState: ProgressLeaderboardStoreState
    ) {
        val serializedScopeKey = serializeProgressLeaderboardScopeKey(scopeKey = refreshStoreState.scopeKey)
        val remoteLeaderboard = try {
            cloudAccountRepository.loadProgressLeaderboard()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            failedRemoteLoadScopeKeyMutable.value = serializedScopeKey
            publishLatestSnapshot()
            if (shouldSuppressRemoteLoadWarning(refreshStoreState = refreshStoreState)) {
                return
            }
            logProgressRefreshWarning(
                observability = observability,
                observationVersions = observationVersions,
                event = "progress_leaderboard_remote_load_failed",
                scopeId = refreshStoreState.scopeKey.scopeId,
                source = "leaderboard_remote_load",
                fields = listOf("scopeKey" to serializedScopeKey),
                error = error
            )
            return
        }

        val latestStoreState = currentStoreState() ?: return
        if (latestStoreState.scopeKey != refreshStoreState.scopeKey) {
            return
        }

        database.progressRemoteCacheDao().insertProgressLeaderboardCache(
            entry = remoteLeaderboard.toCacheEntity(
                scopeKey = latestStoreState.scopeKey,
                updatedAtMillis = timeProvider.currentTimeMillis()
            )
        )
        if (failedRemoteLoadScopeKeyMutable.value == serializedScopeKey) {
            failedRemoteLoadScopeKeyMutable.value = null
        }
    }

    private fun shouldSuppressRemoteLoadWarning(
        refreshStoreState: ProgressLeaderboardStoreState
    ): Boolean {
        val latestStoreState = currentStoreState() ?: return true
        if (latestStoreState.scopeKey != refreshStoreState.scopeKey) {
            return true
        }

        return latestStoreState.cloudState != CloudAccountState.LINKED
    }

    private fun publishLatestSnapshot() {
        val storeState = currentStoreState() ?: return
        publishSnapshotIfChanged(snapshot = storeState.snapshot)
    }

    private fun publishSnapshotIfChanged(
        snapshot: ProgressLeaderboardSnapshot?
    ) {
        if (snapshotMutable.value == snapshot) {
            return
        }

        snapshotMutable.value = snapshot
    }

    private fun currentStoreState(): ProgressLeaderboardStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createStoreState(
            inputs = latestInputs,
            clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
        )
    }

    private fun createStoreState(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressLeaderboardStoreState {
        val scopeKey = createProgressLeaderboardScopeKey(cloudSettings = inputs.cloudSettings)
        return createProgressLeaderboardStoreState(
            inputs = ProgressLeaderboardStoreInputs(
                scopeKey = scopeKey,
                cloudState = inputs.cloudSettings.cloudState,
                workspaceIds = inputs.workspaces.map(WorkspaceEntity::workspaceId),
                serverBase = findProgressLeaderboardServerBase(
                    leaderboardCaches = inputs.leaderboardCaches,
                    scopeKey = scopeKey
                ),
                qualifiedReviewActivity = inputs.qualifiedReviewActivity,
                didLastRemoteLoadFail = failedRemoteLoadScopeKeyMutable.value ==
                    serializeProgressLeaderboardScopeKey(scopeKey = scopeKey),
                currentTimeMillis = clockSnapshot.currentTimeMillis
            )
        )
    }
}
