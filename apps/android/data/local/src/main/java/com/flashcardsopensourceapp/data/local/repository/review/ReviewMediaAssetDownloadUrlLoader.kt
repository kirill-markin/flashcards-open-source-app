package com.flashcardsopensourceapp.data.local.repository.review

import android.util.Log
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.normalizeMediaSha256
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

private const val reviewMediaAssetDownloadLogTag: String = "ReviewMediaDownload"
private const val reviewMediaAssetDownloadMaxAttemptCount: Int = 3
private const val reviewMediaAssetDownloadRetryBaseDelayMillis: Long = 500L
private const val reviewMediaAssetDownloadErrorBodyLimit: Int = 4_096
private const val reviewMediaAssetDownloadRangeChunkSizeBytes: Long = 1024L * 1024L
private const val reviewMediaAssetDownloadBufferSizeBytes: Int = 16 * 1024
private val reviewMediaAssetContentRangePattern: Regex = Regex("^bytes (\\d+)-(\\d+)/(\\d+)$")

data class DownloadedReviewMediaAsset(
    val sizeBytes: Long,
    val sha256: String
) {
    init {
        require(sizeBytes >= 0L) {
            "Downloaded review media asset sizeBytes must not be negative."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Downloaded review media asset sha256 must already be normalized."
        }
    }
}

interface ReviewMediaAssetDownloader {
    suspend fun downloadMediaAsset(
        url: String,
        targetFile: File,
        expectedSizeBytes: Long,
        expectedSha256: String
    ): DownloadedReviewMediaAsset
}

