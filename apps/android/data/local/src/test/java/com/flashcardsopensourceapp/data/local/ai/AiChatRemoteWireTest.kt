package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatRemoteWireTest {
    @Test
    fun loadBootstrapIncludesResumeDiagnosticsHeaders() = runBlocking {
        val headersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat") { exchange ->
            headersRef.set(
                exchange.requestHeaders.entries.associate { (key, value) ->
                    key to value.joinToString(separator = ",")
                }
            )
            val body = """
                {
                  "sessionId": "session-1",
                  "runState": "running",
                  "chatConfig": {
                    "provider": { "id": "openai", "label": "OpenAI" },
                    "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                    "reasoning": { "effort": "medium", "label": "Medium" },
                    "features": {
                      "modelPickerEnabled": false,
                      "dictationEnabled": true,
                      "attachmentsEnabled": true
                    },
                    "liveUrl": "http://localhost/live"
                  },
                  "messages": [],
                  "hasOlder": false,
                  "oldestCursor": null,
                  "liveCursor": "5",
                  "liveStream": null
                }
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = AiChatRemoteService()
            val response = service.loadBootstrap(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                limit = 20,
                resumeDiagnostics = AiChatResumeDiagnostics(
                    resumeAttemptId = 41L,
                    clientPlatform = "android",
                    clientVersion = "1.0.0"
                )
            )

            assertEquals("session-1", response.sessionId)
            assertEquals("41", headersRef.get()["X-chat-resume-attempt-id"])
            assertEquals("android", headersRef.get()["X-client-platform"])
            assertEquals("1.0.0", headersRef.get()["X-client-version"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun liveAttachIncludesResumeDiagnosticsHeaders() = runBlocking {
        val headersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/live") { exchange ->
            headersRef.set(
                exchange.requestHeaders.entries.associate { (key, value) ->
                    key to value.joinToString(separator = ",")
                }
            )
            val body = """
                event: run_state
                data: {"type":"run_state","runState":"idle","sessionId":"session-1"}

            """.trimIndent().toByteArray()
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = AiChatLiveRemoteService()
            service.attachLiveRun(
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                liveStream = AiChatLiveStreamEnvelope(
                    url = "http://127.0.0.1:${server.address.port}/live",
                    authorization = "Live token-2",
                    expiresAt = 123L
                ),
                afterCursor = "5",
                resumeDiagnostics = AiChatResumeDiagnostics(
                    resumeAttemptId = 42L,
                    clientPlatform = "android",
                    clientVersion = "1.0.0"
                ),
                onEvent = {}
            )

            assertEquals("42", headersRef.get()["X-chat-resume-attempt-id"])
            assertEquals("android", headersRef.get()["X-client-platform"])
            assertEquals("1.0.0", headersRef.get()["X-client-version"])
            assertEquals("Live token-2", headersRef.get()["Authorization"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun decodeAiChatLiveEventPayloadAcceptsUnknownFields() {
        val event = decodeAiChatLiveEventPayload(
            eventType = "assistant_message_done",
            payload = """
            {
              "cursor": "12",
              "itemId": "item-1",
              "content": [{ "type": "text", "text": "done" }],
              "isError": false,
              "isStopped": true,
              "futureField": "ignored"
            }
            """.trimIndent()
        )

        require(event is com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent.AssistantMessageDone)
        assertEquals("12", event.cursor)
        assertEquals("item-1", event.itemId)
        assertEquals(1, event.content.size)
        assertFalse(event.isError)
        assertTrue(event.isStopped)
    }

    @Test(expected = CloudContractMismatchException::class)
    fun decodeAiChatLiveEventPayloadRejectsMissingRequiredField() {
        decodeAiChatLiveEventPayload(
            eventType = "assistant_delta",
            payload = """
            {
              "cursor": "12",
              "itemId": "item-1"
            }
            """.trimIndent()
        )
    }

    @Test(expected = CloudContractMismatchException::class)
    fun decodeAiChatLiveEventPayloadRejectsWrongType() {
        decodeAiChatLiveEventPayload(
            eventType = "assistant_message_done",
            payload = """
            {
              "cursor": "12",
              "itemId": "item-1",
              "content": [],
              "isError": "false",
              "isStopped": true
            }
            """.trimIndent()
        )
    }

    @Test(expected = CloudContractMismatchException::class)
    fun decodeAiChatLiveEventPayloadRejectsUnknownEnumValue() {
        decodeAiChatLiveEventPayload(
            eventType = "assistant_tool_call",
            payload = """
            {
              "toolCallId": "tool-1",
              "name": "sql",
              "status": "pending",
              "cursor": "12",
              "itemId": "item-1"
            }
            """.trimIndent()
        )
    }

    @Test(expected = CloudContractMismatchException::class)
    fun decodeAiChatLiveEventPayloadRejectsMalformedJson() {
        decodeAiChatLiveEventPayload(
            eventType = "assistant_delta",
            payload = "{\"text\":\"hi\""
        )
    }

    @Test
    fun decodeAiChatGuestSessionMapsDomainValues() {
        val session = decodeAiChatGuestSession(
            payload = """
            {
              "guestToken": "guest-token",
              "userId": "user-1",
              "workspaceId": "workspace-1"
            }
            """.trimIndent(),
            apiBaseUrl = "https://api.flashcards-open-source-app.com/v1",
            configurationMode = CloudServiceConfigurationMode.OFFICIAL
        )

        assertEquals("guest-token", session.guestToken)
        assertEquals("user-1", session.userId)
        assertEquals("workspace-1", session.workspaceId)
        assertEquals("https://api.flashcards-open-source-app.com/v1", session.apiBaseUrl)
    }
}
