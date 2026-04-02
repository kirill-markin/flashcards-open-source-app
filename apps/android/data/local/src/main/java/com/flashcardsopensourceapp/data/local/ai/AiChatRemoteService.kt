package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.cloud.optCloudStringOrNull
import com.flashcardsopensourceapp.data.local.cloud.optCloudObjectOrNull
import com.flashcardsopensourceapp.data.local.cloud.requireCloudArray
import com.flashcardsopensourceapp.data.local.cloud.requireCloudBoolean
import com.flashcardsopensourceapp.data.local.cloud.requireCloudInt
import com.flashcardsopensourceapp.data.local.cloud.requireCloudLong
import com.flashcardsopensourceapp.data.local.cloud.requireCloudObject
import com.flashcardsopensourceapp.data.local.cloud.requireCloudString
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
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
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatOlderMessagesResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

internal const val chatRequestIdHeaderName: String = "X-Chat-Request-Id"

class AiChatRemoteException(
    message: String,
    val statusCode: Int?,
    val code: String?,
    val stage: String?,
    val requestId: String?,
    val responseBody: String?
) : Exception(message)

class AiChatRemoteService(
    private val dispatchers: AiCoroutineDispatchers,
    private val liveRemoteService: AiChatLiveRemoteService
) {

    suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode
    ): StoredGuestAiSession = withContext(dispatchers.io) {
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/guest-auth/session",
            method = "POST",
            authorizationHeader = null
        )

        try {
            val responseBody = readResponseBody(connection = connection)
            return@withContext decodeAiChatGuestSession(
                payload = responseBody,
                apiBaseUrl = apiBaseUrl,
                configurationMode = configurationMode
            )
        } finally {
            connection.disconnect()
        }
    }

    suspend fun startRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: AiChatStartRunRequest
    ): AiChatStartRunResponse = withContext(dispatchers.io) {
        val startConnection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/chat",
            method = "POST",
            authorizationHeader = authorizationHeader
        )

        val startResponse: AiChatStartRunResponse

        try {
            startConnection.setRequestProperty("Content-Type", "application/json")
            startConnection.doOutput = true
            startConnection.outputStream.use { outputStream ->
                outputStream.write(encodeStartRunRequest(request = request).toString().toByteArray(StandardCharsets.UTF_8))
            }

            val responseBody = readResponseBody(connection = startConnection)
            startResponse = decodeAiChatStartRunResponse(responseBody)
        } finally {
            startConnection.disconnect()
        }

        return@withContext startResponse
    }

    suspend fun loadSnapshot(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?
    ): AiChatSessionSnapshot = withContext(dispatchers.io) {
        val path = if (sessionId.isNullOrBlank()) {
            "/chat"
        } else {
            "/chat?sessionId=$sessionId"
        }
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = path,
            method = "GET",
            authorizationHeader = authorizationHeader
        )

        try {
            val responseBody = readResponseBody(connection = connection)
            return@withContext decodeAiChatSessionSnapshot(responseBody)
        } finally {
            connection.disconnect()
        }
    }

    suspend fun loadBootstrap(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse = withContext(dispatchers.io) {
        val path = buildString {
            append("/chat?limit=$limit")
            if (!sessionId.isNullOrBlank()) {
                append("&sessionId=$sessionId")
            }
        }
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = path,
            method = "GET",
            authorizationHeader = authorizationHeader,
            extraHeaders = resumeDiagnosticsHeaders(resumeDiagnostics = resumeDiagnostics)
        )

        try {
            val responseBody = readResponseBody(connection = connection)
            return@withContext decodeAiChatBootstrapResponse(responseBody)
        } finally {
            connection.disconnect()
        }
    }

    suspend fun loadOlderMessages(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String,
        beforeCursor: String,
        limit: Int
    ): AiChatOlderMessagesResponse = withContext(dispatchers.io) {
        val path = "/chat?sessionId=$sessionId&limit=$limit&before=$beforeCursor"
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = path,
            method = "GET",
            authorizationHeader = authorizationHeader
        )

        try {
            val responseBody = readResponseBody(connection = connection)
            val bootstrap = decodeAiChatBootstrapResponse(responseBody)
            return@withContext AiChatOlderMessagesResponse(
                messages = bootstrap.conversation.messages,
                hasOlder = bootstrap.conversation.hasOlder,
                oldestCursor = bootstrap.conversation.oldestCursor
            )
        } finally {
            connection.disconnect()
        }
    }

    fun attachLiveRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Flow<AiChatLiveEvent> {
        return liveRemoteService.attachLiveRun(
            authorizationHeader = authorizationHeader,
            sessionId = sessionId,
            runId = runId,
            liveStream = liveStream,
            afterCursor = afterCursor,
            resumeDiagnostics = resumeDiagnostics
        )
    }

    suspend fun createNewSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?
    ): AiChatSessionSnapshot = withContext(dispatchers.io) {
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/chat/new",
            method = "POST",
            authorizationHeader = authorizationHeader
        )

        try {
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { outputStream ->
                outputStream.write(
                    JSONObject()
                        .put("sessionId", sessionId)
                        .toString()
                        .toByteArray(StandardCharsets.UTF_8)
                )
            }
            val responseBody = readResponseBody(connection = connection)
            return@withContext decodeAiChatNewSession(responseBody)
        } finally {
            connection.disconnect()
        }
    }

    suspend fun stopRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String
    ): AiChatStopRunResponse = withContext(dispatchers.io) {
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/chat/stop",
            method = "POST",
            authorizationHeader = authorizationHeader
        )

        try {
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { outputStream ->
                outputStream.write(
                    JSONObject()
                        .put("sessionId", sessionId)
                        .toString()
                        .toByteArray(StandardCharsets.UTF_8)
                )
            }
            val responseBody = readResponseBody(connection = connection)
            return@withContext decodeAiChatStopRunResponse(responseBody)
        } finally {
            connection.disconnect()
        }
    }

    suspend fun transcribeAudio(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult = withContext(dispatchers.io) {
        val boundary = "flashcards-${UUID.randomUUID()}"
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/chat/transcriptions",
            method = "POST",
            authorizationHeader = authorizationHeader
        )

        try {
            connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
            connection.doOutput = true
            connection.outputStream.use { outputStream ->
                outputStream.write(
                    encodeMultipartAudioBody(
                        boundary = boundary,
                        sessionId = sessionId,
                        fileName = fileName,
                        mediaType = mediaType,
                        audioBytes = audioBytes
                    )
                )
            }

            val responseBody = readResponseBody(connection = connection)
            return@withContext decodeAiChatTranscription(responseBody)
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(
        apiBaseUrl: String,
        path: String,
        method: String,
        authorizationHeader: String?,
        extraHeaders: Map<String, String> = emptyMap()
    ): HttpURLConnection {
        val trimmedBaseUrl = apiBaseUrl.removeSuffix("/")
        val connection = (URL(trimmedBaseUrl + path).openConnection() as HttpURLConnection)
        connection.requestMethod = method
        connection.connectTimeout = 15_000
        connection.readTimeout = 120_000
        connection.useCaches = false
        connection.setRequestProperty("Accept", "application/json, text/event-stream")
        authorizationHeader?.let { header ->
            connection.setRequestProperty("Authorization", header)
        }
        extraHeaders.forEach { (headerName, headerValue) ->
            connection.setRequestProperty(headerName, headerValue)
        }
        return connection
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

    private fun readResponseBody(connection: HttpURLConnection): String {
        val responseCode = connection.responseCode
        if (responseCode !in 200..299) {
            throw readAiChatRemoteErrorResponse(connection = connection)
        }

        return connection.inputStream.bufferedReader(StandardCharsets.UTF_8).use { reader ->
            reader.readText()
        }
    }

    private fun encodeStartRunRequest(request: AiChatStartRunRequest): JSONObject {
        return JSONObject()
            .put("sessionId", request.sessionId)
            .put("clientRequestId", request.clientRequestId)
            .put("content", JSONArray(request.content.map(::encodeWireContentPart)))
            .put("timezone", request.timezone)
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
        sessionId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): ByteArray {
        val outputStream = ByteArrayOutputStream()
        if (sessionId.isNullOrBlank().not()) {
            outputStream.write("--$boundary\r\n".toByteArray(StandardCharsets.UTF_8))
            outputStream.write(
                "Content-Disposition: form-data; name=\"sessionId\"\r\n\r\n"
                    .toByteArray(StandardCharsets.UTF_8)
            )
            outputStream.write(requireNotNull(sessionId).toByteArray(StandardCharsets.UTF_8))
            outputStream.write("\r\n".toByteArray(StandardCharsets.UTF_8))
        }

        outputStream.write("--$boundary\r\n".toByteArray(StandardCharsets.UTF_8))
        outputStream.write(
            "Content-Disposition: form-data; name=\"source\"\r\n\r\nandroid\r\n"
                .toByteArray(StandardCharsets.UTF_8)
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
}

internal fun readAiChatRemoteErrorResponse(connection: HttpURLConnection): AiChatRemoteException {
    val responseBody = (connection.errorStream ?: connection.inputStream)?.bufferedReader(StandardCharsets.UTF_8)?.use { reader ->
        reader.readText()
    }
    val requestId = connection.getHeaderField(chatRequestIdHeaderName)
    val parsedError = parseBackendErrorPayload(rawBody = responseBody)
    val fields = listOf(
        "url" to connection.url.toString(),
        "method" to connection.requestMethod,
        "statusCode" to connection.responseCode.toString(),
        "code" to parsedError?.code,
        "stage" to parsedError?.stage,
        "requestId" to (parsedError?.requestId ?: requestId),
        "message" to parsedError?.message,
        "responseBody" to responseBody
    )

    if (connection.responseCode >= 500) {
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

    return AiChatRemoteException(
        message = parsedError?.message ?: "AI chat request failed.",
        statusCode = connection.responseCode,
        code = parsedError?.code,
        stage = parsedError?.stage,
        requestId = parsedError?.requestId ?: requestId,
        responseBody = responseBody
    )
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
        } catch (_: Exception) {
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
    } catch (_: Exception) {
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
