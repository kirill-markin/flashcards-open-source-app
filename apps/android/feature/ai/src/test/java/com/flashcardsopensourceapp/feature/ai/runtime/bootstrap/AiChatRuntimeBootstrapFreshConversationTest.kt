package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.ai.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import java.net.SocketException
import java.net.SocketTimeoutException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeBootstrapFreshConversationTest {
    @Test
    fun retryBootstrapProvisionsFailedInitialBlankSessionWithSameProvisionalId() = runTest {
        val repository = FakeAiChatRepository()
        val provisionalSessionId = "bootstrap-provisional-1"
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState()
        repository.nextEnsureSessionId = provisionalSessionId
        repository.createNewSessionErrors += SocketException("connection reset")
        repository.createNewSessionErrors += SocketTimeoutException("timeout")
        repository.createNewSessionErrors += SocketException("still unavailable")
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

        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals(
            listOf(provisionalSessionId, provisionalSessionId, provisionalSessionId),
            repository.createNewSessionRequests
        )
        assertEquals(provisionalSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertEquals(
            provisionalSessionId,
            repository.persistedStates[defaultTestWorkspaceId]?.chatSessionId
        )
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.requiresRemoteSessionProvisioning ?: false
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = provisionalSessionId,
            activeRun = null
        )

        runtime.retryBootstrap()
        advanceUntilIdle()

        assertEquals(
            listOf(
                "createNewSession:$provisionalSessionId",
                "createNewSession:$provisionalSessionId",
                "createNewSession:$provisionalSessionId",
                "createNewSession:$provisionalSessionId",
                "loadBootstrap:$provisionalSessionId"
            ),
            repository.remoteCallEvents
        )
        assertEquals(
            listOf(
                provisionalSessionId,
                provisionalSessionId,
                provisionalSessionId,
                provisionalSessionId
            ),
            repository.createNewSessionRequests
        )
        assertEquals(listOf(provisionalSessionId), repository.loadBootstrapSessionIds)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(provisionalSessionId, runtime.state.value.persistedState.chatSessionId)
        assertFalse(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.requiresRemoteSessionProvisioning ?: true
        )
    }

    @Test
    fun freshConversationRetriesProvisioningTransientFailuresWithSameSessionId() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
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

        repository.createNewSessionErrors += SocketException("connection reset")
        repository.createNewSessionErrors += SocketTimeoutException("timeout")
        runtime.clearConversation()
        advanceUntilIdle()

        val freshSessionId = runtime.state.value.persistedState.chatSessionId
        assertEquals(
            listOf(freshSessionId, freshSessionId, freshSessionId),
            repository.createNewSessionRequests
        )
        assertEquals(
            listOf(
                defaultTestWorkspaceId,
                defaultTestWorkspaceId,
                defaultTestWorkspaceId,
                defaultTestWorkspaceId
            ),
            repository.prepareSessionRequests
        )
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(freshSessionId, runtime.state.value.conversationScopeId)
        assertFalse(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.requiresRemoteSessionProvisioning ?: true
        )
    }

    @Test
    fun retryBootstrapProvisionsFailedFreshConversationBeforeLoadingBootstrap() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
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

        repository.createNewSessionErrors += SocketException("connection reset")
        repository.createNewSessionErrors += SocketTimeoutException("timeout")
        repository.createNewSessionErrors += SocketException("still unavailable")
        runtime.clearConversation()
        advanceUntilIdle()

        val freshSessionId = runtime.state.value.persistedState.chatSessionId
        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertNull(runtime.state.value.activeAlert)
        assertTrue(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.requiresRemoteSessionProvisioning ?: false
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = freshSessionId,
            activeRun = null
        )

        runtime.retryBootstrap()
        advanceUntilIdle()

        assertEquals(
            listOf(freshSessionId, freshSessionId, freshSessionId, freshSessionId),
            repository.createNewSessionRequests
        )
        assertEquals(listOf("session-1", freshSessionId), repository.loadBootstrapSessionIds)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(freshSessionId, runtime.state.value.persistedState.chatSessionId)
        assertFalse(runtime.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.requiresRemoteSessionProvisioning ?: true
        )
    }
}
