package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "media_assets",
    foreignKeys = [
        ForeignKey(
            entity = WorkspaceEntity::class,
            parentColumns = ["workspaceId"],
            childColumns = ["workspaceId"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index("workspaceId"),
        Index(value = ["storageKey"], unique = true),
        Index(value = ["workspaceId", "updatedAtMillis", "mediaAssetId"]),
        Index(value = ["workspaceId", "sha256", "mediaAssetId"])
    ]
)
data class MediaAssetEntity(
    @PrimaryKey val mediaAssetId: String,
    val workspaceId: String,
    val mimeType: String,
    val sizeBytes: Long,
    val sha256: String,
    val storageKey: String,
    val sourceUrl: String?,
    val createdAtMillis: Long,
    val clientUpdatedAtMillis: Long,
    val lastModifiedByReplicaId: String,
    val lastOperationId: String,
    val updatedAtMillis: Long,
    val deletedAtMillis: Long?
)
