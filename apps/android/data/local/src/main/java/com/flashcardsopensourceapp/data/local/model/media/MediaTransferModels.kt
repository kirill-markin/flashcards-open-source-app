package com.flashcardsopensourceapp.data.local.model.media

import java.util.Locale

private val mediaSha256Pattern: Regex = Regex("^[0-9a-f]{64}$")

fun normalizeMediaSha256(rawSha256: String): String {
    val normalizedSha256: String = rawSha256.trim().lowercase(Locale.US)
    require(mediaSha256Pattern.matches(normalizedSha256)) {
        "Media SHA-256 must be exactly 64 lowercase hexadecimal characters after normalization."
    }
    return normalizedSha256
}

fun buildMediaBlobCacheRelativePath(sha256: String): String {
    val normalizedSha256: String = normalizeMediaSha256(rawSha256 = sha256)
    return "media/blobs/sha256/${normalizedSha256.substring(0, 2)}/${normalizedSha256.substring(2, 4)}/$normalizedSha256"
}

data class MediaBlobCache(
    val sha256: String,
    val mimeType: String,
    val sizeBytes: Long,
    val localRelativePath: String,
    val createdAtMillis: Long,
    val lastAccessedAtMillis: Long,
    val sourceMediaAssetId: String?
) {
    init {
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media blob cache sha256 must already be normalized."
        }
        require(mimeType.isNotBlank()) {
            "Media blob cache mimeType must not be blank."
        }
        require(sizeBytes >= 0L) {
            "Media blob cache sizeBytes must not be negative."
        }
        require(localRelativePath == buildMediaBlobCacheRelativePath(sha256 = sha256)) {
            "Media blob cache localRelativePath must match the deterministic SHA-256 path."
        }
    }
}

