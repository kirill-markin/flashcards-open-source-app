package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatNewSessionRequest
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunRequest
import com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatRemoteTransportRequestTest {
    @Test
    fun loadBootstrapIncludesResumeDiagnosticsHeaders() = runBlocking {
        val headersRef = AtomicReference<Map<String, String>>(emptyMap())
        val queryParametersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat") { exchange ->
            headersRef.set(
                exchange.requestHeaders.entries.associate { (key, value) ->
                    key to value.joinToString(separator = ",")
                }
            )
            queryParametersRef.set(parseAiChatTestQueryParameters(rawQuery = exchange.requestURI.rawQuery))
            writeAiChatTestJsonResponse(exchange = exchange, body = bootstrapEnvelopeWithActiveRunJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.loadBootstrap(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                limit = 20,
                workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                resumeDiagnostics = AiChatResumeDiagnostics(
                    resumeAttemptId = 41L,
                    clientPlatform = "android",
                    clientVersion = AI_CHAT_TEST_APP_VERSION
                )
            )

            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals("20", queryParametersRef.get()["limit"])
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, queryParametersRef.get()["workspaceId"])
            assertEquals("41", headersRef.get()["X-chat-resume-attempt-id"])
            assertEquals("android", headersRef.get()["X-client-platform"])
            assertEquals(AI_CHAT_TEST_APP_VERSION, headersRef.get()["X-client-version"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun startRunIncludesUiLocaleWhenPresent() = runBlocking {
        val requestBodyRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat") { exchange ->
            requestBodyRef.set(exchange.requestBody.bufferedReader().use { reader -> reader.readText() })
            writeAiChatTestJsonResponse(exchange = exchange, body = acceptedConversationEnvelopeJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.startRun(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatStartRunRequest(
                    sessionId = "session-1",
                    workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                    clientRequestId = "request-1",
                    content = listOf(AiChatWireContentPart.Text(text = "Hello")),
                    timezone = "Europe/Madrid",
                    uiLocale = AI_CHAT_TEST_UI_LOCALE
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, requestBody.getString("workspaceId"))
            assertEquals(AI_CHAT_TEST_UI_LOCALE, requestBody.getString("uiLocale"))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun createNewSessionIncludesUiLocaleWhenPresent() = runBlocking {
        val requestBodyRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat/new") { exchange ->
            requestBodyRef.set(exchange.requestBody.bufferedReader().use { reader -> reader.readText() })
            writeAiChatTestJsonResponse(exchange = exchange, body = newSessionResponseJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.createNewSession(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatNewSessionRequest(
                    sessionId = "session-1",
                    workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                    uiLocale = AI_CHAT_TEST_UI_LOCALE
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, requestBody.getString("workspaceId"))
            assertEquals(AI_CHAT_TEST_UI_LOCALE, requestBody.getString("uiLocale"))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun createNewSessionOmitsUiLocaleWhenMissing() = runBlocking {
        val requestBodyRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat/new") { exchange ->
            requestBodyRef.set(exchange.requestBody.bufferedReader().use { reader -> reader.readText() })
            writeAiChatTestJsonResponse(exchange = exchange, body = newSessionResponseJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.createNewSession(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatNewSessionRequest(
                    sessionId = "session-1",
                    workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                    uiLocale = null
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, requestBody.getString("workspaceId"))
            assertFalse(requestBody.has("uiLocale"))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun loadSnapshotIncludesWorkspaceIdQueryParameter() = runBlocking {
        val queryParametersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat") { exchange ->
            queryParametersRef.set(parseAiChatTestQueryParameters(rawQuery = exchange.requestURI.rawQuery))
            writeAiChatTestJsonResponse(exchange = exchange, body = conversationEnvelopeJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.loadSnapshot(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                workspaceId = AI_CHAT_TEST_WORKSPACE_ID
            )

            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, queryParametersRef.get()["workspaceId"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun loadOlderMessagesIncludesWorkspaceIdQueryParameter() = runBlocking {
        val queryParametersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat") { exchange ->
            queryParametersRef.set(parseAiChatTestQueryParameters(rawQuery = exchange.requestURI.rawQuery))
            writeAiChatTestJsonResponse(exchange = exchange, body = conversationEnvelopeJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.loadOlderMessages(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                beforeCursor = "cursor-1",
                limit = 20,
                workspaceId = AI_CHAT_TEST_WORKSPACE_ID
            )

            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals("cursor-1", queryParametersRef.get()["before"])
            assertEquals("20", queryParametersRef.get()["limit"])
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, queryParametersRef.get()["workspaceId"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun stopRunIncludesWorkspaceIdAndRunIdWhenPresent() = runBlocking {
        val requestBodyRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat/stop") { exchange ->
            requestBodyRef.set(exchange.requestBody.bufferedReader().use { reader -> reader.readText() })
            writeAiChatTestJsonResponse(exchange = exchange, body = stopRunResponseJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.stopRun(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatStopRunRequest(
                    sessionId = "session-1",
                    workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                    runId = "run-1"
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, requestBody.getString("workspaceId"))
            assertEquals("run-1", requestBody.getString("runId"))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun stopRunOmitsBlankRunId() = runBlocking {
        val requestBodyRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat/stop") { exchange ->
            requestBodyRef.set(exchange.requestBody.bufferedReader().use { reader -> reader.readText() })
            writeAiChatTestJsonResponse(exchange = exchange, body = stopRunResponseJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.stopRun(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatStopRunRequest(
                    sessionId = "session-1",
                    workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                    runId = ""
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, requestBody.getString("workspaceId"))
            assertFalse(requestBody.has("runId"))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun transcribeAudioIncludesWorkspaceIdMultipartField() = runBlocking {
        val requestBodyRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat/transcriptions") { exchange ->
            requestBodyRef.set(String(exchange.requestBody.readBytes(), StandardCharsets.UTF_8))
            writeAiChatTestJsonResponse(exchange = exchange, body = transcriptionResponseJson())
        }
        server.start()

        try {
            val service = makeAiChatTestRemoteService()
            service.transcribeAudio(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                fileName = "recording.wav",
                mediaType = "audio/wav",
                audioBytes = "sample-audio".toByteArray(StandardCharsets.UTF_8)
            )

            assertTrue(requestBodyRef.get().contains("name=\"sessionId\"\r\n\r\nsession-1"))
            assertTrue(requestBodyRef.get().contains("name=\"workspaceId\"\r\n\r\n$AI_CHAT_TEST_WORKSPACE_ID"))
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun liveAttachIncludesResumeDiagnosticsHeadersAndRunIdQueryParam() = runBlocking {
        val headersRef = AtomicReference<Map<String, String>>(emptyMap())
        val queryParametersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/live") { exchange ->
            headersRef.set(
                exchange.requestHeaders.entries.associate { (key, value) ->
                    key to value.joinToString(separator = ",")
                }
            )
            queryParametersRef.set(parseAiChatTestQueryParameters(rawQuery = exchange.requestURI.rawQuery))
            writeAiChatTestSseResponse(exchange = exchange, body = terminalRunSseBody())
        }
        server.start()

        try {
            val service = makeAiChatTestLiveRemoteService()
            val events = service.attachLiveRun(
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                runId = "run-1",
                liveStream = AiChatLiveStreamEnvelope(
                    url = "http://127.0.0.1:${server.address.port}/live",
                    authorization = "Live token-2",
                    expiresAt = 123L
                ),
                workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                afterCursor = "5",
                resumeDiagnostics = AiChatResumeDiagnostics(
                    resumeAttemptId = 42L,
                    clientPlatform = "android",
                    clientVersion = AI_CHAT_TEST_APP_VERSION
                )
            ).toList()

            assertEquals("42", headersRef.get()["X-chat-resume-attempt-id"])
            assertEquals("android", headersRef.get()["X-client-platform"])
            assertEquals(AI_CHAT_TEST_APP_VERSION, headersRef.get()["X-client-version"])
            assertEquals("Live token-2", headersRef.get()["Authorization"])
            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals("run-1", queryParametersRef.get()["runId"])
            assertEquals("5", queryParametersRef.get()["afterCursor"])
            assertFalse(queryParametersRef.get().containsKey("workspaceId"))
            assertEquals(1, events.size)
            require(events.single() is AiChatLiveEvent.RunTerminal)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun liveAttachFallbackAuthorizationIncludesWorkspaceIdQueryParam() = runBlocking {
        val headersRef = AtomicReference<Map<String, String>>(emptyMap())
        val queryParametersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/live") { exchange ->
            headersRef.set(
                exchange.requestHeaders.entries.associate { (key, value) ->
                    key to value.joinToString(separator = ",")
                }
            )
            queryParametersRef.set(parseAiChatTestQueryParameters(rawQuery = exchange.requestURI.rawQuery))
            writeAiChatTestSseResponse(exchange = exchange, body = terminalRunSseBody())
        }
        server.start()

        try {
            val service = makeAiChatTestLiveRemoteService()
            val events = service.attachLiveRun(
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                runId = "run-1",
                liveStream = AiChatLiveStreamEnvelope(
                    url = "http://127.0.0.1:${server.address.port}/live",
                    authorization = "Bearer ignored-live-stream-token",
                    expiresAt = 123L
                ),
                workspaceId = AI_CHAT_TEST_WORKSPACE_ID,
                afterCursor = "5",
                resumeDiagnostics = null
            ).toList()

            assertEquals("Bearer token-1", headersRef.get()["Authorization"])
            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals("run-1", queryParametersRef.get()["runId"])
            assertEquals("5", queryParametersRef.get()["afterCursor"])
            assertEquals(AI_CHAT_TEST_WORKSPACE_ID, queryParametersRef.get()["workspaceId"])
            assertEquals(1, events.size)
            require(events.single() is AiChatLiveEvent.RunTerminal)
        } finally {
            server.stop(0)
        }
    }

    private fun conversationEnvelopeJson(): String {
        return """
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
              "composerSuggestions": [],
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
    }

    private fun acceptedConversationEnvelopeJson(): String {
        return """
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
              "composerSuggestions": [],
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
    }

    private fun bootstrapEnvelopeWithActiveRunJson(): String {
        return """
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
              "composerSuggestions": [],
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
        """.trimIndent()
    }

    private fun newSessionResponseJson(): String {
        return """
            {
              "sessionId": "session-1",
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
              }
            }
        """.trimIndent()
    }

    private fun stopRunResponseJson(): String {
        return """
            {
              "sessionId": "session-1",
              "stopped": true,
              "stillRunning": false
            }
        """.trimIndent()
    }

    private fun transcriptionResponseJson(): String {
        return """
            {
              "text": "Hello",
              "sessionId": "session-1"
            }
        """.trimIndent()
    }

    private fun terminalRunSseBody(): String {
        return """
            event: run_terminal
            data: {"type":"run_terminal","sessionId":"session-1","conversationScopeId":"session-1","runId":"run-1","cursor":"12","sequenceNumber":3,"streamEpoch":"run-1","outcome":"completed"}

        """.trimIndent()
    }
}
