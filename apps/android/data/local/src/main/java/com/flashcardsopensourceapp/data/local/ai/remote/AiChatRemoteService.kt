package com.flashcardsopensourceapp.data.local.ai.remote

import com.flashcardsopensourceapp.core.observability.AndroidAlreadyObservedThrowable
import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidObservationFeature
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatGuestSession
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatNewSession
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.ai.wire.decodeAiChatTranscription
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudObjectOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.ai.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.ai.AiChatNewSessionRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ai.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.ai.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.ai.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.ai.AiChatRole
import com.flashcardsopensourceapp.data.local.model.ai.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.ai.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.ai.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStopRunRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.ai.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.ai.AiChatOlderMessagesResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
import com.flashcardsopensourceapp.data.local.model.ai.aiChatEffortLevelWireValue
import com.flashcardsopensourceapp.data.local.model.ai.aiChatAttachmentUnsupportedTypeCode
import com.flashcardsopensourceapp.data.local.model.ai.aiChatMaximumStartRunRequestBytes
import com.flashcardsopensourceapp.data.local.model.ai.aiChatRequestTooLargeCode
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.InternalCoroutinesApi
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.job
import kotlinx.coroutines.withContext
import okhttp3.CacheControl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

internal const val chatRequestIdHeaderName: String = "X-Chat-Request-Id"
private const val requestIdHeaderName: String = "X-Request-Id"
private const val guestSessionClientPlatform: String = "android"
private const val officialAiApiHost: String = "api.flashcards-open-source-app.com"
private const val officialAiApiPathPrefix: String = "/v1"
private val aiJsonMediaType = "application/json".toMediaType()
private val expectedAiChatHttpFailureCodes: Set<String> = setOf(
    "AI_WORKSPACE_REQUIRED",
    "AUTH_UNAUTHORIZED",
    "CHAT_ACTIVE_RUN_IN_PROGRESS",
    "CHAT_LIVE_AFTER_CURSOR_INVALID",
    "CHAT_LIVE_AUTH_EXPIRED",
    "CHAT_LIVE_AUTH_INVALID",
    "CHAT_LIVE_NOT_FOUND",
    "CHAT_LIVE_RUN_ID_REQUIRED",
    "CHAT_LIVE_SESSION_ID_REQUIRED",
    "CHAT_TRANSCRIPTION_NOT_CONFIGURED",
    "CHAT_TRANSCRIPTION_UNAVAILABLE",
    "CHAT_TRANSCRIPTION_PROVIDER_AUTH_FAILED",
    "CHAT_ATTACHMENT_UNSUPPORTED_TYPE",
    "CHAT_REQUEST_TOO_LARGE",
    "CHAT_SESSION_ID_CONFLICT",
    "CHAT_TRANSCRIPTION_FILE_EMPTY",
    "CHAT_TRANSCRIPTION_FILE_REQUIRED",
    "CHAT_TRANSCRIPTION_FILE_UNSUPPORTED",
    "CHAT_TRANSCRIPTION_INVALID_AUDIO",
    "CHAT_TRANSCRIPTION_INVALID_MULTIPART",
    "CHAT_TRANSCRIPTION_RATE_LIMITED",
    "CHAT_TRANSCRIPTION_SOURCE_INVALID",
    "GUEST_AI_LIMIT_REACHED",
    "GUEST_AUTH_INVALID",
    "GUEST_SESSION_PLATFORM_INVALID",
    "GUEST_SESSION_PLATFORM_MISMATCH",
    "GUEST_WEB_SESSION_UNSUPPORTED",
    "GUEST_WEB_SYNC_UNSUPPORTED",
    "LOCAL_CHAT_CONTINUATION_FAILED",
    "LOCAL_CHAT_NOT_CONFIGURED",
    "LOCAL_CHAT_PROVIDER_AUTH_FAILED",
    "LOCAL_CHAT_RATE_LIMITED",
    "LOCAL_CHAT_UNAVAILABLE",
    "WORKSPACE_ID_INVALID",
    "WORKSPACE_ID_REQUIRED",
    "WORKSPACE_NOT_FOUND",
    "WORKSPACE_SELECTION_REQUIRED"
)

