package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine

internal data class ProgressObservedInputs(
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

internal fun observeProgressInputs(
    database: AppDatabase,
    preferencesStore: CloudPreferencesStore,
    syncRepository: SyncRepository
): Flow<ProgressObservedInputs> {
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
