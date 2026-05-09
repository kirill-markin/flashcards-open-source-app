package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatConversation
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import java.io.IOException
import java.net.MalformedURLException
import java.net.SocketException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
            listOf(defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertEquals(listOf("retry-session-1"), repository.loadBootstrapSessionIds)
        assertEquals(
            "retry-session-1",
            runtime.state.value.persistedState.chatSessionId
        )
    }

    @Test
    fun bootstrapDoesNotRetryPrepareSessionTransientFailuresBeforeProvisioning() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState()
        repository.nextEnsureSessionId = "prepare-session-1"
        repository.prepareSessionErrors += SocketException("connection reset")
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
            listOf(defaultTestWorkspaceId),
            repository.prepareSessionRequests
        )
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertTrue(repository.loadBootstrapSessionIds.isEmpty())
        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertTrue(runtime.state.value.conversationBootstrapErrorPresentation.message.isNotEmpty())
    }

    @Test
    fun bootstrapRetriesOnlyPreparedRemoteCallsAfterPrepareSessionSucceeds() = runTest {
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

        assertEquals(listOf(defaultTestWorkspaceId), repository.prepareSessionRequests)
        assertTrue(repository.ensureSessionRequests.isEmpty())
        assertEquals(2, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
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

    @Test
    fun sameSessionRefreshSessionMismatchFailurePreservesExistingConversationState() = runTest {
        val repository = FakeAiChatRepository()
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "ZmlsZQ=="
        )
        val messages = listOf(
            makeUserMessage(
                content = listOf(AiChatContentPart.Text(text = "Existing question")),
                timestampMillis = 1L
            ),
            makeAssistantStatusMessage(timestampMillis = 2L)
        )
        val activeRun = makeActiveRun(runId = "run-1", cursor = "0")
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.draftStates[defaultTestWorkspaceId to "session-1"] = AiChatDraftState(
            draftMessage = "Keep this draft",
            pendingAttachments = listOf(attachment)
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = activeRun
        ).copy(
            conversation = AiChatConversation(
                messages = messages,
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = true,
                oldestCursor = "older-cursor"
            )
        )
        val runtime = makeRuntimeWithCloudState(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository(),
            cloudState = CloudAccountState.GUEST
        )

        runtime.updateAccessContext(
            makeAccessContext(workspaceId = defaultTestWorkspaceId)
        )
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(messages, runtime.state.value.persistedState.messages)
        assertEquals(activeRun, runtime.state.value.activeRun)

        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "different-session",
            activeRun = null
        )
        runtime.onScreenVisible()
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.FAILED, runtime.state.value.conversationBootstrapState)
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(messages, runtime.state.value.persistedState.messages)
        assertEquals("session-1", runtime.state.value.conversationScopeId)
        assertTrue(runtime.state.value.hasOlder)
        assertEquals("older-cursor", runtime.state.value.oldestCursor)
        assertEquals(activeRun, runtime.state.value.activeRun)
        assertEquals("Keep this draft", runtime.state.value.draftMessage)
        assertEquals(listOf(attachment), runtime.state.value.pendingAttachments)
        assertTrue(
            runtime.state.value.conversationBootstrapErrorPresentation.technicalDetails
                .orEmpty()
                .contains("mismatched sessionId")
        )
    }

    @Test
    fun forcedWorkspaceBootstrapContractMismatchDoesNotRestorePreviousConversationState() = runTest {
        val repository = FakeAiChatRepository()
        val previousAttachment = AiChatAttachment.Binary(
            id = "previous-attachment",
            fileName = "previous.txt",
            mediaType = "text/plain",
            base64Data = "cHJldmlvdXM="
        )
        val previousMessages = listOf(
            makeUserMessage(
                content = listOf(AiChatContentPart.Text(text = "Previous workspace question")),
                timestampMillis = 1L
            )
        )
        val previousActiveRun = makeActiveRun(runId = "previous-run", cursor = "previous-cursor")
        repository.persistedStates[secondaryTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-2"
        )
        repository.loadBootstrapErrors += makeCloudContractMismatchException(
            message = "Cloud contract mismatch for chat bootstrap: payload={previous-workspace-leak}"
        )
        val context = makeRuntimeContext(
            scope = this,
            repository = repository,
            autoSyncEventRepository = FakeAutoSyncEventRepository()
        )
        context.activeAccessContext = makeAccessContext(workspaceId = secondaryTestWorkspaceId)
        context.runtimeStateMutable.value = makeAiDraftState(
            workspaceId = defaultTestWorkspaceId,
            persistedState = makeDefaultAiChatPersistedState().copy(
                chatSessionId = "session-1",
                messages = previousMessages
            )
        ).copy(
            conversationScopeId = "session-1",
            hasOlder = true,
            oldestCursor = "previous-older-cursor",
            activeRun = previousActiveRun,
            draftMessage = "Previous draft",
            pendingAttachments = listOf(previousAttachment),
            serverComposerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "previous-suggestion",
                    text = "Previous suggestion",
                    source = "server",
                    assistantItemId = null
                )
            ),
            conversationBootstrapState = AiConversationBootstrapState.READY
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
        assertEquals(secondaryTestWorkspaceId, context.state.value.workspaceId)
        assertEquals("session-2", context.state.value.persistedState.chatSessionId)
        assertTrue(context.state.value.persistedState.messages.isEmpty())
        assertNull(context.state.value.conversationScopeId)
        assertFalse(context.state.value.hasOlder)
        assertNull(context.state.value.oldestCursor)
        assertNull(context.state.value.activeRun)
        assertEquals("", context.state.value.draftMessage)
        assertTrue(context.state.value.pendingAttachments.isEmpty())
        assertTrue(context.state.value.serverComposerSuggestions.isEmpty())
        assertEquals(
            "AI chat could not be loaded. Try again.",
            context.state.value.conversationBootstrapErrorPresentation.message
        )
        assertFalse(
            context.state.value.conversationBootstrapErrorPresentation.technicalDetails
                .orEmpty()
                .contains("previous-workspace-leak")
        )
    }

    @Test
    fun sameWorkspaceRetryBootstrapPreventsStaleBootstrapFromApplying() = runTest {
        val repository = FakeAiChatRepository()
        val firstBootstrapGate = CompletableDeferred<Unit>()
        repository.loadBootstrapNonCancellableGates += firstBootstrapGate
        repository.persistedStates[defaultTestWorkspaceId] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "stale-run", cursor = "stale-cursor")
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

        assertEquals(1, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.LOADING, runtime.state.value.conversationBootstrapState)

        runtime.retryBootstrap()
        advanceUntilIdle()

        assertEquals(2, repository.loadBootstrapCalls)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertNull(runtime.state.value.activeRun)

        firstBootstrapGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertNull(runtime.state.value.activeRun)
    }

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
            listOf(defaultTestWorkspaceId, defaultTestWorkspaceId),
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

    private fun makeCloudContractMismatchException(message: String): Exception {
        val errorClass = Class.forName(
            "com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException"
        )
        val constructor = errorClass.getDeclaredConstructor(String::class.java, Throwable::class.java)
        constructor.isAccessible = true
        return constructor.newInstance(message, null) as Exception
    }
}
