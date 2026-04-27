package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity

internal class SyncStateLocalStore(
    private val database: AppDatabase
) {
    suspend fun ensureSyncState(workspaceId: String): SyncStateEntity {
        val existingSyncState = database.syncStateDao().loadSyncState(workspaceId = workspaceId)
        if (existingSyncState != null) {
            return existingSyncState
        }

        val syncState = emptySyncStateEntity(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(syncState = syncState)
        return syncState
    }

    suspend fun loadBlockedSyncMessage(workspaceId: String, installationId: String): String? {
        val syncState = database.syncStateDao().loadSyncState(workspaceId = workspaceId) ?: return null
        if (syncState.blockedInstallationId != installationId) {
            return null
        }

        return syncState.lastSyncError ?: "Cloud sync is blocked for this installation."
    }

    suspend fun recordSyncAttempt(workspaceId: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState = syncState.copy(
                lastSyncAttemptAtMillis = System.currentTimeMillis(),
                lastSyncError = null
            )
        )
    }

    suspend fun markSyncFailure(workspaceId: String, errorMessage: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState = syncState.copy(
                lastSyncAttemptAtMillis = System.currentTimeMillis(),
                lastSyncError = errorMessage,
                blockedInstallationId = null
            )
        )
    }

    suspend fun markSyncBlocked(
        workspaceId: String,
        installationId: String,
        errorMessage: String
    ) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState = syncState.copy(
                lastSyncAttemptAtMillis = System.currentTimeMillis(),
                lastSyncError = errorMessage,
                blockedInstallationId = installationId
            )
        )
    }

    suspend fun markReviewHistoryImportPending(workspaceId: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState = syncState.copy(
                hasHydratedReviewHistory = false,
                pendingReviewHistoryImport = true
            )
        )
    }

    suspend fun markReviewHistoryImportComplete(workspaceId: String) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        database.syncStateDao().insertSyncState(
            syncState = syncState.copy(pendingReviewHistoryImport = false)
        )
    }

    suspend fun markSyncSuccess(
        workspaceId: String,
        lastSyncCursor: String,
        lastReviewSequenceId: Long,
        hasHydratedHotState: Boolean,
        hasHydratedReviewHistory: Boolean
    ) {
        val syncState = ensureSyncState(workspaceId = workspaceId)
        val nowMillis = System.currentTimeMillis()
        database.syncStateDao().insertSyncState(
            syncState = SyncStateEntity(
                workspaceId = workspaceId,
                lastSyncCursor = lastSyncCursor,
                lastReviewSequenceId = lastReviewSequenceId,
                hasHydratedHotState = hasHydratedHotState,
                hasHydratedReviewHistory = hasHydratedReviewHistory,
                pendingReviewHistoryImport = syncState.pendingReviewHistoryImport,
                lastSyncAttemptAtMillis = nowMillis,
                lastSuccessfulSyncAtMillis = nowMillis,
                lastSyncError = null,
                blockedInstallationId = null
            )
        )
    }
}

internal fun emptySyncStateEntity(workspaceId: String): SyncStateEntity {
    return SyncStateEntity(
        workspaceId = workspaceId,
        lastSyncCursor = null,
        lastReviewSequenceId = 0L,
        hasHydratedHotState = false,
        hasHydratedReviewHistory = false,
        pendingReviewHistoryImport = false,
        lastSyncAttemptAtMillis = null,
        lastSuccessfulSyncAtMillis = null,
        lastSyncError = null,
        blockedInstallationId = null
    )
}
