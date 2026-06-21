package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.core.observability.AndroidAiObservationName
import com.flashcardsopensourceapp.core.observability.AndroidWarningIssueEvent
import com.flashcardsopensourceapp.data.local.model.ai.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAiDraftState
import java.net.UnknownHostException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeContextTest {
    @Test
    fun persistStateKeepsNewestSnapshotWhenOlderWriteFinishesLast() = runTest {
        val repository = FakeAiChatRepository()
        val firstSaveGate = CompletableDeferred<Unit>()
        repository.savePersistedStateGates += firstSaveGate
        val context = makeRuntimeContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )
        val olderSnapshot = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState().copy(chatSessionId = "session-1")
        )
        val newerSnapshot = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState().copy(chatSessionId = "session-2")
        )

        context.persistState(snapshot = olderSnapshot)
        runCurrent()
        context.persistState(snapshot = newerSnapshot)
        firstSaveGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(
            "session-2",
            repository.persistedStates[defaultTestWorkspaceId]?.chatSessionId
        )
    }

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

    @Test
    fun transientNetworkAutoSyncFailureDoesNotWarnAndKeepsPendingFlagForRetry() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val observability = RecordingAppObservability()
        autoSyncEventRepository.runAutoSyncErrors += UnknownHostException("Unable to resolve host")
        val context = makePendingPostRunSyncContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository,
            observability = observability
        )

        context.triggerToolRunPostSyncIfNeeded(reason = "test")

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertTrue(observability.warningEvents.isEmpty())
        assertTrue(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: false
        )

        context.triggerToolRunPostSyncIfNeeded(reason = "retry")

        assertEquals(2, autoSyncEventRepository.requests.size)
        assertTrue(observability.warningEvents.isEmpty())
        assertFalse(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: true
        )
    }

    @Test
    fun retryableCloudAutoSyncFailureDoesNotWarnAndKeepsPendingFlagForRetry() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val observability = RecordingAppObservability()
        autoSyncEventRepository.runAutoSyncErrors += makeCloudRemoteException(statusCode = 504)
        val context = makePendingPostRunSyncContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository,
            observability = observability
        )

        context.triggerToolRunPostSyncIfNeeded(reason = "test")

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertTrue(observability.warningEvents.isEmpty())
        assertTrue(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: false
        )

        context.triggerToolRunPostSyncIfNeeded(reason = "retry")

        assertEquals(2, autoSyncEventRepository.requests.size)
        assertTrue(observability.warningEvents.isEmpty())
        assertFalse(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: true
        )
    }

    @Test
    fun wrappedTransientNetworkAutoSyncFailureDoesNotWarn() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val observability = RecordingAppObservability()
        autoSyncEventRepository.runAutoSyncErrors += IllegalStateException(
            "Wrapped network error",
            UnknownHostException("Unable to resolve host")
        )
        val context = makePendingPostRunSyncContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository,
            observability = observability
        )

        context.triggerToolRunPostSyncIfNeeded(reason = "test")

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertTrue(observability.warningEvents.isEmpty())
        assertTrue(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: false
        )
    }

    @Test
    fun nonTransientAutoSyncFailureKeepsPostRunSyncWarning() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val observability = RecordingAppObservability()
        autoSyncEventRepository.runAutoSyncErrors += IllegalStateException("Cloud sync failed")
        val context = makePendingPostRunSyncContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository,
            observability = observability
        )

        context.triggerToolRunPostSyncIfNeeded(reason = "test")

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertEquals(1, observability.warningEvents.size)
        val warning = observability.warningEvents.single()
        assertTrue(warning is AndroidWarningIssueEvent.AiLifecycleWarning)
        val lifecycleWarning = warning as AndroidWarningIssueEvent.AiLifecycleWarning
        assertEquals(
            AndroidAiObservationName.POST_RUN_SYNC_FAILED.tagValue,
            lifecycleWarning.lifecycleAction
        )
        assertTrue(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: false
        )
    }

    @Test
    fun nonRetryableCloudAutoSyncFailureKeepsPostRunSyncWarning() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val observability = RecordingAppObservability()
        autoSyncEventRepository.runAutoSyncErrors += makeCloudRemoteException(statusCode = 400)
        val context = makePendingPostRunSyncContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository,
            observability = observability
        )

        context.triggerToolRunPostSyncIfNeeded(reason = "test")

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertEquals(1, observability.warningEvents.size)
        val warning = observability.warningEvents.single()
        assertTrue(warning is AndroidWarningIssueEvent.AiLifecycleWarning)
        val lifecycleWarning = warning as AndroidWarningIssueEvent.AiLifecycleWarning
        assertEquals(
            AndroidAiObservationName.POST_RUN_SYNC_FAILED.tagValue,
            lifecycleWarning.lifecycleAction
        )
        assertTrue(context.runtimeStateMutable.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: false
        )
    }
}

private fun makePendingPostRunSyncContext(
    scope: TestScope,
    repository: FakeAiChatRepository,
    autoSyncEventRepository: FakeAutoSyncEventRepository,
    observability: RecordingAppObservability
): AiChatRuntimeContext {
    val originState = makeDefaultAiChatPersistedState().copy(
        chatSessionId = "session-1",
        pendingToolRunPostSync = true
    )
    repository.setPersistedState(
        workspaceId = defaultTestWorkspaceId,
        state = originState
    )
    val context = makeRuntimeContextWithObservability(
        scope = scope,
        repository = repository,
        autoSyncEventRepository = autoSyncEventRepository,
        observability = observability
    )
    context.runtimeStateMutable.value = makeAiDraftState(
        workspaceId = defaultTestWorkspaceId,
        persistedState = originState
    )
    return context
}
