package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
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
        assertEquals(listOf(testUiLocaleTag), repository.createNewSessionUiLocales)
        assertEquals(0, repository.loadBootstrapCalls)
        assertEquals("send-session-1", repository.lastStartRunState?.chatSessionId)
        assertEquals(testUiLocaleTag, repository.lastStartRunUiLocale)
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
    fun clearConversationSwitchesToLocalReadySessionBeforeServerEnsureCompletes() = runTest {
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
        assertEquals(testUiLocaleTag, repository.createNewSessionUiLocales.single())
        assertTrue(localSessionId.isNotBlank())
        assertFalse(localSessionId == "session-1")
        assertEquals(localSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals(localSessionId, runtime.state.value.conversationScopeId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun clearConversationKeepsFreshLocalSessionWhileBootstrapReloadIsInFlight() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null,
        ).copy(
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Hello")),
                        timestampMillis = 1L
                    ),
                    makeAssistantStatusMessage(timestampMillis = 2L)
                ),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            )
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(2, runtime.state.value.persistedState.messages.size)

        val bootstrapGate = CompletableDeferred<Unit>()
        repository.loadBootstrapGates += bootstrapGate
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null,
        ).copy(
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Reloaded")),
                        timestampMillis = 3L
                    )
                ),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            )
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate

        runtime.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
        runCurrent()
        assertEquals(AiConversationBootstrapState.LOADING, runtime.state.value.conversationBootstrapState)
        assertEquals(2, runtime.state.value.persistedState.messages.size)

        runtime.clearConversation()
        runCurrent()

        assertEquals(1, repository.createNewSessionRequests.size)
        val freshSessionId = repository.createNewSessionRequests.single()
        assertEquals(freshSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals(freshSessionId, runtime.state.value.conversationScopeId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        bootstrapGate.complete(Unit)
        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(freshSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
    }

    @Test
    fun clearConversationKeepsDraftAttachmentsAndSuggestionsClearedDuringBootstrapReload() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.draftStates[defaultTestWorkspaceId to "session-1"] =
            com.flashcardsopensourceapp.data.local.model.AiChatDraftState(
                draftMessage = "Keep the old draft",
                pendingAttachments = listOf(
                    AiChatAttachment.Binary(
                        id = "attachment-1",
                        fileName = "notes.txt",
                        mediaType = "text/plain",
                        base64Data = "ZmlsZQ=="
                    )
                )
            )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null,
        ).copy(
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "suggestion-1",
                    text = "Existing suggestion",
                    source = "server",
                    assistantItemId = null
                )
            )
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals("Keep the old draft", runtime.state.value.draftMessage)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals(
            listOf("suggestion-1"),
            runtime.state.value.serverComposerSuggestions.map { suggestion -> suggestion.id }
        )

        val bootstrapGate = CompletableDeferred<Unit>()
        repository.loadBootstrapGates += bootstrapGate
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null,
        ).copy(
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "stale-suggestion",
                    text = "Stale suggestion",
                    source = "server",
                    assistantItemId = null
                )
            ),
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Reloaded")),
                        timestampMillis = 3L
                    )
                ),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            )
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate

        runtime.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
        runCurrent()
        assertEquals(AiConversationBootstrapState.LOADING, runtime.state.value.conversationBootstrapState)

        runtime.clearConversation()
        runCurrent()

        val freshSessionId = repository.createNewSessionRequests.single()
        assertEquals(freshSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals(freshSessionId, runtime.state.value.conversationScopeId)
        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertTrue(runtime.state.value.serverComposerSuggestions.isEmpty())
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        bootstrapGate.complete(Unit)
        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(freshSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertTrue(runtime.state.value.serverComposerSuggestions.isEmpty())
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun clearConversationIsIgnoredWhileDictationRecording() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.startDictationRecording()
        runtime.clearConversation()
        runCurrent()

        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiChatDictationState.RECORDING, runtime.state.value.dictationState)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun sendMessageWaitsForFreshSessionProvisioningAfterClearConversation() = runTest {
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
        val freshSessionId = repository.createNewSessionRequests.single()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = freshSessionId,
            activeRun = null,
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Hello after reset")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        runtime.updateDraftMessage(draftMessage = "Hello after reset")
        runtime.sendMessage()
        runCurrent()

        assertEquals(0, repository.startRunCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(AiComposerPhase.PREPARING_SEND, runtime.state.value.composerPhase)

        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(1, repository.startRunCalls)
        assertEquals(freshSessionId, repository.lastStartRunState?.chatSessionId)
        assertEquals(freshSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals("", runtime.state.value.draftMessage)
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
    fun acceptedRunSuggestionsReplaceFreshSessionSuggestionsAfterReset() = runTest {
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
                    id = "fresh-session-suggestion",
                    text = "Fresh session suggestion",
                    source = "server",
                    assistantItemId = null
                )
            )
        )
        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(
            listOf("fresh-session-suggestion"),
            runtime.state.value.serverComposerSuggestions.map { suggestion -> suggestion.id }
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
    }
}
