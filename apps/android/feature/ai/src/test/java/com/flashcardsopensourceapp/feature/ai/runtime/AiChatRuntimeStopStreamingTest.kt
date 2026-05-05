package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeStopStreamingTest {
    @Test
    fun stopStreamingSendsActiveRunIdWhenKnown() = runTest {
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

        assertEquals(AiComposerPhase.RUNNING, runtime.state.value.composerPhase)

        runtime.stopStreaming()
        advanceUntilIdle()

        assertEquals(listOf(defaultTestWorkspaceId), repository.stopRunWorkspaceIds)
        assertEquals(listOf("session-1"), repository.stopRunSessionIds)
        assertEquals(listOf("run-1"), repository.stopRunIds)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun stopStreamingReloadsBootstrapWhenStopRunReturnsNoop() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        val replacementLiveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-2", cursor = "8")
        )
        repository.liveFlows["run-1"] = liveEvents
        repository.liveFlows["run-2"] = replacementLiveEvents
        repository.stopRunResponse = AiChatStopRunResponse(
            sessionId = "session-1",
            stopped = false,
            stillRunning = true
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(AiComposerPhase.RUNNING, runtime.state.value.composerPhase)
        assertEquals("run-1", runtime.state.value.activeRun?.runId)

        runtime.stopStreaming()
        advanceUntilIdle()

        assertEquals(listOf("ensured-session-1", "session-1"), repository.loadBootstrapSessionIds)
        assertEquals(listOf("run-1", "run-2"), repository.attachRunIds)
        assertEquals(AiComposerPhase.RUNNING, runtime.state.value.composerPhase)
        assertEquals("run-2", runtime.state.value.activeRun?.runId)
        assertTrue(runtime.state.value.isLiveAttached)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }
}