class OkHttpReviewMediaAssetDownloader(
    okHttpClient: OkHttpClient
) : ReviewMediaAssetDownloader {
    private val httpClient: OkHttpClient = okHttpClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    override suspend fun downloadMediaAsset(
        url: String,
        targetFile: File,
        expectedSizeBytes: Long,
        expectedSha256: String
    ): DownloadedReviewMediaAsset {
        require(url.isNotBlank()) {
            "Managed media download URL must not be blank."
        }
        require(expectedSizeBytes >= 0L) {
            "Managed media download expected sizeBytes must not be negative."
        }
        val normalizedExpectedSha256: String = normalizeMediaSha256(rawSha256 = expectedSha256)

        return withContext(Dispatchers.IO) {
            var attemptNumber = 1
            while (attemptNumber <= reviewMediaAssetDownloadMaxAttemptCount) {
                currentCoroutineContext().ensureActive()
                try {
                    return@withContext downloadMediaAssetAttempt(
                        url = url,
                        targetFile = targetFile,
                        expectedSizeBytes = expectedSizeBytes,
                        expectedSha256 = normalizedExpectedSha256
                    )
                } catch (error: IOException) {
                    currentCoroutineContext().ensureActive()
                    val shouldRetry = shouldRetryReviewMediaDownloadError(
                        error = error,
                        attemptNumber = attemptNumber
                    )
                    if (shouldRetry.not()) {
                        throw error
                    }

                    val delayMillis = calculateReviewMediaDownloadRetryDelayMillis(
                        attemptNumber = attemptNumber
                    )
                    Log.w(
                        reviewMediaAssetDownloadLogTag,
                        "event=review_media_download_retry attemptNumber=$attemptNumber " +
                            "delayMs=$delayMillis errorType=${error::class.java.simpleName}",
                        error
                    )
                    delay(delayMillis)
                    attemptNumber += 1
                }
            }

            throw IllegalStateException("Managed media download retry loop exited without a terminal result.")
        }
    }

    private suspend fun downloadMediaAssetAttempt(
        url: String,
        targetFile: File,
        expectedSizeBytes: Long,
        expectedSha256: String
    ): DownloadedReviewMediaAsset {
        val parentDirectory = targetFile.parentFile
        require(parentDirectory != null) {
            "Managed media download target file must have a parent directory: ${targetFile.absolutePath}"
        }
        if (parentDirectory.exists().not() && parentDirectory.mkdirs().not()) {
            throw IOException("Cannot create managed media download directory: ${parentDirectory.absolutePath}")
        }
        if (targetFile.exists() && targetFile.delete().not()) {
            throw IOException("Cannot replace managed media download target file: ${targetFile.absolutePath}")
        }
        val partialFile = resolvePartialReviewMediaDownloadFile(targetFile = targetFile)
        val shouldRestartAfterResumedValidationFailure: Boolean =
            hasNonEmptyPartialReviewMediaDownload(partialFile = partialFile)
        var restartedAfterResumedValidationFailure = false

        while (true) {
            try {
                if (expectedSizeBytes == 0L) {
                    createEmptyPartialReviewMediaDownload(partialFile = partialFile)
                } else {
                    while (true) {
                        currentCoroutineContext().ensureActive()
                        val partialSizeBytes = checkedPartialReviewMediaDownloadSizeBytes(
                            partialFile = partialFile,
                            expectedSizeBytes = expectedSizeBytes
                        )
                        if (partialSizeBytes == expectedSizeBytes) {
                            break
                        }

                        val range = createReviewMediaDownloadRange(
                            startByte = partialSizeBytes,
                            expectedSizeBytes = expectedSizeBytes
                        )
                        downloadReviewMediaRange(
                            url = url,
                            partialFile = partialFile,
                            range = range,
                            expectedSizeBytes = expectedSizeBytes
                        )
                    }
                }

                return completePartialReviewMediaDownload(
                    partialFile = partialFile,
                    targetFile = targetFile,
                    expectedSizeBytes = expectedSizeBytes,
                    expectedSha256 = expectedSha256
                )
            } catch (error: ReviewMediaAssetDownloadValidationException) {
                deletePartialReviewMediaDownload(partialFile = partialFile, cause = error)
                if (shouldRestartAfterResumedValidationFailure && restartedAfterResumedValidationFailure.not()) {
                    restartedAfterResumedValidationFailure = true
                    currentCoroutineContext().ensureActive()
                    continue
                }
                throw error
            }
        }
    }

    private suspend fun downloadReviewMediaRange(
        url: String,
        partialFile: File,
        range: ReviewMediaDownloadRange,
        expectedSizeBytes: Long
    ): Unit {
        val rangeHeader = formatReviewMediaDownloadRangeHeader(range = range)
        val request: Request = Request.Builder()
            .url(url)
            .get()
            .header("Range", rangeHeader)
            .build()

        httpClient.newCall(request).awaitOkHttpResponse().use { response ->
            when (response.code) {
                206 -> {
                    validatePartialReviewMediaDownloadResponse(
                        response = response,
                        range = range,
                        expectedSizeBytes = expectedSizeBytes
                    )
                    streamReviewMediaResponseToPartialFile(
                        response = response,
                        partialFile = partialFile,
                        writeStartByte = range.startByte,
                        expectedResponseSizeBytes = range.sizeBytes,
                        expectedTotalSizeBytes = expectedSizeBytes,
                        rangeHeader = rangeHeader
                    )
                }

                200 -> {
                    validateFullReviewMediaDownloadResponse(
                        response = response,
                        range = range,
                        expectedSizeBytes = expectedSizeBytes
                    )
                    resetPartialReviewMediaDownloadFile(
                        partialFile = partialFile,
                        rangeHeader = rangeHeader
                    )
                    streamReviewMediaResponseToPartialFile(
                        response = response,
                        partialFile = partialFile,
                        writeStartByte = 0L,
                        expectedResponseSizeBytes = expectedSizeBytes,
                        expectedTotalSizeBytes = expectedSizeBytes,
                        rangeHeader = rangeHeader
                    )
                }

                else -> {
                    if (response.isSuccessful.not()) {
                        throw ReviewMediaAssetDownloadHttpException(
                            statusCode = response.code,
                            responseBody = readReviewMediaDownloadErrorBody(response = response),
                            retryEligible = isTransientReviewMediaDownloadStatusCode(statusCode = response.code)
                        )
                    }
                    throw ReviewMediaAssetDownloadValidationException(
                        "Managed media download received unexpected HTTP statusCode=${response.code} " +
                            "for requested Range='$rangeHeader'."
                    )
                }
            }
        }
    }
}

interface ReviewMediaAssetDownloadUrlLoader {
    suspend fun loadMediaAssetDownloadUrl(workspaceId: String, mediaAssetId: String): MediaAssetDownloadUrl
}

