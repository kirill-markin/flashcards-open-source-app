package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.core.observability.AndroidBreadcrumbEvent
import com.flashcardsopensourceapp.core.observability.AndroidExceptionIssueEvent
import com.flashcardsopensourceapp.core.observability.AndroidObservationFeature
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.observability.CloudObservationIdentity
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.optCloudObjectOrNull
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.wire.requireCloudString
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatNewSessionRequest
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunRequest
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatOlderMessagesResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.network.awaitOkHttpResponse
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
    val responseBody: String?
) : Exception(message)

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
                requestBody = ByteArray(size = 0).toRequestBody(),
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
        val responseBody = readResponseBody(
            request = buildRequest(
                apiBaseUrl = apiBaseUrl,
                path = "/chat",
                method = "POST",
                authorizationHeader = authorizationHeader,
                requestBody = encodeStartRunRequest(request = request).toString().toRequestBody(aiJsonMediaType),
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

    private fun encodeStartRunRequest(request: AiChatStartRunRequest): JSONObject {
        val payload = JSONObject()
            .put("sessionId", request.sessionId)
            .put("clientRequestId", request.clientRequestId)
            .put("content", JSONArray(request.content.map(::encodeWireContentPart)))
            .put("timezone", request.timezone)

        return putOptionalUiLocale(
            payload = putOptionalWorkspaceId(
                payload = payload,
                workspaceId = request.workspaceId
            ),
            uiLocale = request.uiLocale
        )
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
        // Keep uiLocale optional so older backend deployments still accept requests during rollout.
        uiLocale?.takeIf { value -> value.isNotBlank() }?.let { locale ->
            payload.put("uiLocale", locale)
        }
        return payload
    }

    private fun encodeWireContentPart(part: com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart): JSONObject {
        return when (part) {
            is com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart.Text -> JSONObject()
                .put("type", "text")
                .put("text", part.text)

            is com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart.Image -> JSONObject()
                .put("type", "image")
                .put("mediaType", part.mediaType)
                .put("base64Data", part.base64Data)

            is com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart.File -> JSONObject()
                .put("type", "file")
                .put("fileName", part.fileName)
                .put("mediaType", part.mediaType)
                .put("base64Data", part.base64Data)

            is com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart.Card -> JSONObject()
                .put("type", "card")
                .put("cardId", part.cardId)
                .put("frontText", part.frontText)
                .put("backText", part.backText)
                .put("tags", JSONArray(part.tags))
                .put("effortLevel", com.flashcardsopensourceapp.data.local.model.aiChatEffortLevelWireValue(part.effortLevel))

            is com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart.ToolCall -> JSONObject()
                .put("type", "tool_call")
                .put("id", part.toolCallId)
                .put("name", part.name)
                .put("status", part.status.name.lowercase())
                .put("input", part.input)
                .put("output", part.output)
        }
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
    captureAiChatHttpFailureObservation(
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
        responseBody = responseBody
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
) {
    if (statusCode >= 500) {
        observability.captureWarning(
            event = AndroidWarningIssueEvent.HttpServerError(
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
        return
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
    }
}

private fun isExpectedAiChatHttpFailure(
    statusCode: Int,
    code: String?
): Boolean {
    if (statusCode == 401 || statusCode == 403 || statusCode == 429) {
        return true
    }

    return isExpectedAiChatHttpFailureCode(code = code)
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
