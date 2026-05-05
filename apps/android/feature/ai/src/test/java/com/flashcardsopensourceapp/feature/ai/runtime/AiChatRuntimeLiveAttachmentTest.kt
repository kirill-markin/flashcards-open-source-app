package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeLiveAttachmentTest {
    @Test
    fun bootstrapWhileVisibleWithActiveRunStartsLiveCollection() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(listOf("run-1"), repository.attachRunIds)
        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertTrue(runtime.state.value.isLiveAttached)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun acceptedRunDoesNotAttachLiveWhenScreenIsHidden() = runTest {
        val repository = FakeAiChatRepository()
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
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertFalse(runtime.state.value.isLiveAttached)
        assertTrue(repository.attachRunIds.isEmpty())
    }

    @Test
    fun unexpectedLiveDetachTriggersBootstrapRecoveryError() = runTest {
        val repository = FakeAiChatRepository()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "6")
        )
        repository.liveFlows["run-1"] = emptyFlow()
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertEquals("AI live stream ended before message completion.", alert.message)
        assertNull(runtime.state.value.activeRun)
        assertFalse(runtime.state.value.isLiveAttached)
        assertEquals(2, repository.loadBootstrapCalls)
    }
}
