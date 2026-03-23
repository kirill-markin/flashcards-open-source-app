package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatStreamError
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiChatTurnRequest
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

private const val chatRequestIdHeaderName: String = "X-Chat-Request-Id"
private const val codeInterpreterContainerIdHeaderName: String = "X-Code-Interpreter-Container-Id"

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
        val connection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/chat/turn",
            method = "POST",
            authorizationHeader = authorizationHeader
        )

        try {
            connection.setRequestProperty("Content-Type", "application/json")
            connection.doOutput = true
            connection.outputStream.use { outputStream ->
                outputStream.write(encodeTurnRequest(request = request).toString().toByteArray(StandardCharsets.UTF_8))
            }

            val responseCode = connection.responseCode
            if (responseCode !in 200..299) {
                throw readErrorResponse(connection = connection)
            }

            val requestId = connection.getHeaderField(chatRequestIdHeaderName)
            val codeInterpreterContainerId =
                connection.getHeaderField(codeInterpreterContainerIdHeaderName)
            BufferedReader(
                InputStreamReader(connection.inputStream, StandardCharsets.UTF_8)
            ).use { reader ->
                val parser = AiChatSseParser()
                while (true) {
                    val line = reader.readLine() ?: break
                    val event = parser.pushLine(line = line)
                    if (event != null) {
                        onEvent(event)
                        if (event is AiChatStreamEvent.Done) {
                            break
                        }
                    }
                }

                for (event in parser.finish()) {
                    onEvent(event)
                }
            }

            return@withContext AiChatStreamOutcome(
                requestId = requestId,
                codeInterpreterContainerId = codeInterpreterContainerId
            )
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
            .put("messages", JSONArray(request.messages.map(::encodeWireMessage)))
            .put("model", request.model)
            .put("timezone", request.timezone)
            .put("devicePlatform", request.devicePlatform)
            .put("chatSessionId", request.chatSessionId)
            .put("codeInterpreterContainerId", request.codeInterpreterContainerId)
            .put(
                "userContext",
                JSONObject()
                    .put("totalCards", request.userContext.totalCards)
            )
    }

    private fun encodeWireMessage(message: com.flashcardsopensourceapp.data.local.model.AiChatWireMessage): JSONObject {
        return JSONObject()
            .put("role", message.role)
            .put("content", JSONArray(message.content.map(::encodeWireContentPart)))
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
