package com.flashcardsopensourceapp.data.local.repository

import android.util.Log
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
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
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
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException

const val progressHistoryDayCount: Long = 140L
private const val progressRepositoryLogTag: String = "ProgressRepository"
private const val progressRepositoryLogMaxValueLength: Int = 240

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

internal data class ProgressSummaryStoreState(
    val scopeKey: ProgressSummaryScopeKey,
    val cloudState: CloudAccountState,
    val snapshot: ProgressSummarySnapshot?,
    val isLocalCacheReady: Boolean,
    val reviewHistoryFingerprint: String,
    val syncStatus: SyncStatusSnapshot
)

internal data class ProgressSeriesStoreState(
    val scopeKey: ProgressSeriesScopeKey,
    val cloudState: CloudAccountState,
    val snapshot: ProgressSeriesSnapshot?,
    val isLocalCacheReady: Boolean,
    val reviewHistoryFingerprint: String,
    val syncStatus: SyncStatusSnapshot
)

interface ProgressTimeProvider {
    fun currentZoneId(): ZoneId
    fun currentTimeMillis(): Long
}

object SystemProgressTimeProvider : ProgressTimeProvider {
    override fun currentZoneId(): ZoneId {
        return ZoneId.systemDefault()
    }

    override fun currentTimeMillis(): Long {
        return System.currentTimeMillis()
    }
}

private fun logProgressRepositoryWarning(
    event: String,
    fields: List<Pair<String, String?>>,
    error: Throwable
) {
    val message = buildProgressRepositoryLogMessage(
        event = event,
        fields = fields
    )
    val didLog = runCatching {
        Log.w(progressRepositoryLogTag, message, error)
    }.isSuccess
    if (didLog.not()) {
        println("$progressRepositoryLogTag W $message")
        println(error.stackTraceToString())
    }
}

private fun buildProgressRepositoryLogMessage(
    event: String,
    fields: List<Pair<String, String?>>
): String {
    val renderedFields = fields.map { (key, value) ->
        "$key=${sanitizeProgressRepositoryLogValue(value = value)}"
    }

    return if (renderedFields.isEmpty()) {
        "event=$event"
    } else {
        "event=$event ${renderedFields.joinToString(separator = " ")}"
    }
}

