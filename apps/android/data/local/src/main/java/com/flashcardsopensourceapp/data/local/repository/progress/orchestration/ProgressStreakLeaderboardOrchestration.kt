package com.flashcardsopensourceapp.data.local.repository.progress.orchestration

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.ProgressStreakLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import com.flashcardsopensourceapp.data.local.repository.progress.cache.findProgressStreakLeaderboardServerBase
import com.flashcardsopensourceapp.data.local.repository.progress.cache.serializeProgressStreakLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCacheEntity
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressObservedInputs
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.createProgressClockSnapshot
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressObservationVersions
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressRefreshCoordinator
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.ProgressRemoteRefreshSyncMode
import com.flashcardsopensourceapp.data.local.repository.progress.runtime.logProgressRefreshWarning
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressStreakLeaderboardStoreInputs
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.ProgressStreakLeaderboardStoreState
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createProgressStreakLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.snapshots.createProgressStreakLeaderboardStoreState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

private data class ProgressStreakLeaderboardLatestInputs(
    val inputs: ProgressObservedInputs,
    val viewerCurrentStreakDays: Int?
)

internal class ProgressStreakLeaderboardOrchestration(
    private val database: AppDatabase,
    private val cloudAccountRepository: CloudAccountRepository,
    private val timeProvider: TimeProvider,
    private val observability: AppObservability,
    private val observationVersions: ProgressObservationVersions
) {
    private val snapshotMutable = MutableStateFlow<ProgressStreakLeaderboardSnapshot?>(null)
    private val latestInputsMutable = MutableStateFlow<ProgressStreakLeaderboardLatestInputs?>(null)
    private val failedRemoteLoadScopeKeyMutable = MutableStateFlow<String?>(null)
    private val refreshCoordinator = ProgressRefreshCoordinator()

    fun observeSnapshot(): Flow<ProgressStreakLeaderboardSnapshot?> {
        return snapshotMutable.asStateFlow()
    }

    fun handleInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot,
        viewerCurrentStreakDays: Int?
    ): ProgressStreakLeaderboardStoreState {
        latestInputsMutable.value = ProgressStreakLeaderboardLatestInputs(
            inputs = inputs,
            viewerCurrentStreakDays = viewerCurrentStreakDays
        )
        val currentStoreState = createStoreState(
            inputs = inputs,
            clockSnapshot = clockSnapshot,
            viewerCurrentStreakDays = viewerCurrentStreakDays
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

    private suspend fun refreshFromCurrentStoreState() {
        val storeState = currentStoreState() ?: return
        publishSnapshotIfChanged(snapshot = storeState.snapshot)
        if (storeState.cloudState != CloudAccountState.LINKED) {
            return
        }
        if (storeState.snapshot.leaderboard != null && storeState.snapshot.isRefreshDue.not()) {
            return
        }

        val serializedScopeKey = serializeProgressStreakLeaderboardScopeKey(scopeKey = storeState.scopeKey)
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
            if (serializeProgressStreakLeaderboardScopeKey(scopeKey = latestStoreState.scopeKey) != serializedScopeKey) {
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
        refreshStoreState: ProgressStreakLeaderboardStoreState
    ) {
        val serializedScopeKey = serializeProgressStreakLeaderboardScopeKey(scopeKey = refreshStoreState.scopeKey)
        val remoteLeaderboard = try {
            cloudAccountRepository.loadProgressStreakLeaderboard()
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
                event = "progress_streak_leaderboard_remote_load_failed",
                scopeId = refreshStoreState.scopeKey.scopeId,
                source = "streak_leaderboard_remote_load",
                fields = listOf("scopeKey" to serializedScopeKey),
                error = error
            )
            return
        }

        val latestStoreState = currentStoreState() ?: return
        if (latestStoreState.scopeKey != refreshStoreState.scopeKey) {
            return
        }

        database.progressRemoteCacheDao().insertProgressStreakLeaderboardCache(
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
        refreshStoreState: ProgressStreakLeaderboardStoreState
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
        snapshot: ProgressStreakLeaderboardSnapshot?
    ) {
        if (snapshotMutable.value == snapshot) {
            return
        }

        snapshotMutable.value = snapshot
    }

    private fun currentStoreState(): ProgressStreakLeaderboardStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createStoreState(
            inputs = latestInputs.inputs,
            clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider),
            viewerCurrentStreakDays = latestInputs.viewerCurrentStreakDays
        )
    }

    private fun createStoreState(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot,
        viewerCurrentStreakDays: Int?
    ): ProgressStreakLeaderboardStoreState {
        val scopeKey = createProgressStreakLeaderboardScopeKey(cloudSettings = inputs.cloudSettings)
        return createProgressStreakLeaderboardStoreState(
            inputs = ProgressStreakLeaderboardStoreInputs(
                scopeKey = scopeKey,
                cloudState = inputs.cloudSettings.cloudState,
                serverBase = findProgressStreakLeaderboardServerBase(
                    leaderboardCaches = inputs.streakLeaderboardCaches,
                    scopeKey = scopeKey
                ),
                viewerCurrentStreakDays = if (inputs.cloudSettings.cloudState == CloudAccountState.LINKED) {
                    viewerCurrentStreakDays
                } else {
                    null
                },
                didLastRemoteLoadFail = failedRemoteLoadScopeKeyMutable.value ==
                    serializeProgressStreakLeaderboardScopeKey(scopeKey = scopeKey),
                currentTimeMillis = clockSnapshot.currentTimeMillis
            )
        )
    }
}
