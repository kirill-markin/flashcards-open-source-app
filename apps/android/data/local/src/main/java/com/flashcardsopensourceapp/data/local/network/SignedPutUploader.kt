package com.flashcardsopensourceapp.data.local.network

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

private const val signedPutUploadLogTag: String = "SignedPutUpload"
private const val signedPutUploadMaxAttemptCount: Int = 3
private const val signedPutUploadRetryBaseDelayMillis: Long = 500L
private const val signedPutUploadErrorBodyLimit: Int = 4_096

data class SignedPutUploadResult(
    val eTag: String
) {
    init {
        require(eTag.isNotBlank()) {
            "Signed PUT upload ETag must not be blank."
        }
    }
}

interface SignedPutUploader {
    suspend fun uploadSignedPut(
        url: String,
        headers: Map<String, String>,
        bodyBytes: ByteArray
    ): SignedPutUploadResult
}

class SignedPutUploadHttpException(
    val statusCode: Int,
    val responseBody: String,
    val retryEligible: Boolean
) : IOException(
    "Signed PUT upload failed with HTTP statusCode=$statusCode responseBody='$responseBody'."
)

class OkHttpSignedPutUploader(
    okHttpClient: OkHttpClient
) : SignedPutUploader {
    private val httpClient: OkHttpClient = okHttpClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    override suspend fun uploadSignedPut(
        url: String,
        headers: Map<String, String>,
        bodyBytes: ByteArray
    ): SignedPutUploadResult {
        require(bodyBytes.isNotEmpty()) {
            "Signed PUT upload body must not be empty."
        }

        return withContext(Dispatchers.IO) {
            var attemptNumber = 1
            while (attemptNumber <= signedPutUploadMaxAttemptCount) {
                currentCoroutineContext().ensureActive()
                try {
                    return@withContext uploadSignedPutAttempt(
                        url = url,
                        headers = headers,
                        bodyBytes = bodyBytes
                    )
                } catch (error: IOException) {
                    currentCoroutineContext().ensureActive()
                    val shouldRetry = shouldRetrySignedPutUploadError(
                        error = error,
                        attemptNumber = attemptNumber
                    )
                    if (shouldRetry.not()) {
                        throw error
                    }

                    val delayMillis: Long = signedPutUploadRetryBaseDelayMillis * attemptNumber
                    Log.w(
                        signedPutUploadLogTag,
                        "event=signed_put_upload_retry attemptNumber=$attemptNumber " +
                            "delayMs=$delayMillis errorType=${error::class.java.simpleName}",
                        error
                    )
                    delay(delayMillis)
                    attemptNumber += 1
                }
            }

            throw IllegalStateException("Signed PUT upload retry loop exited without a terminal result.")
        }
    }

    private suspend fun uploadSignedPutAttempt(
        url: String,
        headers: Map<String, String>,
        bodyBytes: ByteArray
    ): SignedPutUploadResult {
        val requestBuilder = Request.Builder()
            .url(url.toHttpUrl())
            .put(bodyBytes.toRequestBody(contentType = null))

        headers.forEach { (headerName, headerValue) ->
            require(headerName.isNotBlank()) {
                "Signed PUT upload header name must not be blank."
            }
            require(headerValue.isNotBlank()) {
                "Signed PUT upload header '$headerName' value must not be blank."
            }
            requestBuilder.header(headerName, headerValue)
        }

        httpClient.newCall(requestBuilder.build()).awaitOkHttpResponse().use { response ->
            if (response.isSuccessful.not()) {
                throw SignedPutUploadHttpException(
                    statusCode = response.code,
                    responseBody = readSignedPutUploadErrorBody(response = response),
                    retryEligible = isRetryableHttpStatusCode(statusCode = response.code)
                )
            }

            val eTag: String = response.header("ETag")?.trim().orEmpty()
            if (eTag.isBlank()) {
                throw SignedPutUploadHttpException(
                    statusCode = response.code,
                    responseBody = "Missing ETag response header.",
                    retryEligible = false
                )
            }
            return SignedPutUploadResult(eTag = eTag)
        }
    }
}

private fun shouldRetrySignedPutUploadError(
    error: IOException,
    attemptNumber: Int
): Boolean {
    if (attemptNumber >= signedPutUploadMaxAttemptCount) {
        return false
    }
    if (error is SignedPutUploadHttpException) {
        return error.retryEligible
    }
    return isLikelyTransientNetworkIoException(error = error)
}

private fun readSignedPutUploadErrorBody(response: Response): String {
    return response.body.string().take(n = signedPutUploadErrorBodyLimit)
}
