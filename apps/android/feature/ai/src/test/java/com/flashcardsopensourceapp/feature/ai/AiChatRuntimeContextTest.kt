package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeContextTest {
    @Test
    fun autoSyncCompletionClearsOnlyTheOriginWorkspaceAfterWorkspaceSwitch() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val autoSyncGate = CompletableDeferred<Unit>()
        autoSyncEventRepository.runAutoSyncGates += autoSyncGate
        val originState = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1",
            pendingToolRunPostSync = true
        )
        val switchedWorkspaceState = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-2",
            pendingToolRunPostSync = true
        )
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = originState
        )
        repository.setPersistedState(
            workspaceId = secondaryTestWorkspaceId,
            state = switchedWorkspaceState
        )
        val context = makeRuntimeContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )
        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = originState
        )

        launch {
            context.triggerToolRunPostSyncIfNeeded(reason = "test")
        }
        advanceUntilIdle()

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertTrue(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)

        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = secondaryTestWorkspaceId,
            persistedState = switchedWorkspaceState
        )

        autoSyncGate.complete(Unit)
        advanceUntilIdle()

        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: true
        )
        assertTrue(
            repository.persistedStates[secondaryTestWorkspaceId]?.pendingToolRunPostSync ?: false
        )
        assertEquals(secondaryTestWorkspaceId, context.runtimeStateMutable.value.workspaceId)
        assertTrue(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
    }
}