private fun sanitizeProgressRepositoryLogValue(
    value: String?
): String {
    if (value == null) {
        return "null"
    }

    val normalized = value.replace(oldValue = "\n", newValue = "\\n")
    return if (normalized.length <= progressRepositoryLogMaxValueLength) {
        normalized
    } else {
        normalized.take(progressRepositoryLogMaxValueLength) + "..."
    }
}

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
            combine(
                combine(
                    preferencesStore.observeCloudSettings(),
                    database.workspaceDao().observeWorkspaces(),
                    combine(
                        database.progressLocalCacheDao().observeProgressLocalDayCounts(),
                        database.progressLocalCacheDao().observeProgressReviewHistoryStates(),
                        database.progressLocalCacheDao().observeProgressLocalCacheStates()
                    ) { localDayCounts, reviewHistoryStates, localCacheStates ->
                        Triple(localDayCounts, reviewHistoryStates, localCacheStates)
                    }
                ) { cloudSettings, workspaces, progressInputs ->
                    Triple(cloudSettings, workspaces, progressInputs)
                },
                combine(
                    database.outboxDao().observePendingReviewEventOutboxEntries(),
                    database.syncStateDao().observeSyncStates(),
                    syncRepository.observeSyncStatus()
                ) { pendingReviewOutboxEntries, syncStates, syncStatus ->
                    Triple(pendingReviewOutboxEntries, syncStates, syncStatus)
                }
            ) { primaryInputs, syncInputs ->
                ProgressObservedBaseInputs(
                    cloudSettings = primaryInputs.first,
                    workspaces = primaryInputs.second,
                    localDayCounts = primaryInputs.third.first,
                    reviewHistoryStates = primaryInputs.third.second,
                    localCacheStates = primaryInputs.third.third,
                    pendingReviewOutboxEntries = syncInputs.first,
                    syncStates = syncInputs.second,
                    syncStatus = syncInputs.third
                )
            }.combine(
                database.progressRemoteCacheDao().observeProgressSummaryCaches()
            ) { baseInputs, summaryCaches ->
                Pair(baseInputs, summaryCaches)
            }.combine(
                database.progressRemoteCacheDao().observeProgressSeriesCaches()
            ) { summaryInputs, seriesCaches ->
                ProgressObservedInputs(
                    cloudSettings = summaryInputs.first.cloudSettings,
                    workspaces = summaryInputs.first.workspaces,
                    localDayCounts = summaryInputs.first.localDayCounts,
                    reviewHistoryStates = summaryInputs.first.reviewHistoryStates,
                    localCacheStates = summaryInputs.first.localCacheStates,
                    pendingReviewOutboxEntries = summaryInputs.first.pendingReviewOutboxEntries,
                    syncStates = summaryInputs.first.syncStates,
                    syncStatus = summaryInputs.first.syncStatus,
                    summaryCaches = summaryInputs.second,
                    seriesCaches = seriesCaches
                )
            }.collect { inputs ->
                latestInputsMutable.value = inputs

                val previousSummaryStoreState = latestSummaryStoreStateMutable.value
                val currentSummaryStoreState = createProgressSummaryStoreState(
                    inputs = inputs,
                    timeProvider = timeProvider
                )
                latestSummaryStoreStateMutable.value = currentSummaryStoreState
                publishSummarySnapshotIfChanged(snapshot = currentSummaryStoreState.snapshot)

                val previousSeriesStoreState = latestSeriesStoreStateMutable.value
                val currentSeriesStoreState = createProgressSeriesStoreState(
                    inputs = inputs,
                    timeProvider = timeProvider
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

    private suspend fun refreshSummaryFromStoreState(
        storeState: ProgressSummaryStoreState,
        refreshReason: ProgressRefreshReason
    ) {
        if (supportsServerRefresh(cloudState = storeState.cloudState).not()) {
            return
        }

        val serializedScopeKey = serializeProgressSummaryScopeKey(scopeKey = storeState.scopeKey)
        var requiresSyncBeforeRemoteLoad = requiresSyncBeforeRemoteLoad(refreshReason = refreshReason)
        if (
            summaryRefreshCoordinator.beginRefresh(
                scopeKey = serializedScopeKey,
                requiresSyncBeforeRemoteLoad = requiresSyncBeforeRemoteLoad
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
                    requiresSyncBeforeRemoteLoad = requiresSyncBeforeRemoteLoad
                )
            } catch (error: CancellationException) {
                summaryRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            }

            val queuedRequiresSyncBeforeRemoteLoad = summaryRefreshCoordinator.completeRefreshIteration(
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
            requiresSyncBeforeRemoteLoad = queuedRequiresSyncBeforeRemoteLoad
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
        var requiresSyncBeforeRemoteLoad = requiresSyncBeforeRemoteLoad(refreshReason = refreshReason)
        if (
            seriesRefreshCoordinator.beginRefresh(
                scopeKey = serializedScopeKey,
                requiresSyncBeforeRemoteLoad = requiresSyncBeforeRemoteLoad
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
                    requiresSyncBeforeRemoteLoad = requiresSyncBeforeRemoteLoad
                )
            } catch (error: CancellationException) {
                seriesRefreshCoordinator.endRefresh(scopeKey = serializedScopeKey)
                throw error
            }

            val queuedRequiresSyncBeforeRemoteLoad = seriesRefreshCoordinator.completeRefreshIteration(
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
            requiresSyncBeforeRemoteLoad = queuedRequiresSyncBeforeRemoteLoad
        }
    }

    private suspend fun performSummaryRefresh(
        refreshStoreState: ProgressSummaryStoreState,
        initialStoreState: ProgressSummaryStoreState,
        requiresSyncBeforeRemoteLoad: Boolean
    ) {
        var resolvedRefreshStoreState = refreshStoreState
        if (resolvedRefreshStoreState.isLocalCacheReady.not()) {
            return
        }
        if (requiresSyncBeforeRemoteLoad) {
            try {
                syncRepository.syncNow()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
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
        } catch (_: Exception) {
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
        requiresSyncBeforeRemoteLoad: Boolean
    ) {
        var resolvedRefreshStoreState = refreshStoreState
        if (resolvedRefreshStoreState.isLocalCacheReady.not()) {
            return
        }
        if (requiresSyncBeforeRemoteLoad) {
            try {
                syncRepository.syncNow()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
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
        } catch (_: Exception) {
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
            inputs = latestInputs,
            timeProvider = timeProvider
        )
    }

    private fun currentSeriesStoreState(): ProgressSeriesStoreState? {
        val latestInputs = latestInputsMutable.value ?: return null
        return createProgressSeriesStoreState(
            inputs = latestInputs,
            timeProvider = timeProvider
        )
    }
}

internal class ProgressRefreshCoordinator {
    private val refreshScopesMutex = Mutex()
    private val refreshingScopeKeys = mutableSetOf<String>()
    private val queuedRefreshSyncRequirements = mutableMapOf<String, Boolean>()

    suspend fun beginRefresh(
        scopeKey: String,
        requiresSyncBeforeRemoteLoad: Boolean
    ): Boolean {
        return refreshScopesMutex.withLock {
            if (refreshingScopeKeys.add(scopeKey)) {
                return@withLock true
            }

            val queuedRequiresSyncBeforeRemoteLoad = queuedRefreshSyncRequirements[scopeKey] ?: false
            queuedRefreshSyncRequirements[scopeKey] =
                queuedRequiresSyncBeforeRemoteLoad || requiresSyncBeforeRemoteLoad
            false
        }
    }

    suspend fun completeRefreshIteration(
        scopeKey: String
    ): Boolean? {
        return refreshScopesMutex.withLock {
            val queuedRequiresSyncBeforeRemoteLoad = queuedRefreshSyncRequirements.remove(scopeKey)
            if (queuedRequiresSyncBeforeRemoteLoad != null) {
                return@withLock queuedRequiresSyncBeforeRemoteLoad
            }

            refreshingScopeKeys.remove(scopeKey)
            null
        }
    }

    suspend fun endRefresh(
        scopeKey: String
    ) {
        refreshScopesMutex.withLock {
            refreshingScopeKeys.remove(scopeKey)
            queuedRefreshSyncRequirements.remove(scopeKey)
        }
    }
}

internal class ProgressLocalCacheRebuildCoordinator {
    private val rebuildMutex = Mutex()
    private val rebuildingTimeZones = mutableSetOf<String>()

    suspend fun beginRebuild(timeZone: String): Boolean {
        return rebuildMutex.withLock {
            rebuildingTimeZones.add(timeZone)
        }
    }

    suspend fun endRebuild(timeZone: String) {
        rebuildMutex.withLock {
            rebuildingTimeZones.remove(timeZone)
        }
    }
}

private fun createProgressSummaryStoreState(
    inputs: ProgressObservedInputs,
    timeProvider: ProgressTimeProvider
): ProgressSummaryStoreState {
    val zoneId = timeProvider.currentZoneId()
    val today = Instant.ofEpochMilli(timeProvider.currentTimeMillis())
        .atZone(zoneId)
        .toLocalDate()
    val scopeKey = createProgressSummaryScopeKey(
        cloudSettings = inputs.cloudSettings,
        today = today,
        zoneId = zoneId
    )
    val workspaceIds = inputs.workspaces.map(WorkspaceEntity::workspaceId)
    val isLocalCacheReady = isProgressLocalCacheReady(
        reviewHistoryStates = inputs.reviewHistoryStates,
        localCacheStates = inputs.localCacheStates,
        workspaceIds = workspaceIds,
        timeZone = scopeKey.timeZone
    )
    val serverBase = inputs.summaryCaches.firstOrNull { entry ->
        entry.scopeKey == serializeProgressSummaryScopeKey(scopeKey = scopeKey)
    }?.toCloudProgressSummaryOrNull()
    val localFallback = if (isLocalCacheReady) {
        createLocalFallbackSummary(
            scopeKey = scopeKey,
            localDayCounts = inputs.localDayCounts,
            workspaceIds = workspaceIds,
            today = today
        )
    } else {
        createEmptyProgressSummary()
    }
    return ProgressSummaryStoreState(
        scopeKey = scopeKey,
        cloudState = inputs.cloudSettings.cloudState,
        snapshot = if (isLocalCacheReady) {
            createProgressSummarySnapshot(
                scopeKey = scopeKey,
                localFallback = localFallback,
                serverBase = serverBase,
                cloudState = inputs.cloudSettings.cloudState
            )
        } else {
            null
        },
        isLocalCacheReady = isLocalCacheReady,
        reviewHistoryFingerprint = createReviewHistoryFingerprint(
            reviewHistoryStates = inputs.reviewHistoryStates,
            pendingReviewOutboxEntries = inputs.pendingReviewOutboxEntries,
            syncStates = inputs.syncStates,
            workspaceIds = workspaceIds
        ),
        syncStatus = inputs.syncStatus
    )
}

private fun createProgressSeriesStoreState(
    inputs: ProgressObservedInputs,
    timeProvider: ProgressTimeProvider
): ProgressSeriesStoreState {
    val zoneId = timeProvider.currentZoneId()
    val today = Instant.ofEpochMilli(timeProvider.currentTimeMillis())
        .atZone(zoneId)
        .toLocalDate()
    val scopeKey = createProgressSeriesScopeKey(
        cloudSettings = inputs.cloudSettings,
        today = today,
        zoneId = zoneId
    )
    val workspaceIds = inputs.workspaces.map(WorkspaceEntity::workspaceId)
    val isLocalCacheReady = isProgressLocalCacheReady(
        reviewHistoryStates = inputs.reviewHistoryStates,
        localCacheStates = inputs.localCacheStates,
        workspaceIds = workspaceIds,
        timeZone = scopeKey.timeZone
    )
    val serverBase = inputs.seriesCaches.firstOrNull { entry ->
        entry.scopeKey == serializeProgressSeriesScopeKey(scopeKey = scopeKey)
    }?.toCloudProgressSeriesOrNull()
    val localFallback = if (isLocalCacheReady) {
        createLocalFallbackSeries(
            scopeKey = scopeKey,
            localDayCounts = inputs.localDayCounts,
            workspaceIds = workspaceIds
        )
    } else {
        createEmptyProgressSeries(scopeKey = scopeKey)
    }
    val pendingLocalOverlay = if (isLocalCacheReady) {
        createPendingLocalOverlaySeries(
            scopeKey = scopeKey,
            pendingReviewOutboxEntries = inputs.pendingReviewOutboxEntries,
            workspaceIds = workspaceIds
        )
    } else {
        createEmptyProgressSeries(scopeKey = scopeKey)
    }
    return ProgressSeriesStoreState(
        scopeKey = scopeKey,
        cloudState = inputs.cloudSettings.cloudState,
        snapshot = if (isLocalCacheReady) {
            createProgressSeriesSnapshot(
                scopeKey = scopeKey,
                localFallback = localFallback,
                serverBase = serverBase,
                pendingLocalOverlay = pendingLocalOverlay,
                cloudState = inputs.cloudSettings.cloudState
            )
        } else {
            null
        },
        isLocalCacheReady = isLocalCacheReady,
        reviewHistoryFingerprint = createReviewHistoryFingerprint(
            reviewHistoryStates = inputs.reviewHistoryStates,
            pendingReviewOutboxEntries = inputs.pendingReviewOutboxEntries,
            syncStates = inputs.syncStates,
            workspaceIds = workspaceIds
        ),
        syncStatus = inputs.syncStatus
    )
}

internal fun createProgressSummaryScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId
): ProgressSummaryScopeKey {
    return ProgressSummaryScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        referenceLocalDate = today.toString()
    )
}

internal fun createProgressSeriesScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId
): ProgressSeriesScopeKey {
    val from = today.minusDays(progressHistoryDayCount - 1L)
    return ProgressSeriesScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        from = from.toString(),
        to = today.toString()
    )
}

internal fun createProgressScopeId(
    cloudSettings: CloudSettings
): String {
    return when (cloudSettings.cloudState) {
        CloudAccountState.LINKED -> "linked:${cloudSettings.linkedUserId ?: cloudSettings.installationId}"
        CloudAccountState.GUEST -> "guest:${cloudSettings.activeWorkspaceId ?: cloudSettings.installationId}"
        CloudAccountState.DISCONNECTED -> "local:${cloudSettings.installationId}"
        CloudAccountState.LINKING_READY -> "linking:${cloudSettings.installationId}"
    }
}

internal fun isProgressLocalCacheReady(
    reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    localCacheStates: List<ProgressLocalCacheStateEntity>,
    workspaceIds: List<String>,
    timeZone: String
): Boolean {
    val historyStatesByWorkspaceId = reviewHistoryStates.associateBy(ProgressReviewHistoryStateEntity::workspaceId)
    val cacheStatesByWorkspaceId = localCacheStates.filter { cacheState ->
        cacheState.timeZone == timeZone
    }.associateBy(ProgressLocalCacheStateEntity::workspaceId)

    return workspaceIds.all { workspaceId ->
        val historyVersion = historyStatesByWorkspaceId[workspaceId]?.historyVersion ?: 0L
        if (historyVersion == 0L) {
            return@all true
        }

        cacheStatesByWorkspaceId[workspaceId]?.historyVersion == historyVersion
    }
}

internal fun createLocalFallbackSummary(
    scopeKey: ProgressSummaryScopeKey,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    workspaceIds: List<String>,
    today: LocalDate
): CloudProgressSummary {
    val workspaceIdSet = workspaceIds.toSet()
    val activeReviewDates = localDayCounts.filter { dayCount ->
        dayCount.timeZone == scopeKey.timeZone &&
            workspaceIdSet.contains(dayCount.workspaceId) &&
            dayCount.reviewCount > 0
    }.map(ProgressLocalDayCountEntity::localDate)
        .distinct()
        .sorted()
    val activeReviewDateSet = activeReviewDates.toSet()
    val lastReviewedOn = activeReviewDates.lastOrNull()
    val currentStreakDays = computeCurrentStreakDays(
        activeReviewDateSet = activeReviewDateSet,
        today = today
    )
    return CloudProgressSummary(
        currentStreakDays = currentStreakDays,
        hasReviewedToday = activeReviewDateSet.contains(today.toString()),
        lastReviewedOn = lastReviewedOn,
        activeReviewDays = activeReviewDates.size
    )
}

internal fun createLocalFallbackSeries(
    scopeKey: ProgressSeriesScopeKey,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    workspaceIds: List<String>
): CloudProgressSeries {
    val workspaceIdSet = workspaceIds.toSet()
    val dateRange = createInclusiveLocalDateRange(
        from = scopeKey.from,
        to = scopeKey.to
    )
    val reviewCountsByDate = linkedMapOf<String, Int>()
    dateRange.forEach { date ->
        reviewCountsByDate[date] = 0
    }
    localDayCounts.forEach { dayCount ->
        if (dayCount.timeZone != scopeKey.timeZone) {
            return@forEach
        }
        if (workspaceIdSet.contains(dayCount.workspaceId).not()) {
            return@forEach
        }
        if (reviewCountsByDate.containsKey(dayCount.localDate).not()) {
            return@forEach
        }
        reviewCountsByDate[dayCount.localDate] = (reviewCountsByDate[dayCount.localDate] ?: 0) + dayCount.reviewCount
    }

    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = reviewCountsByDate.map { (date, reviewCount) ->
            CloudDailyReviewPoint(
                date = date,
                reviewCount = reviewCount
            )
        },
        generatedAt = null,
        summary = null
    )
}

