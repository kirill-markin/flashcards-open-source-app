package com.flashcardsopensourceapp.data.local.cloud.remote.transport

import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidObservationFeature
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudSyncConflictDetails
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudBooleanOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudIntOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudObjectOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.TimeUnit

private const val cloudRequestIdHeaderName: String = "X-Request-Id"
private const val officialCloudApiHost: String = "api.flashcards-open-source-app.com"
private const val officialCloudAuthHost: String = "auth.flashcards-open-source-app.com"
private val cloudJsonMediaType = "application/json".toMediaType()
private val expectedCloudHttpFailureCodes: Set<String> = setOf(
    "AGENT_API_KEY_INVALID",
    "AGENT_API_KEY_REQUIRED",
    "AGENT_API_KEY_HUMAN_SESSION_REQUIRED",
    "AGENT_API_KEY_ID_INVALID",
    "AGENT_API_KEY_ID_REQUIRED",
    "AGENT_API_KEY_NOT_FOUND",
    "ACCOUNT_DELETED",
    "ACCOUNT_PREFERENCES_FIELD_UNKNOWN",
    "ACCOUNT_PREFERENCES_HUMAN_AUTH_REQUIRED",
    "ACCOUNT_SIGN_IN_REQUIRED",
    "AUTH_UNAUTHORIZED",
    "FEEDBACK_HUMAN_AUTH_REQUIRED",
    "FEEDBACK_INVALID_REQUEST",
    "FEEDBACK_MESSAGE_TOO_LONG",
    "FEEDBACK_PLATFORM_INVALID",
    "FEEDBACK_PROMPT_EVENT_ID_CONFLICT",
    "FEEDBACK_PROMPT_EVENT_TYPE_INVALID",
    "FEEDBACK_STATE_UNAVAILABLE",
    "FEEDBACK_SUBMISSION_ID_CONFLICT",
    "FEEDBACK_TIMESTAMP_INVALID",
    "FEEDBACK_TIMEZONE_INVALID",
    "FEEDBACK_TRIGGER_INVALID",
    "GUEST_AUTH_INVALID",
    "GUEST_SESSION_DELETE_GUEST_AUTH_REQUIRED",
    "GUEST_SESSION_DELETE_LINKED_ACCOUNT",
    "GUEST_SESSION_PLATFORM_INVALID",
    "GUEST_SESSION_PLATFORM_MISMATCH",
    "GUEST_UPGRADE_ACCOUNT_REQUIRED",
    "GUEST_UPGRADE_GUEST_SYNC_NOT_DRAINED",
    "GUEST_UPGRADE_HUMAN_AUTH_REQUIRED",
    "GUEST_UPGRADE_SELECTION_INVALID",
    "GUEST_WEB_SESSION_UNSUPPORTED",
    "GUEST_WEB_SYNC_UNSUPPORTED",
    "INVALID_EMAIL",
    "INVALID_REQUEST",
    "OTP_CHALLENGE_CONSUMED",
    "OTP_CODE_INVALID",
    "OTP_SESSION_EXPIRED",
    "OTP_TOO_MANY_ATTEMPTS",
    "OTP_VERIFY_FAILED",
    "PASSWORD_SIGN_IN_FAILED",
    "PROGRESS_FROM_INVALID",
    "PROGRESS_FROM_REQUIRED",
    "PROGRESS_HUMAN_AUTH_REQUIRED",
    "PROGRESS_RANGE_INVALID",
    "PROGRESS_RANGE_TOO_LARGE",
    "PROGRESS_TIMEZONE_INVALID",
    "PROGRESS_TIMEZONE_REQUIRED",
    "PROGRESS_TO_INVALID",
    "PROGRESS_TO_REQUIRED",
    "RATE_LIMITED",
    "REFRESH_TOKEN_FAILED",
    "REFRESH_TOKEN_MISSING",
    "REVOKE_TOKEN_MISSING",
    "SESSION_CSRF_TOKEN_INVALID",
    "SYNC_BOOTSTRAP_NOT_EMPTY",
    "SYNC_INVALID_INPUT",
    "SYNC_WORKSPACE_FORK_REQUIRED",
    "WORKSPACE_DELETE_CONFIRMATION_INVALID",
    "WORKSPACE_ID_INVALID",
    "WORKSPACE_ID_REQUIRED",
    "WORKSPACE_NOT_FOUND",
    "WORKSPACE_OWNER_REQUIRED",
    "WORKSPACE_RESET_PROGRESS_CONFIRMATION_INVALID",
    "WORKSPACE_SELECTION_REQUIRED"
)

