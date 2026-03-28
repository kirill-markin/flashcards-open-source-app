package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusText
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class AiConversationStateSupportTest {
    @Test
    fun firstDeltaReplacesOptimisticAssistantPlaceholder() {
        val state = makeAssistantState(
            content = listOf(
                AiChatContentPart.Text(text = aiChatOptimisticAssistantStatusText)
            ),
            isError = false
        )

        val updatedState = appendAssistantText(
            state = state,
            text = "Hello from AI"
        )

        val textPart = updatedState.messages.last().content.single() as AiChatContentPart.Text
        assertEquals("Hello from AI", textPart.text)
    }

    @Test
    fun deltaAppendsToTrailingAssistantText() {
        val state = makeAssistantState(
            content = listOf(
                AiChatContentPart.ToolCall(
                    toolCall = AiChatToolCall(
                        toolCallId = "tool-1",
                        name = "sql",
                        status = AiChatToolCallStatus.STARTED,
                        input = "{\"sql\":\"SELECT 1\"}",
                        output = null
                    )
                ),
                AiChatContentPart.Text(text = "Hello")
            ),
            isError = false
        )

        val updatedState = appendAssistantText(
            state = state,
            text = " world"
        )

        val textPart = updatedState.messages.last().content.last() as AiChatContentPart.Text
        assertEquals("Hello world", textPart.text)
    }

    @Test
    fun completedToolCallReplacesEarlierRequestForSameId() {
        val requestedState = upsertAssistantToolCallRequest(
            state = makeAssistantState(
                content = emptyList(),
                isError = false
            ),
            toolCallRequest = AiToolCallRequest(
                toolCallId = "tool-1",
                name = "sql",
                input = "{\"sql\":\"SELECT 1\"}"
            )
        )

        val completedState = upsertAssistantToolCall(
            state = requestedState,
            toolCall = AiChatToolCall(
                toolCallId = "tool-1",
                name = "sql",
                status = AiChatToolCallStatus.COMPLETED,
                input = "{\"sql\":\"SELECT 1\"}",
                output = "{\"rows\":[1]}"
            )
        )

        val toolCallPart = completedState.messages.last().content.single() as AiChatContentPart.ToolCall
        assertEquals(AiChatToolCallStatus.COMPLETED, toolCallPart.toolCall.status)
        assertEquals("{\"rows\":[1]}", toolCallPart.toolCall.output)
    }

    @Test
    fun assistantErrorAppendsToExistingAssistantText() {
        val state = makeAssistantState(
            content = listOf(
                AiChatContentPart.Text(text = "Partial answer")
            ),
            isError = false
        )

        val updatedState = markAssistantError(
            state = state,
            message = "AI request failed.",
            timestampMillis = 2L
        )

        val lastMessage = updatedState.messages.last()
        val textPart = lastMessage.content.single() as AiChatContentPart.Text
        assertEquals("Partial answer\n\nAI request failed.", textPart.text)
        assertEquals(true, lastMessage.isError)
    }

    @Test
    fun accountUpgradePromptReplacesPreviousAssistantContent() {
        val state = makeAssistantState(
            content = listOf(
                AiChatContentPart.Text(text = "Working...")
            ),
            isError = true
        )

        val updatedState = appendAssistantAccountUpgradePrompt(
            state = state,
            message = "Guest AI quota reached.",
            buttonTitle = "Open account status",
            timestampMillis = 2L
        )

        val lastMessage = updatedState.messages.last()
        val prompt = lastMessage.content.single() as AiChatContentPart.AccountUpgradePrompt
        assertEquals("Guest AI quota reached.", prompt.message)
        assertFalse(lastMessage.isError)
    }

    @Test
    fun transcriptAppendHandlesEmptyAndNonEmptyDrafts() {
        assertEquals(
            "Hello from AI",
            appendTranscriptToDraft(
                currentDraft = "",
                transcript = " Hello from AI "
            )
        )
        assertEquals(
            "Existing draft\nHello from AI",
            appendTranscriptToDraft(
                currentDraft = "Existing draft  ",
                transcript = " Hello from AI "
            )
        )
    }
}

private fun makeAssistantState(
    content: List<AiChatContentPart>,
    isError: Boolean
): AiChatPersistedState {
    return makeDefaultAiChatPersistedState().copy(
        messages = listOf(
            AiChatMessage(
                messageId = "assistant-1",
                role = AiChatRole.ASSISTANT,
                content = content,
                timestampMillis = 1L,
                isError = isError
            )
        )
    )
}