internal data class AiChatHttpObservationVersions(
    val appVersion: String?,
    val clientVersion: String?,
    val versionCode: Int?
)

internal object NoopAiChatHttpObservability : AppObservability {
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

internal fun createAiChatHttpObservationVersions(
    appVersion: String?,
    versionCode: Int?
): AiChatHttpObservationVersions {
    val resolvedAppVersion = appVersion?.trim()?.takeIf { value -> value.isNotEmpty() }
    return AiChatHttpObservationVersions(
        appVersion = resolvedAppVersion,
        clientVersion = resolvedAppVersion,
        versionCode = versionCode
    )
}

class AiChatRemoteException(
    message: String,
    val statusCode: Int?,
    val code: String?,
    val stage: String?,
    val requestId: String?,
    val responseBody: String?,
    override val androidObservationAlreadyCaptured: Boolean
) : Exception(message), AndroidAlreadyObservedThrowable

class AiChatRequestTooLargeException(
    val byteCount: Int,
    val maximumByteCount: Int
) : Exception("AI chat request is too large.")

fun encodeAiChatStartRunRequestJson(request: AiChatStartRunRequest): String {
    return encodeAiChatStartRunRequestPayload(request = request).toString()
}

fun aiChatStartRunRequestByteCount(request: AiChatStartRunRequest): Int {
    return encodeAiChatStartRunRequestJson(request = request)
        .toByteArray(StandardCharsets.UTF_8)
        .size
}

fun requireAiChatStartRunRequestSize(request: AiChatStartRunRequest) {
    val byteCount = aiChatStartRunRequestByteCount(request = request)
    if (byteCount > aiChatMaximumStartRunRequestBytes) {
        throw AiChatRequestTooLargeException(
            byteCount = byteCount,
            maximumByteCount = aiChatMaximumStartRunRequestBytes
        )
    }
}

fun isAiChatRequestTooLargeRemoteError(error: AiChatRemoteException): Boolean {
    if (error.statusCode == 413) {
        return true
    }

    return error.code?.trim()?.uppercase() == aiChatRequestTooLargeCode
}

fun isAiChatAttachmentUnsupportedTypeRemoteError(error: AiChatRemoteException): Boolean {
    return error.statusCode == 400
        && error.code?.trim()?.uppercase() == aiChatAttachmentUnsupportedTypeCode
}

fun isExpectedAiChatRemoteUserError(error: AiChatRemoteException): Boolean {
    return error.statusCode?.let { statusCode ->
        isExpectedAiChatHttpFailure(statusCode = statusCode, code = error.code)
    } ?: isExpectedAiChatHttpFailureCode(code = error.code)
}

private fun encodeAiChatStartRunRequestPayload(request: AiChatStartRunRequest): JSONObject {
    val payload = JSONObject()
        .put("sessionId", request.sessionId)
        .put("clientRequestId", request.clientRequestId)
        .put("content", JSONArray(request.content.map(::encodeAiChatWireContentPart)))
        .put("timezone", request.timezone)

    return putOptionalAiChatUiLocale(
        payload = putOptionalAiChatWorkspaceId(
            payload = payload,
            workspaceId = request.workspaceId
        ),
        uiLocale = request.uiLocale
    )
}

private fun encodeAiChatWireContentPart(part: com.flashcardsopensourceapp.data.local.model.ai.AiChatWireContentPart): JSONObject {
    return when (part) {
        is com.flashcardsopensourceapp.data.local.model.ai.AiChatWireContentPart.Text -> JSONObject()
            .put("type", "text")
            .put("text", part.text)

        is com.flashcardsopensourceapp.data.local.model.ai.AiChatWireContentPart.Image -> JSONObject()
            .put("type", "image")
            .put("mediaType", part.mediaType)
            .put("base64Data", part.base64Data)

        is com.flashcardsopensourceapp.data.local.model.ai.AiChatWireContentPart.File -> JSONObject()
            .put("type", "file")
            .put("fileName", part.fileName)
            .put("mediaType", part.mediaType)
            .put("base64Data", part.base64Data)

        is com.flashcardsopensourceapp.data.local.model.ai.AiChatWireContentPart.Card -> JSONObject()
            .put("type", "card")
            .put("cardId", part.cardId)
            .put("frontText", part.frontText)
            .put("backText", part.backText)
            .put("tags", JSONArray(part.tags))
            .put("effortLevel", aiChatEffortLevelWireValue(part.effortLevel))

        is com.flashcardsopensourceapp.data.local.model.ai.AiChatWireContentPart.ToolCall -> JSONObject()
            .put("type", "tool_call")
            .put("id", part.toolCallId)
            .put("name", part.name)
            .put("status", part.status.name.lowercase())
            .put("input", part.input)
            .put("output", part.output)
    }
}

private fun putOptionalAiChatWorkspaceId(
    payload: JSONObject,
    workspaceId: String?
): JSONObject {
    workspaceId?.takeIf { value -> value.isNotBlank() }?.let { resolvedWorkspaceId ->
        payload.put("workspaceId", resolvedWorkspaceId)
    }
    return payload
}

private fun putOptionalAiChatUiLocale(
    payload: JSONObject,
    uiLocale: String?
): JSONObject {
    uiLocale?.takeIf { value -> value.isNotBlank() }?.let { locale ->
        payload.put("uiLocale", locale)
    }
    return payload
}

class AiChatRemoteService private constructor(
    private val dispatchers: AiCoroutineDispatchers,
    private val liveRemoteService: AiChatLiveRemoteService,
    okHttpClient: OkHttpClient,
    private val observability: AppObservability,
    private val observationVersions: AiChatHttpObservationVersions
) : GuestCloudSessionCreator {
    constructor(
        dispatchers: AiCoroutineDispatchers,
        liveRemoteService: AiChatLiveRemoteService,
        okHttpClient: OkHttpClient,
        observability: AppObservability,
        appVersion: String,
        versionCode: Int
    ) : this(
        dispatchers = dispatchers,
        liveRemoteService = liveRemoteService,
        okHttpClient = okHttpClient,
        observability = observability,
        observationVersions = createAiChatHttpObservationVersions(
            appVersion = appVersion,
            versionCode = versionCode
        )
    )

    constructor(
        dispatchers: AiCoroutineDispatchers,
        liveRemoteService: AiChatLiveRemoteService,
        okHttpClient: OkHttpClient
    ) : this(
        dispatchers = dispatchers,
        liveRemoteService = liveRemoteService,
        okHttpClient = okHttpClient,
        observability = NoopAiChatHttpObservability,
        observationVersions = createAiChatHttpObservationVersions(
            appVersion = null,
            versionCode = null
        )
    )

    constructor(
        dispatchers: AiCoroutineDispatchers,
        liveRemoteService: AiChatLiveRemoteService
    ) : this(
        dispatchers = dispatchers,
        liveRemoteService = liveRemoteService,
        okHttpClient = OkHttpClient()
    )

    constructor(
        dispatchers: AiCoroutineDispatchers,
        okHttpClient: OkHttpClient
    ) : this(
        dispatchers = dispatchers,
        liveRemoteService = AiChatLiveRemoteService(
            dispatchers = dispatchers,
            okHttpClient = okHttpClient
        ),
        okHttpClient = okHttpClient
    )

    private val httpClient: OkHttpClient = okHttpClient.newBuilder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    override suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode
    ): StoredGuestAiSession = withContext(dispatchers.io) {
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = "/guest-auth/session",
                method = "POST",
                authorizationHeader = null,
                requestBody = JSONObject()
                    .put("platform", guestSessionClientPlatform)
                    .toString()
                    .toRequestBody(aiJsonMediaType),
                extraHeaders = emptyMap()
            )
        )
        return@withContext decodeAiChatGuestSession(
            payload = responseBody,
            apiBaseUrl = apiBaseUrl,
            configurationMode = configurationMode
        )
    }

    suspend fun startRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: AiChatStartRunRequest
    ): AiChatStartRunResponse = withContext(dispatchers.io) {
        requireAiChatStartRunRequestSize(request = request)
        val requestJson = encodeAiChatStartRunRequestJson(request = request)
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = "/chat",
                method = "POST",
                authorizationHeader = authorizationHeader,
                requestBody = requestJson.toRequestBody(aiJsonMediaType),
                extraHeaders = emptyMap()
            )
        )
        return@withContext decodeAiChatStartRunResponse(responseBody)
    }

    suspend fun loadSnapshot(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?,
        workspaceId: String?
    ): AiChatSessionSnapshot = withContext(dispatchers.io) {
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = buildSnapshotPath(
                    sessionId = sessionId,
                    workspaceId = workspaceId
                ),
                method = "GET",
                authorizationHeader = authorizationHeader,
                requestBody = null,
                extraHeaders = emptyMap()
            )
        )
        return@withContext decodeAiChatSessionSnapshot(responseBody)
    }

    suspend fun loadBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String,
        limit: Int,
        workspaceId: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse = withContext(dispatchers.io) {
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = buildBootstrapPath(
                    sessionId = sessionId,
                    limit = limit,
                    workspaceId = workspaceId
                ),
                method = "GET",
                authorizationHeader = authorizationHeader,
                requestBody = null,
                extraHeaders = resumeDiagnosticsHeaders(resumeDiagnostics = resumeDiagnostics)
            )
        )
        return@withContext decodeAiChatBootstrapResponse(responseBody)
    }

    suspend fun loadOlderMessages(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String,
        beforeCursor: String,
        limit: Int,
        workspaceId: String?
    ): AiChatOlderMessagesResponse = withContext(dispatchers.io) {
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = buildOlderMessagesPath(
                    sessionId = sessionId,
                    beforeCursor = beforeCursor,
                    limit = limit,
                    workspaceId = workspaceId
                ),
                method = "GET",
                authorizationHeader = authorizationHeader,
                requestBody = null,
                extraHeaders = emptyMap()
            )
        )
        val bootstrap = decodeAiChatBootstrapResponse(responseBody)
        return@withContext AiChatOlderMessagesResponse(
            messages = bootstrap.conversation.messages,
            hasOlder = bootstrap.conversation.hasOlder,
            oldestCursor = bootstrap.conversation.oldestCursor
        )
    }

    fun attachLiveRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        workspaceId: String?,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Flow<AiChatLiveEvent> {
        return liveRemoteService.attachLiveRun(
            authorizationHeader = authorizationHeader,
            sessionId = sessionId,
            runId = runId,
            liveStream = liveStream,
            workspaceId = workspaceId,
            afterCursor = afterCursor,
            resumeDiagnostics = resumeDiagnostics,
            allowOfficialLiveTracePropagation = isOfficialAiApiBaseUrl(apiBaseUrl = apiBaseUrl)
        )
    }

    suspend fun createNewSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: AiChatNewSessionRequest
    ): AiChatSessionSnapshot = withContext(dispatchers.io) {
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = "/chat/new",
                method = "POST",
                authorizationHeader = authorizationHeader,
                requestBody = encodeNewSessionRequest(request = request).toString().toRequestBody(aiJsonMediaType),
                extraHeaders = emptyMap()
            )
        )
        return@withContext decodeAiChatNewSession(responseBody)
    }

    suspend fun stopRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: AiChatStopRunRequest
    ): AiChatStopRunResponse = withContext(dispatchers.io) {
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = "/chat/stop",
                method = "POST",
                authorizationHeader = authorizationHeader,
                requestBody = encodeStopRunRequest(request = request).toString().toRequestBody(aiJsonMediaType),
                extraHeaders = emptyMap()
            )
        )
        return@withContext decodeAiChatStopRunResponse(responseBody)
    }

    suspend fun transcribeAudio(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String,
        workspaceId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult = withContext(dispatchers.io) {
        val boundary = "flashcards-${UUID.randomUUID()}"
        val requestBody = encodeMultipartAudioBody(
            boundary = boundary,
            sessionId = sessionId,
            workspaceId = workspaceId,
            fileName = fileName,
            mediaType = mediaType,
            audioBytes = audioBytes
        ).toRequestBody("multipart/form-data; boundary=$boundary".toMediaType())
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = "/chat/transcriptions",
                method = "POST",
                authorizationHeader = authorizationHeader,
                requestBody = requestBody,
                extraHeaders = emptyMap()
            )
        )
        return@withContext decodeAiChatTranscription(responseBody)
    }

    private fun buildRequest(
        apiBaseUrl: String,
        path: String,
        method: String,
        authorizationHeader: String?,
        requestBody: RequestBody?,
        extraHeaders: Map<String, String>
    ): Request {
        val trimmedBaseUrl = apiBaseUrl.removeSuffix("/")
        val requestBuilder = Request.Builder()
            .url(trimmedBaseUrl + path)
            .method(method, requestBody)
            .cacheControl(CacheControl.FORCE_NETWORK)
            .header("Accept", "application/json, text/event-stream")
        authorizationHeader?.let { header ->
            requestBuilder.header("Authorization", header)
        }
        extraHeaders.forEach { (headerName, headerValue) ->
            requestBuilder.header(headerName, headerValue)
        }
        return requestBuilder.build()
    }

    private fun isOfficialAiApiBaseUrl(apiBaseUrl: String): Boolean {
        val uri = runCatching { URI(apiBaseUrl) }.getOrNull() ?: return false
        if (uri.scheme != "https" || uri.host != officialAiApiHost) {
            return false
        }

        val path = uri.path.orEmpty()
        return path.isEmpty() ||
            path == officialAiApiPathPrefix ||
            path.startsWith(
                prefix = "$officialAiApiPathPrefix/",
                ignoreCase = false
            )
    }

    private fun resumeDiagnosticsHeaders(
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Map<String, String> {
        if (resumeDiagnostics == null) {
            return emptyMap()
        }

        return mapOf(
            "X-Chat-Resume-Attempt-Id" to resumeDiagnostics.resumeAttemptId.toString(),
            "X-Client-Platform" to resumeDiagnostics.clientPlatform,
            "X-Client-Version" to resumeDiagnostics.clientVersion
        )
    }

    @OptIn(InternalCoroutinesApi::class)
    private suspend fun readResponseBody(request: Request): String {
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
                val responseBody = readAiChatResponseBody(response = response)
                if (response.isSuccessful.not()) {
                    throw readAiChatRemoteErrorResponse(
                        response = response,
                        responseBody = responseBody,
                        observability = observability,
                        observationVersions = observationVersions
                    )
                }
                return responseBody.orEmpty()
            }
        } catch (error: IOException) {
            if (cancellationRequested.get() || coroutineJob.isCancelled) {
                throw cancellationException(
                    message = "AI chat request was cancelled.",
                    cause = error
                )
            }
            throw error
        } finally {
            cancellationHandle.dispose()
        }
    }

    private fun readAiChatResponseBody(response: Response): String? {
        return response.body.byteStream().bufferedReader(StandardCharsets.UTF_8).use { reader ->
            reader.readText()
        }
    }

    private fun encodeNewSessionRequest(request: AiChatNewSessionRequest): JSONObject {
        val payload = JSONObject()
            .put("sessionId", request.sessionId)

        return putOptionalUiLocale(
            payload = putOptionalWorkspaceId(
                payload = payload,
                workspaceId = request.workspaceId
            ),
            uiLocale = request.uiLocale
        )
    }

    private fun encodeStopRunRequest(request: AiChatStopRunRequest): JSONObject {
        val payload: JSONObject = JSONObject()
            .put("sessionId", request.sessionId)

        return putOptionalRunId(
            payload = putOptionalWorkspaceId(
                payload = payload,
                workspaceId = request.workspaceId
            ),
            runId = request.runId
        )
    }

    private fun putOptionalWorkspaceId(
        payload: JSONObject,
        workspaceId: String?
    ): JSONObject {
        workspaceId?.takeIf { value -> value.isNotBlank() }?.let { resolvedWorkspaceId ->
            payload.put("workspaceId", resolvedWorkspaceId)
        }
        return payload
    }

    private fun putOptionalRunId(
        payload: JSONObject,
        runId: String?
    ): JSONObject {
        runId?.takeIf { value -> value.isNotBlank() }?.let { resolvedRunId ->
            payload.put("runId", resolvedRunId)
        }
        return payload
    }

    private fun putOptionalUiLocale(
        payload: JSONObject,
        uiLocale: String?
    ): JSONObject {
        // Keep uiLocale optional until the minimum supported backend version is greater than 1.5.0.
        uiLocale?.takeIf { value -> value.isNotBlank() }?.let { locale ->
            payload.put("uiLocale", locale)
        }
        return payload
    }

    private fun encodeMultipartAudioBody(
        boundary: String,
        sessionId: String,
        workspaceId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): ByteArray {
        val outputStream = ByteArrayOutputStream()
        writeMultipartTextField(
            outputStream = outputStream,
            boundary = boundary,
            fieldName = "sessionId",
            fieldValue = sessionId
        )
        workspaceId?.takeIf { value -> value.isNotBlank() }?.let { resolvedWorkspaceId ->
            writeMultipartTextField(
                outputStream = outputStream,
                boundary = boundary,
                fieldName = "workspaceId",
                fieldValue = resolvedWorkspaceId
            )
        }
        writeMultipartTextField(
            outputStream = outputStream,
            boundary = boundary,
            fieldName = "source",
            fieldValue = "android"
        )
        outputStream.write("--$boundary\r\n".toByteArray(StandardCharsets.UTF_8))
        outputStream.write(
            "Content-Disposition: form-data; name=\"file\"; filename=\"$fileName\"\r\n"
                .toByteArray(StandardCharsets.UTF_8)
        )
        outputStream.write("Content-Type: $mediaType\r\n\r\n".toByteArray(StandardCharsets.UTF_8))
        outputStream.write(audioBytes)
        outputStream.write("\r\n--$boundary--\r\n".toByteArray(StandardCharsets.UTF_8))
        return outputStream.toByteArray()
    }

    private fun writeMultipartTextField(
        outputStream: ByteArrayOutputStream,
        boundary: String,
        fieldName: String,
        fieldValue: String
    ) {
        outputStream.write("--$boundary\r\n".toByteArray(StandardCharsets.UTF_8))
        outputStream.write(
            "Content-Disposition: form-data; name=\"$fieldName\"\r\n\r\n"
                .toByteArray(StandardCharsets.UTF_8)
        )
        outputStream.write(fieldValue.toByteArray(StandardCharsets.UTF_8))
        outputStream.write("\r\n".toByteArray(StandardCharsets.UTF_8))
    }

    private fun buildSnapshotPath(
        sessionId: String?,
        workspaceId: String?
    ): String {
        val queryParameters = mutableListOf<String>()
        sessionId?.takeIf { value -> value.isNotBlank() }?.let { resolvedSessionId ->
            queryParameters.add("sessionId=${encodeQueryValue(value = resolvedSessionId)}")
        }
        workspaceId?.takeIf { value -> value.isNotBlank() }?.let { resolvedWorkspaceId ->
            queryParameters.add("workspaceId=${encodeQueryValue(value = resolvedWorkspaceId)}")
        }
        return buildChatPath(queryParameters = queryParameters)
    }

    private fun buildBootstrapPath(
        sessionId: String,
        limit: Int,
        workspaceId: String?
    ): String {
        val queryParameters = mutableListOf(
            "limit=$limit",
            "sessionId=${encodeQueryValue(value = sessionId)}"
        )
        workspaceId?.takeIf { value -> value.isNotBlank() }?.let { resolvedWorkspaceId ->
            queryParameters.add("workspaceId=${encodeQueryValue(value = resolvedWorkspaceId)}")
        }
        return buildChatPath(queryParameters = queryParameters)
    }

    private fun buildOlderMessagesPath(
        sessionId: String,
        beforeCursor: String,
        limit: Int,
        workspaceId: String?
    ): String {
        val queryParameters = mutableListOf(
            "sessionId=${encodeQueryValue(value = sessionId)}",
            "limit=$limit",
            "before=${encodeQueryValue(value = beforeCursor)}"
        )
        workspaceId?.takeIf { value -> value.isNotBlank() }?.let { resolvedWorkspaceId ->
            queryParameters.add("workspaceId=${encodeQueryValue(value = resolvedWorkspaceId)}")
        }
        return buildChatPath(queryParameters = queryParameters)
    }

    private fun buildChatPath(queryParameters: List<String>): String {
        return if (queryParameters.isEmpty()) {
            "/chat"
        } else {
            "/chat?${queryParameters.joinToString(separator = "&")}"
        }
    }

    private fun encodeQueryValue(value: String): String {
        return URLEncoder.encode(value, StandardCharsets.UTF_8)
    }
}

