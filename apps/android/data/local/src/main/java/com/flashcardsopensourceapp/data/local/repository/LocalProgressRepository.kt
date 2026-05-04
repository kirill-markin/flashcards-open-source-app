package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
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
    val reviewScheduleCards: List<ProgressReviewScheduleCardDueEntity>,
    val pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    val pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    val syncStates: List<SyncStateEntity>,
    val syncStatus: SyncStatusSnapshot,
    val summaryCaches: List<ProgressSummaryCacheEntity>,
    val seriesCaches: List<ProgressSeriesCacheEntity>,
    val reviewScheduleCaches: List<ProgressReviewScheduleCacheEntity>
)

private data class ProgressObservedBaseInputs(
    val cloudSettings: CloudSettings,
    val workspaces: List<WorkspaceEntity>,
    val localDayCounts: List<ProgressLocalDayCountEntity>,
    val reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    val localCacheStates: List<ProgressLocalCacheStateEntity>,
    val reviewScheduleCards: List<ProgressReviewScheduleCardDueEntity>,
    val pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    val pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
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
    val localCacheInputs: ProgressLocalCacheObservedInputs,
    val reviewScheduleCards: List<ProgressReviewScheduleCardDueEntity>
)

private data class ProgressSyncObservedInputs(
    val pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    val pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    val syncStates: List<SyncStateEntity>,
    val syncStatus: SyncStatusSnapshot
)

private data class ProgressObservedSummaryInputs(
    val baseInputs: ProgressObservedBaseInputs,
    val summaryCaches: List<ProgressSummaryCacheEntity>
)

