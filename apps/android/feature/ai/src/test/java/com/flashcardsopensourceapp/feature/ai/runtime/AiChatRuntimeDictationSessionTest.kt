package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeDictationSessionTest {
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
    fun dictationPendingRemoteSessionProvisioningFailureAttemptsCreateNewSessionOnceAndSkipsTranscription() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "pending-session-1",
            requiresRemoteSessionProvisioning = true
        )
        repository.createNewSessionErrors += IOException("connection reset")
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

        assertEquals(listOf("pending-session-1"), repository.createNewSessionRequests)
        assertTrue(repository.transcribeAudioSessionIds.isEmpty())
        assertEquals("pending-session-1", runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertEquals(AiChatDictationState.IDLE, runtime.state.value.dictationState)
        assertTrue(runtime.state.value.activeAlert is AiAlertState.GeneralError)
    }

    @Test
    fun dictationPreemptsRetryingFreshSessionProvisioningAndSkipsTranscriptionWhenOneShotFails() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.createNewSessionErrors += IOException("connection reset")
        repository.createNewSessionErrors += IOException("still unavailable")
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        repository.remoteCallEvents.clear()

        runtime.clearConversation()
        runCurrent()
        val freshSessionId = repository.createNewSessionRequests.single()
        assertTrue(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)

        runtime.startDictationRecording()
        runtime.transcribeRecordedAudio(
            fileName = "clip.m4a",
            mediaType = "audio/m4a",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        runCurrent()

        assertEquals(listOf(freshSessionId, freshSessionId), repository.createNewSessionRequests)
        assertTrue(repository.transcribeAudioSessionIds.isEmpty())
        assertEquals(freshSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertEquals(AiChatDictationState.IDLE, runtime.state.value.dictationState)
        assertTrue(runtime.state.value.activeAlert is AiAlertState.GeneralError)

        advanceUntilIdle()

        assertEquals(listOf(freshSessionId, freshSessionId), repository.createNewSessionRequests)
        assertTrue(repository.transcribeAudioSessionIds.isEmpty())
    }

    @Test
    fun draftMessageCanChangeWhileDictationIsActive() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.transcribeAudioGates += CompletableDeferred<Unit>()
        repository.transcribeAudioResponse = AiChatTranscriptionResult(
            text = "late transcript",
            sessionId = "session-1"
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        runtime.startDictationPermissionRequest()
        runtime.updateDraftMessage(draftMessage = "Typed while requesting permission")

        assertEquals(AiChatDictationState.REQUESTING_PERMISSION, runtime.state.value.dictationState)
        assertEquals("Typed while requesting permission", runtime.state.value.draftMessage)

        runtime.startDictationRecording()
        runtime.updateDraftMessage(draftMessage = "Typed while recording")

        assertEquals(AiChatDictationState.RECORDING, runtime.state.value.dictationState)
        assertEquals("Typed while recording", runtime.state.value.draftMessage)

        runtime.transcribeRecordedAudio(
            fileName = "clip.m4a",
            mediaType = "audio/m4a",
            audioBytes = byteArrayOf(1, 2, 3)
        )
        runCurrent()
        runtime.updateDraftMessage(draftMessage = "Typed while transcribing")

        assertEquals(AiChatDictationState.TRANSCRIBING, runtime.state.value.dictationState)
        assertEquals("Typed while transcribing", runtime.state.value.draftMessage)

        runtime.cancelDictation()
        runCurrent()
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
}