internal fun createPendingLocalOverlaySeries(
    scopeKey: ProgressSeriesScopeKey,
    pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    workspaceIds: List<String>
): CloudProgressSeries {
    val workspaceIdSet = workspaceIds.toSet()
    val zoneId = ZoneId.of(scopeKey.timeZone)
    val reviewCountsByDate = createInclusiveLocalDateRange(
        from = scopeKey.from,
        to = scopeKey.to
    ).associateWith { 0 }.toMutableMap()

    pendingReviewOutboxEntries.forEach { entry ->
        if (workspaceIdSet.contains(entry.workspaceId).not()) {
            return@forEach
        }

        val localDate = try {
            entry.toPendingReviewLocalDate(zoneId = zoneId)
        } catch (error: IllegalArgumentException) {
            logProgressRepositoryWarning(
                event = "progress_pending_overlay_entry_skipped",
                fields = listOf(
                    "outboxEntryId" to entry.outboxEntryId,
                    "workspaceId" to entry.workspaceId,
                    "timeZone" to scopeKey.timeZone
                ),
                error = error
            )
            return@forEach
        }
        if (reviewCountsByDate.containsKey(localDate).not()) {
            return@forEach
        }

        reviewCountsByDate[localDate] = (reviewCountsByDate[localDate] ?: 0) + 1
    }

    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = reviewCountsByDate.map { (date, reviewCount) ->
            CloudDailyReviewPoint(
                date = date,
                reviewCount = reviewCount
            )
        },
        generatedAt = null,
        summary = null
    )
}

