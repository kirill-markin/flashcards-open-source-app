package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.feature.ai.AiEntryPrefill
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeActiveRunComposerGuardTest {
    @Test
    fun acceptedRunningRunAllowsNextDraftPreparationButBlocksSecondSend() = runTest {
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
                    content = listOf(AiChatContentPart.Text(text = "First prompt")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)
        val nextAttachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "bm90ZXM="
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        runtime.updateDraftMessage(draftMessage = "First prompt")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(AiComposerPhase.RUNNING, runtime.state.value.composerPhase)

        runtime.updateDraftMessage(draftMessage = "Next draft")
        runtime.addPendingAttachment(attachment = nextAttachment)
        runtime.sendMessage()
        advanceUntilIdle()
        runtime.removePendingAttachment(attachmentId = nextAttachment.id)

        assertEquals("Next draft", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertEquals(1, repository.startRunCalls)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun acceptedRunningRunAppliesEntryPrefillToNextDraftButBlocksSecondSend() = runTest {
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
                    content = listOf(AiChatContentPart.Text(text = "First prompt")),
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
        runtime.updateDraftMessage(draftMessage = "First prompt")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(AiComposerPhase.RUNNING, runtime.state.value.composerPhase)

        val didApplyPrefill = runtime.applyEntryPrefill(prefill = AiEntryPrefill.CREATE_CARD)
        runtime.sendMessage()
        advanceUntilIdle()

        assertTrue(didApplyPrefill)
        assertEquals("Help me create a card.", runtime.state.value.draftMessage)
        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertEquals(AiComposerPhase.RUNNING, runtime.state.value.composerPhase)
        assertEquals(1, repository.startRunCalls)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }
}
