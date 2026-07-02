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
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

private const val reviewMediaAssetDownloadLogTag: String = "ReviewMediaDownload"
private const val reviewMediaAssetDownloadMaxAttemptCount: Int = 3
private const val reviewMediaAssetDownloadRetryBaseDelayMillis: Long = 500L
private const val reviewMediaAssetDownloadErrorBodyLimit: Int = 4_096

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
                    deletePartialReviewMediaDownload(targetFile = targetFile, cause = error)
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

        val request: Request = Request.Builder()
            .url(url)
            .get()
            .build()

        try {
            httpClient.newCall(request).awaitOkHttpResponse().use { response ->
                if (response.isSuccessful.not()) {
                    throw ReviewMediaAssetDownloadHttpException(
                        statusCode = response.code,
                        responseBody = readReviewMediaDownloadErrorBody(response = response),
                        retryEligible = isTransientReviewMediaDownloadStatusCode(statusCode = response.code)
                    )
                }
                validateReviewMediaDownloadContentLength(
                    contentLength = response.body.contentLength(),
                    expectedSizeBytes = expectedSizeBytes
                )

                return streamReviewMediaResponseToFile(
                    response = response,
                    targetFile = targetFile,
                    expectedSizeBytes = expectedSizeBytes,
                    expectedSha256 = expectedSha256
                )
            }
        } catch (error: IOException) {
            deletePartialReviewMediaDownload(targetFile = targetFile, cause = error)
            throw error
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

private fun streamReviewMediaResponseToFile(
    response: Response,
    targetFile: File,
    expectedSizeBytes: Long,
    expectedSha256: String
): DownloadedReviewMediaAsset {
    val digest = MessageDigest.getInstance("SHA-256")
    var sizeBytes = 0L

    response.body.byteStream().use { input ->
        targetFile.outputStream().use { output ->
            val buffer = ByteArray(size = 16 * 1024)
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
                output.write(buffer, 0, readByteCount)
                digest.update(buffer, 0, readByteCount)
                sizeBytes = nextSizeBytes
            }
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
    expectedSizeBytes: Long
): Unit {
    if (contentLength == -1L) {
        return
    }
    if (contentLength != expectedSizeBytes) {
        throw ReviewMediaAssetDownloadValidationException(
            "Managed media download Content-Length mismatch: " +
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
    targetFile: File,
    cause: Throwable
): Unit {
    if (targetFile.exists().not()) {
        return
    }
    if (targetFile.delete().not()) {
        cause.addSuppressed(
            IOException("Cannot delete partial managed media download file: ${targetFile.absolutePath}")
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
