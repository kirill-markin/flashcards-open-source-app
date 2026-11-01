package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudHealthValidationException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.TimeUnit

private val cloudJsonMediaType = "application/json".toMediaType()
private val cloudZipMediaType = "application/zip".toMediaType()
private const val cloudHttpIoReadingResponseBodyPhase: String = "reading_response_body"

internal enum class CloudHttpMethod(
    val requestMethod: String
) {
    GET(requestMethod = "GET"),
    POST(requestMethod = "POST"),
    PATCH(requestMethod = "PATCH")
}

internal data class CloudBinaryHttpResponse(
    val bodyBytes: ByteArray,
    val contentType: String?,
    val contentDisposition: String?
)

internal class CloudJsonHttpClient(
    okHttpClient: OkHttpClient,
    private val observability: AppObservability,
    private val observationVersions: CloudHttpObservationVersions
) {
    constructor(okHttpClient: OkHttpClient) : this(
        okHttpClient = okHttpClient,
        observability = NoopCloudHttpObservability,
        observationVersions = createCloudHttpObservationVersions(
            appVersion = null,
            versionCode = null
        )
    )

    constructor(
        okHttpClient: OkHttpClient,
        observability: AppObservability,
        appVersion: String,
        versionCode: Int
    ) : this(
        okHttpClient = okHttpClient,
        observability = observability,
        observationVersions = createCloudHttpObservationVersions(
            appVersion = appVersion,
            versionCode = versionCode
        )
    )

    constructor() : this(okHttpClient = OkHttpClient())

    private val httpClient: OkHttpClient = okHttpClient.newBuilder()
        .eventListenerFactory { call ->
            val connectionObservation = requireNotNull(call.request().tag(CloudHttpConnectionObservation::class.java)) {
                "Cloud HTTP call requires a per-attempt connection observation."
            }
            okHttpClient.eventListenerFactory.create(call) + connectionObservation
        }
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun getJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?
    ): JSONObject {
        return executeJsonRequest(
            baseUrl = baseUrl,
            path = path,
            method = CloudHttpMethod.GET,
            authorizationHeader = authorizationHeader,
            body = null
        )
    }

    suspend fun postJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject {
        return executeJsonRequest(
            baseUrl = baseUrl,
            path = path,
            method = CloudHttpMethod.POST,
            authorizationHeader = authorizationHeader,
            body = body
        )
    }

    suspend fun postJsonOnce(
        baseUrl: String,
        path: String,
        authorizationHeader: String,
        body: JSONObject
    ): JSONObject {
        val encodedBody = body.toString().toRequestBody(cloudJsonMediaType)
        val oneUseBody = object : RequestBody() {
            override fun contentType() = encodedBody.contentType()
            override fun contentLength(): Long = encodedBody.contentLength()
            override fun isOneShot(): Boolean = true
            override fun writeTo(sink: BufferedSink) = encodedBody.writeTo(sink)
        }
        return executeBuiltJsonRequest(
            request = buildCloudRequest(baseUrl, path, CloudHttpMethod.POST, authorizationHeader,
                oneUseBody, "application/json"),
            path = path,
            method = CloudHttpMethod.POST,
            retryEligible = false
        )
    }

    suspend fun postJsonForBytes(
        baseUrl: String,
        path: String,
        authorizationHeader: String?,
        body: JSONObject,
        acceptHeader: String
    ): CloudBinaryHttpResponse {
        require(acceptHeader.isNotBlank()) {
            "Cloud binary request Accept header must not be blank."
        }
        return executeBuiltBytesRequest(
            request = buildCloudRequest(
                baseUrl = baseUrl,
                path = path,
                method = CloudHttpMethod.POST,
                authorizationHeader = authorizationHeader,
                requestBody = buildJsonRequestBody(method = CloudHttpMethod.POST, body = body),
                contentTypeHeader = "application/json"
            )
                .newBuilder()
                .header("Accept", acceptHeader)
                .build(),
            path = path,
            method = CloudHttpMethod.POST,
            retryEligible = isTransientCloudHttpRetryEligible(
                path = path,
                method = CloudHttpMethod.POST,
                body = body
            )
        )
    }

    suspend fun postZipForJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?,
        zipBytes: ByteArray
    ): JSONObject {
        require(zipBytes.isNotEmpty()) {
            "Cloud ZIP request body must not be empty."
        }
        return executeBuiltJsonRequest(
            request = buildCloudRequest(
                baseUrl = baseUrl,
                path = path,
                method = CloudHttpMethod.POST,
                authorizationHeader = authorizationHeader,
                requestBody = zipBytes.toRequestBody(cloudZipMediaType),
                contentTypeHeader = "application/zip"
            ),
            path = path,
            method = CloudHttpMethod.POST,
            retryEligible = false
        )
    }

    suspend fun postMultipartZipForJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?,
        fileFieldName: String,
        fileName: String,
        zipBytes: ByteArray,
        jsonFieldName: String,
        jsonFieldValue: JSONObject
    ): JSONObject {
        require(fileFieldName.isNotBlank()) {
            "Cloud multipart ZIP request file field name must not be blank."
        }
        require(fileName.isNotBlank()) {
            "Cloud multipart ZIP request file name must not be blank."
        }
        require(zipBytes.isNotEmpty()) {
            "Cloud multipart ZIP request file must not be empty."
        }
        require(jsonFieldName.isNotBlank()) {
            "Cloud multipart ZIP request JSON field name must not be blank."
        }

        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart(
                fileFieldName,
                fileName,
                zipBytes.toRequestBody(cloudZipMediaType)
            )
            .addFormDataPart(jsonFieldName, jsonFieldValue.toString())
            .build()

        return executeBuiltJsonRequest(
            request = buildCloudRequest(
                baseUrl = baseUrl,
                path = path,
                method = CloudHttpMethod.POST,
                authorizationHeader = authorizationHeader,
                requestBody = requestBody,
                contentTypeHeader = null
            ),
            path = path,
            method = CloudHttpMethod.POST,
            retryEligible = false
        )
    }

    suspend fun patchJson(
        baseUrl: String,
        path: String,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject {
        return executeJsonRequest(
            baseUrl = baseUrl,
            path = path,
            method = CloudHttpMethod.PATCH,
            authorizationHeader = authorizationHeader,
            body = body
        )
    }

    private suspend fun executeJsonRequest(
        baseUrl: String,
        path: String,
        method: CloudHttpMethod,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject {
        return executeBuiltJsonRequest(
            request = buildCloudRequest(
                baseUrl = baseUrl,
                path = path,
                method = method,
                authorizationHeader = authorizationHeader,
                requestBody = buildJsonRequestBody(method = method, body = body),
                contentTypeHeader = "application/json"
            ),
            path = path,
            method = method,
            retryEligible = isTransientCloudHttpRetryEligible(
                path = path,
                method = method,
                body = body
            )
        )
    }

    @OptIn(InternalCoroutinesApi::class)
    private suspend fun executeBuiltJsonRequest(
        request: Request,
        path: String,
        method: CloudHttpMethod,
        retryEligible: Boolean
    ): JSONObject = withContext(Dispatchers.IO) {
        var attemptNumber = 1
        var completedResponse: JSONObject? = null

        while (completedResponse == null) {
            val connectionObservation = CloudHttpConnectionObservation()
            val call = httpClient.newCall(
                request.newBuilder()
                    .tag(CloudHttpConnectionObservation::class.java, connectionObservation)
                    .build()
            )
            val coroutineJob = currentCoroutineContext().job
            val cancellationRequested = AtomicBoolean(false)
            val cancellationHandle = coroutineJob.invokeOnCompletion(
                onCancelling = true,
                invokeImmediately = true
            ) { cause ->
                if (cause != null) {
                    cancellationRequested.set(true)
                    call.cancel()
                }
            }
            var retryDelayMs: Long? = null
            var successfulResponse: JSONObject? = null
            var ioPhase: String = cloudHttpIoAwaitingResponseHeadersPhase
            var receivedStatusCode: Int? = null
            var receivedRequestId: String? = null
            var receivedProtocol: String? = null
            var ioExceptionClass: String? = null
            var responseBodyRead: Boolean = false
            val attemptStartedAtNanos: Long = System.nanoTime()

            try {
                call.awaitOkHttpResponse().use { response ->
                    val statusCode = response.code
                    val requestId = readCloudResponseRequestId(response = response)
                    receivedStatusCode = statusCode
                    receivedRequestId = requestId
                    receivedProtocol = response.protocol.toString()
                    val retryAfterDelayMillis = parseCloudRetryAfterDelayMillis(
                        value = response.header("Retry-After")
                    )
                    val responseContentType = response.body.contentType()
                        ?.toString()
                        ?.trim()
                        ?.ifEmpty { null }
                    ioPhase = cloudHttpIoReadingResponseBodyPhase
                    val responseBody = readCloudResponseBody(response = response)
                    responseBodyRead = true
                    if (response.isSuccessful.not()) {
                        val parsedError = parseCloudErrorPayloadWithHeaderRequestId(
                            responseBody = responseBody,
                            requestId = requestId
                        )
                        if (
                            shouldRetryTransientCloudHttpResponse(
                                retryEligible = retryEligible,
                                statusCode = statusCode,
                                attemptNumber = attemptNumber
                            )
                        ) {
                            val delayMs = calculateCloudHttpTransientRetryDelayMs(attemptNumber)
                            captureCloudHttpTransientRetryObservation(
                                observability = observability,
                                observationVersions = observationVersions,
                                request = request,
                                path = path,
                                method = method.requestMethod,
                                requestId = parsedError?.requestId,
                                statusCode = statusCode,
                                code = parsedError?.code,
                                stage = cloudHttpRetryHttpResponseStage,
                                attemptNumber = attemptNumber,
                                delayMs = delayMs,
                                ioPhase = null,
                                exceptionClass = null,
                                attemptElapsedMs = null,
                                responseProtocol = null,
                                connectionId = null,
                                connectionProtocol = null,
                                requestHeadersCompleted = null
                            )
                            retryDelayMs = delayMs
                        } else {
                            val androidObservationAlreadyCaptured = captureCloudHttpFailureObservation(
                                observability = observability,
                                observationVersions = observationVersions,
                                request = request,
                                path = path,
                                method = method.requestMethod,
                                requestId = parsedError?.requestId,
                                statusCode = statusCode,
                                code = parsedError?.code,
                                syncConflict = parsedError?.syncConflict,
                                responseHasStackRequestId = requestId != null
                            )
                            throw CloudRemoteException(
                                message = formatCloudRemoteErrorMessage(
                                    parsedError = parsedError,
                                    responseBody = responseBody,
                                    responseMetadata = CloudErrorResponseMetadata(
                                        statusCode = statusCode,
                                        path = cloudObservationEndpointName(path = path),
                                        requestId = parsedError?.requestId,
                                        responseBodyLengthBytes = responseBody
                                            .toByteArray(StandardCharsets.UTF_8)
                                            .size,
                                        responseContentType = responseContentType
                                    )
                                ),
                                statusCode = statusCode,
                                responseBody = responseBody,
                                errorCode = parsedError?.code,
                                requestId = parsedError?.requestId,
                                syncConflict = parsedError?.syncConflict,
                                retryAfterDelayMillis = retryAfterDelayMillis,
                                androidObservationAlreadyCaptured = androidObservationAlreadyCaptured
                            )
                        }
                    } else {
                        try {
                            successfulResponse = if (responseBody.isBlank()) {
                                JSONObject()
                            } else {
                                JSONObject(responseBody)
                            }
                        } catch (error: JSONException) {
                            if (isExpectedCloudHealthValidationFailure(path = path, method = method.requestMethod)) {
                                throw CloudHealthValidationException(
                                    message = "Cloud health response was not valid JSON.",
                                    cause = error
                                )
                            }
                            throw error
                        }
                    }
                }
            } catch (error: IOException) {
                ioExceptionClass = error::class.java.name
                if (cancellationRequested.get() || coroutineJob.isCancelled) {
                    throw cancellationException(
                        message = "Cloud request was cancelled.",
                        cause = error
                    )
                }
                if (
                    shouldRetryTransientCloudIOException(
                        retryEligible = retryEligible,
                        attemptNumber = attemptNumber,
                        error = error
                    )
                ) {
                    val connectionSnapshot = connectionObservation.snapshot()
                    val delayMs = calculateCloudHttpIoRetryDelayMs(
                        attemptNumber = attemptNumber,
                        error = error,
                        connectionProtocol = connectionSnapshot.connectionProtocol,
                        ioPhase = ioPhase
                    )
                    captureCloudHttpTransientRetryObservation(
                        observability = observability,
                        observationVersions = observationVersions,
                        request = request,
                        path = path,
                        method = method.requestMethod,
                        requestId = receivedRequestId,
                        statusCode = receivedStatusCode,
                        code = null,
                        stage = cloudHttpRetryIoExceptionStage,
                        attemptNumber = attemptNumber,
                        delayMs = delayMs,
                        ioPhase = ioPhase,
                        exceptionClass = error::class.java.name,
                        attemptElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - attemptStartedAtNanos),
                        responseProtocol = receivedProtocol,
                        connectionId = connectionSnapshot.connectionId,
                        connectionProtocol = connectionSnapshot.connectionProtocol,
                        requestHeadersCompleted = connectionSnapshot.requestHeadersCompleted
                    )
                    retryDelayMs = delayMs
                } else {
                    throw error
                }
            } finally {
                cancellationHandle.dispose()
                captureCloudHttpAttemptFinishedObservation(
                    observability = observability,
                    observationVersions = observationVersions,
                    call = call,
                    path = path,
                    method = method.requestMethod,
                    attemptNumber = attemptNumber,
                    attemptElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - attemptStartedAtNanos),
                    ioPhase = ioPhase,
                    exceptionClass = ioExceptionClass,
                    cancelled = cancellationRequested.get() || coroutineJob.isCancelled,
                    requestId = receivedRequestId,
                    statusCode = receivedStatusCode,
                    responseProtocol = receivedProtocol,
                    connectionSnapshot = connectionObservation.snapshot(),
                    responseBodyRead = responseBodyRead
                )
            }

            val attemptResponse = successfulResponse
            completedResponse = attemptResponse

            if (attemptResponse == null) {
                val delayMs = retryDelayMs
                if (delayMs != null) {
                    delay(delayMs)
                    attemptNumber += 1
                    continue
                }

                throw IllegalStateException("Cloud request attempt finished without a response or retry decision.")
            }
        }
        completedResponse
    }

    @OptIn(InternalCoroutinesApi::class)
    private suspend fun executeBuiltBytesRequest(
        request: Request,
        path: String,
        method: CloudHttpMethod,
        retryEligible: Boolean
    ): CloudBinaryHttpResponse = withContext(Dispatchers.IO) {
        var attemptNumber = 1
        var completedResponse: CloudBinaryHttpResponse? = null

        while (completedResponse == null) {
            val connectionObservation = CloudHttpConnectionObservation()
            val call = httpClient.newCall(
                request.newBuilder()
                    .tag(CloudHttpConnectionObservation::class.java, connectionObservation)
                    .build()
            )
            val coroutineJob = currentCoroutineContext().job
            val cancellationRequested = AtomicBoolean(false)
            val cancellationHandle = coroutineJob.invokeOnCompletion(
                onCancelling = true,
                invokeImmediately = true
            ) { cause ->
                if (cause != null) {
                    cancellationRequested.set(true)
                    call.cancel()
                }
            }
            var retryDelayMs: Long? = null
            var successfulResponse: CloudBinaryHttpResponse? = null
            var ioPhase: String = cloudHttpIoAwaitingResponseHeadersPhase
            var receivedStatusCode: Int? = null
            var receivedRequestId: String? = null
            var receivedProtocol: String? = null
            var ioExceptionClass: String? = null
            var responseBodyRead: Boolean = false
            val attemptStartedAtNanos: Long = System.nanoTime()

            try {
                call.awaitOkHttpResponse().use { response ->
                    val statusCode = response.code
                    val requestId = readCloudResponseRequestId(response = response)
                    receivedStatusCode = statusCode
                    receivedRequestId = requestId
                    receivedProtocol = response.protocol.toString()
                    val retryAfterDelayMillis = parseCloudRetryAfterDelayMillis(
                        value = response.header("Retry-After")
                    )
                    val responseContentType = response.body.contentType()
                        ?.toString()
                        ?.trim()
                        ?.ifEmpty { null }
                    val responseContentDisposition = response.header("Content-Disposition")
                        ?.trim()
                        ?.ifEmpty { null }
                    ioPhase = cloudHttpIoReadingResponseBodyPhase
                    val responseBodyBytes = readCloudResponseBytes(response = response)
                    responseBodyRead = true
                    if (response.isSuccessful.not()) {
                        val responseBody = String(responseBodyBytes, StandardCharsets.UTF_8)
                        val parsedError = parseCloudErrorPayloadWithHeaderRequestId(
                            responseBody = responseBody,
                            requestId = requestId
                        )
                        if (
                            shouldRetryTransientCloudHttpResponse(
                                retryEligible = retryEligible,
                                statusCode = statusCode,
                                attemptNumber = attemptNumber
                            )
                        ) {
                            val delayMs = calculateCloudHttpTransientRetryDelayMs(attemptNumber)
                            captureCloudHttpTransientRetryObservation(
                                observability = observability,
                                observationVersions = observationVersions,
                                request = request,
                                path = path,
                                method = method.requestMethod,
                                requestId = parsedError?.requestId,
                                statusCode = statusCode,
                                code = parsedError?.code,
                                stage = cloudHttpRetryHttpResponseStage,
                                attemptNumber = attemptNumber,
                                delayMs = delayMs,
                                ioPhase = null,
                                exceptionClass = null,
                                attemptElapsedMs = null,
                                responseProtocol = null,
                                connectionId = null,
                                connectionProtocol = null,
                                requestHeadersCompleted = null
                            )
                            retryDelayMs = delayMs
                        } else {
                            val androidObservationAlreadyCaptured = captureCloudHttpFailureObservation(
                                observability = observability,
                                observationVersions = observationVersions,
                                request = request,
                                path = path,
                                method = method.requestMethod,
                                requestId = parsedError?.requestId,
                                statusCode = statusCode,
                                code = parsedError?.code,
                                syncConflict = parsedError?.syncConflict,
                                responseHasStackRequestId = requestId != null
                            )
                            throw CloudRemoteException(
                                message = formatCloudRemoteErrorMessage(
                                    parsedError = parsedError,
                                    responseBody = responseBody,
                                    responseMetadata = CloudErrorResponseMetadata(
                                        statusCode = statusCode,
                                        path = cloudObservationEndpointName(path = path),
                                        requestId = parsedError?.requestId,
                                        responseBodyLengthBytes = responseBodyBytes.size,
                                        responseContentType = responseContentType
                                    )
                                ),
                                statusCode = statusCode,
                                responseBody = responseBody,
                                errorCode = parsedError?.code,
                                requestId = parsedError?.requestId,
                                syncConflict = parsedError?.syncConflict,
                                retryAfterDelayMillis = retryAfterDelayMillis,
                                androidObservationAlreadyCaptured = androidObservationAlreadyCaptured
                            )
                        }
                    } else {
                        successfulResponse = CloudBinaryHttpResponse(
                            bodyBytes = responseBodyBytes,
                            contentType = responseContentType,
                            contentDisposition = responseContentDisposition
                        )
                    }
                }
            } catch (error: IOException) {
                ioExceptionClass = error::class.java.name
                if (cancellationRequested.get() || coroutineJob.isCancelled) {
                    throw cancellationException(
                        message = "Cloud request was cancelled.",
                        cause = error
                    )
                }
                if (
                    shouldRetryTransientCloudIOException(
                        retryEligible = retryEligible,
                        attemptNumber = attemptNumber,
                        error = error
                    )
                ) {
                    val connectionSnapshot = connectionObservation.snapshot()
                    val delayMs = calculateCloudHttpIoRetryDelayMs(
                        attemptNumber = attemptNumber,
                        error = error,
                        connectionProtocol = connectionSnapshot.connectionProtocol,
                        ioPhase = ioPhase
                    )
                    captureCloudHttpTransientRetryObservation(
                        observability = observability,
                        observationVersions = observationVersions,
                        request = request,
                        path = path,
                        method = method.requestMethod,
                        requestId = receivedRequestId,
                        statusCode = receivedStatusCode,
                        code = null,
                        stage = cloudHttpRetryIoExceptionStage,
                        attemptNumber = attemptNumber,
                        delayMs = delayMs,
                        ioPhase = ioPhase,
                        exceptionClass = error::class.java.name,
                        attemptElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - attemptStartedAtNanos),
                        responseProtocol = receivedProtocol,
                        connectionId = connectionSnapshot.connectionId,
                        connectionProtocol = connectionSnapshot.connectionProtocol,
                        requestHeadersCompleted = connectionSnapshot.requestHeadersCompleted
                    )
                    retryDelayMs = delayMs
                } else {
                    throw error
                }
            } finally {
                cancellationHandle.dispose()
                captureCloudHttpAttemptFinishedObservation(
                    observability = observability,
                    observationVersions = observationVersions,
                    call = call,
                    path = path,
                    method = method.requestMethod,
                    attemptNumber = attemptNumber,
                    attemptElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - attemptStartedAtNanos),
                    ioPhase = ioPhase,
                    exceptionClass = ioExceptionClass,
                    cancelled = cancellationRequested.get() || coroutineJob.isCancelled,
                    requestId = receivedRequestId,
                    statusCode = receivedStatusCode,
                    responseProtocol = receivedProtocol,
                    connectionSnapshot = connectionObservation.snapshot(),
                    responseBodyRead = responseBodyRead
                )
            }

            val attemptResponse = successfulResponse
            completedResponse = attemptResponse

            if (attemptResponse == null) {
                val delayMs = retryDelayMs
                if (delayMs != null) {
                    delay(delayMs)
                    attemptNumber += 1
                    continue
                }

                throw IllegalStateException("Cloud binary request attempt finished without a response or retry decision.")
            }
        }
        completedResponse
    }

    private fun buildCloudRequest(
        baseUrl: String,
        path: String,
        method: CloudHttpMethod,
        authorizationHeader: String?,
        requestBody: RequestBody?,
        contentTypeHeader: String?
    ): Request {
        val normalizedBaseUrl = if (baseUrl.endsWith("/")) {
            baseUrl.dropLast(1)
        } else {
            baseUrl
        }
        val requestBuilder = Request.Builder()
            .url("$normalizedBaseUrl$path")
            .method(method.requestMethod, requestBody)

        if (contentTypeHeader != null) {
            requestBuilder.header("Content-Type", contentTypeHeader)
        }

        if (authorizationHeader != null) {
            requestBuilder.header("Authorization", authorizationHeader)
        }

        return requestBuilder.build()
    }

    private fun buildJsonRequestBody(
        method: CloudHttpMethod,
        body: JSONObject?
    ): RequestBody? {
        return when (method) {
            CloudHttpMethod.GET -> null
            CloudHttpMethod.POST,
            CloudHttpMethod.PATCH -> body?.toString()?.toRequestBody(cloudJsonMediaType)
                ?: ByteArray(size = 0).toRequestBody(cloudJsonMediaType)
        }
    }

    private fun readCloudResponseBody(response: Response): String {
        return response.body.byteStream().bufferedReader(StandardCharsets.UTF_8).use { reader ->
            reader.readText()
        }
    }

    private fun readCloudResponseBytes(response: Response): ByteArray {
        return response.body.bytes()
    }
}

private fun cancellationException(message: String, cause: Throwable): CancellationException {
    val cancellationException = CancellationException(message)
    cancellationException.initCause(cause)
    return cancellationException
}
