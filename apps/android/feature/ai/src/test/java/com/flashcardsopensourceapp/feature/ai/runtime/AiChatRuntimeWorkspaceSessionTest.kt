package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.makeAiChatCardAttachment
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeWorkspaceSessionTest {
    @Test
    fun guestMetadataOnlyAccessContextChangeDoesNotRestartBootstrap() = runTest {
        val repository = FakeAiChatRepository()
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState()
        )
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId).copy(
                linkedUserId = "guest-user-1",
                activeWorkspaceId = defaultTestWorkspaceId
            )
        )
        advanceUntilIdle()

        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(listOf("session-1"), repository.createNewSessionRequests)
        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertNull(runtime.state.value.activeRun)
    }

    @Test
    fun disconnectedAccessPreparesGuestSessionBeforeGuestBootstrapStarts() = runTest {
        val repository = FakeAiChatRepository()
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState()
        )
        repository.nextEnsureSessionId = "guest-session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "guest-session-1",
            activeRun = null
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

        assertEquals(listOf(defaultTestWorkspaceId), repository.prepareSessionRequests)
        assertEquals(0, repository.loadBootstrapCalls)
        assertEquals(
            AiConversationBootstrapState.READY,
            runtime.state.value.conversationBootstrapState
        )

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(listOf("guest-session-1"), repository.createNewSessionRequests)
        assertEquals("guest-session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(
            AiConversationBootstrapState.READY,
            runtime.state.value.conversationBootstrapState
        )
    }

    @Test
    fun cancelledWarmUpDoesNotRestartGuestBootstrapAfterAccessHandoff() = runTest {
        val repository = FakeAiChatRepository()
        val prepareSessionGate = CompletableDeferred<Unit>()
        val guestBootstrapGate = CompletableDeferred<Unit>()
        repository.prepareSessionGates += prepareSessionGate
        repository.loadBootstrapGates += guestBootstrapGate
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState()
        )
        repository.nextEnsureSessionId = "guest-session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "guest-session-1",
            activeRun = null
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "guest-session-1",
            activeRun = null
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

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        prepareSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(listOf("guest-session-1"), repository.createNewSessionRequests)

        guestBootstrapGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals("guest-session-1", runtime.state.value.persistedState.chatSessionId)
    }

    @Test
    fun cancelledWarmUpStillRetriesWhenNextAccessStillNeedsGuestPreparation() = runTest {
        val repository = FakeAiChatRepository()
        val firstPrepareSessionGate = CompletableDeferred<Unit>()
        repository.prepareSessionGates += firstPrepareSessionGate
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState()
        )
        repository.setPersistedState(
            workspaceId = secondaryTestWorkspaceId,
            state = makeDefaultAiChatPersistedState()
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

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = secondaryTestWorkspaceId).copy(
                cloudState = CloudAccountState.DISCONNECTED
            )
        )
        firstPrepareSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(
            listOf(defaultTestWorkspaceId, secondaryTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(0, repository.loadBootstrapCalls)
        assertEquals(
            AiConversationBootstrapState.READY,
            runtime.state.value.conversationBootstrapState
        )
    }

    @Test
    fun accessContextSwitchCancelsInFlightTranscriptionAndIgnoresLateResult() = runTest {
        val repository = FakeAiChatRepository()
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState()
        )
        repository.setPersistedState(
            workspaceId = secondaryTestWorkspaceId,
            state = makeDefaultAiChatPersistedState()
        )
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

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = secondaryTestWorkspaceId).copy(
                cloudState = CloudAccountState.DISCONNECTED
            )
        )
        runCurrent()

        transcribeGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(secondaryTestWorkspaceId, runtime.state.value.workspaceId)
        assertEquals(AiChatDictationState.IDLE, runtime.state.value.dictationState)
        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.persistedState.chatSessionId.isBlank())
        assertEquals(listOf(defaultTestWorkspaceId), repository.transcribeAudioWorkspaceIds)
    }

    @Test
    fun accessContextSwitchCancelsBootstrapAndRestoresNewWorkspaceBaseline() = runTest {
        val repository = FakeAiChatRepository()
        val firstBootstrapGate = CompletableDeferred<Unit>()
        val secondBootstrapGate = CompletableDeferred<Unit>()
        repository.loadBootstrapGates += firstBootstrapGate
        repository.loadBootstrapGates += secondBootstrapGate
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "persisted-session-1")
        )
        repository.setPersistedState(
            workspaceId = secondaryTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "persisted-session-2")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-2",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateAccessContext(makeAccessContext(workspaceId = secondaryTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(secondaryTestWorkspaceId, runtime.state.value.workspaceId)
        assertEquals("persisted-session-2", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.LOADING, runtime.state.value.conversationBootstrapState)

        secondBootstrapGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(secondaryTestWorkspaceId, runtime.state.value.workspaceId)
        assertEquals("session-2", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(2, repository.loadBootstrapCalls)
    }

    @Test
    fun passiveBootstrapPreservesLocalDraftAndAttachmentsWhenIdle() = runTest {
        val repository = FakeAiChatRepository()
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "session-1")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "ZmlsZQ=="
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "Preserve me")
        runtime.addPendingAttachment(attachment = attachment)
        runtime.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
        advanceUntilIdle()

        assertEquals("Preserve me", runtime.state.value.draftMessage)
        assertEquals(listOf(attachment), runtime.state.value.pendingAttachments)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun stalePersistedChatPreservesCurrentBootstrapPath() = runTest {
        val repository = FakeAiChatRepository()
        val nowMillis = System.currentTimeMillis()
        val staleTimestamp = nowMillis - aiChatStalenessThresholdMillis - 1_000L
        val oldSessionId = "session-old"
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = oldSessionId,
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Stale question")),
                        timestampMillis = staleTimestamp
                    ),
                    makeAssistantStatusMessage(timestampMillis = staleTimestamp + 1L)
                )
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = oldSessionId,
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals(oldSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun nonStalePersistedChatPreservesCurrentBootstrapPath() = runTest {
        val repository = FakeAiChatRepository()
        val nowMillis = System.currentTimeMillis()
        val recentTimestamp = nowMillis - 1_000L
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = "session-1",
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Recent question")),
                        timestampMillis = recentTimestamp
                    ),
                    makeAssistantStatusMessage(timestampMillis = recentTimestamp + 1L)
                )
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun assistantOnlyHistoryDoesNotAutoRollOver() = runTest {
        val repository = FakeAiChatRepository()
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = "session-1",
                messages = listOf(
                    makeAssistantStatusMessage(
                        timestampMillis = System.currentTimeMillis() - aiChatStalenessThresholdMillis - 1_000L
                    )
                )
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun accessContextRestoresSessionScopedDraftState() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.draftStates[defaultTestWorkspaceId to "session-1"] = AiChatDraftState(
            draftMessage = "Keep this draft",
            pendingAttachments = listOf(
                makeAiChatCardAttachment(
                    cardId = "card-1",
                    frontText = "Front",
                    backText = "Back",
                    tags = listOf("tag"),
                    effortLevel = EffortLevel.MEDIUM
                )
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals("Keep this draft", runtime.state.value.draftMessage)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals("card-1", (runtime.state.value.pendingAttachments.single() as AiChatAttachment.Card).cardId)
    }

    @Test
    fun bootstrapWithPersistedSessionIdReusesThatExactSessionId() = runTest {
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

        assertEquals(listOf("session-1"), repository.loadBootstrapSessionIds)
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
    }
}
