package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStreamError
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiChatTurnRequest
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

private const val chatRequestIdHeaderName: String = "X-Chat-Request-Id"
private const val activeRunSnapshotPollIntervalMs: Long = 1_000L

class AiChatRemoteException(
    message: String,
    val statusCode: Int?,
    val code: String?,
    val stage: String?,
    val requestId: String?,
    val responseBody: String?
) : Exception(message)

class AiChatRemoteService {
    suspend fun createGuestSession(
        apiBaseUrl: String,
        configurationMode: CloudServiceConfigurationMode
    ): StoredGuestAiSession = withContext(Dispatchers.IO) {
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/guest-auth/session",
            method = "POST",
            authorizationHeader = null
        )

        try {
            val response = readJsonResponse(connection = connection)
            return@withContext StoredGuestAiSession(
                guestToken = response.getString("guestToken"),
                userId = response.getString("userId"),
                workspaceId = response.getString("workspaceId"),
                configurationMode = configurationMode,
                apiBaseUrl = apiBaseUrl
            )
        } finally {
            connection.disconnect()
        }
    }

    suspend fun streamTurn(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: AiChatTurnRequest,
        onEvent: suspend (AiChatStreamEvent) -> Unit
    ): AiChatStreamOutcome = withContext(Dispatchers.IO) {
        val startConnection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/chat",
            method = "POST",
            authorizationHeader = authorizationHeader
        )

        var latestChatConfig: AiChatServerConfig? = null
        val requestId: String?
        val sessionId: String

        try {
            startConnection.setRequestProperty("Content-Type", "application/json")
            startConnection.doOutput = true
            startConnection.outputStream.use { outputStream ->
                outputStream.write(encodeTurnRequest(request = request).toString().toByteArray(StandardCharsets.UTF_8))
            }

            val response = readJsonResponse(connection = startConnection)
            requestId = startConnection.getHeaderField(chatRequestIdHeaderName)
            sessionId = response.getString("sessionId")
            latestChatConfig = response.optJSONObject("chatConfig")?.let(::decodeChatConfig)
        } finally {
            startConnection.disconnect()
        }

        var previousAssistantText = ""
        var previousToolCalls = linkedMapOf<String, AiChatToolCall>()

        return@withContext try {
            while (true) {
                val snapshot = loadSnapshot(
                    apiBaseUrl = apiBaseUrl,
                    authorizationHeader = authorizationHeader,
                    sessionId = sessionId
                )
                latestChatConfig = snapshot.chatConfig

                val latestAssistantMessage = snapshot.messages.lastOrNull { message ->
                    message.role == AiChatRole.ASSISTANT
                }
                val latestAssistantText = latestAssistantMessage?.content
                    ?.filterIsInstance<AiChatContentPart.Text>()
                    ?.joinToString(separator = "") { part -> part.text }
                    ?: ""

                if (latestAssistantText.startsWith(previousAssistantText) && latestAssistantText != previousAssistantText) {
                    onEvent(
                        AiChatStreamEvent.Delta(
                            text = latestAssistantText.removePrefix(previousAssistantText)
                        )
                    )
                    previousAssistantText = latestAssistantText
                }

                val latestToolCalls = linkedMapOf<String, AiChatToolCall>()
                latestAssistantMessage?.content?.forEach { part ->
                    if (part is AiChatContentPart.ToolCall) {
                        latestToolCalls[part.toolCall.toolCallId] = part.toolCall
                    }
                }
                latestToolCalls.values.forEach { toolCall ->
                    val previousToolCall = previousToolCalls[toolCall.toolCallId]
                    if (previousToolCall != toolCall) {
                        onEvent(AiChatStreamEvent.ToolCall(toolCall = toolCall))
                    }
                }
                previousToolCalls = latestToolCalls

                if (snapshot.runState != "running") {
                    onEvent(AiChatStreamEvent.Done)
                    return@withContext AiChatStreamOutcome(
                        requestId = requestId,
                        chatSessionId = sessionId,
                        chatConfig = latestChatConfig
                    )
                }

                delay(activeRunSnapshotPollIntervalMs)
            }

            throw IllegalStateException("Chat polling loop exited unexpectedly.")
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) {
                try {
                    stopChatRun(
                        apiBaseUrl = apiBaseUrl,
                        authorizationHeader = authorizationHeader,
                        sessionId = sessionId
                    )
                } catch (_: Exception) {
                }
            }
            throw error
        }
    }

    suspend fun loadSnapshot(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?
    ): AiChatSessionSnapshot = withContext(Dispatchers.IO) {
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
            val response = readJsonResponse(connection = connection)
            return@withContext decodeSnapshot(response)
        } finally {
            connection.disconnect()
        }
    }

    suspend fun resetChatSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?
    ): AiChatSessionSnapshot = withContext(Dispatchers.IO) {
        val path = if (sessionId.isNullOrBlank()) {
            "/chat"
        } else {
            "/chat?sessionId=$sessionId"
        }
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = path,
            method = "DELETE",
            authorizationHeader = authorizationHeader
        )

        try {
            val response = readJsonResponse(connection = connection)
            return@withContext AiChatSessionSnapshot(
                sessionId = response.getString("sessionId"),
                runState = "idle",
                updatedAtMillis = 0L,
                mainContentInvalidationVersion = 0L,
                messages = emptyList(),
                chatConfig = response.optJSONObject("chatConfig")?.let(::decodeChatConfig)
                    ?: throw AiChatRemoteException(
                        message = "Backend chat reset response is missing chatConfig.",
                        statusCode = connection.responseCode,
                        code = null,
                        stage = "response_decode",
                        requestId = connection.getHeaderField(chatRequestIdHeaderName),
                        responseBody = response.toString()
                    )
            )
        } finally {
            connection.disconnect()
        }
    }

    suspend fun stopChatRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String
    ) = withContext(Dispatchers.IO) {
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
            readJsonResponse(connection = connection)
        } finally {
            connection.disconnect()
        }
    }

    suspend fun transcribeAudio(
        apiBaseUrl: String,
        authorizationHeader: String,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): String = withContext(Dispatchers.IO) {
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
                        fileName = fileName,
                        mediaType = mediaType,
                        audioBytes = audioBytes
                    )
                )
            }

            val response = readJsonResponse(connection = connection)
            return@withContext response.getString("text")
        } finally {
            connection.disconnect()
        }
    }

    private fun openConnection(
        apiBaseUrl: String,
        path: String,
        method: String,
        authorizationHeader: String?
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
        return connection
    }

    private fun readJsonResponse(connection: HttpURLConnection): JSONObject {
        val responseCode = connection.responseCode
        if (responseCode !in 200..299) {
            throw readErrorResponse(connection = connection)
        }

        val responseBody = connection.inputStream.bufferedReader(StandardCharsets.UTF_8).use { reader ->
            reader.readText()
        }
        return JSONObject(responseBody)
    }

    private fun readErrorResponse(connection: HttpURLConnection): AiChatRemoteException {
        val responseBody = (connection.errorStream ?: connection.inputStream)?.bufferedReader(StandardCharsets.UTF_8)?.use { reader ->
            reader.readText()
        }
        val requestId = connection.getHeaderField(chatRequestIdHeaderName)
        val parsedError = parseBackendErrorPayload(rawBody = responseBody)

        return AiChatRemoteException(
            message = parsedError?.message ?: "AI chat request failed.",
            statusCode = connection.responseCode,
            code = parsedError?.code,
            stage = parsedError?.stage,
            requestId = parsedError?.requestId ?: requestId,
            responseBody = responseBody
        )
    }

    private fun encodeTurnRequest(request: AiChatTurnRequest): JSONObject {
        return JSONObject()
            .put("sessionId", request.sessionId)
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
                .put("toolCallId", part.toolCallId)
                .put("name", part.name)
                .put("status", part.status.name.lowercase())
                .put("input", part.input)
                .put("output", part.output)
        }
    }

    private fun decodeSnapshot(jsonObject: JSONObject): AiChatSessionSnapshot {
        return AiChatSessionSnapshot(
            sessionId = jsonObject.getString("sessionId"),
            runState = jsonObject.getString("runState"),
            updatedAtMillis = jsonObject.getLong("updatedAt"),
            mainContentInvalidationVersion = jsonObject.getLong("mainContentInvalidationVersion"),
            messages = decodeMessages(jsonObject.getJSONArray("messages")),
            chatConfig = decodeChatConfig(
                jsonObject.optJSONObject("chatConfig")
                    ?: throw IllegalArgumentException("Backend chat snapshot is missing chatConfig.")
            )
        )
    }

    private fun decodeMessages(jsonArray: JSONArray): List<AiChatMessage> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                val item = jsonArray.getJSONObject(index)
                add(
                    AiChatMessage(
                        messageId = item.optString("messageId", "snapshot-$index"),
                        role = if (item.getString("role") == "assistant") {
                            AiChatRole.ASSISTANT
                        } else {
                            AiChatRole.USER
                        },
                        content = decodeContentParts(item.getJSONArray("content")),
                        timestampMillis = item.getLong("timestamp"),
                        isError = item.optBoolean("isError", false)
                    )
                )
            }
        }
    }

    private fun decodeContentParts(jsonArray: JSONArray): List<AiChatContentPart> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                val item = jsonArray.getJSONObject(index)
                when (item.getString("type")) {
                    "text" -> add(
                        AiChatContentPart.Text(
                            text = item.getString("text")
                        )
                    )

                    "image" -> add(
                        AiChatContentPart.Image(
                            fileName = item.optString("fileName", "").ifBlank { null },
                            mediaType = item.getString("mediaType"),
                            base64Data = item.getString("base64Data")
                        )
                    )

                    "file" -> add(
                        AiChatContentPart.File(
                            fileName = item.getString("fileName"),
                            mediaType = item.getString("mediaType"),
                            base64Data = item.getString("base64Data")
                        )
                    )

                    "tool_call" -> add(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = item.optString("toolCallId", item.optString("id")),
                                name = item.getString("name"),
                                status = if (item.getString("status") == "completed") {
                                    AiChatToolCallStatus.COMPLETED
                                } else {
                                    AiChatToolCallStatus.STARTED
                                },
                                input = item.optString("input", "").ifBlank { null },
                                output = item.optString("output", "").ifBlank { null }
                            )
                        )
                    )

                    "reasoning_summary" -> {
                    }
                }
            }
        }
    }

    private fun decodeChatConfig(jsonObject: JSONObject): AiChatServerConfig {
        return AiChatServerConfig(
            provider = com.flashcardsopensourceapp.data.local.model.AiChatProvider(
                id = jsonObject.getJSONObject("provider").getString("id"),
                label = jsonObject.getJSONObject("provider").getString("label")
            ),
            model = com.flashcardsopensourceapp.data.local.model.AiChatServerModel(
                id = jsonObject.getJSONObject("model").getString("id"),
                label = jsonObject.getJSONObject("model").getString("label"),
                badgeLabel = jsonObject.getJSONObject("model").getString("badgeLabel")
            ),
            reasoning = com.flashcardsopensourceapp.data.local.model.AiChatReasoning(
                effort = jsonObject.getJSONObject("reasoning").getString("effort"),
                label = jsonObject.getJSONObject("reasoning").getString("label")
            ),
            features = com.flashcardsopensourceapp.data.local.model.AiChatFeatures(
                modelPickerEnabled = jsonObject.getJSONObject("features").optBoolean("modelPickerEnabled", false),
                dictationEnabled = jsonObject.getJSONObject("features").optBoolean("dictationEnabled", true),
                attachmentsEnabled = jsonObject.getJSONObject("features").optBoolean("attachmentsEnabled", true)
            )
        )
    }

    private fun encodeMultipartAudioBody(
        boundary: String,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): ByteArray {
        val outputStream = ByteArrayOutputStream()
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

internal class AiChatSseParser {
    private val currentDataLines = mutableListOf<String>()

    fun pushLine(line: String): AiChatStreamEvent? {
        if (line.startsWith("data: ")) {
            currentDataLines += line.removePrefix("data: ")
            return null
        }

        if (line.isNotEmpty()) {
            return null
        }

        return finishEvent()
    }

    fun finish(): List<AiChatStreamEvent> {
        val trailingEvent = finishEvent() ?: return emptyList()
        return listOf(trailingEvent)
    }

    private fun finishEvent(): AiChatStreamEvent? {
        if (currentDataLines.isEmpty()) {
            return null
        }

        val payload = currentDataLines.joinToString(separator = "\n")
        currentDataLines.clear()
        return parseStreamEvent(jsonObject = JSONObject(payload))
    }
}

private data class ParsedBackendError(
    val message: String,
    val code: String?,
    val stage: String?,
    val requestId: String?
)

private fun parseBackendErrorPayload(rawBody: String?): ParsedBackendError? {
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

private fun parseBackendErrorJson(jsonObject: JSONObject): ParsedBackendError? {
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

private fun parseStreamEvent(jsonObject: JSONObject): AiChatStreamEvent {
    return when (val type = jsonObject.getString("type")) {
        "delta" -> AiChatStreamEvent.Delta(
            text = jsonObject.getString("text")
        )

        "tool_call" -> AiChatStreamEvent.ToolCall(
            toolCall = AiChatToolCall(
                toolCallId = jsonObject.getString("toolCallId"),
                name = jsonObject.getString("name"),
                status = when (jsonObject.getString("status")) {
                    "started" -> AiChatToolCallStatus.STARTED
                    "completed" -> AiChatToolCallStatus.COMPLETED
                    else -> throw IllegalArgumentException("Unsupported AI chat tool call status.")
                },
                input = jsonObject.optString("input", "").ifBlank { null },
                output = jsonObject.optString("output", "").ifBlank { null }
            )
        )

        "tool_call_request" -> AiChatStreamEvent.ToolCallRequest(
            toolCallRequest = AiToolCallRequest(
                toolCallId = jsonObject.getString("toolCallId"),
                name = jsonObject.getString("name"),
                input = jsonObject.getString("input")
            )
        )

        "repair_attempt" -> AiChatStreamEvent.RepairAttempt(
            status = AiChatRepairAttemptStatus(
                message = jsonObject.getString("message"),
                attempt = jsonObject.getInt("attempt"),
                maxAttempts = jsonObject.getInt("maxAttempts"),
                toolName = jsonObject.optString("toolName", "").ifBlank { null }
            )
        )

        "done" -> AiChatStreamEvent.Done

        "error" -> AiChatStreamEvent.Error(
            error = AiChatStreamError(
                message = jsonObject.getString("message"),
                code = jsonObject.getString("code"),
                stage = jsonObject.getString("stage"),
                requestId = jsonObject.getString("requestId")
            )
        )

        else -> throw IllegalArgumentException("Unsupported AI chat stream event type: $type")
    }
}