class CloudReviewMediaAssetDownloadUrlLoader(
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    resetCoordinator: CloudIdentityResetCoordinator
) : ReviewMediaAssetDownloadUrlLoader {
    private val sessionProvider = CloudSessionProvider(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator
    )

    override suspend fun loadMediaAssetDownloadUrl(
        workspaceId: String,
        mediaAssetId: String
    ): MediaAssetDownloadUrl {
        return operationCoordinator.runExclusive {
            val session = reviewMediaCloudSession(workspaceId = workspaceId)
            remoteService.loadMediaAssetDownloadUrl(
                apiBaseUrl = session.apiBaseUrl,
                authorizationHeader = session.authorizationHeader,
                workspaceId = workspaceId,
                mediaAssetId = mediaAssetId
            )
        }
    }

    private suspend fun reviewMediaCloudSession(workspaceId: String): ReviewMediaCloudSession {
        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val activeWorkspaceId = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
        require(activeWorkspaceId == workspaceId) {
            "Managed media download requires active workspace '$workspaceId', " +
                "but cloud settings point to '$activeWorkspaceId'."
        }

        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
                ReviewMediaCloudSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}"
                )
            }

            CloudAccountState.GUEST -> {
                val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
                val guestSession: StoredGuestAiSession = requireNotNull(
                    loadActiveGuestSessionOrNull(
                        preferencesStore = preferencesStore,
                        guestSessionStore = guestSessionStore,
                        configuration = configuration
                    )
                ) {
                    "Managed media download requires an active guest session."
                }
                require(guestSession.workspaceId == workspaceId) {
                    "Managed media download requires guest workspace '$workspaceId', " +
                        "but the stored guest session points to '${guestSession.workspaceId}'."
                }
                ReviewMediaCloudSession(
                    apiBaseUrl = guestSession.apiBaseUrl,
                    authorizationHeader = "Guest ${guestSession.guestToken}"
                )
            }

            CloudAccountState.DISCONNECTED,
            CloudAccountState.LINKING_READY -> throw IllegalStateException(
                "Managed media download requires a linked or guest cloud account."
            )
        }
    }
}

private data class ReviewMediaCloudSession(
    val apiBaseUrl: String,
    val authorizationHeader: String
)

private class ReviewMediaAssetDownloadHttpException(
    val statusCode: Int,
    val responseBody: String,
    val retryEligible: Boolean
) : IOException(
    "Managed media download failed with HTTP statusCode=$statusCode responseBody='$responseBody'."
)

private class ReviewMediaAssetDownloadValidationException(
    message: String
) : IOException(message)

private data class ReviewMediaDownloadRange(
    val startByte: Long,
    val endByteInclusive: Long
) {
    val sizeBytes: Long = endByteInclusive - startByte + 1L

    init {
        require(startByte >= 0L) {
            "Managed media download range startByte must not be negative."
        }
        require(endByteInclusive >= startByte) {
            "Managed media download range endByteInclusive must be greater than or equal to startByte."
        }
    }
}

private data class ReviewMediaContentRange(
    val startByte: Long,
    val endByteInclusive: Long,
    val completeSizeBytes: Long
)

private fun resolvePartialReviewMediaDownloadFile(targetFile: File): File {
    val parentDirectory: File = requireNotNull(targetFile.parentFile) {
        "Managed media download partial file target must have a parent directory: ${targetFile.absolutePath}"
    }
    return File(parentDirectory, "${targetFile.name}.partial")
}

private fun createEmptyPartialReviewMediaDownload(partialFile: File): Unit {
    if (partialFile.exists()) {
        if (partialFile.isFile.not()) {
            throw IOException("Managed media download partial path is not a file: ${partialFile.absolutePath}")
        }
        if (partialFile.length() == 0L) {
            return
        }
        val error = ReviewMediaAssetDownloadValidationException(
            "Managed media download expected an empty partial file but found ${partialFile.length()} byte(s): " +
                partialFile.absolutePath
        )
        deletePartialReviewMediaDownload(partialFile = partialFile, cause = error)
        throw error
    }
    if (partialFile.createNewFile().not()) {
        throw IOException("Cannot create empty managed media download partial file: ${partialFile.absolutePath}")
    }
}

private fun hasNonEmptyPartialReviewMediaDownload(partialFile: File): Boolean {
    return partialFile.exists() && partialFile.isFile && partialFile.length() > 0L
}

