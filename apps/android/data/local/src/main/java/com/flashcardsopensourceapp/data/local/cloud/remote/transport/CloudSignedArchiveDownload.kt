package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
import com.flashcardsopensourceapp.data.local.network.isLikelyTransientNetworkIoException
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request

sealed class CloudSignedArchiveDownloadException private constructor(message: String) : IOException(message) {
    class Transport internal constructor(
        val isTransient: Boolean,
        errorType: String
    ) : CloudSignedArchiveDownloadException("Signed archive download failed ($errorType).")

    class Http internal constructor(
        val statusCode: Int
    ) : CloudSignedArchiveDownloadException("Signed archive download failed with HTTP $statusCode.")
}

// A presigned URL is a credential. Keep this client separate from app HTTP instrumentation.
private val signedArchiveHttpClient: OkHttpClient = OkHttpClient.Builder()
    .followRedirects(false)
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()

internal suspend fun downloadSignedArchive(
    url: HttpUrl,
    destination: File,
    expectedContentType: String
): Unit = withContext(Dispatchers.IO) {
    val request = Request.Builder().url(url).get().build()
    var attemptNumber = 1
    while (true) {
        val statusCode = try {
            downloadSignedArchiveAttempt(
                request = request,
                destination = destination,
                expectedContentType = expectedContentType
            )
        } catch (error: IOException) {
            currentCoroutineContext().ensureActive()
            if (shouldRetryTransientCloudIOException(true, attemptNumber, error).not()) {
                throw CloudSignedArchiveDownloadException.Transport(
                    isTransient = isLikelyTransientNetworkIoException(error = error),
                    errorType = error.javaClass.simpleName
                )
            }
            null
        }
        if (statusCode != null) {
            if (statusCode in 200..299) {
                return@withContext
            }
            if (shouldRetryTransientCloudHttpResponse(true, statusCode, attemptNumber).not()) {
                // Storage error bodies can contain the presigned URL or its query parameters.
                throw CloudSignedArchiveDownloadException.Http(statusCode = statusCode)
            }
        }
        delay(calculateCloudHttpTransientRetryDelayMs(attemptNumber))
        attemptNumber += 1
    }
}

@OptIn(InternalCoroutinesApi::class)
private suspend fun downloadSignedArchiveAttempt(
    request: Request,
    destination: File,
    expectedContentType: String
): Int {
    val call = signedArchiveHttpClient.newCall(request)
    val cancellationHandle = currentCoroutineContext().job.invokeOnCompletion(
        onCancelling = true,
        invokeImmediately = true
    ) { cause ->
        if (cause != null) {
            call.cancel()
        }
    }
    try {
        return call.awaitOkHttpResponse().use { response ->
            if (response.isSuccessful) {
                val contentType = response.body.contentType()?.toString()?.substringBefore(";")?.trim()
                if (expectedContentType.equals(contentType, ignoreCase = true).not()) {
                    throw CloudContractMismatchException(
                        "Signed archive download expected content type $expectedContentType."
                    )
                }
                val bytesCopied = destination.outputStream().use { output ->
                    response.body.byteStream().copyTo(output)
                }
                if (bytesCopied == 0L) {
                    throw CloudContractMismatchException("Signed archive download returned an empty archive.")
                }
            }
            response.code
        }
    } finally {
        cancellationHandle.dispose()
    }
}
