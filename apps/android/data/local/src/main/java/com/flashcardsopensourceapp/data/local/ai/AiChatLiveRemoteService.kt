package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets

/**
 * Owns the low-level live SSE transport for Android AI chat.
 * Snapshot/bootstrap remains the source of truth; this service only opens the
 * temporary live overlay, validates the SSE wire payloads, and stops when the
 * caller no longer wants more events.
 */
class AiChatLiveRemoteService(
    private val dispatchers: AiCoroutineDispatchers
) {
    fun attachLiveRun(
        authorizationHeader: String,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
    ): Flow<AiChatLiveEvent> = flow {
        val authorization = if (liveStream.authorization.startsWith(prefix = "Live ")) {
            liveStream.authorization
        } else {
            authorizationHeader
        }
        connectLiveStream(
            liveUrl = liveStream.url,
            authorization = authorization,
            sessionId = sessionId,
            runId = runId,
            afterCursor = afterCursor,
            resumeDiagnostics = resumeDiagnostics,
            emitEvent = { event ->
                emit(event)
                event !is AiChatLiveEvent.RunTerminal
            }
        )
    }.flowOn(dispatchers.io)

    private fun truncatedPayloadSnippet(payload: String): String {
        val trimmedPayload = payload.trim()
        return if (trimmedPayload.length <= 240) {
            trimmedPayload
        } else {
            trimmedPayload.take(n = 240)
        }
    }

    private suspend fun emitDecodedPayload(
        currentEventType: String?,
        payload: String,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        emitEvent: suspend (AiChatLiveEvent) -> Boolean
    ): Boolean {
        return when (val decodingResult = decodeAiChatLiveEventPayloadResult(eventType = currentEventType, payload = payload)) {
            is AiChatLiveEventPayloadDecodeResult.Event -> emitEvent(decodingResult.event)
            is AiChatLiveEventPayloadDecodeResult.IgnoredUnknownType -> {
                AiChatDiagnosticsLogger.warn(
                    event = "ai_live_event_skipped_unknown_type",
                    fields = listOf(
                        "sessionId" to sessionId,
                        "runId" to runId,
                        "afterCursor" to afterCursor,
                        "eventType" to decodingResult.eventType,
                        "payloadSnippet" to truncatedPayloadSnippet(payload = payload)
                    )
                )
                true
            }
        }
    }

    private suspend fun connectLiveStream(
        liveUrl: String,
        authorization: String,
        sessionId: String,
        runId: String,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        emitEvent: suspend (AiChatLiveEvent) -> Boolean
    ) {
        val urlString = buildString {
            append(liveUrl.removeSuffix("/"))
            append("?sessionId=$sessionId")
            append("&runId=$runId")
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
                    val shouldContinue = emitDecodedPayload(
                        currentEventType = currentEventType,
                        payload = payload,
                        sessionId = sessionId,
                        runId = runId,
                        afterCursor = afterCursor,
                        emitEvent = emitEvent
                    )
                    currentEventType = null
                    if (shouldContinue.not()) {
                        return
                    }
                }
                line = reader.readLine()
            }

            if (dataLines.isNotEmpty()) {
                val payload = dataLines.joinToString(separator = "\n")
                emitDecodedPayload(
                    currentEventType = currentEventType,
                    payload = payload,
                    sessionId = sessionId,
                    runId = runId,
                    afterCursor = afterCursor,
                    emitEvent = emitEvent
                )
            }
        } catch (error: CancellationException) {
            throw error
        } finally {
            connection.disconnect()
        }
    }
}