internal fun createProgressSummarySnapshot(
    scopeKey: ProgressSummaryScopeKey,
    localFallback: CloudProgressSummary,
    serverBase: CloudProgressSummary?,
    cloudState: CloudAccountState
): ProgressSummarySnapshot {
    val hasPendingLocalOverlay = serverBase?.let { base ->
        hasProgressSummaryOverlay(
            localFallback = localFallback,
            serverBase = base
        )
    } ?: false
    val renderedSummary = when {
        serverBase == null -> localFallback
        hasPendingLocalOverlay -> mergeProgressSummary(
            base = serverBase,
            localFallback = localFallback
        )
        else -> serverBase
    }
    val source = when {
        serverBase == null -> ProgressSnapshotSource.LOCAL_ONLY
        hasPendingLocalOverlay -> ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY
        else -> ProgressSnapshotSource.SERVER_BASE
    }
    return ProgressSummarySnapshot(
        scopeKey = scopeKey,
        renderedSummary = renderedSummary,
        localFallback = localFallback,
        serverBase = serverBase,
        source = source,
        isApproximate = source == ProgressSnapshotSource.LOCAL_ONLY ||
            hasPendingLocalOverlay ||
            cloudState == CloudAccountState.DISCONNECTED ||
            cloudState == CloudAccountState.LINKING_READY
    )
}