internal fun readAiChatRemoteErrorResponse(
    response: Response,
    responseBody: String?,
    observability: AppObservability,
    observationVersions: AiChatHttpObservationVersions
): AiChatRemoteException {
    val requestId = readAiChatRequestIdHeader(response = response)
    val parsedError = parseBackendErrorPayload(rawBody = responseBody)
    val endpointName = response.request.url.encodedPath
    val method = response.request.method
    val statusCode = response.code
    val resolvedRequestId = parsedError?.requestId ?: requestId
    val fields = listOf(
        "endpoint" to endpointName,
        "method" to method,
        "statusCode" to statusCode.toString(),
        "code" to parsedError?.code,
        "stage" to parsedError?.stage,
        "requestId" to resolvedRequestId
    )

    if (statusCode >= 500) {
        AiChatDiagnosticsLogger.error(
            event = "http_request_failed",
            fields = fields
        )
    } else {
        AiChatDiagnosticsLogger.warn(
            event = "http_request_failed",
            fields = fields
        )
    }
    val androidObservationAlreadyCaptured = captureAiChatHttpFailureObservation(
        observability = observability,
        observationVersions = observationVersions,
        endpointName = endpointName,
        method = method,
        requestId = resolvedRequestId,
        statusCode = statusCode,
        code = parsedError?.code,
        stage = parsedError?.stage
    )

    return AiChatRemoteException(
        message = parsedError?.message ?: "AI chat request failed.",
        statusCode = statusCode,
        code = parsedError?.code,
        stage = parsedError?.stage,
        requestId = resolvedRequestId,
        responseBody = responseBody,
        androidObservationAlreadyCaptured = androidObservationAlreadyCaptured
    )
}

