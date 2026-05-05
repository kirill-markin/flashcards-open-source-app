package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatLiveEventDecodingTest {
    @Test
    fun liveAttachSkipsUnknownEventTypesAndContinues() = runBlocking {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/live") { exchange ->
            writeAiChatTestSseResponse(exchange = exchange, body = unknownThenTerminalRunSseBody())
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

    private fun unknownThenTerminalRunSseBody(): String {
        return """
            event: service_side_event_v2
            data: {"ignored":true}

            event: run_terminal
            data: {"type":"run_terminal","sessionId":"session-1","conversationScopeId":"session-1","runId":"run-1","cursor":"12","sequenceNumber":3,"streamEpoch":"run-1","outcome":"completed"}

        """.trimIndent()
    }
}
