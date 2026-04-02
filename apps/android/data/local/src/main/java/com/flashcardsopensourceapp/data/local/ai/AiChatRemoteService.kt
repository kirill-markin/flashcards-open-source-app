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
import com.flashcardsopensourceapp.data.local.model.AiChatStreamOutcome
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
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.flashcardsopensourceapp.data.local.model.StoredGuestAiSession
import kotlinx.coroutines.Dispatchers
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

class AiChatRemoteService {
    private val liveRemoteService = AiChatLiveRemoteService()

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
        request: AiChatStartRunRequest,
        onAccepted: suspend (AiChatStartRunResponse) -> Unit,
        onEvent: suspend (AiChatLiveEvent) -> Unit
    ): AiChatStreamOutcome = withContext(Dispatchers.IO) {
        val startConnection = openConnection(
            apiBaseUrl = apiBaseUrl,
            path = "/chat",
            method = "POST",
            authorizationHeader = authorizationHeader
        )

        val startResponse: AiChatStartRunResponse
        val requestId: String?

        try {
            startConnection.setRequestProperty("Content-Type", "application/json")
            startConnection.doOutput = true
            startConnection.outputStream.use { outputStream ->
                outputStream.write(encodeStartRunRequest(request = request).toString().toByteArray(StandardCharsets.UTF_8))
            }

            val responseBody = readResponseBody(connection = startConnection)
            requestId = startConnection.getHeaderField(chatRequestIdHeaderName)
            startResponse = decodeAiChatStartRunResponse(responseBody)
        } finally {
            startConnection.disconnect()
        }

        onAccepted(startResponse)
        return@withContext AiChatStreamOutcome(
            requestId = requestId,
            chatSessionId = startResponse.sessionId,
            chatConfig = startResponse.chatConfig
        )
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
    ): AiChatBootstrapResponse = withContext(Dispatchers.IO) {
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
    ): AiChatOlderMessagesResponse = withContext(Dispatchers.IO) {
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
                messages = bootstrap.messages,
                hasOlder = bootstrap.hasOlder,
                oldestCursor = bootstrap.oldestCursor
            )
        } finally {
            connection.disconnect()
        }
    }

    suspend fun attachLiveRun(
        apiBaseUrl: String,
        authorizationHeader: String,
        sessionId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        onEvent: suspend (AiChatLiveEvent) -> Unit
    ) {
        liveRemoteService.attachLiveRun(
            authorizationHeader = authorizationHeader,
            sessionId = sessionId,
            liveStream = liveStream,
            afterCursor = afterCursor,
            resumeDiagnostics = resumeDiagnostics,
            onEvent = onEvent
        )
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
            readResponseBody(connection = connection)
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
                val content = decodeContentParts(
                    jsonArray = item.requireCloudArray("content", "$fieldPath[$index].content"),
                    fieldPath = "$fieldPath[$index].content"
                )
                add(
                    AiChatMessage(
                        messageId = item.optCloudStringOrNull("messageId", "$fieldPath[$index].messageId")
                            ?.ifBlank { null }
                            ?: "snapshot-$index",
                        role = decodeMessageRole(
                            value = item.requireCloudString("role", "$fieldPath[$index].role"),
                            fieldPath = "$fieldPath[$index].role"
                        ),
                        content = content,
                        timestampMillis = item.requireCloudLong("timestamp", "$fieldPath[$index].timestamp"),
                        isError = item.requireCloudBoolean("isError", "$fieldPath[$index].isError"),
                        isStopped = item.optBoolean("isStopped", false),
                        cursor = item.optCloudStringOrNull("cursor", "$fieldPath[$index].cursor")
                            ?.ifBlank { null },
                        itemId = decodeMessageItemId(
                            jsonArray = item.requireCloudArray("content", "$fieldPath[$index].content"),
                            fieldPath = "$fieldPath[$index].content"
                        )
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
                            reasoningSummary = AiChatReasoningSummary(
                                reasoningId = decodeReasoningId(
                                    jsonObject = item,
                                    fieldPath = "$fieldPath[$index]"
                                ),
                                summary = item.requireCloudString("summary", "$fieldPath[$index].summary"),
                                status = decodeReasoningStatus(
                                    value = item.optCloudStringOrNull("status", "$fieldPath[$index].status")
                                )
                            )
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
            ),
            liveUrl = jsonObject.optCloudStringOrNull("liveUrl", "chatConfig.liveUrl")
                ?.ifBlank { null }
        )
    }

    private fun decodeStartRunResponse(jsonObject: JSONObject): AiChatStartRunResponse {
        return AiChatStartRunResponse(
            sessionId = jsonObject.requireCloudString("sessionId", "sessionId"),
            runState = decodeRunState(
                value = jsonObject.requireCloudString("runState", "runState"),
                fieldPath = "runState"
            ),
            chatConfig = decodeChatConfig(jsonObject.requireCloudObject("chatConfig", "chatConfig")),
            liveStream = jsonObject.optCloudObjectOrNull("liveStream", "liveStream")
                ?.let(::decodeLiveStreamEnvelope)
        )
    }

    private fun decodeLiveStreamEnvelope(jsonObject: JSONObject): AiChatLiveStreamEnvelope {
        return AiChatLiveStreamEnvelope(
            url = jsonObject.requireCloudString("url", "liveStream.url"),
            authorization = jsonObject.requireCloudString("authorization", "liveStream.authorization"),
            expiresAt = jsonObject.requireCloudLong("expiresAt", "liveStream.expiresAt")
        )
    }

    private fun decodeBootstrapResponse(jsonObject: JSONObject): AiChatBootstrapResponse {
        val sessionId = jsonObject.requireCloudString("sessionId", "sessionId")
        val messagesArray = jsonObject.requireCloudArray("messages", "messages")
        val messages = buildList {
            for (index in 0 until messagesArray.length()) {
                val item = messagesArray.requireCloudObject(index = index, fieldPath = "messages[$index]")
                val cursor = item.optCloudStringOrNull("cursor", "messages[$index].cursor")
                    ?.ifBlank { null } ?: "bootstrap-$index"
                val contentArray = item.requireCloudArray("content", "messages[$index].content")
                val content = decodeContentParts(
                    jsonArray = contentArray,
                    fieldPath = "messages[$index].content"
                )
                add(
                    AiChatMessage(
                        messageId = "$sessionId-$index-$cursor",
                        role = decodeMessageRole(
                            value = item.requireCloudString("role", "messages[$index].role"),
                            fieldPath = "messages[$index].role"
                        ),
                        content = content,
                        timestampMillis = item.requireCloudLong("timestamp", "messages[$index].timestamp"),
                        isError = item.requireCloudBoolean("isError", "messages[$index].isError"),
                        isStopped = item.optBoolean("isStopped", false),
                        cursor = cursor,
                        itemId = decodeMessageItemId(
                            jsonArray = contentArray,
                            fieldPath = "messages[$index].content"
                        )
                    )
                )
            }
        }

        return AiChatBootstrapResponse(
            sessionId = sessionId,
            runState = decodeRunState(
                value = jsonObject.requireCloudString("runState", "runState"),
                fieldPath = "runState"
            ),
            chatConfig = decodeChatConfig(jsonObject.requireCloudObject("chatConfig", "chatConfig")),
            messages = messages,
            hasOlder = jsonObject.requireCloudBoolean("hasOlder", "hasOlder"),
            oldestCursor = jsonObject.optCloudStringOrNull("oldestCursor", "oldestCursor")
                ?.ifBlank { null },
            liveCursor = jsonObject.optCloudStringOrNull("liveCursor", "liveCursor")
                ?.ifBlank { null },
            liveStream = jsonObject.optCloudObjectOrNull("liveStream", "liveStream")
                ?.let(::decodeLiveStreamEnvelope)
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

private fun decodeToolCallId(jsonObject: JSONObject, fieldPath: String): String {
    return jsonObject.optCloudStringOrNull("toolCallId", "$fieldPath.toolCallId")
        ?.ifBlank { null }
        ?: jsonObject.optCloudStringOrNull("id", "$fieldPath.id")
        ?.ifBlank { null }
        ?: throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: missing AI chat tool call id"
        )
}

private fun decodeReasoningId(jsonObject: JSONObject, fieldPath: String): String {
    return jsonObject.optCloudStringOrNull("reasoningId", "$fieldPath.reasoningId")
        ?.ifBlank { null }
        ?: jsonObject.optCloudStringOrNull("id", "$fieldPath.id")
        ?.ifBlank { null }
        ?: jsonObject.optCloudObjectOrNull("streamPosition", "$fieldPath.streamPosition")
            ?.optCloudStringOrNull("itemId", "$fieldPath.streamPosition.itemId")
            ?.ifBlank { null }
        ?: throw CloudContractMismatchException(
            "Cloud contract mismatch for $fieldPath: missing AI chat reasoning summary id"
        )
}

private fun decodeMessageItemId(jsonArray: JSONArray, fieldPath: String): String? {
    for (index in 0 until jsonArray.length()) {
        val item = jsonArray.requireCloudObject(index = index, fieldPath = "$fieldPath[$index]")
        val streamPosition = item.optCloudObjectOrNull("streamPosition", "$fieldPath[$index].streamPosition")
            ?: continue
        val itemId = streamPosition.optCloudStringOrNull("itemId", "$fieldPath[$index].streamPosition.itemId")
            ?.ifBlank { null }
        if (itemId != null) {
            return itemId
        }
    }

    return null
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

private fun decodeReasoningStatus(value: String?): AiChatToolCallStatus {
    return when (value) {
        null, "", "completed", "COMPLETED" -> AiChatToolCallStatus.COMPLETED
        "started", "STARTED" -> AiChatToolCallStatus.STARTED
        else -> throw CloudContractMismatchException(
            "Cloud contract mismatch for reasoning_summary.status: unsupported AI chat reasoning status \"$value\""
        )
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