internal fun readAiChatRemoteErrorResponse(response: Response, responseBody: String?): AiChatRemoteException {
    return readAiChatRemoteErrorResponse(
        response = response,
        responseBody = responseBody,
        observability = NoopAiChatHttpObservability,
        observationVersions = createAiChatHttpObservationVersions(
            appVersion = null,
            versionCode = null
        )
    )
}

private fun captureAiChatHttpFailureObservation(
    observability: AppObservability,
    observationVersions: AiChatHttpObservationVersions,
    endpointName: String,
    method: String,
    requestId: String?,
    statusCode: Int,
    code: String?,
    stage: String?
): Boolean {
    if (observability === NoopAiChatHttpObservability) {
        return false
    }

    if (
        isExpectedAiChatHttpFailure(
            statusCode = statusCode,
            code = code
        )
    ) {
        observability.addBreadcrumb(
            event = AndroidBreadcrumbEvent.ExpectedHttpFailure(
                feature = AndroidObservationFeature.AI,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                stage = stage,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return false
    }

    if (statusCode >= 500) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.HttpServerError(
                feature = AndroidObservationFeature.AI,
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
        return true
    }

    if (statusCode in 400..499) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.HttpUnexpectedClientError(
                feature = AndroidObservationFeature.AI,
                endpointName = endpointName,
                method = method,
                requestId = requestId,
                statusCode = statusCode,
                code = code,
                stage = stage,
                appVersion = observationVersions.appVersion,
                clientVersion = observationVersions.clientVersion,
                versionCode = observationVersions.versionCode
            )
        )
        return true
    }

    return false
}