internal fun createProgressSeriesSnapshot(
    scopeKey: ProgressSeriesScopeKey,
    localFallback: CloudProgressSeries,
    serverBase: CloudProgressSeries?,
    pendingLocalOverlay: CloudProgressSeries,
    cloudState: CloudAccountState
): ProgressSeriesSnapshot {
    val hasPendingLocalOverlay = pendingLocalOverlay.dailyReviews.any { point ->
        point.reviewCount > 0
    }
    val renderedSeries = if (serverBase == null) {
        localFallback
    } else {
        mergeProgressSeries(
            base = serverBase,
            overlay = pendingLocalOverlay
        )
    }
    val source = when {
        serverBase == null -> ProgressSnapshotSource.LOCAL_ONLY
        hasPendingLocalOverlay -> ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY
        else -> ProgressSnapshotSource.SERVER_BASE
    }
    return ProgressSeriesSnapshot(
        scopeKey = scopeKey,
        renderedSeries = renderedSeries,
        localFallback = localFallback,
        serverBase = serverBase,
        pendingLocalOverlay = pendingLocalOverlay,
        source = source,
        isApproximate = source == ProgressSnapshotSource.LOCAL_ONLY ||
            hasPendingLocalOverlay ||
            cloudState == CloudAccountState.DISCONNECTED ||
            cloudState == CloudAccountState.LINKING_READY
    )
}

