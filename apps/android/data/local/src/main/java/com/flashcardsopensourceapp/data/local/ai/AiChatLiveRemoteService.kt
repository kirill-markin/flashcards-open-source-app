package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * Owns the low-level live SSE transport for Android AI chat.
 * Snapshot/bootstrap remains the source of truth; this service only opens the
 * temporary live overlay, validates the SSE wire payloads, and stops when the
 * caller no longer wants more events.
 */
class AiChatLiveRemoteService {
    suspend fun attachLiveRun(
        authorizationHeader: String,
        sessionId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        onEvent: suspend (AiChatLiveEvent) -> Unit
    ) {
        val authorization = if (liveStream.authorization.startsWith(prefix = "Live ")) {
            liveStream.authorization
        } else {
            authorizationHeader
        }
        connectLiveStream(
            liveUrl = liveStream.url,
            authorization = authorization,
            sessionId = sessionId,
            afterCursor = afterCursor,
            resumeDiagnostics = resumeDiagnostics,
            onEvent = { event ->
                onEvent(event)
                when (event) {
                    is AiChatLiveEvent.RunState -> event.runState == "running"
                    is AiChatLiveEvent.AssistantMessageDone,
                    is AiChatLiveEvent.Error,
                    is AiChatLiveEvent.StopAck,
                    AiChatLiveEvent.ResetRequired -> false
                    is AiChatLiveEvent.AssistantDelta,
                    is AiChatLiveEvent.AssistantReasoningDone,
                    is AiChatLiveEvent.AssistantReasoningStarted,
                    is AiChatLiveEvent.AssistantReasoningSummary,
                    is AiChatLiveEvent.AssistantToolCall,
                    is AiChatLiveEvent.RepairStatus -> true
                }
            }
        )
    }

    /**
     * Opens one SSE connection and forwards typed events until the caller asks
     * to stop, the server terminates the run, or the socket closes.
     */
    suspend fun connectLiveStream(
        liveUrl: String,
        authorization: String,
        sessionId: String,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        onEvent: suspend (AiChatLiveEvent) -> Boolean
    ): Unit = withContext(Dispatchers.IO) {
        val urlString = buildString {
            append(liveUrl.removeSuffix("/"))
            append("?sessionId=$sessionId")
            if (afterCursor != null) {
                append("&afterCursor=$afterCursor")
            }
        }
        val connection = (URL(urlString).openConnection() as HttpURLConnection)
        connection.requestMethod = "GET"
        connection.connectTimeout = 15_000
        connection.readTimeout = 600_000
        connection.useCaches = false
        connection.setRequestProperty("Accept", "text/event-stream")
        connection.setRequestProperty("Authorization", authorization)
        if (resumeDiagnostics != null) {
            connection.setRequestProperty(
                "X-Chat-Resume-Attempt-Id",
                resumeDiagnostics.resumeAttemptId.toString()
            )
            connection.setRequestProperty("X-Client-Platform", resumeDiagnostics.clientPlatform)
            connection.setRequestProperty("X-Client-Version", resumeDiagnostics.clientVersion)
        }

        try {
            val responseCode = connection.responseCode
            if (responseCode !in 200..299) {
                throw readAiChatRemoteErrorResponse(connection = connection)
            }

            val reader = connection.inputStream.bufferedReader(StandardCharsets.UTF_8)
            var currentEventType: String? = null
            val dataLines = mutableListOf<String>()

            var line: String? = reader.readLine()
            while (line != null) {
                if (line.startsWith("event: ")) {
                    currentEventType = line.removePrefix("event: ")
                } else if (line.startsWith("data: ")) {
                    dataLines += line.removePrefix("data: ")
                } else if (line.startsWith(":")) {
                    // keepalive comment, ignore
                } else if (line.isEmpty() && dataLines.isNotEmpty()) {
                    val payload = dataLines.joinToString(separator = "\n")
                    dataLines.clear()
                    val event = decodeAiChatLiveEventPayload(currentEventType, payload)
                    currentEventType = null
                    val shouldContinue = runBlocking { onEvent(event) }
                    if (shouldContinue.not()) {
                        return@withContext
                    }
                }
                line = reader.readLine()
            }

            if (dataLines.isNotEmpty()) {
                val payload = dataLines.joinToString(separator = "\n")
                val event = decodeAiChatLiveEventPayload(currentEventType, payload)
                runBlocking { onEvent(event) }
            }
        } finally {
            connection.disconnect()
        }
    }
}
