package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch

private enum class ProgressRefreshReason {
    MISSING_SERVER_BASE,
    LOCAL_CONTEXT_CHANGED,
    SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE,
    MANUAL
}

private data class ProgressObservedInputs(
    val cloudSettings: CloudSettings,
    val workspaces: List<WorkspaceEntity>,
    val localDayCounts: List<ProgressLocalDayCountEntity>,
    val reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    val localCacheStates: List<ProgressLocalCacheStateEntity>,
    val pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    val syncStates: List<SyncStateEntity>,
    val syncStatus: SyncStatusSnapshot,
    val summaryCaches: List<ProgressSummaryCacheEntity>,
    val seriesCaches: List<ProgressSeriesCacheEntity>
)

private data class ProgressObservedBaseInputs(
    val cloudSettings: CloudSettings,
    val workspaces: List<WorkspaceEntity>,
    val localDayCounts: List<ProgressLocalDayCountEntity>,
    val reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    val localCacheStates: List<ProgressLocalCacheStateEntity>,
    val pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    val syncStates: List<SyncStateEntity>,
    val syncStatus: SyncStatusSnapshot
)

private data class ProgressLocalCacheObservedInputs(
    val localDayCounts: List<ProgressLocalDayCountEntity>,
    val reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    val localCacheStates: List<ProgressLocalCacheStateEntity>
)

private data class ProgressPrimaryObservedInputs(
    val cloudSettings: CloudSettings,
    val workspaces: List<WorkspaceEntity>,
    val localCacheInputs: ProgressLocalCacheObservedInputs
)

private data class ProgressSyncObservedInputs(
    val pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    val syncStates: List<SyncStateEntity>,
    val syncStatus: SyncStatusSnapshot
)

private data class ProgressObservedSummaryInputs(
    val baseInputs: ProgressObservedBaseInputs,
    val summaryCaches: List<ProgressSummaryCacheEntity>
)