internal fun mergeProgressSummary(
    base: CloudProgressSummary,
    localFallback: CloudProgressSummary
): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = maxOf(base.currentStreakDays, localFallback.currentStreakDays),
        hasReviewedToday = base.hasReviewedToday || localFallback.hasReviewedToday,
        lastReviewedOn = maxLocalDate(
            first = base.lastReviewedOn,
            second = localFallback.lastReviewedOn
        ),
        activeReviewDays = maxOf(base.activeReviewDays, localFallback.activeReviewDays)
    )
}

internal fun mergeProgressSeries(
    base: CloudProgressSeries,
    overlay: CloudProgressSeries
): CloudProgressSeries {
    val overlayCountsByDate = overlay.dailyReviews.associate { point ->
        point.date to point.reviewCount
    }
    val mergedDailyReviews = base.dailyReviews.map { point ->
        CloudDailyReviewPoint(
            date = point.date,
            reviewCount = point.reviewCount + (overlayCountsByDate[point.date] ?: 0)
        )
    }
    return CloudProgressSeries(
        timeZone = base.timeZone,
        from = base.from,
        to = base.to,
        dailyReviews = mergedDailyReviews,
        generatedAt = base.generatedAt,
        summary = null
    )
}

internal fun createReviewHistoryFingerprint(
    reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    pendingReviewOutboxEntries: List<OutboxEntryEntity>,
    syncStates: List<SyncStateEntity>,
    workspaceIds: List<String>
): String {
    val workspaceIdSet = workspaceIds.toSet()
    val relevantHistoryStates = reviewHistoryStates.filter { historyState ->
        workspaceIdSet.contains(historyState.workspaceId)
    }.sortedBy(ProgressReviewHistoryStateEntity::workspaceId)
    val relevantPendingReviewEntries = pendingReviewOutboxEntries.filter { entry ->
        workspaceIdSet.contains(entry.workspaceId)
    }
    val relevantSyncStates = syncStates.filter { syncState ->
        workspaceIdSet.contains(syncState.workspaceId)
    }.sortedBy(SyncStateEntity::workspaceId)

    val historyFingerprint = relevantHistoryStates.joinToString(separator = "|") { historyState ->
        "${historyState.workspaceId}:${historyState.historyVersion}"
    }
    val pendingReviewIds = relevantPendingReviewEntries.map(OutboxEntryEntity::outboxEntryId).sorted()
    val reviewSequenceFingerprint = relevantSyncStates.joinToString(separator = "|") { syncState ->
        "${syncState.workspaceId}:${syncState.lastReviewSequenceId}"
    }
    return "$historyFingerprint:${pendingReviewIds.joinToString(separator = ",")}:$reviewSequenceFingerprint"
}

