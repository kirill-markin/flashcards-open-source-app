package com.flashcardsopensourceapp.feature.ai.runtime

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
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatDictationCoordinatorTest {
    @Test
    fun dictationCanStartDuringAcceptedRunningPhase() = runTest {
        val context = makeRuntimeContext(
            scope = this,
            repository = FakeAiChatRepository(),
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )
        val dictationCoordinator = makeDictationCoordinator(context = context)
        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState()
        ).copy(
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            composerPhase = AiComposerPhase.RUNNING
        )

        dictationCoordinator.startDictationRecording()

        assertEquals(AiChatDictationState.RECORDING, context.state.value.dictationState)
    }

    @Test
    fun dictationStartRemainsBlockedDuringLockedPhasesAndWhenDisabled() = runTest {
        val context = makeRuntimeContext(
            scope = this,
            repository = FakeAiChatRepository(),
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )
        val dictationCoordinator = makeDictationCoordinator(context = context)
        val disabledConfig = defaultAiChatServerConfig.copy(
            features = defaultAiChatServerConfig.features.copy(dictationEnabled = false)
        )
        val lockedStates: List<AiChatRuntimeState> = listOf(
            makeAiDraftState(
                workspaceId = defaultTestWorkspaceId,
                persistedState = makeDefaultAiChatPersistedState()
            ).copy(composerPhase = AiComposerPhase.PREPARING_SEND),
            makeAiDraftState(
                workspaceId = defaultTestWorkspaceId,
                persistedState = makeDefaultAiChatPersistedState()
            ).copy(composerPhase = AiComposerPhase.STARTING_RUN),
            makeAiDraftState(
                workspaceId = defaultTestWorkspaceId,
                persistedState = makeDefaultAiChatPersistedState()
            ).copy(
                activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
                composerPhase = AiComposerPhase.STOPPING
            ),
            makeAiDraftState(
                workspaceId = defaultTestWorkspaceId,
                persistedState = makeDefaultAiChatPersistedState().copy(
                    lastKnownChatConfig = disabledConfig
                )
            )
        )

        lockedStates.forEach { runtimeState ->
            context.runtimeStateMutable.value = runtimeState

            dictationCoordinator.startDictationRecording()

            assertEquals(AiChatDictationState.IDLE, context.state.value.dictationState)
        }
    }

    @Test
    fun freshConversationResetCancelsInFlightTranscriptionAndIgnoresLateResult() = runTest {
        val repository = FakeAiChatRepository()
        repository.transcribeAudioResponse = AiChatTranscriptionResult(
            text = "late transcript",
            sessionId = "session-1"
        )
        val transcribeGate = CompletableDeferred<Unit>()
        repository.transcribeAudioGates += transcribeGate
        val context = makeRuntimeContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )

        val dictationCoordinator = makeDictationCoordinator(context = context)
        val sessionCoordinator = AiChatSessionCoordinator(
            context = context,
            detachLiveStream = { _ -> Unit },
            cancelActiveDictation = dictationCoordinator::cancelActiveTranscription
        )
        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState().copy(chatSessionId = "session-1")
        ).copy(
            dictationState = AiChatDictationState.RECORDING
        )

        dictationCoordinator.transcribeRecordedAudio(
            fileName = "clip.m4a",
            mediaType = "audio/m4a",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        runCurrent()

        assertEquals(AiChatDictationState.TRANSCRIBING, context.state.value.dictationState)

        sessionCoordinator.startFreshConversation(
            draftMessage = "",
            pendingAttachments = emptyList(),
            shouldFocusComposer = false
        )
        runCurrent()

        assertEquals(AiChatDictationState.IDLE, context.state.value.dictationState)
        assertTrue(repository.createNewSessionRequests.size == 1)

        transcribeGate.complete(Unit)
        advanceUntilIdle()

        val freshSessionId = repository.createNewSessionRequests.single()
        assertEquals(freshSessionId, context.state.value.persistedState.chatSessionId)
        assertEquals("", context.state.value.draftMessage)
        assertEquals(listOf("session-1"), repository.transcribeAudioSessionIds)
    }

    private fun makeDictationCoordinator(context: AiChatRuntimeContext): AiChatDictationCoordinator {
        lateinit var dictationCoordinator: AiChatDictationCoordinator
        val sessionCoordinator = AiChatSessionCoordinator(
            context = context,
            detachLiveStream = { _ -> Unit },
            cancelActiveDictation = { reason ->
                dictationCoordinator.cancelActiveTranscription(reason = reason)
            }
        )
        dictationCoordinator = AiChatDictationCoordinator(
            context = context,
            sessionCoordinator = sessionCoordinator
        )
        return dictationCoordinator
    }
}