private fun isExpectedAiChatHttpFailure(
    statusCode: Int,
    code: String?
): Boolean {
    if (isExpectedAiChatHttpFailureCode(code = code)) {
        return true
    }
    if (statusCode == 401 || statusCode == 403 || statusCode == 413 || statusCode == 429) {
        return true
    }

    return false
}

private fun isExpectedAiChatHttpFailureCode(code: String?): Boolean {
    val normalizedCode = code?.trim()?.uppercase() ?: return false
    return expectedAiChatHttpFailureCodes.contains(element = normalizedCode)
}

internal fun cancellationException(message: String, cause: Throwable): CancellationException {
    val cancellationException = CancellationException(message)
    cancellationException.initCause(cause)
    return cancellationException
}

internal fun readAiChatRequestIdHeader(response: Response): String? {
    return response.header(chatRequestIdHeaderName)?.trim()?.ifEmpty { null }
        ?: response.header(requestIdHeaderName)?.trim()?.ifEmpty { null }
}

internal data class ParsedBackendError(
    val message: String,
    val code: String?,
    val stage: String?,
    val requestId: String?
)

internal fun parseBackendErrorPayload(rawBody: String?): ParsedBackendError? {
    if (rawBody.isNullOrBlank()) {
        return null
    }

    val trimmedBody = rawBody.trim()
    if (trimmedBody.startsWith("data: ")) {
        val firstDataLine = trimmedBody.lineSequence().firstOrNull { line ->
            line.startsWith("data: ")
        } ?: return null
        return try {
            parseBackendErrorJson(jsonObject = JSONObject(firstDataLine.removePrefix("data: ")))
        } catch (_: JSONException) {
            null
        }
    }

    return try {
        val jsonObject = JSONObject(trimmedBody)
        if (jsonObject.has("error")) {
            ParsedBackendError(
                message = jsonObject.getString("error"),
                code = jsonObject.optString("code", "").ifBlank { null },
                stage = null,
                requestId = jsonObject.optString("requestId", "").ifBlank { null }
            )
        } else {
            parseBackendErrorJson(jsonObject = jsonObject)
        }
    } catch (_: JSONException) {
        null
    }
}

internal fun parseBackendErrorJson(jsonObject: JSONObject): ParsedBackendError? {
    if (jsonObject.optString("type") != "error") {
        return null
    }

    return ParsedBackendError(
        message = jsonObject.getString("message"),
        code = jsonObject.optString("code", "").ifBlank { null },
        stage = jsonObject.optString("stage", "").ifBlank { null },
        requestId = jsonObject.optString("requestId", "").ifBlank { null }
    )
}
