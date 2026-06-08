package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.ai.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAiDraftState
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.lifecycle.AiChatRuntimeLifecycleCoordinator
import java.net.MalformedURLException
import java.net.SocketException
import java.net.SocketTimeoutException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeBootstrapWarmUpTest {
    @Test
    fun completedWarmUpJobIsNotRetainedWithEagerDispatcher() = runTest(UnconfinedTestDispatcher()) {
        val repository = FakeAiChatRepository()
        val context = makeRuntimeContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )
        context.activeAccessContext = makeAccessContext(workspaceId = defaultTestWorkspaceId).copy(
            cloudState = CloudAccountState.LINKED
        )
        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState()
        )
        var bootstrapCalls: Int = 0
        val coordinator = AiChatRuntimeLifecycleCoordinator(
            context = context,
            startConversationBootstrap = { _, _ ->
                bootstrapCalls += 1
            },
            detachLiveStream = { _ -> },
            cancelActiveDictation = { _ -> }
        )

        coordinator.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)

        assertEquals(1, bootstrapCalls)
        assertNull(context.activeWarmUpJob)

        coordinator.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)

        assertEquals(2, bootstrapCalls)
        assertNull(context.activeWarmUpJob)
    }

    @Test
    fun visibleWarmUpDoesNotRetryPermanentBootstrapFailureButManualRetryStillWorks() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 400)
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
        assertEquals(listOf(defaultTestWorkspaceId), repository.prepareSessionRequests)

        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        runtime.onScreenHidden()
        runtime.onScreenVisible()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals(listOf(defaultTestWorkspaceId), repository.prepareSessionRequests)
        assertEquals(0, repository.loadBootstrapCalls)

        runtime.retryBootstrap()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(listOf("session-1"), repository.loadBootstrapSessionIds)
    }

    @Test
    fun visibleWarmUpRetriesTransientBootstrapFailure() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 503)
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 503)
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 503)
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
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )

        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        runtime.onScreenHidden()
        runtime.onScreenVisible()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(
            listOf(
                defaultTestWorkspaceId,
                defaultTestWorkspaceId,
                defaultTestWorkspaceId,
                defaultTestWorkspaceId
            ),
            repository.prepareSessionRequests
        )
        assertEquals(listOf("session-1"), repository.loadBootstrapSessionIds)
    }

    @Test
    fun disconnectedGuestAccessWarmUpRetriesTransientPrepareSessionFailure() = runTest {
        val repository = FakeAiChatRepository()
        repository.prepareSessionErrors += SSLHandshakeException("connection closed")
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

        assertEquals(
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertNull(runtime.state.value.activeAlert)
    }

    @Test
    fun disconnectedGuestAccessWarmUpFailureDoesNotShowAlert() = runTest {
        val repository = FakeAiChatRepository()
        repository.prepareSessionErrors += MalformedURLException("bad guest auth URL")
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

        assertEquals(listOf(defaultTestWorkspaceId), repository.prepareSessionRequests)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertNull(runtime.state.value.activeAlert)
    }

    @Test
    fun visibleWarmUpRetriesTransientFreshConversationProvisioningFailure() = runTest {
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
        assertEquals(
            listOf(freshSessionId, freshSessionId, freshSessionId),
            repository.createNewSessionRequests
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = freshSessionId,
            activeRun = null
        )

        runtime.onScreenHidden()
        runtime.onScreenVisible()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(
            listOf(freshSessionId, freshSessionId, freshSessionId, freshSessionId),
            repository.createNewSessionRequests
        )
        assertEquals(listOf("session-1", freshSessionId), repository.loadBootstrapSessionIds)
    }

    @Test
    fun visibleWarmUpDoesNotRetryPermanentFreshConversationProvisioningFailure() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 503)
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 503)
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 503)
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

        repository.createNewSessionErrors += makeCloudRemoteException(statusCode = 400)
        runtime.clearConversation()
        advanceUntilIdle()

        val freshSessionId = runtime.state.value.persistedState.chatSessionId
        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals(listOf(freshSessionId), repository.createNewSessionRequests)
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = freshSessionId,
            activeRun = null
        )

        runtime.onScreenHidden()
        runtime.onScreenVisible()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals(listOf(freshSessionId), repository.createNewSessionRequests)
        assertTrue(repository.loadBootstrapSessionIds.isEmpty())

        runtime.retryBootstrap()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(listOf(freshSessionId, freshSessionId), repository.createNewSessionRequests)
        assertEquals(listOf(freshSessionId), repository.loadBootstrapSessionIds)
    }
}
