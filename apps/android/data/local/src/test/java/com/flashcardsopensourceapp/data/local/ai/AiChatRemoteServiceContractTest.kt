package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class AiChatRemoteServiceContractTest {
    @Test
    fun sseParserParsesStrictToolCallPayload() {
        val parser = AiChatSseParser()

        val event = parser.pushLine(
            "data: {\"type\":\"tool_call\",\"id\":\"tool-1\",\"name\":\"sql\",\"status\":\"completed\",\"input\":\"{}\",\"output\":\"[]\"}"
        )
        val completedEvent = parser.pushLine("")

        require(event == null)
        val toolCall = (completedEvent as AiChatStreamEvent.ToolCall).toolCall
        assertEquals("tool-1", toolCall.toolCallId)
        assertEquals("sql", toolCall.name)
        assertEquals(AiChatToolCallStatus.COMPLETED, toolCall.status)
        assertEquals("{}", toolCall.input)
        assertEquals("[]", toolCall.output)
    }

    @Test(expected = CloudContractMismatchException::class)
    fun sseParserRejectsUnsupportedToolCallStatus() {
        val parser = AiChatSseParser()

        parser.pushLine(
            "data: {\"type\":\"tool_call\",\"id\":\"tool-1\",\"name\":\"sql\",\"status\":\"queued\"}"
        )
        parser.pushLine("")
    }

    @Test
    fun decodeSnapshotAcceptsNewToolCallIdFieldAndReasoningSummary() {
        val service = AiChatRemoteService()
        val method = AiChatRemoteService::class.java.getDeclaredMethod("decodeSnapshot", JSONObject::class.java)
        method.isAccessible = true

        val snapshot = method.invoke(
            service,
            JSONObject(
                """
                {
                  "sessionId": "session-1",
                  "runState": "completed",
                  "updatedAt": 1742811200000,
                  "mainContentInvalidationVersion": 1,
                  "chatConfig": {
                    "provider": { "id": "openai", "label": "OpenAI" },
                    "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                    "reasoning": { "effort": "medium", "label": "Medium" },
                    "features": { "modelPickerEnabled": false, "dictationEnabled": true, "attachmentsEnabled": true }
                  },
                  "messages": [
                    {
                      "role": "assistant",
                      "content": [
                        { "type": "reasoning_summary", "summary": "Hidden reasoning" },
                        {
                          "type": "tool_call",
                          "id": "tool-1",
                          "name": "sql",
                          "status": "completed",
                          "input": "select 1",
                          "output": "[1]"
                        },
                        { "type": "text", "text": "Stored answer" }
                      ],
                      "timestamp": 1742811200000,
                      "isError": false
                    }
                  ]
                }
                """.trimIndent()
            )
        ) as com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot

        val assistantMessage = snapshot.messages.single()
        val reasoningSummary = assistantMessage.content[0] as AiChatContentPart.ReasoningSummary
        val toolCall = assistantMessage.content[1] as AiChatContentPart.ToolCall
        val textPart = assistantMessage.content[2] as AiChatContentPart.Text

        assertEquals("Hidden reasoning", reasoningSummary.summary)
        assertEquals("tool-1", toolCall.toolCall.toolCallId)
        assertEquals(AiChatToolCallStatus.COMPLETED, toolCall.toolCall.status)
        assertEquals("Stored answer", textPart.text)
    }

    @Test
    fun decodeSnapshotPreservesReasoningSummaryPart() {
        val service = AiChatRemoteService()
        val method = AiChatRemoteService::class.java.getDeclaredMethod("decodeSnapshot", JSONObject::class.java)
        method.isAccessible = true

        val snapshot = method.invoke(
            service,
            JSONObject(
                """
                {
                  "sessionId": "session-1",
                  "runState": "completed",
                  "updatedAt": 1742811200000,
                  "mainContentInvalidationVersion": 0,
                  "chatConfig": {
                    "provider": { "id": "openai", "label": "OpenAI" },
                    "model": { "id": "gpt-5.4", "label": "GPT-5.4", "badgeLabel": "GPT-5.4 · Medium" },
                    "reasoning": { "effort": "medium", "label": "Medium" },
                    "features": { "modelPickerEnabled": false, "dictationEnabled": true, "attachmentsEnabled": true }
                  },
                  "messages": [
                    {
                      "role": "assistant",
                      "content": [
                        { "type": "reasoning_summary", "summary": "Compact thinking" }
                      ],
                      "timestamp": 1742811200000,
                      "isError": false
                    }
                  ]
                }
                """.trimIndent()
            )
        ) as com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot

        assertTrue(snapshot.messages.single().content.single() is AiChatContentPart.ReasoningSummary)
    }
}
