package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressPendingReviewFingerprintEntry

internal fun createReviewHistoryFingerprint(
    reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    pendingReviewEntries: List<ProgressPendingReviewFingerprintEntry>,
    syncStates: List<SyncStateEntity>,
    workspaceIds: List<String>
): String {
    val workspaceIdSet = workspaceIds.toSet()
    val relevantHistoryStates = reviewHistoryStates.filter { historyState ->
        workspaceIdSet.contains(historyState.workspaceId)
    }.sortedBy(ProgressReviewHistoryStateEntity::workspaceId)
    val relevantPendingReviewEntries = pendingReviewEntries.filter { entry ->
        workspaceIdSet.contains(entry.workspaceId)
    }
    val relevantSyncStates = syncStates.filter { syncState ->
        workspaceIdSet.contains(syncState.workspaceId)
    }.sortedBy(SyncStateEntity::workspaceId)

    val historyFingerprint = relevantHistoryStates.joinToString(separator = "|") { historyState ->
        "${historyState.workspaceId}:${historyState.historyVersion}"
    }
    val pendingReviewIds = relevantPendingReviewEntries.map(ProgressPendingReviewFingerprintEntry::outboxEntryId).sorted()
    val reviewSequenceFingerprint = relevantSyncStates.joinToString(separator = "|") { syncState ->
        "${syncState.workspaceId}:${syncState.lastReviewSequenceId}"
    }
    return "$historyFingerprint:${pendingReviewIds.joinToString(separator = ",")}:$reviewSequenceFingerprint"
}

internal fun createReviewScheduleFingerprint(
    reviewScheduleCards: List<ProgressReviewScheduleCardDueEntity>,
    pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    workspaceIds: List<String>
): String {
    val workspaceIdSet = workspaceIds.toSet()
    val cardFingerprint = reviewScheduleCards.filter { card ->
        workspaceIdSet.contains(card.workspaceId)
    }.sortedWith(
        compareBy<ProgressReviewScheduleCardDueEntity> { card -> card.workspaceId }
            .thenBy { card -> card.cardId }
    ).joinToString(separator = "|") { card ->
        "${card.workspaceId}:${card.cardId}:${card.dueAtMillis ?: "new"}"
    }
    val pendingCardFingerprint = pendingCardUpsertOutboxEntries.filter { entry ->
        workspaceIdSet.contains(entry.workspaceId) &&
            entry.entityType == "card" &&
            entry.operationType == "upsert" &&
            entry.affectsReviewSchedule
    }.sortedWith(
        compareBy<OutboxEntryEntity> { entry -> entry.workspaceId }
            .thenBy { entry -> entry.outboxEntryId }
    ).joinToString(separator = "|") { entry ->
        "${entry.workspaceId}:${entry.outboxEntryId}:${entry.entityId}"
    }

    return "$cardFingerprint::$pendingCardFingerprint"
}

internal fun isProgressReviewScheduleLocalScopeHydrated(
    syncStates: List<SyncStateEntity>,
    workspaceIds: List<String>
): Boolean {
    val syncStatesByWorkspaceId = syncStates.associateBy(SyncStateEntity::workspaceId)
    return workspaceIds.all { workspaceId ->
        syncStatesByWorkspaceId[workspaceId]?.hasHydratedHotState == true
    }
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

internal fun didSyncCompleteWithReviewScheduleChange(
    previousSuccessfulSyncAtMillis: Long?,
    currentSuccessfulSyncAtMillis: Long?,
    previousReviewScheduleFingerprint: String?,
    currentReviewScheduleFingerprint: String
): Boolean {
    if (previousReviewScheduleFingerprint == null) {
        return false
    }
    if (currentSuccessfulSyncAtMillis == null || currentSuccessfulSyncAtMillis == previousSuccessfulSyncAtMillis) {
        return false
    }

    return previousReviewScheduleFingerprint != currentReviewScheduleFingerprint
}

internal data class ProgressReviewScheduleSyncRefreshTrackerState(
    val serializedScopeKey: String,
    val reviewScheduleFingerprint: String,
    val hasUnacknowledgedReviewScheduleChange: Boolean,
    val sawSyncSuccessAfterReviewScheduleChange: Boolean,
    val lastSuccessfulSyncAtMillis: Long?
)

internal data class ProgressReviewScheduleSyncRefreshTrackerResult(
    val state: ProgressReviewScheduleSyncRefreshTrackerState,
    val shouldRefresh: Boolean
)

internal fun updateProgressReviewScheduleSyncRefreshTrackerState(
    previousState: ProgressReviewScheduleSyncRefreshTrackerState?,
    serializedScopeKey: String,
    reviewScheduleFingerprint: String,
    hasPendingScheduleImpactingCardChanges: Boolean,
    currentSuccessfulSyncAtMillis: Long?
): ProgressReviewScheduleSyncRefreshTrackerResult {
    val scopedPreviousState = previousState?.takeIf { state ->
        state.serializedScopeKey == serializedScopeKey
    }
    val previousSuccessfulSyncAtMillis = scopedPreviousState?.lastSuccessfulSyncAtMillis
    val didSyncSuccessAdvance = scopedPreviousState != null &&
        currentSuccessfulSyncAtMillis != null &&
        currentSuccessfulSyncAtMillis != previousSuccessfulSyncAtMillis
    val didReviewScheduleFingerprintChange = scopedPreviousState != null &&
        scopedPreviousState.reviewScheduleFingerprint != reviewScheduleFingerprint
    val hasUnacknowledgedReviewScheduleChange = scopedPreviousState
        ?.hasUnacknowledgedReviewScheduleChange == true ||
        hasPendingScheduleImpactingCardChanges ||
        didReviewScheduleFingerprintChange
    val sawSyncSuccessAfterReviewScheduleChange = scopedPreviousState
        ?.sawSyncSuccessAfterReviewScheduleChange == true ||
        (hasUnacknowledgedReviewScheduleChange && didSyncSuccessAdvance)
    val shouldRefresh = hasUnacknowledgedReviewScheduleChange &&
        sawSyncSuccessAfterReviewScheduleChange &&
        hasPendingScheduleImpactingCardChanges.not()

    return ProgressReviewScheduleSyncRefreshTrackerResult(
        state = ProgressReviewScheduleSyncRefreshTrackerState(
            serializedScopeKey = serializedScopeKey,
            reviewScheduleFingerprint = reviewScheduleFingerprint,
            hasUnacknowledgedReviewScheduleChange = if (shouldRefresh) {
                false
            } else {
                hasUnacknowledgedReviewScheduleChange
            },
            sawSyncSuccessAfterReviewScheduleChange = if (shouldRefresh) {
                false
            } else {
                sawSyncSuccessAfterReviewScheduleChange
            },
            lastSuccessfulSyncAtMillis = currentSuccessfulSyncAtMillis
        ),
        shouldRefresh = shouldRefresh
    )
}
