package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(tableName = "workspaces")
data class WorkspaceEntity(
    @PrimaryKey val workspaceId: String,
    val name: String,
    val createdAtMillis: Long
)

@Entity(tableName = "app_local_settings")
data class AppLocalSettingsEntity(
    @PrimaryKey val settingsId: Int,
    val installationId: String,
    val cloudState: String,
    val linkedUserId: String?,
    val linkedWorkspaceId: String?,
    val linkedEmail: String?,
    val activeWorkspaceId: String?,
    val updatedAtMillis: Long
)

@Entity(
    tableName = "workspace_scheduler_settings",
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
data class WorkspaceSchedulerSettingsEntity(
    @PrimaryKey val workspaceId: String,
    val algorithm: String,
    val desiredRetention: Double,
    val learningStepsMinutesJson: String,
    val relearningStepsMinutesJson: String,
    val maximumIntervalDays: Int,
    val enableFuzz: Boolean,
    val updatedAtMillis: Long
)