enum class MediaTransferKind(
    val wireKey: String
) {
    UPLOAD("upload"),
    DOWNLOAD("download");

    companion object {
        private val orderedEntries: List<MediaTransferKind> = listOf(
            UPLOAD,
            DOWNLOAD
        )

        fun fromWireKey(wireKey: String): MediaTransferKind {
            return orderedEntries.firstOrNull { kind -> kind.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown media transfer kind '$wireKey'.")
        }
    }
}

enum class MediaTransferStatus(
    val wireKey: String
) {
    QUEUED("queued"),
    IN_PROGRESS("in_progress"),
    SUCCEEDED("succeeded"),
    FAILED("failed"),
    ABORTED("aborted");

    companion object {
        private val orderedEntries: List<MediaTransferStatus> = listOf(
            QUEUED,
            IN_PROGRESS,
            SUCCEEDED,
            FAILED,
            ABORTED
        )

        fun fromWireKey(wireKey: String): MediaTransferStatus {
            return orderedEntries.firstOrNull { status -> status.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown media transfer status '$wireKey'.")
        }
    }
}

data class MediaTransferQueueItem(
    val transferId: String,
    val workspaceId: String,
    val mediaAssetId: String,
    val kind: MediaTransferKind,
    val status: MediaTransferStatus,
    val sha256: String,
    val mimeType: String,
    val sizeBytes: Long,
    val localRelativePath: String,
    val attemptCount: Int,
    val nextAttemptAtMillis: Long,
    val lastError: String?,
    val createdAtMillis: Long,
    val updatedAtMillis: Long
) {
    init {
        require(transferId.isNotBlank()) {
            "Media transfer queue item transferId must not be blank."
        }
        require(workspaceId.isNotBlank()) {
            "Media transfer queue item workspaceId must not be blank."
        }
        require(mediaAssetId.isNotBlank()) {
            "Media transfer queue item mediaAssetId must not be blank."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media transfer queue item sha256 must already be normalized."
        }
        require(mimeType.isNotBlank()) {
            "Media transfer queue item mimeType must not be blank."
        }
        require(sizeBytes >= 0L) {
            "Media transfer queue item sizeBytes must not be negative."
        }
        require(localRelativePath == buildMediaBlobCacheRelativePath(sha256 = sha256)) {
            "Media transfer queue item localRelativePath must match the deterministic SHA-256 path."
        }
        require(attemptCount >= 0) {
            "Media transfer queue item attemptCount must not be negative."
        }
    }
}

data class MediaAssetUploadSessionCreateRequest(
    val mediaAssetId: String,
    val mimeType: String,
    val sizeBytes: Long,
    val sha256: String,
    val partSizeBytes: Long,
    val partCount: Int,
    val sourceUrl: String?,
    val createdAtMillis: Long,
    val clientUpdatedAtMillis: Long,
    val lastModifiedByReplicaId: String,
    val lastOperationId: String
) {
    init {
        require(mediaAssetId.isNotBlank()) {
            "Media asset upload session create request mediaAssetId must not be blank."
        }
        require(mimeType.isNotBlank()) {
            "Media asset upload session create request mimeType must not be blank."
        }
        require(sizeBytes > 0L) {
            "Media asset upload session create request sizeBytes must be positive."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media asset upload session create request sha256 must already be normalized."
        }
        require(partSizeBytes > 0L) {
            "Media asset upload session create request partSizeBytes must be positive."
        }
        require(partCount > 0) {
            "Media asset upload session create request partCount must be positive."
        }
        require(lastModifiedByReplicaId.isNotBlank()) {
            "Media asset upload session create request lastModifiedByReplicaId must not be blank."
        }
        require(lastOperationId.isNotBlank()) {
            "Media asset upload session create request lastOperationId must not be blank."
        }
    }
}

enum class MediaAssetUploadSessionCreateStatus(
    val wireKey: String
) {
    ALREADY_AVAILABLE("already_available"),
    UPLOAD_REQUIRED("upload_required");

    companion object {
        private val orderedEntries: List<MediaAssetUploadSessionCreateStatus> = listOf(
            ALREADY_AVAILABLE,
            UPLOAD_REQUIRED
        )

        fun fromWireKey(wireKey: String): MediaAssetUploadSessionCreateStatus {
            return orderedEntries.firstOrNull { status -> status.wireKey == wireKey }
                ?: throw IllegalArgumentException("Unknown media asset upload session status '$wireKey'.")
        }
    }
}

data class MediaAssetUploadSession(
    val sessionId: String,
    val expiresAtMillis: Long,
    val partSizeBytes: Long,
    val partCount: Int
) {
    init {
        require(sessionId.isNotBlank()) {
            "Media asset upload session sessionId must not be blank."
        }
        require(partSizeBytes > 0L) {
            "Media asset upload session partSizeBytes must be positive."
        }
        require(partCount > 0) {
            "Media asset upload session partCount must be positive."
        }
    }
}

data class MediaAssetUploadSessionCreateResponse(
    val workspaceId: String,
    val mediaAssetId: String,
    val status: MediaAssetUploadSessionCreateStatus,
    val mediaAsset: MediaAsset?,
    val uploadSession: MediaAssetUploadSession?
)

data class MediaAssetUploadPartRequest(
    val partNumber: Int,
    val sha256: String
) {
    init {
        require(partNumber > 0) {
            "Media asset upload part request partNumber must be positive."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media asset upload part request sha256 must already be normalized."
        }
    }
}

data class MediaAssetUploadPartUrlsRequest(
    val parts: List<MediaAssetUploadPartRequest>
) {
    init {
        require(parts.isNotEmpty()) {
            "Media asset upload part URL request parts must not be empty."
        }
    }
}

data class MediaAssetUploadPartUrl(
    val partNumber: Int,
    val method: String,
    val url: String,
    val expiresAtMillis: Long,
    val headers: Map<String, String>
) {
    init {
        require(partNumber > 0) {
            "Media asset upload part URL partNumber must be positive."
        }
        require(method == "PUT") {
            "Media asset upload part URL method must be PUT."
        }
        require(url.isNotBlank()) {
            "Media asset upload part URL url must not be blank."
        }
    }
}

data class MediaAssetUploadPartUrlsResponse(
    val sessionId: String,
    val partUrls: List<MediaAssetUploadPartUrl>
) {
    init {
        require(sessionId.isNotBlank()) {
            "Media asset upload part URLs response sessionId must not be blank."
        }
        require(partUrls.isNotEmpty()) {
            "Media asset upload part URLs response partUrls must not be empty."
        }
    }
}

data class CompleteMediaAssetUploadPart(
    val partNumber: Int,
    val eTag: String,
    val sha256: String
) {
    init {
        require(partNumber > 0) {
            "Complete media asset upload part partNumber must be positive."
        }
        require(eTag.isNotBlank()) {
            "Complete media asset upload part eTag must not be blank."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Complete media asset upload part sha256 must already be normalized."
        }
    }
}

data class CompleteMediaAssetUploadSessionRequest(
    val parts: List<CompleteMediaAssetUploadPart>
) {
    init {
        require(parts.isNotEmpty()) {
            "Complete media asset upload session request parts must not be empty."
        }
    }
}

data class MediaAssetUploadCompletion(
    val mediaAsset: MediaAsset,
    val applied: Boolean
)

data class MediaAssetUploadSessionAbort(
    val sessionId: String,
    val abortedAtMillis: Long
) {
    init {
        require(sessionId.isNotBlank()) {
            "Media asset upload session abort sessionId must not be blank."
        }
    }
}
