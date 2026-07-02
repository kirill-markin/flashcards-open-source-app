package com.flashcardsopensourceapp.data.local.database.entities

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "media_blob_cache",
    indices = [
        Index(value = ["localRelativePath"], unique = true),
        Index(value = ["sourceMediaAssetId"]),
        Index(value = ["lastAccessedAtMillis"])
    ]
)
data class MediaBlobCacheEntity(
    @PrimaryKey val sha256: String,
    val mimeType: String,
    val sizeBytes: Long,
    val localRelativePath: String,
    val createdAtMillis: Long,
    val lastAccessedAtMillis: Long,
    val sourceMediaAssetId: String?
)

@Entity(
    tableName = "media_transfer_queue",
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
        Index(value = ["workspaceId", "status", "nextAttemptAtMillis", "createdAtMillis"]),
        Index(value = ["sha256"]),
        Index(value = ["mediaAssetId"])
    ]
)
data class MediaTransferQueueEntity(
    @PrimaryKey val transferId: String,
    val workspaceId: String,
    val mediaAssetId: String,
    val kind: String,
    val status: String,
    val sha256: String,
    val mimeType: String,
    val sizeBytes: Long,
    val localRelativePath: String,
    val attemptCount: Int,
    val nextAttemptAtMillis: Long,
    val lastError: String?,
    val createdAtMillis: Long,
    val updatedAtMillis: Long
)
