package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.ai.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAiDraftState
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.AiChatBootstrapCoordinator
import java.io.IOException
import java.net.MalformedURLException
import java.net.SocketException
import java.net.SocketTimeoutException
import javax.net.ssl.SSLHandshakeException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeBootstrapRetryTest {
    @Test
    fun bootstrapRetryReusesProvisionalSessionIdWhenProvisioningFailsTransiently() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState()
        repository.nextEnsureSessionId = "retry-session-1"
        repository.createNewSessionErrors += SocketException("connection reset")
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "retry-session-1",
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

        assertEquals(
            listOf("retry-session-1", "retry-session-1"),
            repository.createNewSessionRequests
        )
        assertEquals(
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(listOf("retry-session-1"), repository.loadBootstrapSessionIds)
        assertEquals(
            "retry-session-1",
            runtime.state.value.persistedState.chatSessionId
        )
    }

    @Test
    fun bootstrapRetriesPrepareSessionTransientFailuresBeforeProvisioning() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState()
        repository.nextEnsureSessionId = "prepare-session-1"
        repository.prepareSessionErrors += SocketException("connection reset")
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "prepare-session-1",
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

        assertEquals(
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(listOf("prepare-session-1"), repository.createNewSessionRequests)
        assertEquals(listOf("prepare-session-1"), repository.loadBootstrapSessionIds)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals("prepare-session-1", runtime.state.value.persistedState.chatSessionId)
    }

    @Test
    fun bootstrapRetriesPrepareSessionTransientCloudRemoteFailureBeforeProvisioning() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState()
        repository.nextEnsureSessionId = "cloud-prepare-session-1"
        repository.prepareSessionErrors += makeCloudRemoteException(statusCode = 503)
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "cloud-prepare-session-1",
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

        assertEquals(
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(listOf("cloud-prepare-session-1"), repository.createNewSessionRequests)
        assertEquals(listOf("cloud-prepare-session-1"), repository.loadBootstrapSessionIds)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun bootstrapRetriesPreparedRemoteCallsWithFreshPreparationAttempt() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.loadBootstrapErrors += SocketException("connection reset")
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

        assertEquals(
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertTrue(repository.ensureSessionRequests.isEmpty())
        assertEquals(2, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun bootstrapRetriesTransientSslHandshakeFailure() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.loadBootstrapErrors += SSLHandshakeException("connection closed")
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

        assertEquals(
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(2, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun bootstrapDoesNotRetryNonTransientSslHandshakeFailure() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.loadBootstrapErrors += SSLHandshakeException("Trust anchor for certification path not found.")
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

        assertEquals(listOf(defaultTestWorkspaceId), repository.prepareSessionRequests)
        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
    }

    @Test
    fun bootstrapDoesNotRetryRemoteCallsWhenDraftLoadingFailsLocally() = runTest {
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

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        repository.loadDraftStateErrors += IOException("draft store unavailable")
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        runtime.retryBootstrap()
        advanceUntilIdle()

        assertEquals(listOf(defaultTestWorkspaceId, defaultTestWorkspaceId), repository.prepareSessionRequests)
        assertEquals(2, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertTrue(
            runtime.state.value.conversationBootstrapErrorPresentation.technicalDetails
                .orEmpty()
                .contains("draft store unavailable")
        )
    }

    @Test
    fun forcedFreshSessionRetryPreservesDraftWhenProvisioningSucceedsAndBootstrapExhaustsRetries() = runTest {
        val repository = FakeAiChatRepository()
        val freshSessionId = "fresh-session-1"
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "prompt.txt",
            mediaType = "text/plain",
            base64Data = "cHJvbXB0"
        )
        val pendingFreshState = makeDefaultAiChatPersistedState().copy(
            chatSessionId = freshSessionId,
            requiresRemoteSessionProvisioning = true
        )
        val pendingDraftState = AiChatDraftState(
            draftMessage = "Keep this fresh prompt",
            pendingAttachments = listOf(attachment)
        )
        repository.persistedStates[defaultTestWorkspaceId] = pendingFreshState
        repository.draftStates[defaultTestWorkspaceId to freshSessionId] = pendingDraftState
        repository.loadBootstrapErrors += SocketTimeoutException("first timeout")
        repository.loadBootstrapErrors += SocketTimeoutException("second timeout")
        repository.loadBootstrapErrors += SocketTimeoutException("third timeout")
        val context = makeRuntimeContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )
        context.activeAccessContext = makeAccessContext(workspaceId = defaultTestWorkspaceId)
        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = pendingFreshState
        ).copy(
            draftMessage = pendingDraftState.draftMessage,
            pendingAttachments = pendingDraftState.pendingAttachments,
            conversationBootstrapState = AiConversationBootstrapState.FAILED
        )
        val coordinator = AiChatBootstrapCoordinator(
            context = context,
            attachBootstrapLiveStream = { _, _, _ -> }
        )

        coordinator.startConversationBootstrap(
            forceReloadState = true,
            resumeDiagnostics = null
        )
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.FAILED, context.state.value.conversationBootstrapState)
        assertEquals(freshSessionId, context.state.value.persistedState.chatSessionId)
        assertFalse(context.state.value.persistedState.requiresRemoteSessionProvisioning)
        assertEquals("Keep this fresh prompt", context.state.value.draftMessage)
        assertEquals(listOf(attachment), context.state.value.pendingAttachments)
        assertEquals(pendingDraftState, repository.draftStates[defaultTestWorkspaceId to freshSessionId])
        assertEquals(
            listOf(freshSessionId, freshSessionId, freshSessionId),
            repository.createNewSessionRequests
        )
        assertEquals(
            listOf(freshSessionId, freshSessionId, freshSessionId),
            repository.loadBootstrapSessionIds
        )
    }

    @Test
    fun bootstrapDoesNotRetryNonTransientMalformedUrlFailure() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.loadBootstrapErrors += MalformedURLException("bad bootstrap URL")
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

        assertEquals(listOf(defaultTestWorkspaceId), repository.prepareSessionRequests)
        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(listOf("session-1"), repository.loadBootstrapSessionIds)
        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
    }
}