private fun checkedPartialReviewMediaDownloadSizeBytes(
    partialFile: File,
    expectedSizeBytes: Long
): Long {
    if (partialFile.exists().not()) {
        return 0L
    }
    if (partialFile.isFile.not()) {
        throw IOException("Managed media download partial path is not a file: ${partialFile.absolutePath}")
    }
    val partialSizeBytes = partialFile.length()
    if (partialSizeBytes > expectedSizeBytes) {
        val error = ReviewMediaAssetDownloadValidationException(
            "Managed media download partial file is larger than expected: expected at most " +
                "$expectedSizeBytes byte(s), found $partialSizeBytes byte(s) at ${partialFile.absolutePath}."
        )
        deletePartialReviewMediaDownload(partialFile = partialFile, cause = error)
        throw error
    }
    return partialSizeBytes
}

private fun createReviewMediaDownloadRange(
    startByte: Long,
    expectedSizeBytes: Long
): ReviewMediaDownloadRange {
    require(startByte >= 0L) {
        "Managed media download range startByte must not be negative."
    }
    require(startByte < expectedSizeBytes) {
        "Managed media download range startByte must be smaller than expectedSizeBytes."
    }
    val endByteInclusive = minOf(
        startByte + reviewMediaAssetDownloadRangeChunkSizeBytes - 1L,
        expectedSizeBytes - 1L
    )
    return ReviewMediaDownloadRange(
        startByte = startByte,
        endByteInclusive = endByteInclusive
    )
}

private fun formatReviewMediaDownloadRangeHeader(range: ReviewMediaDownloadRange): String {
    return "bytes=${range.startByte}-${range.endByteInclusive}"
}

private fun validatePartialReviewMediaDownloadResponse(
    response: Response,
    range: ReviewMediaDownloadRange,
    expectedSizeBytes: Long
): Unit {
    val rangeHeader = formatReviewMediaDownloadRangeHeader(range = range)
    validateReviewMediaDownloadContentLength(
        contentLength = response.body.contentLength(),
        expectedSizeBytes = range.sizeBytes,
        rangeHeader = rangeHeader
    )
    val contentRangeHeader: String = response.header("Content-Range")
        ?: throw ReviewMediaAssetDownloadValidationException(
            "Managed media download response is missing Content-Range for requested Range='$rangeHeader'."
        )
    val contentRange: ReviewMediaContentRange = parseReviewMediaContentRange(
        contentRangeHeader = contentRangeHeader,
        rangeHeader = rangeHeader
    )
    if (contentRange.startByte != range.startByte || contentRange.endByteInclusive != range.endByteInclusive) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download Content-Range mismatch for requested Range='$rangeHeader': " +
                "received '$contentRangeHeader'."
        )
    }
    if (contentRange.completeSizeBytes != expectedSizeBytes) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download Content-Range total mismatch for requested Range='$rangeHeader': " +
                "expected $expectedSizeBytes byte(s), received '$contentRangeHeader'."
        )
    }
}

private fun validateFullReviewMediaDownloadResponse(
    response: Response,
    range: ReviewMediaDownloadRange,
    expectedSizeBytes: Long
): Unit {
    validateReviewMediaDownloadContentLength(
        contentLength = response.body.contentLength(),
        expectedSizeBytes = expectedSizeBytes,
        rangeHeader = formatReviewMediaDownloadRangeHeader(range = range)
    )
}

private fun resetPartialReviewMediaDownloadFile(
    partialFile: File,
    rangeHeader: String
): Unit {
    if (partialFile.exists().not()) {
        return
    }
    if (partialFile.isFile.not()) {
        throw IOException(
            "Managed media download cannot restart full-object response for requested Range='$rangeHeader' " +
                "because the partial path is not a file: ${partialFile.absolutePath}"
        )
    }
    if (partialFile.delete().not()) {
        throw IOException(
            "Cannot restart managed media download full-object response for requested Range='$rangeHeader': " +
                "failed to delete partial file ${partialFile.absolutePath}."
        )
    }
}

