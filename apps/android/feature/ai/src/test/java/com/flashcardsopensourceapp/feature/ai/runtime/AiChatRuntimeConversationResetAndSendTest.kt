package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatConversation
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
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
    fun firstDictationAlwaysUsesExplicitSessionId() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "dictation-session-1"
        repository.transcribeAudioResponse = AiChatTranscriptionResult(
            text = "dictated text",
            sessionId = "dictation-session-1"
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
    fun cancelDictationDuringTranscribingPreventsTranscriptAppend() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "dictation-session-1"
        repository.transcribeAudioResponse = AiChatTranscriptionResult(
            text = "late transcript",
            sessionId = "dictation-session-1"
        )
        val transcribeGate = CompletableDeferred<Unit>()
        repository.transcribeAudioGates += transcribeGate
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

        runtime.startDictationRecording()
        runtime.transcribeRecordedAudio(
            fileName = "clip.m4a",
            mediaType = "audio/m4a",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        runCurrent()

        assertEquals(AiChatDictationState.TRANSCRIBING, runtime.state.value.dictationState)

        runtime.cancelDictation()
        runCurrent()

        assertEquals(AiChatDictationState.IDLE, runtime.state.value.dictationState)
        assertEquals("", runtime.state.value.draftMessage)

        transcribeGate.complete(Unit)
        advanceUntilIdle()

        assertEquals("dictation-session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals("", runtime.state.value.draftMessage)
        assertEquals(listOf("dictation-session-1"), repository.transcribeAudioSessionIds)
    }

    @Test
    fun dictationEmptyTranscriptReturnsIdleWithAlert() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "dictation-session-1"
        repository.transcribeAudioResponse = AiChatTranscriptionResult(
            text = "   ",
            sessionId = "dictation-session-1"
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

        runtime.startDictationRecording()
        runtime.transcribeRecordedAudio(
            fileName = "clip.m4a",
            mediaType = "audio/m4a",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        advanceUntilIdle()

        assertEquals(AiChatDictationState.IDLE, runtime.state.value.dictationState)
        assertEquals("", runtime.state.value.draftMessage)
        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertEquals("No speech was recorded.", alert.message)
    }

    @Test
    fun dictationMismatchedSessionIdReturnsIdleWithAlert() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "dictation-session-1"
        repository.transcribeAudioResponse = AiChatTranscriptionResult(
            text = "dictated text",
            sessionId = "different-session"
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

        runtime.startDictationRecording()
        runtime.transcribeRecordedAudio(
            fileName = "clip.m4a",
            mediaType = "audio/m4a",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        advanceUntilIdle()

        assertEquals(AiChatDictationState.IDLE, runtime.state.value.dictationState)
        assertEquals("", runtime.state.value.draftMessage)
        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertTrue(alert.message.contains("mismatched sessionId"))
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
