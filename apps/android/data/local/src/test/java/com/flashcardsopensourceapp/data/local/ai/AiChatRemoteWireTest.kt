package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AiChatRemoteWireTest {
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
