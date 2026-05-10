package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatConversation
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeGuestQuotaPromptTest {
    @Test
    fun guestQuotaSendFailureRestoresDraftAndAttachmentsWhileShowingUpgradePrompt() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.startRunError = AiChatRemoteException(
            message = "Guest quota reached.",
            statusCode = 429,
            code = "GUEST_AI_LIMIT_REACHED",
            stage = null,
            requestId = "request-1",
            responseBody = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "ZmlsZQ=="
        )

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "keep this")
        runtime.addPendingAttachment(attachment = attachment)
        runtime.sendMessage()

        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertEquals(AiComposerPhase.PREPARING_SEND, runtime.state.value.composerPhase)

        advanceUntilIdle()

        assertEquals("keep this", runtime.state.value.draftMessage)
        assertEquals(listOf(attachment), runtime.state.value.pendingAttachments)
        assertEquals(1, runtime.state.value.persistedState.messages.size)
        assertTrue(
            runtime.state.value.persistedState.messages.single().content.single() is AiChatContentPart.AccountUpgradePrompt
        )
        assertEquals(AiComposerPhase.IDLE, runtime.state.value.composerPhase)
        assertEquals(
            "keep this",
            repository.draftStates[defaultTestWorkspaceId to "session-1"]?.draftMessage
        )
        assertEquals(
            listOf(attachment),
            repository.draftStates[defaultTestWorkspaceId to "session-1"]?.pendingAttachments
        )
    }

    @Test
    fun guestQuotaSendFailureAppendsUpgradePromptAfterRealAssistantReply() = runTest {
        val repository = FakeAiChatRepository()
        val restoredMessages = listOf(
            makeUserMessage(
                content = listOf(AiChatContentPart.Text(text = "Original question")),
                timestampMillis = 1L
            ),
            makeAssistantTextMessage(
                text = "Original answer",
                timestampMillis = 2L
            )
        )
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1",
            messages = restoredMessages
        )
        repository.bootstrapResponses += makeBootstrapResponseWithMessages(
            sessionId = "session-1",
            messages = restoredMessages
        )
        repository.startRunError = AiChatRemoteException(
            message = "Guest quota reached.",
            statusCode = 429,
            code = "GUEST_AI_LIMIT_REACHED",
            stage = null,
            requestId = "request-1",
            responseBody = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "keep this")
        runtime.sendMessage()
        advanceUntilIdle()

        val messages = runtime.state.value.persistedState.messages
        assertEquals(3, messages.size)
        assertEquals(restoredMessages[0], messages[0])
        assertEquals(restoredMessages[1], messages[1])
        assertTrue(messages[2].content.single() is AiChatContentPart.AccountUpgradePrompt)
    }

    @Test
    fun guestQuotaSendFailureReplacesOptimisticAssistantPlaceholderWithUpgradePrompt() = runTest {
        val repository = FakeAiChatRepository()
        val restoredMessages = listOf(
            makeUserMessage(
                content = listOf(AiChatContentPart.Text(text = "Original question")),
                timestampMillis = 1L
            ),
            makeAssistantStatusMessage(timestampMillis = 2L)
        )
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1",
            messages = restoredMessages
        )
        repository.bootstrapResponses += makeBootstrapResponseWithMessages(
            sessionId = "session-1",
            messages = restoredMessages
        )
        repository.startRunError = AiChatRemoteException(
            message = "Guest quota reached.",
            statusCode = 429,
            code = "GUEST_AI_LIMIT_REACHED",
            stage = null,
            requestId = "request-1",
            responseBody = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "keep this")
        runtime.sendMessage()
        advanceUntilIdle()

        val messages = runtime.state.value.persistedState.messages
        assertEquals(2, messages.size)
        assertEquals(restoredMessages[0], messages[0])
        assertEquals(restoredMessages[1].messageId, messages[1].messageId)
        assertTrue(messages[1].content.single() is AiChatContentPart.AccountUpgradePrompt)
    }

    private fun makeBootstrapResponseWithMessages(
        sessionId: String,
        messages: List<AiChatMessage>
    ): AiChatBootstrapResponse {
        return AiChatBootstrapResponse(
            sessionId = sessionId,
            conversationScopeId = sessionId,
            conversation = AiChatConversation(
                messages = messages,
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            ),
            composerSuggestions = emptyList(),
            chatConfig = defaultAiChatServerConfig,
            activeRun = null
        )
    }

    private fun makeAssistantTextMessage(
        text: String,
        timestampMillis: Long
    ): AiChatMessage {
        return AiChatMessage(
            messageId = "assistant-$timestampMillis",
            role = AiChatRole.ASSISTANT,
            content = listOf(AiChatContentPart.Text(text = text)),
            timestampMillis = timestampMillis,
            isError = false,
            isStopped = false,
            cursor = null,
            itemId = null
        )
    }
}
