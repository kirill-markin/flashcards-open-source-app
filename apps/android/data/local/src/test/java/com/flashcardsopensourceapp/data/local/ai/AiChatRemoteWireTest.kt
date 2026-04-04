package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatRemoteWireTest {
    private val appVersion: String = "1.1.0"

    private fun makeDispatchers(): AiCoroutineDispatchers {
        return AiCoroutineDispatchers(io = Dispatchers.IO)
    }

    private fun makeLiveRemoteService(): AiChatLiveRemoteService {
        return AiChatLiveRemoteService(dispatchers = makeDispatchers())
    }

    private fun makeRemoteService(): AiChatRemoteService {
        return AiChatRemoteService(
            dispatchers = makeDispatchers(),
            liveRemoteService = makeLiveRemoteService()
        )
    }

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
                  "conversationScopeId": "session-1",
                  "conversation": {
                    "updatedAt": 111,
                    "mainContentInvalidationVersion": 222,
                    "messages": [],
                    "hasOlder": false,
                    "oldestCursor": null
                  },
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
                  "activeRun": {
                    "runId": "run-1",
                    "status": "running",
                    "live": {
                      "cursor": "5",
                      "stream": {
                        "url": "http://localhost/live",
                        "authorization": "Live token-1",
                        "expiresAt": 123
                      }
                    },
                    "lastHeartbeatAt": 456
                  }
                }
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            val response = service.loadBootstrap(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                limit = 20,
                resumeDiagnostics = AiChatResumeDiagnostics(
                    resumeAttemptId = 41L,
                    clientPlatform = "android",
                    clientVersion = appVersion
                )
            )

            assertEquals("session-1", response.sessionId)
            assertEquals("session-1", response.conversationScopeId)
            assertEquals("run-1", response.activeRun?.runId)
            assertEquals("5", response.activeRun?.live?.cursor)
            assertEquals("41", headersRef.get()["X-chat-resume-attempt-id"])
            assertEquals("android", headersRef.get()["X-client-platform"])
            assertEquals(appVersion, headersRef.get()["X-client-version"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun decodeAcceptedEnvelopeIncludesActiveRun() {
        val response = decodeAiChatStartRunResponse(
            payload = """
            {
              "accepted": true,
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
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
              "activeRun": {
                "runId": "run-1",
                "status": "running",
                "live": {
                  "cursor": "9",
                  "stream": {
                    "url": "http://localhost/live",
                    "authorization": "Live token-1",
                    "expiresAt": 123
                  }
                },
                "lastHeartbeatAt": 456
              },
              "deduplicated": false
            }
            """.trimIndent()
        )

        assertTrue(response.accepted)
        assertEquals("session-1", response.conversationScopeId)
        assertEquals("run-1", response.activeRun?.runId)
        assertEquals("9", response.activeRun?.live?.cursor)
        assertEquals(false, response.deduplicated)
    }

    @Test
    fun decodeSnapshotEnvelopeWithoutActiveRun() {
        val snapshot = decodeAiChatSessionSnapshot(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [],
                "hasOlder": false,
                "oldestCursor": null
              },
              "chatConfig": {
                "provider": { "id": "openai", "label": "OpenAI" },
                "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                "reasoning": { "effort": "medium", "label": "Medium" },
                "features": {
                  "modelPickerEnabled": false,
                  "dictationEnabled": true,
                  "attachmentsEnabled": true
                },
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        assertEquals("session-1", snapshot.sessionId)
        assertEquals("session-1", snapshot.conversationScopeId)
        assertNull(snapshot.activeRun)
        assertEquals(0, snapshot.conversation.messages.size)
    }

    @Test
    fun liveAttachIncludesResumeDiagnosticsHeadersAndRunIdQueryParam() = runBlocking {
        val headersRef = AtomicReference<Map<String, String>>(emptyMap())
        val queryRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/live") { exchange ->
            headersRef.set(
                exchange.requestHeaders.entries.associate { (key, value) ->
                    key to value.joinToString(separator = ",")
                }
            )
            queryRef.set(exchange.requestURI.rawQuery ?: "")
            val body = """
                event: run_terminal
                data: {"type":"run_terminal","sessionId":"session-1","conversationScopeId":"session-1","runId":"run-1","cursor":"12","sequenceNumber":3,"streamEpoch":"run-1","outcome":"completed"}

            """.trimIndent().toByteArray()
            exchange.responseHeaders.add("Content-Type", "text/event-stream")
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeLiveRemoteService()
            val events = service.attachLiveRun(
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                runId = "run-1",
                liveStream = AiChatLiveStreamEnvelope(
                    url = "http://127.0.0.1:${server.address.port}/live",
                    authorization = "Live token-2",
                    expiresAt = 123L
                ),
                afterCursor = "5",
                resumeDiagnostics = AiChatResumeDiagnostics(
                    resumeAttemptId = 42L,
                    clientPlatform = "android",
                    clientVersion = appVersion
                )
            ).toList()

            assertEquals("42", headersRef.get()["X-chat-resume-attempt-id"])
            assertEquals("android", headersRef.get()["X-client-platform"])
            assertEquals(appVersion, headersRef.get()["X-client-version"])
            assertEquals("Live token-2", headersRef.get()["Authorization"])
            assertTrue(queryRef.get().contains("sessionId=session-1"))
            assertTrue(queryRef.get().contains("runId=run-1"))
            assertTrue(queryRef.get().contains("afterCursor=5"))
            assertEquals(1, events.size)
            require(events.single() is AiChatLiveEvent.RunTerminal)
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
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "12",
              "sequenceNumber": 2,
              "streamEpoch": "run-1",
              "itemId": "item-1",
              "content": [{ "type": "text", "text": "done" }],
              "isError": false,
              "isStopped": true,
              "futureField": "ignored"
            }
            """.trimIndent()
        )

        require(event is AiChatLiveEvent.AssistantMessageDone)
        assertEquals("session-1", event.metadata.sessionId)
        assertEquals("run-1", event.metadata.runId)
        assertEquals("12", event.metadata.cursor)
        assertEquals("item-1", event.itemId)
        assertEquals(1, event.content.size)
        assertFalse(event.isError)
        assertTrue(event.isStopped)
    }

    @Test
    fun decodeRunTerminalCompleted() {
        val event = decodeAiChatLiveEventPayload(
            eventType = "run_terminal",
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "12",
              "sequenceNumber": 3,
              "streamEpoch": "run-1",
              "outcome": "completed"
            }
            """.trimIndent()
        )

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.COMPLETED, event.outcome)
        assertNull(event.message)
    }

    @Test
    fun decodeRunTerminalStopped() {
        val event = decodeAiChatLiveEventPayload(
            eventType = "run_terminal",
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "12",
              "sequenceNumber": 3,
              "streamEpoch": "run-1",
              "outcome": "stopped",
              "assistantItemId": "item-1",
              "isStopped": true
            }
            """.trimIndent()
        )

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.STOPPED, event.outcome)
        assertEquals("item-1", event.assistantItemId)
        assertEquals(true, event.isStopped)
    }

    @Test
    fun decodeRunTerminalError() {
        val event = decodeAiChatLiveEventPayload(
            eventType = "run_terminal",
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": null,
              "sequenceNumber": 3,
              "streamEpoch": "run-1",
              "outcome": "error",
              "message": "boom",
              "isError": true
            }
            """.trimIndent()
        )

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.ERROR, event.outcome)
        assertEquals("boom", event.message)
        assertEquals(true, event.isError)
    }

    @Test
    fun decodeRunTerminalResetRequired() {
        val event = decodeAiChatLiveEventPayload(
            eventType = "run_terminal",
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": null,
              "sequenceNumber": 3,
              "streamEpoch": "run-1",
              "outcome": "reset_required",
              "message": "refresh"
            }
            """.trimIndent()
        )

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.RESET_REQUIRED, event.outcome)
        assertEquals("refresh", event.message)
    }

    @Test(expected = CloudContractMismatchException::class)
    fun decodeAiChatLiveEventPayloadRejectsMissingRequiredField() {
        decodeAiChatLiveEventPayload(
            eventType = "assistant_delta",
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "12",
              "sequenceNumber": 1,
              "streamEpoch": "run-1",
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
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "12",
              "sequenceNumber": 2,
              "streamEpoch": "run-1",
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
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "runId": "run-1",
              "cursor": "12",
              "sequenceNumber": 1,
              "streamEpoch": "run-1",
              "toolCallId": "tool-1",
              "name": "sql",
              "status": "pending",
              "itemId": "item-1",
              "outputIndex": 0
            }
            """.trimIndent()
        )
    }

    @Test(expected = CloudContractMismatchException::class)
    fun decodeAiChatLiveEventPayloadRejectsOldTerminalContract() {
        decodeAiChatLiveEventPayload(
            eventType = "stop_ack",
            payload = """
            {
              "sessionId": "session-1"
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