class LocalProgressRepository(
    private val appScope: CoroutineScope,
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val localProgressCacheStore: LocalProgressCacheStore,
    private val timeProvider: ProgressTimeProvider
) : ProgressRepository {
    private val summarySnapshotMutable = MutableStateFlow<ProgressSummarySnapshot?>(null)
    private val seriesSnapshotMutable = MutableStateFlow<ProgressSeriesSnapshot?>(null)
    private val latestInputsMutable = MutableStateFlow<ProgressObservedInputs?>(null)
    private val latestSummaryStoreStateMutable = MutableStateFlow<ProgressSummaryStoreState?>(null)
    private val latestSeriesStoreStateMutable = MutableStateFlow<ProgressSeriesStoreState?>(null)
    private val summaryRefreshCoordinator = ProgressRefreshCoordinator()
    private val seriesRefreshCoordinator = ProgressRefreshCoordinator()
    private val localCacheRebuildCoordinator = ProgressLocalCacheRebuildCoordinator()

    init {
        appScope.launch {
            observeProgressInputs().collect { inputs ->
                handleProgressInputs(inputs = inputs)
            }
        }
    }

    override fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?> {
        return summarySnapshotMutable.asStateFlow()
    }

    override fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?> {
        return seriesSnapshotMutable.asStateFlow()
    }

    override suspend fun refreshSummaryIfInvalidated() {
        var storeState = currentSummaryStoreState() ?: return
        if (storeState.isLocalCacheReady.not()) {
            ensureLocalCacheReady(timeZone = storeState.scopeKey.timeZone)
            storeState = currentSummaryStoreState() ?: return
            if (storeState.isLocalCacheReady.not()) {
                return
            }
        }

        val snapshot = requireNotNull(storeState.snapshot) {
            "Progress summary snapshot is required once the local progress cache is ready."
        }
        val existingSnapshot = summarySnapshotMutable.value
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
        publishSummarySnapshotIfChanged(snapshot = snapshot)
        val resolvedRefreshReason = refreshReason ?: return

        refreshSummaryFromStoreState(
            storeState = storeState,
            refreshReason = resolvedRefreshReason
        )
    }

    override suspend fun refreshSeriesIfInvalidated() {
        var storeState = currentSeriesStoreState() ?: return
        if (storeState.isLocalCacheReady.not()) {
            ensureLocalCacheReady(timeZone = storeState.scopeKey.timeZone)
            storeState = currentSeriesStoreState() ?: return
            if (storeState.isLocalCacheReady.not()) {
                return
            }
        }

        val snapshot = requireNotNull(storeState.snapshot) {
            "Progress series snapshot is required once the local progress cache is ready."
        }
        val existingSnapshot = seriesSnapshotMutable.value
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
        publishSeriesSnapshotIfChanged(snapshot = snapshot)
        val resolvedRefreshReason = refreshReason ?: return

        refreshSeriesFromStoreState(
            storeState = storeState,
            refreshReason = resolvedRefreshReason
        )
    }

    override suspend fun refreshSummaryManually() {
        var storeState = currentSummaryStoreState() ?: return
        if (storeState.isLocalCacheReady.not()) {
            ensureLocalCacheReady(timeZone = storeState.scopeKey.timeZone)
            storeState = currentSummaryStoreState() ?: return
            if (storeState.isLocalCacheReady.not()) {
                return
            }
        }

        publishSummarySnapshotIfChanged(
            snapshot = requireNotNull(storeState.snapshot) {
                "Progress summary snapshot is required once the local progress cache is ready."
            }
        )
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        refreshSummaryFromStoreState(
            storeState = storeState,
            refreshReason = ProgressRefreshReason.MANUAL
        )
    }

    override suspend fun refreshSeriesManually() {
        var storeState = currentSeriesStoreState() ?: return
        if (storeState.isLocalCacheReady.not()) {
            ensureLocalCacheReady(timeZone = storeState.scopeKey.timeZone)
            storeState = currentSeriesStoreState() ?: return
            if (storeState.isLocalCacheReady.not()) {
                return
            }
        }

        publishSeriesSnapshotIfChanged(
            snapshot = requireNotNull(storeState.snapshot) {
                "Progress series snapshot is required once the local progress cache is ready."
            }
        )
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        refreshSeriesFromStoreState(
            storeState = storeState,
            refreshReason = ProgressRefreshReason.MANUAL
        )
    }

    private fun observeProgressInputs(): Flow<ProgressObservedInputs> {
        val localCacheDao = database.progressLocalCacheDao()
        val remoteCacheDao = database.progressRemoteCacheDao()
        val localCacheInputsFlow = combine(
            localCacheDao.observeProgressLocalDayCounts(),
            localCacheDao.observeProgressReviewHistoryStates(),
            localCacheDao.observeProgressLocalCacheStates()
        ) { localDayCounts, reviewHistoryStates, localCacheStates ->
            ProgressLocalCacheObservedInputs(
                localDayCounts = localDayCounts,
                reviewHistoryStates = reviewHistoryStates,
                localCacheStates = localCacheStates
            )
        }
        val primaryInputsFlow = combine(
            preferencesStore.observeCloudSettings(),
            database.workspaceDao().observeWorkspaces(),
            localCacheInputsFlow
        ) { cloudSettings, workspaces, localCacheInputs ->
            ProgressPrimaryObservedInputs(
                cloudSettings = cloudSettings,
                workspaces = workspaces,
                localCacheInputs = localCacheInputs
            )
        }
        val syncInputsFlow = combine(
            database.outboxDao().observePendingReviewEventOutboxEntries(),
            database.syncStateDao().observeSyncStates(),
            syncRepository.observeSyncStatus()
        ) { pendingReviewOutboxEntries, syncStates, syncStatus ->
            ProgressSyncObservedInputs(
                pendingReviewOutboxEntries = pendingReviewOutboxEntries,
                syncStates = syncStates,
                syncStatus = syncStatus
            )
        }
        val baseInputsFlow = combine(
            primaryInputsFlow,
            syncInputsFlow
        ) { primaryInputs, syncInputs ->
            ProgressObservedBaseInputs(
                cloudSettings = primaryInputs.cloudSettings,
                workspaces = primaryInputs.workspaces,
                localDayCounts = primaryInputs.localCacheInputs.localDayCounts,
                reviewHistoryStates = primaryInputs.localCacheInputs.reviewHistoryStates,
                localCacheStates = primaryInputs.localCacheInputs.localCacheStates,
                pendingReviewOutboxEntries = syncInputs.pendingReviewOutboxEntries,
                syncStates = syncInputs.syncStates,
                syncStatus = syncInputs.syncStatus
            )
        }
        val summaryInputsFlow = baseInputsFlow.combine(
            remoteCacheDao.observeProgressSummaryCaches()
        ) { baseInputs, summaryCaches ->
            ProgressObservedSummaryInputs(
                baseInputs = baseInputs,
                summaryCaches = summaryCaches
            )
        }

        return summaryInputsFlow.combine(
            remoteCacheDao.observeProgressSeriesCaches()
        ) { summaryInputs, seriesCaches ->
            ProgressObservedInputs(
                cloudSettings = summaryInputs.baseInputs.cloudSettings,
                workspaces = summaryInputs.baseInputs.workspaces,
                localDayCounts = summaryInputs.baseInputs.localDayCounts,
                reviewHistoryStates = summaryInputs.baseInputs.reviewHistoryStates,
                localCacheStates = summaryInputs.baseInputs.localCacheStates,
                pendingReviewOutboxEntries = summaryInputs.baseInputs.pendingReviewOutboxEntries,
                syncStates = summaryInputs.baseInputs.syncStates,
                syncStatus = summaryInputs.baseInputs.syncStatus,
                summaryCaches = summaryInputs.summaryCaches,
                seriesCaches = seriesCaches
            )
        }
    }

    private fun handleProgressInputs(inputs: ProgressObservedInputs) {
        latestInputsMutable.value = inputs

        val clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
        val previousSummaryStoreState = latestSummaryStoreStateMutable.value
        val currentSummaryStoreState = createProgressSummaryStoreState(
            inputs = createProgressSummaryStoreInputs(
                inputs = inputs,
                clockSnapshot = clockSnapshot
            )
        )
        latestSummaryStoreStateMutable.value = currentSummaryStoreState
        publishSummarySnapshotIfChanged(snapshot = currentSummaryStoreState.snapshot)

        val previousSeriesStoreState = latestSeriesStoreStateMutable.value
        val currentSeriesStoreState = createProgressSeriesStoreState(
            inputs = createProgressSeriesStoreInputs(
                inputs = inputs,
                clockSnapshot = clockSnapshot
            )
        )
        latestSeriesStoreStateMutable.value = currentSeriesStoreState
        publishSeriesSnapshotIfChanged(snapshot = currentSeriesStoreState.snapshot)

        if (currentSummaryStoreState.isLocalCacheReady.not() || currentSeriesStoreState.isLocalCacheReady.not()) {
            appScope.launch {
                ensureLocalCacheReady(timeZone = currentSummaryStoreState.scopeKey.timeZone)
            }
        }

        if (
            didSyncCompleteWithReviewHistoryChange(
                previousSuccessfulSyncAtMillis = previousSummaryStoreState?.syncStatus?.lastSuccessfulSyncAtMillis,
                currentSuccessfulSyncAtMillis = currentSummaryStoreState.syncStatus.lastSuccessfulSyncAtMillis,
                previousReviewHistoryFingerprint = previousSummaryStoreState?.reviewHistoryFingerprint,
                currentReviewHistoryFingerprint = currentSummaryStoreState.reviewHistoryFingerprint
            )
        ) {
            appScope.launch {
                refreshSummaryFromStoreState(
                    storeState = currentSummaryStoreState,
                    refreshReason = ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE
                )
            }
        }

        if (
            didSyncCompleteWithReviewHistoryChange(
                previousSuccessfulSyncAtMillis = previousSeriesStoreState?.syncStatus?.lastSuccessfulSyncAtMillis,
                currentSuccessfulSyncAtMillis = currentSeriesStoreState.syncStatus.lastSuccessfulSyncAtMillis,
                previousReviewHistoryFingerprint = previousSeriesStoreState?.reviewHistoryFingerprint,
                currentReviewHistoryFingerprint = currentSeriesStoreState.reviewHistoryFingerprint
            )
        ) {
            appScope.launch {
                refreshSeriesFromStoreState(
                    storeState = currentSeriesStoreState,
                    refreshReason = ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE
                )
            }
        }
    }

    private suspend fun refreshSummaryFromStoreState(
        storeState: ProgressSummaryStoreState,
        refreshReason: ProgressRefreshReason
    ) {
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        val serializedScopeKey = serializeProgressSummaryScopeKey(scopeKey = storeState.scopeKey)
        var syncMode = createProgressRemoteRefreshSyncMode(refreshReason = refreshReason)
        if (
            summaryRefreshCoordinator.beginRefresh(
                scopeKey = serializedScopeKey,
                syncMode = syncMode
            ).not()
        ) {
            return
        }

        var refreshStoreState = storeState
        while (true) {
            try {
                performSummaryRefresh(
                    refreshStoreState = refreshStoreState,
                    initialStoreState = storeState,
                    syncMode = syncMode
                )
            } catch (error: CancellationException) {
                summaryRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            } catch (error: Exception) {
                summaryRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            }

            val queuedSyncMode = summaryRefreshCoordinator.completeRefreshIteration(
                scopeKey = serializedScopeKey
            ) ?: return
            val latestStoreState = currentSummaryStoreState()
            if (latestStoreState == null) {
                summaryRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (serializeProgressSummaryScopeKey(scopeKey = latestStoreState.scopeKey) != serializedScopeKey) {
                summaryRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (supportsServerRefresh(cloudState = latestStoreState.cloudState).not()) {
                summaryRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            refreshStoreState = latestStoreState
            syncMode = queuedSyncMode
        }
    }

    private suspend fun refreshSeriesFromStoreState(
        storeState: ProgressSeriesStoreState,
        refreshReason: ProgressRefreshReason
    ) {
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        val serializedScopeKey = serializeProgressSeriesScopeKey(scopeKey = storeState.scopeKey)
        var syncMode = createProgressRemoteRefreshSyncMode(refreshReason = refreshReason)
        if (
            seriesRefreshCoordinator.beginRefresh(
                scopeKey = serializedScopeKey,
                syncMode = syncMode
            ).not()
        ) {
            return
        }

        var refreshStoreState = storeState
        while (true) {
            try {
                performSeriesRefresh(
                    refreshStoreState = refreshStoreState,
                    initialStoreState = storeState,
                    syncMode = syncMode
                )
            } catch (error: CancellationException) {
                seriesRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            } catch (error: Exception) {
                seriesRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            }

            val queuedSyncMode = seriesRefreshCoordinator.completeRefreshIteration(
                scopeKey = serializedScopeKey
            ) ?: return
            val latestStoreState = currentSeriesStoreState()
            if (latestStoreState == null) {
                seriesRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (serializeProgressSeriesScopeKey(scopeKey = latestStoreState.scopeKey) != serializedScopeKey) {
                seriesRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (supportsServerRefresh(cloudState = latestStoreState.cloudState).not()) {
                seriesRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            refreshStoreState = latestStoreState
            syncMode = queuedSyncMode
        }
    }

    private suspend fun performSummaryRefresh(
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
                        "scopeKey" to serializeProgressSummaryScopeKey(scopeKey = resolvedRefreshStoreState.scopeKey),
                        "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone
                    ),
                    error = error
                )
                return
            }
            resolvedRefreshStoreState = currentSummaryStoreState() ?: return
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
                    "scopeKey" to serializeProgressSummaryScopeKey(scopeKey = resolvedRefreshStoreState.scopeKey),
                    "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone
                ),
                error = error
            )
            return
        }

        val latestStoreState = currentSummaryStoreState() ?: return
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

    private suspend fun performSeriesRefresh(
        refreshStoreState: ProgressSeriesStoreState,
        initialStoreState: ProgressSeriesStoreState,
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
                    event = "progress_series_sync_before_remote_load_failed",
                    fields = listOf(
                        "scopeKey" to serializeProgressSeriesScopeKey(scopeKey = resolvedRefreshStoreState.scopeKey),
                        "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone,
                        "from" to resolvedRefreshStoreState.scopeKey.from,
                        "to" to resolvedRefreshStoreState.scopeKey.to
                    ),
                    error = error
                )
                return
            }
            resolvedRefreshStoreState = currentSeriesStoreState() ?: return
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

        val remoteSeries = try {
            cloudAccountRepository.loadProgressSeries(
                timeZone = resolvedRefreshStoreState.scopeKey.timeZone,
                from = resolvedRefreshStoreState.scopeKey.from,
                to = resolvedRefreshStoreState.scopeKey.to
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logProgressRepositoryWarning(
                event = "progress_series_remote_load_failed",
                fields = listOf(
                    "scopeKey" to serializeProgressSeriesScopeKey(scopeKey = resolvedRefreshStoreState.scopeKey),
                    "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone,
                    "from" to resolvedRefreshStoreState.scopeKey.from,
                    "to" to resolvedRefreshStoreState.scopeKey.to
                ),
                error = error
            )
            return
        }

        val latestStoreState = currentSeriesStoreState() ?: return
        if (latestStoreState.scopeKey != resolvedRefreshStoreState.scopeKey) {
            return
        }

        database.progressRemoteCacheDao().insertProgressSeriesCache(
            entry = remoteSeries.toCacheEntity(
                scopeKey = latestStoreState.scopeKey,
                updatedAtMillis = timeProvider.currentTimeMillis()
            )
        )
    }

    private suspend fun ensureLocalCacheReady(timeZone: String) {
        if (localCacheRebuildCoordinator.beginRebuild(timeZone = timeZone).not()) {
            return
        }

        try {
            localProgressCacheStore.rebuildTimeZoneCache(
                timeZone = timeZone,
                updatedAtMillis = timeProvider.currentTimeMillis()
            )
        } finally {
            localCacheRebuildCoordinator.endRebuild(timeZone = timeZone)
        }
    }

    private fun publishSummarySnapshotIfChanged(
        snapshot: ProgressSummarySnapshot?
    ) {
        if (summarySnapshotMutable.value == snapshot) {
            return
        }

        summarySnapshotMutable.value = snapshot
    }

    private fun publishSeriesSnapshotIfChanged(
        snapshot: ProgressSeriesSnapshot?
    ) {
        if (seriesSnapshotMutable.value == snapshot) {
            return
        }

        seriesSnapshotMutable.value = snapshot
    }

    private fun currentSummaryStoreState(): ProgressSummaryStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createProgressSummaryStoreState(
            inputs = createProgressSummaryStoreInputs(
                inputs = latestInputs,
                clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
            )
        )
    }

    private fun currentSeriesStoreState(): ProgressSeriesStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createProgressSeriesStoreState(
            inputs = createProgressSeriesStoreInputs(
                inputs = latestInputs,
                clockSnapshot = createProgressClockSnapshot(timeProvider = timeProvider)
            )
        )
    }

    private fun createProgressSummaryStoreInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressSummaryStoreInputs {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = inputs.cloudSettings,
            today = clockSnapshot.today,
            zoneId = clockSnapshot.zoneId
        )
        val workspaceIds = inputs.workspaces.map(WorkspaceEntity::workspaceId)
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

    private fun createProgressSeriesStoreInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressSeriesStoreInputs {
        val scopeKey = createProgressSeriesScopeKey(
            cloudSettings = inputs.cloudSettings,
            today = clockSnapshot.today,
            zoneId = clockSnapshot.zoneId
        )
        val workspaceIds = inputs.workspaces.map(WorkspaceEntity::workspaceId)
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
        return ProgressSeriesStoreInputs(
            scopeKey = scopeKey,
            cloudState = inputs.cloudSettings.cloudState,
            workspaceIds = workspaceIds,
            localDayCounts = inputs.localDayCounts,
            isLocalCacheReady = isLocalCacheReady,
            serverBase = inputs.seriesCaches.firstOrNull { entry ->
                entry.scopeKey == serializeProgressSeriesScopeKey(scopeKey = scopeKey)
            }?.toCloudProgressSeriesOrNull(),
            pendingReviewLocalDates = if (isLocalCacheReady) {
                createProgressPendingReviewLocalDates(
                    pendingReviewOutboxEntries = inputs.pendingReviewOutboxEntries,
                    workspaceIds = workspaceIds,
                    timeZone = scopeKey.timeZone
                )
            } else {
                emptyList()
            },
            reviewHistoryFingerprint = createReviewHistoryFingerprint(
                reviewHistoryStates = inputs.reviewHistoryStates,
                pendingReviewEntries = pendingReviewFingerprintEntries,
                syncStates = inputs.syncStates,
                workspaceIds = workspaceIds
            ),
            syncStatus = inputs.syncStatus
        )
    }
}

private fun supportsServerRefresh(
    cloudState: CloudAccountState
): Boolean {
    return cloudState == CloudAccountState.GUEST || cloudState == CloudAccountState.LINKED
}

private fun createProgressRemoteRefreshSyncMode(
    refreshReason: ProgressRefreshReason
): ProgressRemoteRefreshSyncMode {
    return if (refreshReason == ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE) {
        ProgressRemoteRefreshSyncMode.SKIP_SYNC
    } else {
        ProgressRemoteRefreshSyncMode.SYNC_BEFORE_REMOTE_LOAD
    }
}