internal enum class CloudHttpMethod(
    val requestMethod: String
) {
    GET(requestMethod = "GET"),
    POST(requestMethod = "POST"),
    PATCH(requestMethod = "PATCH")
}

internal data class ParsedCloudErrorPayload(
    val message: String?,
    val code: String?,
    val requestId: String?,
    val syncConflict: CloudSyncConflictDetails?
)

private data class CloudErrorResponseMetadata(
    val statusCode: Int,
    val path: String,
    val requestId: String?,
    val responseBodyLengthBytes: Int,
    val responseContentType: String?
)

internal data class CloudHttpObservationVersions(
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

internal object NoopCloudHttpObservability : AppObservability {
    override fun setCloudIdentity(identity: CloudObservationIdentity) {
    }

    override fun clearCloudIdentity() {
    }

    override fun addBreadcrumb(event: AndroidBreadcrumbEvent) {
    }

    override fun captureWarning(event: AndroidWarningIssueEvent) {
    }

    override fun captureException(event: AndroidExceptionIssueEvent) {
    }
}

internal fun createCloudHttpObservationVersions(
    appVersion: String?,
    versionCode: Int?
): CloudHttpObservationVersions {
    val resolvedAppVersion = appVersion?.trim()?.takeIf { value -> value.isNotEmpty() }
    return CloudHttpObservationVersions(
        appVersion = resolvedAppVersion,
        clientVersion = resolvedAppVersion,
        versionCode = versionCode
    )
}

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

    @OptIn(InternalCoroutinesApi::class)
    private suspend fun executeJsonRequest(
        baseUrl: String,
        path: String,
        method: CloudHttpMethod,
        authorizationHeader: String?,
        body: JSONObject?
    ): JSONObject = withContext(Dispatchers.IO) {
        val request = buildCloudRequest(
            baseUrl = baseUrl,
            path = path,
            method = method,
            authorizationHeader = authorizationHeader,
            body = body
        )
        val call = httpClient.newCall(request)
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

        try {
            call.awaitOkHttpResponse().use { response ->
                val statusCode = response.code
                val requestId = response.header(cloudRequestIdHeaderName)
                val responseContentType = response.body.contentType()
                    ?.toString()
                    ?.trim()
                    ?.ifEmpty { null }
                val responseBody = readCloudResponseBody(response = response)
                if (response.isSuccessful.not()) {
                    val parsedError = parseCloudErrorPayloadWithHeaderRequestId(
                        responseBody = responseBody,
                        requestId = requestId
                    )
                    captureCloudHttpFailureObservation(
                        observability = observability,
                        observationVersions = observationVersions,
                        request = request,
                        path = path,
                        method = method.requestMethod,
                        requestId = parsedError?.requestId,
                        statusCode = statusCode,
                        code = parsedError?.code,
                        syncConflict = parsedError?.syncConflict
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
                        syncConflict = parsedError?.syncConflict
                    )
                }
                if (responseBody.isBlank()) {
                    JSONObject()
                } else {
                    JSONObject(responseBody)
                }
            }
        } catch (error: IOException) {
            if (cancellationRequested.get() || coroutineJob.isCancelled) {
                throw cancellationException(
                    message = "Cloud request was cancelled.",
                    cause = error
                )
            }
            throw error
        } finally {
            cancellationHandle.dispose()
        }
    }

    private fun buildCloudRequest(
        baseUrl: String,
        path: String,
        method: CloudHttpMethod,
        authorizationHeader: String?,
        body: JSONObject?
    ): Request {
        val normalizedBaseUrl = if (baseUrl.endsWith("/")) {
            baseUrl.dropLast(1)
        } else {
            baseUrl
        }
        val requestBody = when (method) {
            CloudHttpMethod.GET -> null
            CloudHttpMethod.POST,
            CloudHttpMethod.PATCH -> body?.toString()?.toRequestBody(cloudJsonMediaType)
                ?: ByteArray(size = 0).toRequestBody(cloudJsonMediaType)
        }
        val requestBuilder = Request.Builder()
            .url("$normalizedBaseUrl$path")
            .method(method.requestMethod, requestBody)
            .header("Content-Type", "application/json")

        if (authorizationHeader != null) {
            requestBuilder.header("Authorization", authorizationHeader)
        }

        return requestBuilder.build()
    }

    private fun readCloudResponseBody(response: Response): String {
        return response.body.byteStream().bufferedReader(StandardCharsets.UTF_8).use { reader ->
            reader.readText()
        }
    }
}

