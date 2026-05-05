package com.flashcardsopensourceapp.data.local.repository.progress

import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import java.time.LocalDate
import java.time.ZoneId

internal data class ProgressSummaryStoreInputs(
    val scopeKey: ProgressSummaryScopeKey,
    val cloudState: CloudAccountState,
    val workspaceIds: List<String>,
    val localDayCounts: List<ProgressLocalDayCountEntity>,
    val isLocalCacheReady: Boolean,
    val serverBase: CloudProgressSummary?,
    val reviewHistoryFingerprint: String,
    val syncStatus: SyncStatusSnapshot,
    val today: LocalDate
)

internal data class ProgressSeriesStoreInputs(
    val scopeKey: ProgressSeriesScopeKey,
    val cloudState: CloudAccountState,
    val workspaceIds: List<String>,
    val localDayCounts: List<ProgressLocalDayCountEntity>,
    val isLocalCacheReady: Boolean,
    val serverBase: CloudProgressSeries?,
    val pendingReviewLocalDates: List<ProgressPendingReviewLocalDate>,
    val reviewHistoryFingerprint: String,
    val syncStatus: SyncStatusSnapshot
)

internal data class ProgressReviewScheduleStoreInputs(
    val scopeKey: ProgressReviewScheduleScopeKey,
    val cloudState: CloudAccountState,
    val workspaceIds: List<String>,
    val reviewScheduleCards: List<ProgressReviewScheduleCardDueEntity>,
    val serverBase: CloudProgressReviewSchedule?,
    val hasPendingScheduleImpactingCardChanges: Boolean,
    val pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    val isLocalReviewScheduleScopeHydrated: Boolean,
    val reviewScheduleFingerprint: String,
    val syncStatus: SyncStatusSnapshot,
    val today: LocalDate,
    val zoneId: ZoneId
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

internal data class ProgressReviewScheduleStoreState(
    val scopeKey: ProgressReviewScheduleScopeKey,
    val cloudState: CloudAccountState,
    val snapshot: ProgressReviewScheduleSnapshot,
    val hasPendingScheduleImpactingCardChanges: Boolean,
    val reviewScheduleFingerprint: String,
    val syncStatus: SyncStatusSnapshot
)

internal fun createProgressSummaryStoreState(
    inputs: ProgressSummaryStoreInputs
): ProgressSummaryStoreState {
    val localFallback = if (inputs.isLocalCacheReady) {
        createLocalFallbackSummary(
            scopeKey = inputs.scopeKey,
            localDayCounts = inputs.localDayCounts,
            workspaceIds = inputs.workspaceIds,
            today = inputs.today
        )
    } else {
        createEmptyProgressSummary()
    }
    return ProgressSummaryStoreState(
        scopeKey = inputs.scopeKey,
        cloudState = inputs.cloudState,
        snapshot = if (inputs.isLocalCacheReady) {
            createProgressSummarySnapshot(
                scopeKey = inputs.scopeKey,
                localFallback = localFallback,
                serverBase = inputs.serverBase,
                cloudState = inputs.cloudState
            )
        } else {
            null
        },
        isLocalCacheReady = inputs.isLocalCacheReady,
        reviewHistoryFingerprint = inputs.reviewHistoryFingerprint,
        syncStatus = inputs.syncStatus
    )
}

internal fun createProgressReviewScheduleStoreState(
    inputs: ProgressReviewScheduleStoreInputs
): ProgressReviewScheduleStoreState {
    val localFallback = createLocalFallbackReviewSchedule(
        scopeKey = inputs.scopeKey,
        reviewScheduleCards = inputs.reviewScheduleCards,
        workspaceIds = inputs.workspaceIds,
        today = inputs.today,
        zoneId = inputs.zoneId
    )

    return ProgressReviewScheduleStoreState(
        scopeKey = inputs.scopeKey,
        cloudState = inputs.cloudState,
        snapshot = createProgressReviewScheduleSnapshot(
            scopeKey = inputs.scopeKey,
            localFallback = localFallback,
            serverBase = inputs.serverBase,
            hasPendingScheduleImpactingCardChanges = inputs.hasPendingScheduleImpactingCardChanges,
            pendingCardUpsertOutboxEntries = inputs.pendingCardUpsertOutboxEntries,
            isLocalReviewScheduleScopeHydrated = inputs.isLocalReviewScheduleScopeHydrated,
            workspaceIds = inputs.workspaceIds,
            cloudState = inputs.cloudState
        ),
        hasPendingScheduleImpactingCardChanges = inputs.hasPendingScheduleImpactingCardChanges,
        reviewScheduleFingerprint = inputs.reviewScheduleFingerprint,
        syncStatus = inputs.syncStatus
    )
}

internal fun createProgressSeriesStoreState(
    inputs: ProgressSeriesStoreInputs
): ProgressSeriesStoreState {
    val localFallback = if (inputs.isLocalCacheReady) {
        createLocalFallbackSeries(
            scopeKey = inputs.scopeKey,
            localDayCounts = inputs.localDayCounts,
            workspaceIds = inputs.workspaceIds
        )
    } else {
        createEmptyProgressSeries(scopeKey = inputs.scopeKey)
    }
    val pendingLocalOverlay = if (inputs.isLocalCacheReady) {
        createPendingLocalOverlaySeries(
            scopeKey = inputs.scopeKey,
            pendingReviewLocalDates = inputs.pendingReviewLocalDates,
            workspaceIds = inputs.workspaceIds
        )
    } else {
        createEmptyProgressSeries(scopeKey = inputs.scopeKey)
    }
    return ProgressSeriesStoreState(
        scopeKey = inputs.scopeKey,
        cloudState = inputs.cloudState,
        snapshot = if (inputs.isLocalCacheReady) {
            createProgressSeriesSnapshot(
                scopeKey = inputs.scopeKey,
                localFallback = localFallback,
                serverBase = inputs.serverBase,
                pendingLocalOverlay = pendingLocalOverlay,
                cloudState = inputs.cloudState
            )
        } else {
            null
        },
        isLocalCacheReady = inputs.isLocalCacheReady,
        reviewHistoryFingerprint = inputs.reviewHistoryFingerprint,
        syncStatus = inputs.syncStatus
    )
}
