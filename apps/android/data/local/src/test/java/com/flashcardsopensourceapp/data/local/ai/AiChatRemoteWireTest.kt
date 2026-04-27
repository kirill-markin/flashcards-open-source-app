package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatNewSessionRequest
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.AiChatWireContentPart
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatRemoteWireTest {
    private val appVersion: String = "1.2.2"
    private val testUiLocale: String = "es-ES"
    private val testWorkspaceId: String = "workspace-1"

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

    private fun parseQueryParameters(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrBlank()) {
            return emptyMap()
        }

        return rawQuery.split("&")
            .filter(String::isNotBlank)
            .associate { entry ->
                val separatorIndex = entry.indexOf('=')
                if (separatorIndex < 0) {
                    URLDecoder.decode(entry, StandardCharsets.UTF_8) to ""
                } else {
                    URLDecoder.decode(entry.substring(startIndex = 0, endIndex = separatorIndex), StandardCharsets.UTF_8) to
                        URLDecoder.decode(entry.substring(startIndex = separatorIndex + 1), StandardCharsets.UTF_8)
                }
            }
    }

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
            queryParametersRef.set(parseQueryParameters(rawQuery = exchange.requestURI.rawQuery))
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
                workspaceId = testWorkspaceId,
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
            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals("20", queryParametersRef.get()["limit"])
            assertEquals(testWorkspaceId, queryParametersRef.get()["workspaceId"])
            assertEquals("41", headersRef.get()["X-chat-resume-attempt-id"])
            assertEquals("android", headersRef.get()["X-client-platform"])
            assertEquals(appVersion, headersRef.get()["X-client-version"])
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
            val body = """
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
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            service.startRun(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatStartRunRequest(
                    sessionId = "session-1",
                    workspaceId = testWorkspaceId,
                    clientRequestId = "request-1",
                    content = listOf(AiChatWireContentPart.Text(text = "Hello")),
                    timezone = "Europe/Madrid",
                    uiLocale = testUiLocale
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(testWorkspaceId, requestBody.getString("workspaceId"))
            assertEquals(testUiLocale, requestBody.getString("uiLocale"))
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
            val body = """
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
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            service.createNewSession(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatNewSessionRequest(
                    sessionId = "session-1",
                    workspaceId = testWorkspaceId,
                    uiLocale = testUiLocale
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(testWorkspaceId, requestBody.getString("workspaceId"))
            assertEquals(testUiLocale, requestBody.getString("uiLocale"))
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
            val body = """
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
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            service.createNewSession(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                request = AiChatNewSessionRequest(
                    sessionId = "session-1",
                    workspaceId = testWorkspaceId,
                    uiLocale = null
                )
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(testWorkspaceId, requestBody.getString("workspaceId"))
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
            queryParametersRef.set(parseQueryParameters(rawQuery = exchange.requestURI.rawQuery))
            val body = """
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
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            service.loadSnapshot(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                workspaceId = testWorkspaceId
            )

            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals(testWorkspaceId, queryParametersRef.get()["workspaceId"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun loadOlderMessagesIncludesWorkspaceIdQueryParameter() = runBlocking {
        val queryParametersRef = AtomicReference<Map<String, String>>(emptyMap())
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat") { exchange ->
            queryParametersRef.set(parseQueryParameters(rawQuery = exchange.requestURI.rawQuery))
            val body = """
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
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            service.loadOlderMessages(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                beforeCursor = "cursor-1",
                limit = 20,
                workspaceId = testWorkspaceId
            )

            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals("cursor-1", queryParametersRef.get()["before"])
            assertEquals("20", queryParametersRef.get()["limit"])
            assertEquals(testWorkspaceId, queryParametersRef.get()["workspaceId"])
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun stopRunIncludesWorkspaceIdWhenPresent() = runBlocking {
        val requestBodyRef = AtomicReference("")
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/chat/stop") { exchange ->
            requestBodyRef.set(exchange.requestBody.bufferedReader().use { reader -> reader.readText() })
            val body = """
                {
                  "sessionId": "session-1",
                  "stopped": true,
                  "stillRunning": false
                }
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            service.stopRun(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                workspaceId = testWorkspaceId
            )

            val requestBody = JSONObject(requestBodyRef.get())
            assertEquals("session-1", requestBody.getString("sessionId"))
            assertEquals(testWorkspaceId, requestBody.getString("workspaceId"))
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
            val body = """
                {
                  "text": "Hello",
                  "sessionId": "session-1"
                }
            """.trimIndent().toByteArray()
            exchange.sendResponseHeaders(200, body.size.toLong())
            exchange.responseBody.use { outputStream -> outputStream.write(body) }
        }
        server.start()

        try {
            val service = makeRemoteService()
            service.transcribeAudio(
                apiBaseUrl = "http://127.0.0.1:${server.address.port}",
                authorizationHeader = "Bearer token-1",
                sessionId = "session-1",
                workspaceId = testWorkspaceId,
                fileName = "recording.wav",
                mediaType = "audio/wav",
                audioBytes = "sample-audio".toByteArray(StandardCharsets.UTF_8)
            )

            assertTrue(requestBodyRef.get().contains("name=\"sessionId\"\r\n\r\nsession-1"))
            assertTrue(requestBodyRef.get().contains("name=\"workspaceId\"\r\n\r\n$testWorkspaceId"))
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
    fun decodeAcceptedEnvelopeWithoutComposerSuggestionsDefaultsToEmptyList() {
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
                "liveUrl": null
              },
              "activeRun": null
            }
            """.trimIndent()
        )

        assertEquals(0, response.composerSuggestions.size)
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
        )

        assertEquals("session-1", snapshot.sessionId)
        assertEquals("session-1", snapshot.conversationScopeId)
        assertNull(snapshot.activeRun)
        assertEquals(0, snapshot.conversation.messages.size)
    }

    @Test
    fun decodeSnapshotEnvelopeWithUnknownContentFallsBackToUnknownPart() {
        val snapshot = decodeAiChatSessionSnapshot(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 100,
                "mainContentInvalidationVersion": 200,
                "messages": [
                  {
                    "role": "assistant",
                    "content": [
                      {
                        "type": "audio_transcript_v2",
                        "text": "future"
                      }
                    ],
                    "timestamp": 123,
                    "isError": false,
                    "isStopped": false,
                    "cursor": "cur-1",
                    "itemId": "item-1"
                  }
                ],
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
        )

        val unknownPart = snapshot.conversation.messages.single().content.single() as AiChatContentPart.Unknown
        assertEquals("audio_transcript_v2", unknownPart.originalType)
        assertEquals("Unsupported content", unknownPart.summaryText)
        assertTrue(unknownPart.rawPayloadJson?.contains("audio_transcript_v2") == true)
    }

    @Test
    fun decodeSnapshotEnvelopeWithoutComposerSuggestionsDefaultsToEmptyList() {
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

        assertEquals(0, snapshot.composerSuggestions.size)
    }

    @Test
    fun decodeBootstrapEnvelopeWithoutComposerSuggestionsDefaultsToEmptyList() {
        val response = decodeAiChatBootstrapResponse(
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

        assertEquals(0, response.composerSuggestions.size)
    }

    @Test
    fun decodeNewSessionWithoutComposerSuggestionsDefaultsToEmptyList() {
        val response = decodeAiChatNewSession(
            payload = """
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
        )

        assertEquals(0, response.composerSuggestions.size)
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
            queryParametersRef.set(parseQueryParameters(rawQuery = exchange.requestURI.rawQuery))
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
                workspaceId = testWorkspaceId,
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
            queryParametersRef.set(parseQueryParameters(rawQuery = exchange.requestURI.rawQuery))
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
                    authorization = "Bearer ignored-live-stream-token",
                    expiresAt = 123L
                ),
                workspaceId = testWorkspaceId,
                afterCursor = "5",
                resumeDiagnostics = null
            ).toList()

            assertEquals("Bearer token-1", headersRef.get()["Authorization"])
            assertEquals("session-1", queryParametersRef.get()["sessionId"])
            assertEquals("run-1", queryParametersRef.get()["runId"])
            assertEquals("5", queryParametersRef.get()["afterCursor"])
            assertEquals(testWorkspaceId, queryParametersRef.get()["workspaceId"])
            assertEquals(1, events.size)
            require(events.single() is AiChatLiveEvent.RunTerminal)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun liveAttachSkipsUnknownEventTypesAndContinues() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/live") { exchange ->
            val body = """
                event: service_side_event_v2
                data: {"ignored":true}

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
                workspaceId = testWorkspaceId,
                afterCursor = "5",
                resumeDiagnostics = null
            ).toList()

            assertEquals(1, events.size)
            require(events.single() is AiChatLiveEvent.RunTerminal)
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun decodeAiChatLiveEventPayloadAcceptsUnknownFields() {
        val event = requireNotNull(decodeAiChatLiveEventPayload(
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
        ))

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
    fun decodeAiChatLiveEventPayloadAssistantMessageDoneFallsBackToUnknownPart() {
        val event = requireNotNull(decodeAiChatLiveEventPayload(
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
              "content": [{ "type": "audio_transcript_v2", "text": "done" }],
              "isError": false,
              "isStopped": true
            }
            """.trimIndent()
        ))

        require(event is AiChatLiveEvent.AssistantMessageDone)
        val unknownPart = event.content.single() as AiChatContentPart.Unknown
        assertEquals("audio_transcript_v2", unknownPart.originalType)
        assertEquals("Unsupported content", unknownPart.summaryText)
        assertTrue(unknownPart.rawPayloadJson?.contains("audio_transcript_v2") == true)
    }

    @Test
    fun decodeRunTerminalCompleted() {
        val event = requireNotNull(decodeAiChatLiveEventPayload(
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
        ))

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.COMPLETED, event.outcome)
        assertNull(event.message)
    }

    @Test
    fun decodeRunTerminalStopped() {
        val event = requireNotNull(decodeAiChatLiveEventPayload(
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
        ))

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.STOPPED, event.outcome)
        assertEquals("item-1", event.assistantItemId)
        assertEquals(true, event.isStopped)
    }

    @Test
    fun decodeRunTerminalError() {
        val event = requireNotNull(decodeAiChatLiveEventPayload(
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
        ))

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.ERROR, event.outcome)
        assertEquals("boom", event.message)
        assertEquals(true, event.isError)
    }

    @Test
    fun decodeRunTerminalResetRequired() {
        val event = requireNotNull(decodeAiChatLiveEventPayload(
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
        ))

        require(event is AiChatLiveEvent.RunTerminal)
        assertEquals(AiChatRunTerminalOutcome.RESET_REQUIRED, event.outcome)
        assertEquals("refresh", event.message)
    }

    @Test
    fun decodeComposerSuggestionsUpdatedWithoutSuggestionsDefaultsToEmptyList() {
        val event = requireNotNull(
            decodeAiChatLiveEventPayload(
                eventType = "composer_suggestions_updated",
                payload = """
                {
                  "sessionId": "session-1",
                  "conversationScopeId": "session-1",
                  "runId": "run-1",
                  "cursor": "12",
                  "sequenceNumber": 3,
                  "streamEpoch": "run-1"
                }
                """.trimIndent()
            )
        )

        require(event is AiChatLiveEvent.ComposerSuggestionsUpdated)
        assertEquals(0, event.suggestions.size)
    }

    @Test
    fun decodeAiChatLiveEventPayloadIgnoresUnknownExplicitEventType() {
        val event = decodeAiChatLiveEventPayload(
            eventType = "service_side_event_v2",
            payload = """
            {
              "ignored": true
            }
            """.trimIndent()
        )

        assertNull(event)
    }

    @Test
    fun decodeAiChatLiveEventPayloadIgnoresUnknownPayloadTypeWhenEventHeaderIsMissing() {
        val event = decodeAiChatLiveEventPayload(
            eventType = null,
            payload = """
            {
              "type": "service_side_event_v3",
              "ignored": true
            }
            """.trimIndent()
        )

        assertNull(event)
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

    @Test
    fun decodeAiChatLiveEventPayloadMapsToolCallWithoutSyncField() {
        val event = decodeAiChatLiveEventPayload(
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
              "status": "completed",
              "input": "{\"sql\":\"SELECT 1\"}",
              "output": "{\"rows\":[1]}",
              "itemId": "item-1",
              "outputIndex": 0
            }
            """.trimIndent()
        ) as AiChatLiveEvent.AssistantToolCall

        assertEquals("tool-1", event.toolCall.toolCallId)
        assertEquals("{\"sql\":\"SELECT 1\"}", event.toolCall.input)
        assertEquals("{\"rows\":[1]}", event.toolCall.output)
    }

    @Test
    fun decodeAiChatSessionSnapshotMapsToolCallWithoutSyncField() {
        val snapshot = decodeAiChatSessionSnapshot(
            payload = """
            {
              "sessionId": "session-1",
              "conversationScopeId": "session-1",
              "conversation": {
                "updatedAt": 111,
                "mainContentInvalidationVersion": 222,
                "messages": [
                  {
                    "role": "assistant",
                    "content": [
                      {
                        "type": "tool_call",
                        "id": "tool-1",
                        "name": "sql",
                        "status": "completed"
                      }
                    ],
                    "timestamp": 123,
                    "isError": false,
                    "isStopped": false
                  }
                ],
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
        )

        val toolCall = ((snapshot.conversation.messages.single().content.single()) as AiChatContentPart.ToolCall).toolCall
        assertEquals("tool-1", toolCall.toolCallId)
        assertEquals("sql", toolCall.name)
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

    @Test
    fun decodeAiChatLiveEventPayloadIgnoresUnknownLegacyEventType() {
        val event = decodeAiChatLiveEventPayload(
            eventType = "stop_ack",
            payload = """
            {
              "sessionId": "session-1"
            }
            """.trimIndent()
        )

        assertNull(event)
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