private fun parseReviewMediaContentRange(
    contentRangeHeader: String,
    rangeHeader: String
): ReviewMediaContentRange {
    val match = reviewMediaAssetContentRangePattern.matchEntire(contentRangeHeader.trim())
        ?: throw ReviewMediaAssetDownloadValidationException(
            "Managed media download Content-Range header is invalid for requested Range='$rangeHeader': " +
                "received '$contentRangeHeader'."
        )
    val startByte: Long = match.groupValues[1].toLong()
    val endByteInclusive: Long = match.groupValues[2].toLong()
    val completeSizeBytes: Long = match.groupValues[3].toLong()
    if (endByteInclusive < startByte) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download Content-Range has an invalid byte order for requested Range='$rangeHeader': " +
                "received '$contentRangeHeader'."
        )
    }
    if (completeSizeBytes <= endByteInclusive) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download Content-Range total is too small for requested Range='$rangeHeader': " +
                "received '$contentRangeHeader'."
        )
    }
    return ReviewMediaContentRange(
        startByte = startByte,
        endByteInclusive = endByteInclusive,
        completeSizeBytes = completeSizeBytes
    )
}

private fun streamReviewMediaResponseToPartialFile(
    response: Response,
    partialFile: File,
    writeStartByte: Long,
    expectedResponseSizeBytes: Long,
    expectedTotalSizeBytes: Long,
    rangeHeader: String
): Unit {
    val currentPartialSizeBytes = partialFile.length()
    if (currentPartialSizeBytes != writeStartByte) {
        throw IOException(
            "Managed media download partial size changed before write for requested Range='$rangeHeader': " +
                "expected $writeStartByte byte(s), found $currentPartialSizeBytes byte(s)."
        )
    }
    var responseSizeBytes = 0L

    response.body.byteStream().use { input ->
        FileOutputStream(partialFile, true).use { output ->
            val buffer = ByteArray(size = reviewMediaAssetDownloadBufferSizeBytes)
            while (true) {
                val readByteCount = input.read(buffer)
                if (readByteCount == -1) {
                    break
                }
                val nextResponseSizeBytes = responseSizeBytes + readByteCount.toLong()
                if (nextResponseSizeBytes > expectedResponseSizeBytes) {
                    throw ReviewMediaAssetDownloadValidationException(
                        "Managed media download response exceeded requested Range='$rangeHeader': " +
                            "expected $expectedResponseSizeBytes byte(s), received at least " +
                            "$nextResponseSizeBytes byte(s)."
                    )
                }
                val nextTotalSizeBytes = writeStartByte + nextResponseSizeBytes
                if (nextTotalSizeBytes > expectedTotalSizeBytes) {
                    throw ReviewMediaAssetDownloadValidationException(
                        "Managed media download exceeded expected total size for requested Range='$rangeHeader': " +
                            "expected $expectedTotalSizeBytes byte(s), received at least " +
                            "$nextTotalSizeBytes byte(s)."
                    )
                }
                output.write(buffer, 0, readByteCount)
                responseSizeBytes = nextResponseSizeBytes
            }
        }
    }

    if (responseSizeBytes != expectedResponseSizeBytes) {
        throw IOException(
            "Managed media download response ended early for requested Range='$rangeHeader': " +
                "expected $expectedResponseSizeBytes byte(s), received $responseSizeBytes byte(s)."
        )
    }
}

private fun completePartialReviewMediaDownload(
    partialFile: File,
    targetFile: File,
    expectedSizeBytes: Long,
    expectedSha256: String
): DownloadedReviewMediaAsset {
    val downloadedMediaAsset = verifyPartialReviewMediaDownload(
        partialFile = partialFile,
        expectedSizeBytes = expectedSizeBytes,
        expectedSha256 = expectedSha256
    )

    if (targetFile.exists() && targetFile.delete().not()) {
        throw IOException("Cannot replace managed media download target file: ${targetFile.absolutePath}")
    }
    try {
        Files.move(
            partialFile.toPath(),
            targetFile.toPath(),
            StandardCopyOption.ATOMIC_MOVE
        )
    } catch (error: AtomicMoveNotSupportedException) {
        throw IOException(
            "Atomic managed media download move is not supported from partial file " +
                "'${partialFile.absolutePath}' to target file '${targetFile.absolutePath}'.",
            error
        )
    }
    return downloadedMediaAsset
}

