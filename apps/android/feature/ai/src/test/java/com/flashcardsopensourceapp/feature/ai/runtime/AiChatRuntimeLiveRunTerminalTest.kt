package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeLiveRunTerminalTest {
    @Test
    fun reasoningSummaryStaysAfterExistingTextWhenItArrivesLater() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "What should I study next?")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        runtime.updateDraftMessage(draftMessage = "What should I study next?")
        runtime.sendMessage()
        advanceUntilIdle()

        // This ordering is the behavior we want to preserve: the transcript should
        // reflect arrival order, not jump a later reasoning block back to the top.
        liveEvents.emit(
            AiChatLiveEvent.AssistantDelta(
                metadata = makeMetadata(runId = "run-1", cursor = "1"),
                text = "I'm checking your due cards.",
                itemId = "item-1"
            )
        )
        advanceUntilIdle()

        liveEvents.emit(
            AiChatLiveEvent.AssistantReasoningStarted(
                metadata = makeMetadata(runId = "run-1", cursor = "2"),
                reasoningId = "reasoning-1",
                itemId = "item-1",
                outputIndex = 0
            )
        )
        advanceUntilIdle()

        val assistantMessage = runtime.state.value.persistedState.messages.last()
        assertEquals(2, assistantMessage.content.size)
        assertTrue(assistantMessage.content[0] is AiChatContentPart.Text)
        assertTrue(assistantMessage.content[1] is AiChatContentPart.ReasoningSummary)
        assertEquals(
            "I'm checking your due cards.",
            (assistantMessage.content[0] as AiChatContentPart.Text).text
        )
        assertEquals(
            "reasoning-1",
            (assistantMessage.content[1] as AiChatContentPart.ReasoningSummary).reasoningSummary.reasoningId
        )

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun assistantMessageDoneKeepsActiveRunUntilRunTerminalCompleted() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Hello")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        liveEvents.emit(
            AiChatLiveEvent.AssistantMessageDone(
                metadata = makeMetadata(runId = "run-1", cursor = "1"),
                itemId = "item-1",
                content = listOf(AiChatContentPart.Text(text = "Done")),
                isError = false,
                isStopped = false
            )
        )
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        val lastMessageAfterDone = runtime.state.value.persistedState.messages.last()
        assertEquals("item-1", lastMessageAfterDone.itemId)
        assertEquals(false, lastMessageAfterDone.isError)
        assertEquals(false, lastMessageAfterDone.isStopped)
        assertEquals(
            "Done",
            (lastMessageAfterDone.content.single() as AiChatContentPart.Text).text
        )

        liveEvents.emit(
            AiChatLiveEvent.RunTerminal(
                metadata = makeMetadata(runId = "run-1", cursor = "2"),
                outcome = AiChatRunTerminalOutcome.COMPLETED,
                message = null,
                assistantItemId = null,
                isError = null,
                isStopped = null
            )
        )
        advanceUntilIdle()

        assertNull(runtime.state.value.activeRun)
        assertFalse(runtime.state.value.isLiveAttached)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun runTerminalResetRequiredForcesBootstrapReload() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        liveEvents.emit(
            AiChatLiveEvent.RunTerminal(
                metadata = makeMetadata(runId = "run-1", cursor = "6"),
                outcome = AiChatRunTerminalOutcome.RESET_REQUIRED,
                message = "refresh",
                assistantItemId = null,
                isError = null,
                isStopped = null
            )
        )
        advanceUntilIdle()

        assertEquals(2, repository.loadBootstrapCalls)
        assertNull(runtime.state.value.activeRun)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertFalse(runtime.state.value.isLiveAttached)
    }
}