private fun captureCloudHttpFailureObservation(
    observability: AppObservability,
    observationVersions: CloudHttpObservationVersions,
    request: Request,
    path: String,
    method: String,
    requestId: String?,
    statusCode: Int,
    code: String?,
    syncConflict: CloudSyncConflictDetails?
) {
    val feature = cloudObservationFeature(request = request)
    val endpointName = cloudObservationEndpointName(path = path)
    if (statusCode >= 500) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.HttpServerError(
                feature = feature,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                stage = null,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return
    }

    if (
        isExpectedCloudHttpFailure(
            statusCode = statusCode,
            code = code,
            syncConflict = syncConflict
        )
    ) {
        observability.addBreadcrumb(
            event = AndroidBreadcrumbEvent.ExpectedHttpFailure(
                feature = feature,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return
    }

    if (statusCode in 400..499) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.HttpUnexpectedClientError(
                feature = feature,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                stage = null,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
    }
}

private fun cloudObservationEndpointName(path: String): String {
    val pathOnly = path.substringBefore(delimiter = "?").trim().ifEmpty { "/" }
    val segments = pathOnly.split("/").filter { segment -> segment.isNotEmpty() }
    if (segments.isEmpty()) {
        return "/"
    }

    val normalizedSegments = segments.mapIndexed { index, segment ->
        when {
            index > 0 && segments[index - 1] == "workspaces" -> "{workspaceId}"
            index > 0 && segments[index - 1] == "agent-api-keys" -> "{connectionId}"
            else -> segment
        }
    }
    return "/" + normalizedSegments.joinToString(separator = "/")
}

private fun cloudObservationFeature(request: Request): AndroidObservationFeature {
    val host = request.url.host
    val path = request.url.encodedPath
    return when {
        host == officialCloudAuthHost -> AndroidObservationFeature.AUTH
        path.startsWith(prefix = "/api/") -> AndroidObservationFeature.AUTH
        host == officialCloudApiHost -> AndroidObservationFeature.BACKEND
        else -> AndroidObservationFeature.CLOUD
    }
}

private fun isExpectedCloudHttpFailure(
    statusCode: Int,
    code: String?,
    syncConflict: CloudSyncConflictDetails?
): Boolean {
    if (statusCode == 401 || statusCode == 403 || statusCode == 429) {
        return true
    }
    if (syncConflict != null) {
        return true
    }

    val normalizedCode = code?.trim()?.uppercase() ?: return false
    return expectedCloudHttpFailureCodes.contains(element = normalizedCode)
}

private fun cancellationException(message: String, cause: Throwable): CancellationException {
    val cancellationException = CancellationException(message)
    cancellationException.initCause(cause)
    return cancellationException
}

private fun parseCloudErrorPayloadWithHeaderRequestId(
    responseBody: String,
    requestId: String?
): ParsedCloudErrorPayload? {
    val normalizedRequestId = requestId?.trim()?.ifEmpty { null }
    val parsedError = parseCloudErrorPayload(responseBody = responseBody)
    if (parsedError != null) {
        return parsedError.withHeaderRequestId(requestId = normalizedRequestId)
    }
    if (normalizedRequestId == null) {
        return null
    }
    return ParsedCloudErrorPayload(
        message = null,
        code = null,
        requestId = normalizedRequestId,
        syncConflict = null
    )
}

private fun ParsedCloudErrorPayload.withHeaderRequestId(requestId: String?): ParsedCloudErrorPayload {
    return if (this.requestId.isNullOrBlank() && requestId.isNullOrBlank().not()) {
        copy(requestId = requestId)
    } else {
        this
    }
}

private fun formatCloudRemoteErrorMessage(
    parsedError: ParsedCloudErrorPayload?,
    responseBody: String,
    responseMetadata: CloudErrorResponseMetadata
): String {
    val message = parsedError?.message?.trim().orEmpty()
    if (message.isNotEmpty()) {
        val requestId = parsedError?.requestId?.trim().orEmpty()
        return if (requestId.isEmpty()) {
            message
        } else {
            "$message Reference: $requestId"
        }
    }

    val metadataMessage = formatCloudErrorMetadataMessage(responseMetadata = responseMetadata)
    return if (responseBody.isBlank()) {
        "$metadataMessage Response body was empty."
    } else {
        "$metadataMessage Response body was not valid cloud error JSON."
    }
}

private fun formatCloudErrorMetadataMessage(responseMetadata: CloudErrorResponseMetadata): String {
    val requestIdMessage = responseMetadata.requestId?.trim()?.ifEmpty { null }?.let { requestId ->
        "Request id: $requestId."
    }
    val contentTypeMessage = responseMetadata.responseContentType?.trim()?.ifEmpty { null }?.let { contentType ->
        "Response content type: $contentType."
    }
    val responseBodyLengthMessage = "Response body length: ${responseMetadata.responseBodyLengthBytes} bytes."
    return listOfNotNull(
        "Cloud request failed with status ${responseMetadata.statusCode} for ${responseMetadata.path}.",
        requestIdMessage,
        contentTypeMessage,
        responseBodyLengthMessage
    ).joinToString(separator = " ")
}

internal fun parseCloudErrorPayload(responseBody: String): ParsedCloudErrorPayload? {
    if (responseBody.isBlank()) {
        return null
    }

    return try {
        val payload = JSONObject(responseBody)
        val nestedErrorValue = payload.opt("error")
        val nestedErrorObject = nestedErrorValue as? JSONObject
        val topLevelMessage = (nestedErrorValue as? String)
            ?: payload.optCloudStringOrNull("message", "error.message")
        val topLevelCode = payload.optCloudStringOrNull("code", "error.code")
        val nestedMessage = nestedErrorObject?.optCloudStringOrNull("message", "error.error.message")
        val nestedCode = nestedErrorObject?.optCloudStringOrNull("code", "error.error.code")
        val requestId = payload.optCloudStringOrNull("requestId", "error.requestId")
        val topLevelDetails = payload.optCloudObjectOrNull("details", "error.details")
        val nestedDetails = nestedErrorObject?.optCloudObjectOrNull("details", "error.error.details")
        ParsedCloudErrorPayload(
            message = topLevelMessage ?: nestedMessage,
            code = topLevelCode ?: nestedCode,
            requestId = requestId,
            syncConflict = parseSyncConflictDetails(
                details = topLevelDetails ?: nestedDetails
            )
        )
    } catch (_: JSONException) {
        null
    } catch (_: CloudContractMismatchException) {
        null
    }
}

private fun parseSyncConflictDetails(details: JSONObject?): CloudSyncConflictDetails? {
    if (details == null) {
        return null
    }

    return try {
        val syncConflict = details.optCloudObjectOrNull("syncConflict", "error.details.syncConflict") ?: return null
        val rawEntityType = syncConflict.optCloudStringOrNull(
            key = "entityType",
            fieldPath = "error.details.syncConflict.entityType"
        )
        CloudSyncConflictDetails(
            entityType = rawEntityType?.let { value ->
                parseSyncConflictEntityType(
                    rawValue = value,
                    fieldPath = "error.details.syncConflict.entityType"
                )
            },
            entityId = syncConflict.optCloudStringOrNull(
                key = "entityId",
                fieldPath = "error.details.syncConflict.entityId"
            ),
            entryIndex = syncConflict.optCloudIntOrNull(
                key = "entryIndex",
                fieldPath = "error.details.syncConflict.entryIndex"
            ),
            reviewEventIndex = syncConflict.optCloudIntOrNull(
                key = "reviewEventIndex",
                fieldPath = "error.details.syncConflict.reviewEventIndex"
            ),
            recoverable = syncConflict.optCloudBooleanOrNull(
                key = "recoverable",
                fieldPath = "error.details.syncConflict.recoverable"
            ),
            conflictingWorkspaceId = syncConflict.optCloudStringOrNull(
                key = "conflictingWorkspaceId",
                fieldPath = "error.details.syncConflict.conflictingWorkspaceId"
            ),
            remoteIsEmpty = syncConflict.optCloudBooleanOrNull(
                key = "remoteIsEmpty",
                fieldPath = "error.details.syncConflict.remoteIsEmpty"
            )
        )
    } catch (_: CloudContractMismatchException) {
        null
    }
}

private fun parseSyncConflictEntityType(rawValue: String, fieldPath: String): SyncEntityType {
    return when (rawValue) {
        "card" -> SyncEntityType.CARD
        "deck" -> SyncEntityType.DECK
        "review_event" -> SyncEntityType.REVIEW_EVENT
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: expected one of [card, deck, review_event], got invalid string \"$rawValue\""
        )
    }
}
