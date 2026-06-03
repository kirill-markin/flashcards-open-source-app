package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "outbox_entries",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [Index("workspaceId")]
)
data class OutboxEntryEntity(
    @PrimaryKey val outboxEntryId: String,
    val workspaceId: String,
    val installationId: String,
    val entityType: String,
    val entityId: String,
    val operationType: String,
    val payloadJson: String,
    val clientUpdatedAtIso: String,
    val createdAtMillis: Long,
    val affectsReviewSchedule: Boolean,
    val attemptCount: Int,
    val lastError: String?
)

@Entity(tableName = "sync_state")
data class SyncStateEntity(
    @PrimaryKey val workspaceId: String,
    val lastSyncCursor: String?,
    val lastReviewSequenceId: Long,
    val hasHydratedHotState: Boolean,
    val hasHydratedReviewHistory: Boolean,
    val pendingReviewHistoryImport: Boolean,
    val lastSyncAttemptAtMillis: Long?,
    val lastSuccessfulSyncAtMillis: Long?,
    val lastSyncError: String?,
    val blockedInstallationId: String?
)
