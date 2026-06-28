package com.flashcardsopensourceapp.data.local.model.media

data class MediaAsset(
    val mediaAssetId: String,
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