private fun verifyPartialReviewMediaDownload(
    partialFile: File,
    expectedSizeBytes: Long,
    expectedSha256: String
): DownloadedReviewMediaAsset {
    if (partialFile.exists().not()) {
        throw IOException("Managed media download partial file does not exist: ${partialFile.absolutePath}")
    }
    if (partialFile.isFile.not()) {
        throw IOException("Managed media download partial path is not a file: ${partialFile.absolutePath}")
    }
    val digest = MessageDigest.getInstance("SHA-256")
    var sizeBytes = 0L

    partialFile.inputStream().use { input ->
        val buffer = ByteArray(size = reviewMediaAssetDownloadBufferSizeBytes)
        while (true) {
            val readByteCount = input.read(buffer)
            if (readByteCount == -1) {
                break
            }
            val nextSizeBytes = sizeBytes + readByteCount.toLong()
            if (nextSizeBytes > expectedSizeBytes) {
                throw ReviewMediaAssetDownloadValidationException(
                    "Managed media download exceeded expected size: " +
                        "expected $expectedSizeBytes byte(s), received at least $nextSizeBytes byte(s)."
                )
            }
            digest.update(buffer, 0, readByteCount)
            sizeBytes = nextSizeBytes
        }
    }

    val downloadedMediaAsset = DownloadedReviewMediaAsset(
        sizeBytes = sizeBytes,
        sha256 = encodeReviewMediaDigestHex(bytes = digest.digest())
    )
    validateCompletedReviewMediaDownload(
        downloadedMediaAsset = downloadedMediaAsset,
        expectedSizeBytes = expectedSizeBytes,
        expectedSha256 = expectedSha256
    )
    return downloadedMediaAsset
}

private fun validateReviewMediaDownloadContentLength(
    contentLength: Long,
    expectedSizeBytes: Long,
    rangeHeader: String
): Unit {
    if (contentLength == -1L) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download response is missing Content-Length for requested Range='$rangeHeader'."
        )
    }
    if (contentLength != expectedSizeBytes) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download Content-Length mismatch for requested Range='$rangeHeader': " +
                "expected $expectedSizeBytes byte(s), received header value $contentLength."
        )
    }
}

private fun validateCompletedReviewMediaDownload(
    downloadedMediaAsset: DownloadedReviewMediaAsset,
    expectedSizeBytes: Long,
    expectedSha256: String
): Unit {
    if (downloadedMediaAsset.sizeBytes != expectedSizeBytes) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download size mismatch: expected $expectedSizeBytes byte(s) " +
                "but received ${downloadedMediaAsset.sizeBytes} byte(s)."
        )
    }
    if (downloadedMediaAsset.sha256 != expectedSha256) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download SHA-256 mismatch: expected '$expectedSha256' " +
                "but received '${downloadedMediaAsset.sha256}'."
        )
    }
}

private fun readReviewMediaDownloadErrorBody(response: Response): String {
    return response.body.string().take(n = reviewMediaAssetDownloadErrorBodyLimit)
}

private fun shouldRetryReviewMediaDownloadError(
    error: IOException,
    attemptNumber: Int
): Boolean {
    if (attemptNumber >= reviewMediaAssetDownloadMaxAttemptCount) {
        return false
    }
    if (error is ReviewMediaAssetDownloadHttpException) {
        return error.retryEligible
    }
    if (error is ReviewMediaAssetDownloadValidationException) {
        return false
    }
    return true
}

private fun isTransientReviewMediaDownloadStatusCode(statusCode: Int): Boolean {
    return statusCode == 408 || statusCode == 429 || statusCode in 500..599
}

private fun calculateReviewMediaDownloadRetryDelayMillis(attemptNumber: Int): Long {
    return reviewMediaAssetDownloadRetryBaseDelayMillis * attemptNumber
}

private fun deletePartialReviewMediaDownload(
    partialFile: File,
    cause: Throwable
): Unit {
    if (partialFile.exists().not()) {
        return
    }
    if (partialFile.delete().not()) {
        cause.addSuppressed(
            IOException("Cannot delete partial managed media download file: ${partialFile.absolutePath}")
        )
    }
}

private fun encodeReviewMediaDigestHex(bytes: ByteArray): String {
    val hexChars = "0123456789abcdef".toCharArray()
    val result = CharArray(size = bytes.size * 2)
    bytes.forEachIndexed { index, byte ->
        val value = byte.toInt() and 0xff
        result[index * 2] = hexChars[value ushr 4]
        result[(index * 2) + 1] = hexChars[value and 0x0f]
    }
    return String(result)
}
