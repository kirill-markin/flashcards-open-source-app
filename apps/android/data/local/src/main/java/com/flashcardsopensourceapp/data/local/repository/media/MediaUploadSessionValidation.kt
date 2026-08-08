package com.flashcardsopensourceapp.data.local.repository.media

import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrl
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSession
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferQueueItem
import java.io.IOException

internal class MediaUploadTransferSessionExpiredException(
    message: String,
    cause: Throwable?
) : IOException(message, cause)

internal fun requireUploadTransferCanUseSession(
    transfer: MediaTransferQueueItem,
    cloudSettings: CloudSettings
) {
    val activeWorkspaceId: String? = cloudSettings.activeWorkspaceId
        ?: cloudSettings.linkedWorkspaceId
    if (activeWorkspaceId != transfer.workspaceId) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' targets workspace " +
                "'${transfer.workspaceId}', but active cloud workspace is '$activeWorkspaceId'.",
            cause = null
        )
    }
}

internal fun requireCreateResponseMatchesTransfer(
    createResponse: MediaAssetUploadSessionCreateResponse,
    transfer: MediaTransferQueueItem
) {
    if (createResponse.workspaceId != transfer.workspaceId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload create workspaceId: " +
                "expected '${transfer.workspaceId}', got '${createResponse.workspaceId}'."
        )
    }
    if (createResponse.mediaAssetId != transfer.mediaAssetId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload create mediaAssetId: " +
                "expected '${transfer.mediaAssetId}', got '${createResponse.mediaAssetId}'."
        )
    }
}

internal fun requireUploadSessionMatchesPlan(
    uploadSession: MediaAssetUploadSession,
    uploadFilePlan: MediaUploadFilePlan,
    currentTimeMillis: Long
) {
    if (uploadSession.partSizeBytes != uploadFilePlan.partSizeBytes) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload session partSizeBytes: " +
                "expected ${uploadFilePlan.partSizeBytes}, got ${uploadSession.partSizeBytes}."
        )
    }
    if (uploadSession.partCount != uploadFilePlan.parts.size) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload session partCount: " +
                "expected ${uploadFilePlan.parts.size}, got ${uploadSession.partCount}."
        )
    }
    requireUploadSessionNotExpired(
        uploadSession = uploadSession,
        currentTimeMillis = currentTimeMillis
    )
}

internal fun requireUploadSessionNotExpired(
    uploadSession: MediaAssetUploadSession,
    currentTimeMillis: Long
) {
    if (uploadSession.expiresAtMillis <= currentTimeMillis) {
        throw MediaUploadTransferSessionExpiredException(
            message = "Media upload session '${uploadSession.sessionId}' is expired.",
            cause = null
        )
    }
}

internal fun requirePartUrlNotExpired(
    partUrl: MediaAssetUploadPartUrl,
    currentTimeMillis: Long
) {
    if (partUrl.expiresAtMillis <= currentTimeMillis) {
        throw MediaUploadTransferSessionExpiredException(
            message = "Media upload part URL for partNumber=${partUrl.partNumber} is expired.",
            cause = null
        )
    }
}

internal fun requirePartUrlsMatchRequest(
    partUrlsResponse: MediaAssetUploadPartUrlsResponse,
    uploadSession: MediaAssetUploadSession,
    requestedParts: List<MediaUploadFilePart>
): Map<Int, MediaAssetUploadPartUrl> {
    if (partUrlsResponse.sessionId != uploadSession.sessionId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload part URLs sessionId: " +
                "expected '${uploadSession.sessionId}', got '${partUrlsResponse.sessionId}'."
        )
    }
    val expectedPartNumbers: Set<Int> = requestedParts.map { part -> part.partNumber }.toSet()
    val actualPartNumbers: Set<Int> = partUrlsResponse.partUrls.map { partUrl -> partUrl.partNumber }.toSet()
    if (actualPartNumbers != expectedPartNumbers) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload part URLs: " +
                "expected partNumbers=$expectedPartNumbers, got partNumbers=$actualPartNumbers."
        )
    }
    return partUrlsResponse.partUrls.associateBy { partUrl -> partUrl.partNumber }
}

internal fun requireMediaAssetMatchesTransfer(
    mediaAsset: MediaAsset,
    transfer: MediaTransferQueueItem
) {
    if (mediaAsset.mediaAssetId != transfer.mediaAssetId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset id: " +
                "expected '${transfer.mediaAssetId}', got '${mediaAsset.mediaAssetId}'."
        )
    }
    if (mediaAsset.workspaceId != transfer.workspaceId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset workspaceId: " +
                "expected '${transfer.workspaceId}', got '${mediaAsset.workspaceId}'."
        )
    }
    if (mediaAsset.sha256 != transfer.sha256) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset sha256: " +
                "expected '${transfer.sha256}', got '${mediaAsset.sha256}'."
        )
    }
    if (mediaAsset.sizeBytes != transfer.sizeBytes) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset sizeBytes: " +
                "expected ${transfer.sizeBytes}, got ${mediaAsset.sizeBytes}."
        )
    }
    if (mediaAsset.mimeType != transfer.mimeType) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset mimeType: " +
                "expected '${transfer.mimeType}', got '${mediaAsset.mimeType}'."
        )
    }
    if (mediaAsset.deletedAtMillis != null) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset deletedAtMillis: expected null, got ${mediaAsset.deletedAtMillis}."
        )
    }
}