internal fun didSyncCompleteWithReviewHistoryChange(
    previousSuccessfulSyncAtMillis: Long?,
    currentSuccessfulSyncAtMillis: Long?,
    previousReviewHistoryFingerprint: String?,
    currentReviewHistoryFingerprint: String
): Boolean {
    if (previousReviewHistoryFingerprint == null) {
        return false
    }
    if (currentSuccessfulSyncAtMillis == null || currentSuccessfulSyncAtMillis == previousSuccessfulSyncAtMillis) {
        return false
    }

    return previousReviewHistoryFingerprint != currentReviewHistoryFingerprint
}

internal fun serializeProgressSummaryScopeKey(
    scopeKey: ProgressSummaryScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.referenceLocalDate}"
}

internal fun serializeProgressSeriesScopeKey(
    scopeKey: ProgressSeriesScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.from}::${scopeKey.to}"
}

private fun supportsServerRefresh(
    cloudState: CloudAccountState
): Boolean {
    return cloudState == CloudAccountState.GUEST || cloudState == CloudAccountState.LINKED
}

private fun requiresSyncBeforeRemoteLoad(
    refreshReason: ProgressRefreshReason
): Boolean {
    return refreshReason != ProgressRefreshReason.SYNC_COMPLETED_WITH_REVIEW_HISTORY_CHANGE
}

private fun createInclusiveLocalDateRange(
    from: String,
    to: String
): List<String> {
    val startDate = parseLocalDate(rawDate = from)
    val endDate = parseLocalDate(rawDate = to)
    val dates = mutableListOf<String>()
    var currentDate = startDate

    while (currentDate <= endDate) {
        dates.add(currentDate.toString())
        currentDate = currentDate.plusDays(1L)
    }

    return dates
}

private fun parseLocalDate(
    rawDate: String
): LocalDate {
    return try {
        LocalDate.parse(rawDate)
    } catch (error: DateTimeParseException) {
        throw IllegalArgumentException("Invalid local date '$rawDate'.", error)
    }
}

private fun computeCurrentStreakDays(
    activeReviewDateSet: Set<String>,
    today: LocalDate
): Int {
    val anchorDate: LocalDate = when {
        activeReviewDateSet.contains(today.toString()) -> today
        activeReviewDateSet.contains(today.minusDays(1L).toString()) -> today.minusDays(1L)
        else -> return 0
    }

    var streakDays = 0
    var currentDate = anchorDate
    while (activeReviewDateSet.contains(currentDate.toString())) {
        streakDays += 1
        currentDate = currentDate.minusDays(1L)
    }
    return streakDays
}

private fun OutboxEntryEntity.toPendingReviewLocalDate(
    zoneId: ZoneId
): String {
    val payloadJsonObject = try {
        JSONObject(payloadJson)
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Invalid pending review-event payload JSON for outbox entry '$outboxEntryId': $payloadJson",
            error
        )
    }
    val reviewedAtClient = try {
        payloadJsonObject.getString("reviewedAtClient")
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Missing reviewedAtClient in pending review-event payload for outbox entry '$outboxEntryId': $payloadJson",
            error
        )
    }
    val reviewedAtInstant = try {
        Instant.parse(reviewedAtClient)
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Invalid reviewedAtClient '$reviewedAtClient' in pending review-event payload for outbox entry '$outboxEntryId'.",
            error
        )
    }
    return reviewedAtInstant.atZone(zoneId).toLocalDate().toString()
}

private fun hasProgressSummaryOverlay(
    localFallback: CloudProgressSummary,
    serverBase: CloudProgressSummary
): Boolean {
    return localFallback.currentStreakDays > serverBase.currentStreakDays ||
        (localFallback.hasReviewedToday && serverBase.hasReviewedToday.not()) ||
        isLocalDateAfter(
            first = localFallback.lastReviewedOn,
            second = serverBase.lastReviewedOn
        ) ||
        localFallback.activeReviewDays > serverBase.activeReviewDays
}

private fun isLocalDateAfter(
    first: String?,
    second: String?
): Boolean {
    return when {
        first == null -> false
        second == null -> true
        else -> parseLocalDate(rawDate = first).isAfter(parseLocalDate(rawDate = second))
    }
}

