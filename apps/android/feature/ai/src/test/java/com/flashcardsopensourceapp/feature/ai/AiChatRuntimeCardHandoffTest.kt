package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeCardHandoffTest {
    @Test
    fun staleCardHandoffRequiresManualNewChatAndPreservesCurrentDraftState() = runTest {
        val repository = FakeAiChatRepository()
        repository.consent.value = false
        val nowMillis = System.currentTimeMillis()
        val staleTimestamp = nowMillis - aiChatStalenessThresholdMillis - 1_000L
        val oldSessionId = "session-old"
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = oldSessionId,
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Very old question")),
                        timestampMillis = staleTimestamp
                    )
                )
            )
        )
        repository.draftStates[defaultTestWorkspaceId to oldSessionId] = AiChatDraftState(
            draftMessage = "Unsaved review note",
            pendingAttachments = emptyList()
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.startDictationRecording()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = EffortLevel.LONG
        )
        advanceUntilIdle()

        assertFalse(didHandoff)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals(oldSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertEquals("Unsaved review note", runtime.state.value.draftMessage)
        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertEquals("Start a new chat before handing off a card to AI.", alert.message)
        assertEquals(
            "Unsaved review note",
            repository.draftStates[defaultTestWorkspaceId to oldSessionId]?.draftMessage
        )
    }

    @Test
    fun cleanCardHandoffReusesCurrentSessionAndAddsCardDraft() = runTest {
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

        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = EffortLevel.FAST
        )
        advanceUntilIdle()

        assertTrue(didHandoff)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals("card-1", (runtime.state.value.pendingAttachments.single() as AiChatAttachment.Card).cardId)
    }

    @Test
    fun dirtyCardHandoffRequiresManualNewChatAndPreservesCurrentDraftState() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.draftStates[defaultTestWorkspaceId to "session-1"] = AiChatDraftState(
            draftMessage = "Unsaved note",
            pendingAttachments = emptyList()
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = EffortLevel.LONG
        )
        advanceUntilIdle()

        assertFalse(didHandoff)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals("Unsaved note", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertEquals("Start a new chat before handing off a card to AI.", alert.message)
        assertEquals("Unsaved note", repository.draftStates[defaultTestWorkspaceId to "session-1"]?.draftMessage)
    }

    @Test
    fun bootstrapWithoutPersistedSessionIdUsesLatestOrCreateBeforeCardHandoff() = runTest {
        val repository = FakeAiChatRepository()
        repository.nextEnsureSessionId = "session-from-server"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-from-server",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(listOf("session-from-server"), repository.createNewSessionRequests)
        assertEquals(listOf("session-from-server"), repository.loadBootstrapSessionIds)
        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = EffortLevel.FAST
        )
        advanceUntilIdle()

        assertTrue(didHandoff)
        assertEquals(listOf("session-from-server"), repository.createNewSessionRequests)
        assertEquals("session-from-server", runtime.state.value.persistedState.chatSessionId)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals("card-1", (runtime.state.value.pendingAttachments.single() as AiChatAttachment.Card).cardId)
    }
}
