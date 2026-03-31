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
import com.flashcardsopensourceapp.data.local.model.AiChatStreamError
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunRequest
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
                guestToken = response.requireCloudString("guestToken", "guestToken"),
                userId = response.requireCloudString("userId", "userId"),
                workspaceId = response.requireCloudString("workspaceId", "workspaceId"),
                configurationMode = configurationMode,
                apiBaseUrl = apiBaseUrl
            )
        } finally {
            connection.disconnect()
        }
    }

    suspend fun startRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        request: AiChatStartRunRequest,
        onAccepted: suspend (String, AiChatServerConfig?) -> Unit,
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
                outputStream.write(encodeStartRunRequest(request = request).toString().toByteArray(StandardCharsets.UTF_8))
            }

            val response = readJsonResponse(connection = startConnection)
            requestId = startConnection.getHeaderField(chatRequestIdHeaderName)
            sessionId = response.requireCloudString("sessionId", "sessionId")
            latestChatConfig = response.optCloudObjectOrNull("chatConfig", "chatConfig")?.let(::decodeChatConfig)
        } finally {
            startConnection.disconnect()
        }

        onAccepted(sessionId, latestChatConfig)

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
                        chatConfig = latestChatConfig,
                        finalSnapshot = snapshot
                    )
                }

                delay(activeRunSnapshotPollIntervalMs)
            }

            throw IllegalStateException("Chat polling loop exited unexpectedly.")
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) {
                try {
                    stopRun(
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

    suspend fun createNewSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String?
    ): AiChatSessionSnapshot = withContext(Dispatchers.IO) {
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
            val response = readJsonResponse(connection = connection)
            return@withContext AiChatSessionSnapshot(
                sessionId = response.requireCloudString("sessionId", "sessionId"),
                runState = "idle",
                updatedAtMillis = 0L,
                mainContentInvalidationVersion = 0L,
                messages = emptyList(),
                chatConfig = decodeChatConfig(response.requireCloudObject("chatConfig", "chatConfig"))
            )
        } finally {
            connection.disconnect()
        }
    }

    suspend fun stopRun(
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
        sessionId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult = withContext(Dispatchers.IO) {
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

            val response = readJsonResponse(connection = connection)
            return@withContext AiChatTranscriptionResult(
                text = response.requireCloudString("text", "text"),
                sessionId = response.requireCloudString("sessionId", "sessionId")
            )
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

    private fun decodeSnapshot(jsonObject: JSONObject): AiChatSessionSnapshot {
        return AiChatSessionSnapshot(
            sessionId = jsonObject.requireCloudString("sessionId", "sessionId"),
            runState = decodeRunState(
                value = jsonObject.requireCloudString("runState", "runState"),
                fieldPath = "runState"
            ),
            updatedAtMillis = jsonObject.requireCloudLong("updatedAt", "updatedAt"),
            mainContentInvalidationVersion = jsonObject.requireCloudLong(
                "mainContentInvalidationVersion",
                "mainContentInvalidationVersion"
            ),
            messages = decodeMessages(
                jsonArray = jsonObject.requireCloudArray("messages", "messages"),
                fieldPath = "messages"
            ),
            chatConfig = decodeChatConfig(jsonObject.requireCloudObject("chatConfig", "chatConfig"))
        )
    }

    private fun decodeMessages(jsonArray: JSONArray, fieldPath: String): List<AiChatMessage> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                val item = jsonArray.requireCloudObject(index = index, fieldPath = "$fieldPath[$index]")
                add(
                    AiChatMessage(
                        messageId = item.optCloudStringOrNull("messageId", "$fieldPath[$index].messageId")
                            ?.ifBlank { null }
                            ?: "snapshot-$index",
                        role = decodeMessageRole(
                            value = item.requireCloudString("role", "$fieldPath[$index].role"),
                            fieldPath = "$fieldPath[$index].role"
                        ),
                        content = decodeContentParts(
                            jsonArray = item.requireCloudArray("content", "$fieldPath[$index].content"),
                            fieldPath = "$fieldPath[$index].content"
                        ),
                        timestampMillis = item.requireCloudLong("timestamp", "$fieldPath[$index].timestamp"),
                        isError = item.requireCloudBoolean("isError", "$fieldPath[$index].isError")
                    )
                )
            }
        }
    }

    private fun decodeContentParts(jsonArray: JSONArray, fieldPath: String): List<AiChatContentPart> {
        return buildList {
            for (index in 0 until jsonArray.length()) {
                val item = jsonArray.requireCloudObject(index = index, fieldPath = "$fieldPath[$index]")
                when (val type = item.requireCloudString("type", "$fieldPath[$index].type")) {
                    "text" -> add(
                        AiChatContentPart.Text(
                            text = item.requireCloudString("text", "$fieldPath[$index].text")
                        )
                    )

                    "reasoning_summary" -> add(
                        AiChatContentPart.ReasoningSummary(
                            summary = item.requireCloudString("summary", "$fieldPath[$index].summary")
                        )
                    )

                    "image" -> add(
                        AiChatContentPart.Image(
                            fileName = item.optCloudStringOrNull("fileName", "$fieldPath[$index].fileName")
                                ?.ifBlank { null },
                            mediaType = item.requireCloudString("mediaType", "$fieldPath[$index].mediaType"),
                            base64Data = item.requireCloudString("base64Data", "$fieldPath[$index].base64Data")
                        )
                    )

                    "file" -> add(
                        AiChatContentPart.File(
                            fileName = item.requireCloudString("fileName", "$fieldPath[$index].fileName"),
                            mediaType = item.requireCloudString("mediaType", "$fieldPath[$index].mediaType"),
                            base64Data = item.requireCloudString("base64Data", "$fieldPath[$index].base64Data")
                        )
                    )

                    "tool_call" -> add(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = decodeToolCallId(
                                    jsonObject = item,
                                    fieldPath = "$fieldPath[$index]"
                                ),
                                name = item.requireCloudString("name", "$fieldPath[$index].name"),
                                status = decodeToolCallStatus(
                                    value = item.requireCloudString("status", "$fieldPath[$index].status"),
                                    fieldPath = "$fieldPath[$index].status"
                                ),
                                input = item.optCloudStringOrNull("input", "$fieldPath[$index].input")?.ifBlank { null },
                                output = item.optCloudStringOrNull("output", "$fieldPath[$index].output")?.ifBlank { null }
                            )
                        )
                    )

                    else -> throw CloudContractMismatchException(
                        "Cloud contract mismatch for $fieldPath[$index].type: unsupported AI chat content part type \"$type\""
                    )
                }
            }
        }
    }

    private fun decodeChatConfig(jsonObject: JSONObject): AiChatServerConfig {
        val provider = jsonObject.requireCloudObject("provider", "chatConfig.provider")
        val model = jsonObject.requireCloudObject("model", "chatConfig.model")
        val reasoning = jsonObject.requireCloudObject("reasoning", "chatConfig.reasoning")
        val features = jsonObject.requireCloudObject("features", "chatConfig.features")

        return AiChatServerConfig(
            provider = com.flashcardsopensourceapp.data.local.model.AiChatProvider(
                id = provider.requireCloudString("id", "chatConfig.provider.id"),
                label = provider.requireCloudString("label", "chatConfig.provider.label")
            ),
            model = com.flashcardsopensourceapp.data.local.model.AiChatServerModel(
                id = model.requireCloudString("id", "chatConfig.model.id"),
                label = model.requireCloudString("label", "chatConfig.model.label"),
                badgeLabel = model.requireCloudString("badgeLabel", "chatConfig.model.badgeLabel")
            ),
            reasoning = com.flashcardsopensourceapp.data.local.model.AiChatReasoning(
                effort = reasoning.requireCloudString("effort", "chatConfig.reasoning.effort"),
                label = reasoning.requireCloudString("label", "chatConfig.reasoning.label")
            ),
            features = com.flashcardsopensourceapp.data.local.model.AiChatFeatures(
                modelPickerEnabled = features.requireCloudBoolean(
                    "modelPickerEnabled",
                    "chatConfig.features.modelPickerEnabled"
                ),
                dictationEnabled = features.requireCloudBoolean(
                    "dictationEnabled",
                    "chatConfig.features.dictationEnabled"
                ),
                attachmentsEnabled = features.requireCloudBoolean(
                    "attachmentsEnabled",
                    "chatConfig.features.attachmentsEnabled"
                )
            )
        )
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

private fun decodeToolCallId(jsonObject: JSONObject, fieldPath: String): String {
    return jsonObject.optCloudStringOrNull("toolCallId", "$fieldPath.toolCallId")
        ?.ifBlank { null }
        ?: jsonObject.optCloudStringOrNull("id", "$fieldPath.id")
        ?.ifBlank { null }
        ?: throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: missing AI chat tool call id"
        )
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
    return when (val type = jsonObject.requireCloudString("type", "type")) {
        "delta" -> AiChatStreamEvent.Delta(
            text = jsonObject.requireCloudString("text", "text")
        )

        "tool_call" -> AiChatStreamEvent.ToolCall(
            toolCall = AiChatToolCall(
                toolCallId = decodeToolCallId(
                    jsonObject = jsonObject,
                    fieldPath = "tool_call"
                ),
                name = jsonObject.requireCloudString("name", "name"),
                status = decodeToolCallStatus(
                    value = jsonObject.requireCloudString("status", "status"),
                    fieldPath = "status"
                ),
                input = jsonObject.optCloudStringOrNull("input", "input")?.ifBlank { null },
                output = jsonObject.optCloudStringOrNull("output", "output")?.ifBlank { null }
            )
        )

        "tool_call_request" -> AiChatStreamEvent.ToolCallRequest(
            toolCallRequest = AiToolCallRequest(
                toolCallId = decodeToolCallId(
                    jsonObject = jsonObject,
                    fieldPath = "tool_call_request"
                ),
                name = jsonObject.requireCloudString("name", "name"),
                input = jsonObject.requireCloudString("input", "input")
            )
        )

        "repair_attempt" -> AiChatStreamEvent.RepairAttempt(
            status = AiChatRepairAttemptStatus(
                message = jsonObject.requireCloudString("message", "message"),
                attempt = jsonObject.requireCloudInt("attempt", "attempt"),
                maxAttempts = jsonObject.requireCloudInt("maxAttempts", "maxAttempts"),
                toolName = jsonObject.optCloudStringOrNull("toolName", "toolName")?.ifBlank { null }
            )
        )

        "done" -> AiChatStreamEvent.Done

        "error" -> AiChatStreamEvent.Error(
            error = AiChatStreamError(
                message = jsonObject.requireCloudString("message", "message"),
                code = jsonObject.requireCloudString("code", "code"),
                stage = jsonObject.requireCloudString("stage", "stage"),
                requestId = jsonObject.requireCloudString("requestId", "requestId")
            )
        )

        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for type: unsupported AI chat stream event type \"$type\""
        )
    }
}

private fun decodeRunState(value: String, fieldPath: String): String {
    return when (value) {
        "idle", "running", "completed", "failed", "stopped", "interrupted" -> value
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: unsupported AI chat run state \"$value\""
        )
    }
}

private fun decodeMessageRole(value: String, fieldPath: String): AiChatRole {
    return when (value) {
        "user" -> AiChatRole.USER
        "assistant" -> AiChatRole.ASSISTANT
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: unsupported AI chat role \"$value\""
        )
    }
}

private fun decodeToolCallStatus(value: String, fieldPath: String): AiChatToolCallStatus {
    return when (value) {
        "started" -> AiChatToolCallStatus.STARTED
        "completed" -> AiChatToolCallStatus.COMPLETED
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: unsupported AI chat tool call status \"$value\""
        )
    }
}