private fun maxLocalDate(
    first: String?,
    second: String?
): String? {
    return when {
        first == null -> second
        second == null -> first
        parseLocalDate(rawDate = first).isAfter(parseLocalDate(rawDate = second)) -> first
        else -> second
    }
}

private fun createEmptyProgressSummary(): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = 0,
        hasReviewedToday = false,
        lastReviewedOn = null,
        activeReviewDays = 0
    )
}

private fun createEmptyProgressSeries(
    scopeKey: ProgressSeriesScopeKey
): CloudProgressSeries {
    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = createInclusiveLocalDateRange(
            from = scopeKey.from,
            to = scopeKey.to
        ).map { date ->
            CloudDailyReviewPoint(
                date = date,
                reviewCount = 0
            )
        },
        generatedAt = null,
        summary = null
    )
}

private fun CloudProgressSummary.toCacheEntity(
    scopeKey: ProgressSummaryScopeKey,
    updatedAtMillis: Long
): ProgressSummaryCacheEntity {
    return ProgressSummaryCacheEntity(
        scopeKey = serializeProgressSummaryScopeKey(scopeKey = scopeKey),
        scopeId = scopeKey.scopeId,
        timeZone = scopeKey.timeZone,
        generatedAt = null,
        currentStreakDays = currentStreakDays,
        hasReviewedToday = hasReviewedToday,
        lastReviewedOn = lastReviewedOn,
        activeReviewDays = activeReviewDays,
        updatedAtMillis = updatedAtMillis
    )
}

private fun CloudProgressSeries.toCacheEntity(
    scopeKey: ProgressSeriesScopeKey,
    updatedAtMillis: Long
): ProgressSeriesCacheEntity {
    return ProgressSeriesCacheEntity(
        scopeKey = serializeProgressSeriesScopeKey(scopeKey = scopeKey),
        scopeId = scopeKey.scopeId,
        timeZone = timeZone,
        fromLocalDate = from,
        toLocalDate = to,
        generatedAt = generatedAt,
        dailyReviewsJson = JSONArray().apply {
            dailyReviews.forEach { point ->
                put(
                    JSONObject()
                        .put("date", point.date)
                        .put("reviewCount", point.reviewCount)
                )
            }
        }.toString(),
        updatedAtMillis = updatedAtMillis
    )
}

internal fun ProgressSummaryCacheEntity.toCloudProgressSummaryOrNull(): CloudProgressSummary? {
    return runCatching {
        lastReviewedOn?.let { cachedLastReviewedOn ->
            parseLocalDate(rawDate = cachedLastReviewedOn)
        }
        CloudProgressSummary(
            currentStreakDays = currentStreakDays,
            hasReviewedToday = hasReviewedToday,
            lastReviewedOn = lastReviewedOn,
            activeReviewDays = activeReviewDays
        )
    }.getOrElse { error ->
        logProgressRepositoryWarning(
            event = "progress_summary_cache_skipped",
            fields = listOf(
                "scopeKey" to scopeKey,
                "timeZone" to timeZone,
                "lastReviewedOn" to lastReviewedOn
            ),
            error = error
        )
        null
    }
}

internal fun ProgressSeriesCacheEntity.toCloudProgressSeriesOrNull(): CloudProgressSeries? {
    return runCatching {
        val parsedFrom = parseLocalDate(rawDate = fromLocalDate)
        val parsedTo = parseLocalDate(rawDate = toLocalDate)
        if (parsedFrom.isAfter(parsedTo)) {
            throw IllegalArgumentException(
                "Invalid progress series cache range '$fromLocalDate' > '$toLocalDate'."
            )
        }

        val dailyReviewsArray = JSONArray(dailyReviewsJson)
        CloudProgressSeries(
            timeZone = timeZone,
            from = fromLocalDate,
            to = toLocalDate,
            dailyReviews = buildList {
                for (index in 0 until dailyReviewsArray.length()) {
                    val point = dailyReviewsArray.getJSONObject(index)
                    val date = point.getString("date")
                    parseLocalDate(rawDate = date)
                    add(
                        CloudDailyReviewPoint(
                            date = date,
                            reviewCount = point.getInt("reviewCount")
                        )
                    )
                }
            },
            generatedAt = generatedAt,
            summary = null
        )
    }.getOrElse { error ->
        logProgressRepositoryWarning(
            event = "progress_series_cache_skipped",
            fields = listOf(
                "scopeKey" to scopeKey,
                "timeZone" to timeZone,
                "fromLocalDate" to fromLocalDate,
                "toLocalDate" to toLocalDate
            ),
            error = error
        )
        null
    }
}
