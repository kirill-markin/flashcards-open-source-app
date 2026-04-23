package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import java.time.LocalDate

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
