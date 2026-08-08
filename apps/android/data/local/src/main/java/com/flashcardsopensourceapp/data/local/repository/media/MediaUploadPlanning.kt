package com.flashcardsopensourceapp.data.local.repository.media

import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadPart
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferQueueItem
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.model.media.normalizeMediaSha256
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.buildClientWorkspaceReplicaId
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest

private const val mediaUploadPartSizeBytes: Long = 8_388_608L

internal data class MediaUploadFilePlan(
    val file: File,
    val sizeBytes: Long,
    val sha256: String,
    val partSizeBytes: Long,
    val parts: List<MediaUploadFilePart>
) {
    init {
        require(sizeBytes > 0L) {
            "Media upload file plan sizeBytes must be positive."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media upload file plan sha256 must already be normalized."
        }
        require(partSizeBytes > 0L) {
            "Media upload file plan partSizeBytes must be positive."
        }
        require(parts.isNotEmpty()) {
            "Media upload file plan parts must not be empty."
        }
    }
}

internal data class MediaUploadFilePart(
    val partNumber: Int,
    val offsetBytes: Long,
    val sizeBytes: Long,
    val sha256: String
) {
    init {
        require(partNumber > 0) {
            "Media upload file part partNumber must be positive."
        }
        require(offsetBytes >= 0L) {
            "Media upload file part offsetBytes must not be negative."
        }
        require(sizeBytes > 0L) {
            "Media upload file part sizeBytes must be positive."
        }
        require(sizeBytes <= Int.MAX_VALUE.toLong()) {
            "Media upload file part sizeBytes must fit in memory."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media upload file part sha256 must already be normalized."
        }
    }
}

internal class MediaUploadTransferPermanentException(
    message: String,
    cause: Throwable?
) : IllegalStateException(message, cause)

internal suspend fun planUploadFile(
    transfer: MediaTransferQueueItem,
    mediaFileRootDirectory: File,
    ioDispatcher: CoroutineDispatcher
): MediaUploadFilePlan {
    if (transfer.kind != MediaTransferKind.UPLOAD) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' has unexpected kind '${transfer.kind.wireKey}'.",
            cause = null
        )
    }
    if (transfer.status != MediaTransferStatus.IN_PROGRESS) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' must be in_progress before upload.",
            cause = null
        )
    }
    if (transfer.localRelativePath != buildMediaBlobCacheRelativePath(sha256 = transfer.sha256)) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' local path does not match SHA-256.",
            cause = null
        )
    }

    return withContext(ioDispatcher) {
        planUploadFileBlocking(
            transfer = transfer,
            mediaFileRootDirectory = mediaFileRootDirectory
        )
    }
}

private fun planUploadFileBlocking(
    transfer: MediaTransferQueueItem,
    mediaFileRootDirectory: File
): MediaUploadFilePlan {
    val uploadFile: File = resolveUploadFile(
        mediaFileRootDirectory = mediaFileRootDirectory,
        localRelativePath = transfer.localRelativePath
    )
    if (uploadFile.exists().not()) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload file is missing: ${uploadFile.absolutePath}",
            cause = null
        )
    }
    if (uploadFile.isFile.not()) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload path is not a file: ${uploadFile.absolutePath}",
            cause = null
        )
    }
    if (uploadFile.length() <= 0L) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload file must not be empty: ${uploadFile.absolutePath}",
            cause = null
        )
    }
    if (uploadFile.length() != transfer.sizeBytes) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload size mismatch for transfer '${transfer.transferId}': " +
                "queue sizeBytes=${transfer.sizeBytes} file sizeBytes=${uploadFile.length()}.",
            cause = null
        )
    }

    return try {
        buildUploadFilePlan(
            file = uploadFile,
            expectedSha256 = transfer.sha256,
            expectedSizeBytes = transfer.sizeBytes
        )
    } catch (error: IOException) {
        throw MediaUploadTransferPermanentException(
            message = "Cannot read managed media upload file '${uploadFile.absolutePath}': " +
                (error.message ?: error::class.java.simpleName),
            cause = error
        )
    }
}

internal fun buildUploadSessionCreateRequest(
    transfer: MediaTransferQueueItem,
    uploadFilePlan: MediaUploadFilePlan,
    cloudSettings: CloudSettings
): MediaAssetUploadSessionCreateRequest {
    return MediaAssetUploadSessionCreateRequest(
        mediaAssetId = transfer.mediaAssetId,
        mimeType = transfer.mimeType,
        sizeBytes = uploadFilePlan.sizeBytes,
        sha256 = uploadFilePlan.sha256,
        partSizeBytes = uploadFilePlan.partSizeBytes,
        partCount = uploadFilePlan.parts.size,
        sourceUrl = null,
        createdAtMillis = transfer.createdAtMillis,
        clientUpdatedAtMillis = transfer.updatedAtMillis,
        lastModifiedByReplicaId = buildClientWorkspaceReplicaId(
            workspaceId = transfer.workspaceId,
            installationId = cloudSettings.installationId
        ),
        lastOperationId = transfer.transferId
    )
}

internal fun buildUploadPartUrlsRequest(
    parts: List<MediaUploadFilePart>
): MediaAssetUploadPartUrlsRequest {
    return MediaAssetUploadPartUrlsRequest(
        parts = parts.map { part ->
            MediaAssetUploadPartRequest(
                partNumber = part.partNumber,
                sha256 = part.sha256
            )
        }
    )
}

