package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeBootstrapProvisioningTest {
    @Test
    fun guestBootstrapProvisionsSessionBeforeLoadingConversationWhenPersistedSessionMissing() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState()
        repository.nextEnsureSessionId = "guest-session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "guest-session-1",
            activeRun = null
        )
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.GUEST
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId)
        )
        advanceUntilIdle()

        assertEquals(listOf("guest-session-1"), repository.createNewSessionRequests)
        assertEquals(listOf(testUiLocaleTag), repository.createNewSessionUiLocales)
        assertEquals(listOf("guest-session-1"), repository.loadBootstrapSessionIds)
        assertEquals(
            "guest-session-1",
            repository.persistedStates[defaultTestWorkspaceId]?.chatSessionId
        )
        assertEquals(
            "guest-session-1",
            runtime.state.value.persistedState.chatSessionId
        )
    }

    @Test
    fun linkedBootstrapProvisionsSessionBeforeLoadingConversationWhenPersistedSessionMissing() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState()
        repository.nextEnsureSessionId = "linked-session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "linked-session-1",
            activeRun = null
        )
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.LINKED
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId).copy(
                cloudState = CloudAccountState.LINKED
            )
        )
        advanceUntilIdle()

        assertEquals(listOf("linked-session-1"), repository.createNewSessionRequests)
        assertEquals(listOf(testUiLocaleTag), repository.createNewSessionUiLocales)
        assertEquals(listOf("linked-session-1"), repository.loadBootstrapSessionIds)
        assertEquals(
            "linked-session-1",
            repository.persistedStates[defaultTestWorkspaceId]?.chatSessionId
        )
        assertEquals(
            "linked-session-1",
            runtime.state.value.persistedState.chatSessionId
        )
    }
}
