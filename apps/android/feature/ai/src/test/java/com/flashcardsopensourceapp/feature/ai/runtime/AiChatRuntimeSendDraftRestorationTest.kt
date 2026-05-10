package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeSendDraftRestorationTest {
    @Test
    fun sendMessageEnsuresExplicitSessionWithoutLegacyBootstrapFallback() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "send-session-1"
        val startRunGate = CompletableDeferred<Unit>()
        repository.startRunGates += startRunGate
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "send-session-1",
            activeRun = null,
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Hello")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.DISCONNECTED
        )

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId).copy(
                cloudState = CloudAccountState.DISCONNECTED
            )
        )
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertEquals(AiComposerPhase.PREPARING_SEND, runtime.state.value.composerPhase)
        runCurrent()

        assertEquals("send-session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(
            "Hello",
            repository.draftStates[defaultTestWorkspaceId to "send-session-1"]?.draftMessage
        )
        assertTrue(
            repository.draftStates[defaultTestWorkspaceId to "send-session-1"]?.pendingAttachments?.isEmpty()
                ?: false
        )
        assertEquals(2, repository.persistedStates[defaultTestWorkspaceId]?.messages?.size)

        startRunGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf("send-session-1"), repository.createNewSessionRequests)
        assertEquals(listOf(testUiLocaleTag), repository.createNewSessionUiLocales)
        assertEquals(0, repository.loadBootstrapCalls)
        assertEquals("send-session-1", repository.lastStartRunState?.chatSessionId)
        assertEquals(testUiLocaleTag, repository.lastStartRunUiLocale)
        assertEquals("send-session-1", runtime.state.value.persistedState.chatSessionId)
    }

    @Test
    fun firstSendFailureKeepsEnsuredSessionIdAndRestoresDraftDurably() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "send-session-1"
        repository.startRunError = IllegalStateException("Run start failed.")
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.DISCONNECTED
        )
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "ZmlsZQ=="
        )

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId).copy(
                cloudState = CloudAccountState.DISCONNECTED
            )
        )
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "retry me")
        runtime.addPendingAttachment(attachment = attachment)
        runtime.sendMessage()

        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())

        advanceUntilIdle()

        assertEquals("send-session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals("retry me", runtime.state.value.draftMessage)
        assertEquals(listOf(attachment), runtime.state.value.pendingAttachments)
        assertEquals(AiComposerPhase.IDLE, runtime.state.value.composerPhase)
        assertEquals(
            "retry me",
            repository.draftStates[defaultTestWorkspaceId to "send-session-1"]?.draftMessage
        )
        assertEquals(
            listOf(attachment),
            repository.draftStates[defaultTestWorkspaceId to "send-session-1"]?.pendingAttachments
        )
    }

    @Test
    fun sendPendingRemoteSessionProvisioningFailureAttemptsCreateNewSessionOnceAndRestoresDraft() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "pending-session-1",
            requiresRemoteSessionProvisioning = true
        )
        repository.createNewSessionErrors += IOException("connection reset")
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.DISCONNECTED
        )

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId).copy(
                cloudState = CloudAccountState.DISCONNECTED
            )
        )
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "retry me")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(listOf("pending-session-1"), repository.createNewSessionRequests)
        assertEquals(0, repository.startRunCalls)
        assertEquals("pending-session-1", runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertEquals("retry me", runtime.state.value.draftMessage)
        assertEquals(AiComposerPhase.IDLE, runtime.state.value.composerPhase)
        assertEquals(
            "retry me",
            repository.draftStates[defaultTestWorkspaceId to "pending-session-1"]?.draftMessage
        )
    }

    @Test
    fun missingSessionSendFailureKeepsSessionIdAndRestoresDraft() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.startRunError = AiChatRemoteException(
            message = "Chat session not found: session-1",
            statusCode = 404,
            code = "CHAT_SESSION_NOT_FOUND",
            stage = null,
            requestId = null,
            responseBody = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "retry me")
        runtime.sendMessage()
        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        advanceUntilIdle()

        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals("retry me", runtime.state.value.draftMessage)
        assertEquals(AiComposerPhase.IDLE, runtime.state.value.composerPhase)
        assertFalse(runtime.state.value.isLiveAttached)
        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertTrue(alert.message.isNotEmpty())
    }

    @Test
    fun preAcceptSendFailureBeforeOptimisticMessagesRestoresDraftAndAttachments() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.ensureReadyForSendError = IllegalStateException("Sync failed before send.")
        val runtime = makeRuntime(scope = this, repository = repository)
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "ZmlsZQ=="
        )

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "retry me")
        runtime.addPendingAttachment(attachment = attachment)
        runtime.sendMessage()

        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertEquals(AiComposerPhase.PREPARING_SEND, runtime.state.value.composerPhase)

        advanceUntilIdle()

        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals("retry me", runtime.state.value.draftMessage)
        assertEquals(listOf(attachment), runtime.state.value.pendingAttachments)
        assertEquals(AiComposerPhase.IDLE, runtime.state.value.composerPhase)
        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertTrue(alert.message.isNotEmpty())
        assertEquals(
            "retry me",
            repository.draftStates[defaultTestWorkspaceId to "session-1"]?.draftMessage
        )
        assertEquals(
            listOf(attachment),
            repository.draftStates[defaultTestWorkspaceId to "session-1"]?.pendingAttachments
        )
    }
}