internal fun buildUploadCompletionRequest(
    parts: List<CompleteMediaAssetUploadPart>
): CompleteMediaAssetUploadSessionRequest {
    return CompleteMediaAssetUploadSessionRequest(
        parts = parts.sortedBy { part -> part.partNumber }
    )
}

internal suspend fun readUploadPartBytes(
    file: File,
    part: MediaUploadFilePart,
    ioDispatcher: CoroutineDispatcher
): ByteArray {
    return withContext(ioDispatcher) {
        readUploadPartBytesBlocking(
            file = file,
            part = part
        )
    }
}

private fun readUploadPartBytesBlocking(
    file: File,
    part: MediaUploadFilePart
): ByteArray {
    return try {
        RandomAccessFile(file, "r").use { randomAccessFile ->
            randomAccessFile.seek(part.offsetBytes)
            val bytes = ByteArray(size = part.sizeBytes.toInt())
            randomAccessFile.readFully(bytes)
            bytes
        }
    } catch (error: EOFException) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload file ended before partNumber=${part.partNumber}.",
            cause = error
        )
    } catch (error: IOException) {
        throw MediaUploadTransferPermanentException(
            message = "Cannot read managed media upload partNumber=${part.partNumber}: " +
                (error.message ?: error::class.java.simpleName),
            cause = error
        )
    }
}

private fun resolveUploadFile(
    mediaFileRootDirectory: File,
    localRelativePath: String
): File {
    val rootDirectory: File = mediaFileRootDirectory.canonicalFile
    val uploadFile: File = File(rootDirectory, localRelativePath).canonicalFile
    val rootPath: String = rootDirectory.path
    val uploadFilePath: String = uploadFile.path
    if (uploadFilePath != rootPath && uploadFilePath.startsWith(prefix = "$rootPath${File.separator}").not()) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload path escapes file root: root='$rootPath' relativePath='$localRelativePath'.",
            cause = null
        )
    }
    return uploadFile
}

private fun buildUploadFilePlan(
    file: File,
    expectedSha256: String,
    expectedSizeBytes: Long
): MediaUploadFilePlan {
    val fullDigest: MessageDigest = MessageDigest.getInstance("SHA-256")
    var partDigest: MessageDigest = MessageDigest.getInstance("SHA-256")
    val parts = mutableListOf<MediaUploadFilePart>()
    val buffer = ByteArray(size = 64 * 1024)
    var totalSizeBytes = 0L
    var currentPartSizeBytes = 0L
    var currentPartOffsetBytes = 0L
    var currentPartNumber = 1

    FileInputStream(file).use { input ->
        while (true) {
            val readByteCount: Int = input.read(buffer)
            if (readByteCount == -1) {
                break
            }

            var consumedByteCount = 0
            while (consumedByteCount < readByteCount) {
                val remainingReadBytes: Int = readByteCount - consumedByteCount
                val remainingPartBytes: Long = mediaUploadPartSizeBytes - currentPartSizeBytes
                val chunkByteCount: Int = minOf(remainingReadBytes, remainingPartBytes.toInt())
                fullDigest.update(buffer, consumedByteCount, chunkByteCount)
                partDigest.update(buffer, consumedByteCount, chunkByteCount)
                consumedByteCount += chunkByteCount
                currentPartSizeBytes += chunkByteCount.toLong()
                totalSizeBytes += chunkByteCount.toLong()

                if (currentPartSizeBytes == mediaUploadPartSizeBytes) {
                    parts += MediaUploadFilePart(
                        partNumber = currentPartNumber,
                        offsetBytes = currentPartOffsetBytes,
                        sizeBytes = currentPartSizeBytes,
                        sha256 = encodeDigestHex(bytes = partDigest.digest())
                    )
                    currentPartNumber += 1
                    currentPartOffsetBytes = totalSizeBytes
                    currentPartSizeBytes = 0L
                    partDigest = MessageDigest.getInstance("SHA-256")
                }
            }
        }
    }

    if (currentPartSizeBytes > 0L) {
        parts += MediaUploadFilePart(
            partNumber = currentPartNumber,
            offsetBytes = currentPartOffsetBytes,
            sizeBytes = currentPartSizeBytes,
            sha256 = encodeDigestHex(bytes = partDigest.digest())
        )
    }

    val computedSha256: String = encodeDigestHex(bytes = fullDigest.digest())
    if (totalSizeBytes != expectedSizeBytes) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload size changed while reading: " +
                "expected $expectedSizeBytes byte(s), read $totalSizeBytes byte(s).",
            cause = null
        )
    }
    if (computedSha256 != expectedSha256) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload SHA-256 mismatch: expected '$expectedSha256' but read '$computedSha256'.",
            cause = null
        )
    }

    return MediaUploadFilePlan(
        file = file,
        sizeBytes = totalSizeBytes,
        sha256 = computedSha256,
        partSizeBytes = mediaUploadPartSizeBytes,
        parts = parts
    )
}

private fun encodeDigestHex(bytes: ByteArray): String {
    val hexChars = "0123456789abcdef".toCharArray()
    val result = CharArray(size = bytes.size * 2)
    bytes.forEachIndexed { index, byte ->
        val value: Int = byte.toInt() and 0xff
        result[index * 2] = hexChars[value ushr 4]
        result[(index * 2) + 1] = hexChars[value and 0x0f]
    }
    return String(result)
}
