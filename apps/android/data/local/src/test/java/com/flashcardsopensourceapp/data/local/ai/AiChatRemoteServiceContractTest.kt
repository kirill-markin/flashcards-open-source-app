package com.flashcardsopensourceapp.data.local.ai

import com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import org.junit.Assert.assertEquals
import org.junit.Test

class AiChatRemoteServiceContractTest {
    @Test
    fun sseParserParsesStrictToolCallPayload() {
        val parser = AiChatSseParser()

        val event = parser.pushLine(
            "data: {\"type\":\"tool_call\",\"toolCallId\":\"tool-1\",\"name\":\"sql\",\"status\":\"completed\",\"input\":\"{}\",\"output\":\"[]\"}"
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
            "data: {\"type\":\"tool_call\",\"toolCallId\":\"tool-1\",\"name\":\"sql\",\"status\":\"queued\"}"
        )
        parser.pushLine("")
    }
}