private data class ProgressObservedSeriesInputs(
    val summaryInputs: ProgressObservedSummaryInputs,
    val seriesCaches: List<ProgressSeriesCacheEntity>
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
    private val reviewScheduleSnapshotMutable = MutableStateFlow<ProgressReviewScheduleSnapshot?>(null)
    private val latestInputsMutable = MutableStateFlow<ProgressObservedInputs?>(null)
    private val latestSummaryStoreStateMutable = MutableStateFlow<ProgressSummaryStoreState?>(null)
    private val latestSeriesStoreStateMutable = MutableStateFlow<ProgressSeriesStoreState?>(null)
    private val latestReviewScheduleStoreStateMutable = MutableStateFlow<ProgressReviewScheduleStoreState?>(null)
    private val summaryRefreshCoordinator = ProgressRefreshCoordinator()
    private val seriesRefreshCoordinator = ProgressRefreshCoordinator()
    private val reviewScheduleRefreshCoordinator = ProgressRefreshCoordinator()
    private val localCacheRebuildCoordinator = ProgressLocalCacheRebuildCoordinator()
    private var reviewScheduleSyncRefreshTrackerState: ProgressReviewScheduleSyncRefreshTrackerState? = null

    // Captured handle for the input-observation flow so the lifecycle of this
    // long-running collector is explicit rather than hidden inside an init block.
    // Cancellation flows through appJob today; the handle is here so the collector
    // is no longer anonymous and can be disposed independently in the future.
    private val observeInputsJob: Job = launchAndLogFailure(
        event = "progress_inputs_collect_failed",
        fields = emptyList()
    ) {
        observeProgressInputs().collect { inputs ->
            handleProgressInputs(inputs = inputs)
        }
    }

    override fun observeSummarySnapshot(): Flow<ProgressSummarySnapshot?> {
        return summarySnapshotMutable.asStateFlow()
    }

    override fun observeSeriesSnapshot(): Flow<ProgressSeriesSnapshot?> {
        return seriesSnapshotMutable.asStateFlow()
    }

    override fun observeReviewScheduleSnapshot(): Flow<ProgressReviewScheduleSnapshot?> {
        return reviewScheduleSnapshotMutable.asStateFlow()
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

    override suspend fun refreshReviewScheduleIfInvalidated() {
        val storeState = currentReviewScheduleStoreState() ?: return
        val snapshot = storeState.snapshot
        val existingSnapshot = reviewScheduleSnapshotMutable.value
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
        publishReviewScheduleSnapshotIfChanged(snapshot = snapshot)
        val resolvedRefreshReason = refreshReason ?: return

        refreshReviewScheduleFromStoreState(
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

    override suspend fun refreshReviewScheduleManually() {
        val storeState = currentReviewScheduleStoreState() ?: return
        publishReviewScheduleSnapshotIfChanged(snapshot = storeState.snapshot)
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        refreshReviewScheduleFromStoreState(
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
            localCacheInputsFlow,
            database.cardDao().observeProgressReviewScheduleCardDueDates()
        ) { cloudSettings, workspaces, localCacheInputs, reviewScheduleCards ->
            ProgressPrimaryObservedInputs(
                cloudSettings = cloudSettings,
                workspaces = workspaces,
                localCacheInputs = localCacheInputs,
                reviewScheduleCards = reviewScheduleCards
            )
        }
        val syncInputsFlow = combine(
            database.outboxDao().observePendingReviewEventOutboxEntries(),
            database.outboxDao().observePendingReviewScheduleCardUpsertOutboxEntries(),
            database.syncStateDao().observeSyncStates(),
            syncRepository.observeSyncStatus()
        ) { pendingReviewOutboxEntries, pendingCardUpsertOutboxEntries, syncStates, syncStatus ->
            ProgressSyncObservedInputs(
                pendingReviewOutboxEntries = pendingReviewOutboxEntries,
                pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
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
                reviewScheduleCards = primaryInputs.reviewScheduleCards,
                pendingReviewOutboxEntries = syncInputs.pendingReviewOutboxEntries,
                pendingCardUpsertOutboxEntries = syncInputs.pendingCardUpsertOutboxEntries,
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

        val seriesInputsFlow = summaryInputsFlow.combine(
            remoteCacheDao.observeProgressSeriesCaches()
        ) { summaryInputs, seriesCaches ->
            ProgressObservedSeriesInputs(
                summaryInputs = summaryInputs,
                seriesCaches = seriesCaches
            )
        }

        return seriesInputsFlow.combine(
            remoteCacheDao.observeProgressReviewScheduleCaches()
        ) { seriesInputs, reviewScheduleCaches ->
            ProgressObservedInputs(
                cloudSettings = seriesInputs.summaryInputs.baseInputs.cloudSettings,
                workspaces = seriesInputs.summaryInputs.baseInputs.workspaces,
                localDayCounts = seriesInputs.summaryInputs.baseInputs.localDayCounts,
                reviewHistoryStates = seriesInputs.summaryInputs.baseInputs.reviewHistoryStates,
                localCacheStates = seriesInputs.summaryInputs.baseInputs.localCacheStates,
                reviewScheduleCards = seriesInputs.summaryInputs.baseInputs.reviewScheduleCards,
                pendingReviewOutboxEntries = seriesInputs.summaryInputs.baseInputs.pendingReviewOutboxEntries,
                pendingCardUpsertOutboxEntries = seriesInputs.summaryInputs.baseInputs.pendingCardUpsertOutboxEntries,
                syncStates = seriesInputs.summaryInputs.baseInputs.syncStates,
                syncStatus = seriesInputs.summaryInputs.baseInputs.syncStatus,
                summaryCaches = seriesInputs.summaryInputs.summaryCaches,
                seriesCaches = seriesInputs.seriesCaches,
                reviewScheduleCaches = reviewScheduleCaches
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

        val previousReviewScheduleStoreState = latestReviewScheduleStoreStateMutable.value
        val currentReviewScheduleStoreState = createProgressReviewScheduleStoreState(
            inputs = createProgressReviewScheduleStoreInputs(
                inputs = inputs,
                clockSnapshot = clockSnapshot
            )
        )
        latestReviewScheduleStoreStateMutable.value = currentReviewScheduleStoreState
        publishReviewScheduleSnapshotIfChanged(snapshot = currentReviewScheduleStoreState.snapshot)
        val reviewScheduleSyncRefreshTrackerResult = updateProgressReviewScheduleSyncRefreshTrackerState(
            previousState = reviewScheduleSyncRefreshTrackerState,
            serializedScopeKey = serializeProgressReviewScheduleScopeKey(
                scopeKey = currentReviewScheduleStoreState.scopeKey
            ),
            reviewScheduleFingerprint = currentReviewScheduleStoreState.reviewScheduleFingerprint,
            hasPendingScheduleImpactingCardChanges =
                currentReviewScheduleStoreState.hasPendingScheduleImpactingCardChanges,
            currentSuccessfulSyncAtMillis = currentReviewScheduleStoreState.syncStatus.lastSuccessfulSyncAtMillis
        )
        reviewScheduleSyncRefreshTrackerState = reviewScheduleSyncRefreshTrackerResult.state

        if (currentSummaryStoreState.isLocalCacheReady.not() || currentSeriesStoreState.isLocalCacheReady.not()) {
            launchAndLogFailure(
                event = "progress_local_cache_ready_background_failed",
                fields = listOf("timeZone" to currentSummaryStoreState.scopeKey.timeZone)
            ) {
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
            launchAndLogFailure(
                event = "progress_summary_background_refresh_failed",
                fields = listOf(
                    "scopeKey" to serializeProgressSummaryScopeKey(scopeKey = currentSummaryStoreState.scopeKey)
                )
            ) {
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
            launchAndLogFailure(
                event = "progress_series_background_refresh_failed",
                fields = listOf(
                    "scopeKey" to serializeProgressSeriesScopeKey(scopeKey = currentSeriesStoreState.scopeKey)
                )
            ) {
                refreshSeriesFromStoreState(
                    storeState = currentSeriesStoreState,
                    refreshReason = ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE
                )
            }
        }

        if (
            didSyncCompleteWithReviewScheduleChange(
                previousSuccessfulSyncAtMillis = previousReviewScheduleStoreState?.syncStatus?.lastSuccessfulSyncAtMillis,
                currentSuccessfulSyncAtMillis = currentReviewScheduleStoreState.syncStatus.lastSuccessfulSyncAtMillis,
                previousReviewScheduleFingerprint = previousReviewScheduleStoreState?.reviewScheduleFingerprint,
                currentReviewScheduleFingerprint = currentReviewScheduleStoreState.reviewScheduleFingerprint
            ) || reviewScheduleSyncRefreshTrackerResult.shouldRefresh
        ) {
            launchAndLogFailure(
                event = "progress_review_schedule_background_refresh_failed",
                fields = listOf(
                    "scopeKey" to serializeProgressReviewScheduleScopeKey(scopeKey = currentReviewScheduleStoreState.scopeKey)
                )
            ) {
                refreshReviewScheduleFromStoreState(
                    storeState = currentReviewScheduleStoreState,
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
            } catch (error: Throwable) {
                // Cleanup-and-rethrow: always release the coordinator before propagating,
                // including for CancellationException (preserves structured concurrency)
                // and Error (so OOM/StackOverflow does not leave the coordinator in
                // inFlight forever).
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
            } catch (error: Throwable) {
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

    private suspend fun refreshReviewScheduleFromStoreState(
        storeState: ProgressReviewScheduleStoreState,
        refreshReason: ProgressRefreshReason
    ) {
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        val serializedScopeKey = serializeProgressReviewScheduleScopeKey(scopeKey = storeState.scopeKey)
        var syncMode = createProgressRemoteRefreshSyncMode(refreshReason = refreshReason)
        if (
            reviewScheduleRefreshCoordinator.beginRefresh(
                scopeKey = serializedScopeKey,
                syncMode = syncMode
            ).not()
        ) {
            return
        }

        var refreshStoreState = storeState
        while (true) {
            try {
                performReviewScheduleRefresh(
                    refreshStoreState = refreshStoreState,
                    initialStoreState = storeState,
                    syncMode = syncMode
                )
            } catch (error: Throwable) {
                reviewScheduleRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            }

            val queuedSyncMode = reviewScheduleRefreshCoordinator.completeRefreshIteration(
                scopeKey = serializedScopeKey
            ) ?: return
            val latestStoreState = currentReviewScheduleStoreState()
            if (latestStoreState == null) {
                reviewScheduleRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (serializeProgressReviewScheduleScopeKey(scopeKey = latestStoreState.scopeKey) != serializedScopeKey) {
                reviewScheduleRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                return
            }
            if (supportsServerRefresh(cloudState = latestStoreState.cloudState).not()) {
                reviewScheduleRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
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

    private suspend fun performReviewScheduleRefresh(
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
                        "scopeKey" to serializeProgressReviewScheduleScopeKey(scopeKey = resolvedRefreshStoreState.scopeKey),
                        "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone
                    ),
                    error = error
                )
                return
            }
            resolvedRefreshStoreState = currentReviewScheduleStoreState() ?: return
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
                    "scopeKey" to serializeProgressReviewScheduleScopeKey(scopeKey = resolvedRefreshStoreState.scopeKey),
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
                    "scopeKey" to serializeProgressReviewScheduleScopeKey(scopeKey = resolvedRefreshStoreState.scopeKey),
                    "timeZone" to resolvedRefreshStoreState.scopeKey.timeZone,
                    "responseTimeZone" to remoteSchedule.timeZone
                ),
                error = error
            )
            return
        }

        val latestStoreState = currentReviewScheduleStoreState() ?: return
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

    private suspend fun ensureLocalCacheReady(timeZone: String) {
        // If another caller is already rebuilding the cache for this timezone, await its result
        // instead of returning early. Returning early would let a follow-up refresh see
        // isLocalCacheReady = false and silently bail, dropping the user-initiated refresh.
        val lease = localCacheRebuildCoordinator.acquireRebuildLease(timeZone = timeZone)
        when (lease) {
            is ProgressLocalCacheRebuildLease.Waiter -> {
                lease.inFlight.await()
            }
            is ProgressLocalCacheRebuildLease.Owner -> {
                runOwnedLocalCacheRebuild(timeZone = timeZone, lease = lease)
            }
        }
    }

    private suspend fun runOwnedLocalCacheRebuild(
        timeZone: String,
        lease: ProgressLocalCacheRebuildLease.Owner
    ) {
        var failure: Throwable? = null
        try {
            localProgressCacheStore.rebuildTimeZoneCache(
                timeZone = timeZone,
                updatedAtMillis = timeProvider.currentTimeMillis()
            )
        } catch (error: Throwable) {
            failure = error
            throw error
        } finally {
            // completeRebuild is invoked in the finally block so concurrent waiters always
            // observe completion. If the rebuild failed or was cancelled, the same throwable
            // propagates to waiters so they do not silently see an empty cache.
            localCacheRebuildCoordinator.completeRebuild(
                timeZone = timeZone,
                completion = lease.completion,
                error = failure
            )
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

    private fun publishReviewScheduleSnapshotIfChanged(
        snapshot: ProgressReviewScheduleSnapshot?
    ) {
        if (reviewScheduleSnapshotMutable.value == snapshot) {
            return
        }

        reviewScheduleSnapshotMutable.value = snapshot
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

    private fun currentReviewScheduleStoreState(): ProgressReviewScheduleStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createProgressReviewScheduleStoreState(
            inputs = createProgressReviewScheduleStoreInputs(
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

    private fun createProgressReviewScheduleStoreInputs(
        inputs: ProgressObservedInputs,
        clockSnapshot: ProgressClockSnapshot
    ): ProgressReviewScheduleStoreInputs {
        val workspaceIds = inputs.workspaces.map(WorkspaceEntity::workspaceId)
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

    // Single entry point for every appScope.launch in this class. It re-throws
    // CancellationException to keep structured concurrency intact, and swallows any
    // other Exception after a structured warning. Errors (OOM/StackOverflow) are
    // intentionally not caught here — they bubble up to the appScope's
    // CoroutineExceptionHandler in AppGraph.
    private fun launchAndLogFailure(
        event: String,
        fields: List<Pair<String, String?>>,
        block: suspend () -> Unit
    ): Job {
        return appScope.launch {
            try {
                block()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logProgressRepositoryWarning(
                    event = event,
                    fields = fields,
                    error = error
                )
            }
        }
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
