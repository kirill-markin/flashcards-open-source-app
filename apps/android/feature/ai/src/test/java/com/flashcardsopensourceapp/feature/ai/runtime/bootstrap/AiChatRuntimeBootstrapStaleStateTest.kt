package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.ai.AiChatConversation
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.ai.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAssistantStatusMessage
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAiDraftState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeUserMessage
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.AiChatBootstrapCoordinator
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeBootstrapStaleStateTest {
    @Test
    fun sameSessionRefreshSessionMismatchFailurePreservesExistingConversationState() = runTest {
        val repository = FakeAiChatRepository()
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "ZmlsZQ=="
        )
        val messages = listOf(
            makeUserMessage(
                content = listOf(AiChatContentPart.Text(text = "Existing question")),
                timestampMillis = 1L
            ),
            makeAssistantStatusMessage(timestampMillis = 2L)
        )
        val activeRun = makeActiveRun(runId = "run-1", cursor = "0")
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.draftStates[defaultTestWorkspaceId to "session-1"] = AiChatDraftState(
            draftMessage = "Keep this draft",
            pendingAttachments = listOf(attachment)
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = activeRun
        ).copy(
            conversation = AiChatConversation(
                messages = messages,
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = true,
                oldestCursor = "older-cursor"
            )
        )
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.GUEST
        )

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId)
        )
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(messages, runtime.state.value.persistedState.messages)
        assertEquals(activeRun, runtime.state.value.activeRun)

        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "different-session",
            activeRun = null
        )
        runtime.onScreenVisible()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(messages, runtime.state.value.persistedState.messages)
        assertEquals("session-1", runtime.state.value.conversationScopeId)
        assertTrue(runtime.state.value.hasOlder)
        assertEquals("older-cursor", runtime.state.value.oldestCursor)
        assertEquals(activeRun, runtime.state.value.activeRun)
        assertEquals("Keep this draft", runtime.state.value.draftMessage)
        assertEquals(listOf(attachment), runtime.state.value.pendingAttachments)
        assertTrue(
            runtime.state.value.conversationBootstrapErrorPresentation.technicalDetails
                .orEmpty()
                .contains("mismatched sessionId")
        )
    }

    @Test
    fun forcedWorkspaceBootstrapContractMismatchDoesNotRestorePreviousConversationState() = runTest {
        val repository = FakeAiChatRepository()
        val previousAttachment = AiChatAttachment.Binary(
            id = "previous-attachment",
            fileName = "previous.txt",
            mediaType = "text/plain",
            base64Data = "cHJldmlvdXM="
        )
        val previousMessages = listOf(
            makeUserMessage(
                content = listOf(AiChatContentPart.Text(text = "Previous workspace question")),
                timestampMillis = 1L
            )
        )
        val previousActiveRun = makeActiveRun(runId = "previous-run", cursor = "previous-cursor")
        repository.persistedStates[secondaryTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-2"
        )
        repository.loadBootstrapErrors += makeCloudContractMismatchException(
            message = "Cloud contract mismatch for chat bootstrap: payload={previous-workspace-leak}"
        )
        val context = makeRuntimeContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )
        context.activeAccessContext = makeAccessContext(workspaceId = secondaryTestWorkspaceId)
        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState().copy(
                chatSessionId = "session-1",
                messages = previousMessages
            )
        ).copy(
            conversationScopeId = "session-1",
            hasOlder = true,
            oldestCursor = "previous-older-cursor",
            activeRun = previousActiveRun,
            draftMessage = "Previous draft",
            pendingAttachments = listOf(previousAttachment),
            serverComposerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "previous-suggestion",
                    text = "Previous suggestion",
                    source = "server",
                    assistantItemId = null
                )
            ),
            conversationBootstrapState = AiConversationBootstrapState.READY
        )
        val coordinator = AiChatBootstrapCoordinator(
            context = context,
            attachBootstrapLiveStream = { _, _, _ -> }
        )

        coordinator.startConversationBootstrap(
            forceReloadState = true,
            resumeDiagnostics = null
        )
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.FAILED, context.state.value.conversationBootstrapState)
        assertEquals(secondaryTestWorkspaceId, context.state.value.workspaceId)
        assertEquals("session-2", context.state.value.persistedState.chatSessionId)
        assertTrue(context.state.value.persistedState.messages.isEmpty())
        assertNull(context.state.value.conversationScopeId)
        assertFalse(context.state.value.hasOlder)
        assertNull(context.state.value.oldestCursor)
        assertNull(context.state.value.activeRun)
        assertEquals("", context.state.value.draftMessage)
        assertTrue(context.state.value.pendingAttachments.isEmpty())
        assertTrue(context.state.value.serverComposerSuggestions.isEmpty())
        assertEquals(
            "AI chat could not be loaded. Try again.",
            context.state.value.conversationBootstrapErrorPresentation.message
        )
        assertFalse(
            context.state.value.conversationBootstrapErrorPresentation.technicalDetails
                .orEmpty()
                .contains("previous-workspace-leak")
        )
    }

    @Test
    fun sameWorkspaceRetryBootstrapPreventsStaleBootstrapFromApplying() = runTest {
        val repository = FakeAiChatRepository()
        val firstBootstrapGate = CompletableDeferred<Unit>()
        repository.loadBootstrapNonCancellableGates += firstBootstrapGate
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "stale-run", cursor = "stale-cursor")
        )
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.GUEST
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId)
        )
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.LOADING, runtime.state.value.conversationBootstrapState)

        runtime.retryBootstrap()
        advanceUntilIdle()

        assertEquals(2, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertNull(runtime.state.value.activeRun)

        firstBootstrapGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertNull(runtime.state.value.activeRun)
    }
}
