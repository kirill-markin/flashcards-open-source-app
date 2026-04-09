package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
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
class AiChatRuntimeConversationResetAndSendTest {
    @Test
    fun sendMessageEnsuresExplicitSessionWithoutLegacyBootstrapFallback() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "send-session-1"
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
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(listOf("send-session-1"), repository.createNewSessionRequests)
        assertEquals(0, repository.loadBootstrapCalls)
        assertEquals("send-session-1", repository.lastStartRunState?.chatSessionId)
        assertEquals("send-session-1", runtime.state.value.persistedState.chatSessionId)
    }

    @Test
    fun firstDictationAlwaysUsesExplicitSessionId() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "dictation-session-1"
        repository.transcribeAudioResponse = AiChatTranscriptionResult(
            text = "dictated text",
            sessionId = "dictation-session-1"
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.startDictationRecording()
        runtime.transcribeRecordedAudio(
            fileName = "clip.m4a",
            mediaType = "audio/m4a",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        advanceUntilIdle()

        assertEquals(listOf("dictation-session-1"), repository.createNewSessionRequests)
        assertEquals(listOf("dictation-session-1"), repository.transcribeAudioSessionIds)
        assertEquals(0, repository.loadBootstrapCalls)
        assertEquals("dictation-session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals("dictated text", runtime.state.value.draftMessage)
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
    fun clearConversationSwitchesToLocalSessionBeforeServerEnsureCompletes() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        runtime.clearConversation()
        runCurrent()

        assertEquals(1, repository.createNewSessionRequests.size)
        val localSessionId = repository.createNewSessionRequests.single()
        assertTrue(localSessionId.isNotBlank())
        assertFalse(localSessionId == "session-1")
        assertEquals(localSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())

        createSessionGate.complete(Unit)
        advanceUntilIdle()
    }

    @Test
    fun clearConversationIgnoresMismatchedEnsuredSessionResponse() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.createNewSessionResponses += makeSessionSnapshot(
            sessionId = "server-session-2",
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "suggestion-1",
                    text = "Server suggestion",
                    source = "server",
                    assistantItemId = null
                )
            )
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.clearConversation()
        runCurrent()

        val localSessionId = repository.createNewSessionRequests.single()
        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(localSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals(localSessionId, runtime.state.value.conversationScopeId)
        assertTrue(runtime.state.value.serverComposerSuggestions.isEmpty())
        assertEquals(defaultAiChatServerConfig, runtime.state.value.persistedState.lastKnownChatConfig)
    }

    @Test
    fun lateEnsureResponseDoesNotOverwriteFreshSuggestionsAfterSend() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.clearConversation()
        runCurrent()

        val newSessionId = repository.createNewSessionRequests.single()
        repository.createNewSessionResponses += makeSessionSnapshot(
            sessionId = newSessionId,
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "stale-suggestion",
                    text = "Stale ensure suggestion",
                    source = "server",
                    assistantItemId = null
                )
            )
        )
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = newSessionId,
            activeRun = null,
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Hello")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "fresh-suggestion",
                    text = "Fresh run suggestion",
                    source = "assistant_follow_up",
                    assistantItemId = null
                )
            )
        )

        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(
            listOf("fresh-suggestion"),
            runtime.state.value.serverComposerSuggestions.map { suggestion -> suggestion.id }
        )

        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(
            listOf("fresh-suggestion"),
            runtime.state.value.serverComposerSuggestions.map { suggestion -> suggestion.id }
        )
    }
}
