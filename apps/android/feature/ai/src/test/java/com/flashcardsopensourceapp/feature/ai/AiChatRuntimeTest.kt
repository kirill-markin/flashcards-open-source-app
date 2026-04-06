package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAcceptedConversationEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRunLive
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEventMetadata
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatStopRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatTranscriptionResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.makeAiChatCardAttachment
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import java.util.ArrayDeque
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeTest {
    private val appVersion: String = "1.1.0"

    @Test
    fun bootstrapWhileVisibleWithActiveRunStartsLiveCollection() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        assertEquals(listOf("run-1"), repository.attachRunIds)
        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertTrue(runtime.state.value.isLiveAttached)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun assistantMessageDoneKeepsActiveRunUntilRunTerminalCompleted() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Hello")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        liveEvents.emit(
            AiChatLiveEvent.AssistantMessageDone(
                metadata = makeMetadata(runId = "run-1", cursor = "1"),
                itemId = "item-1",
                content = listOf(AiChatContentPart.Text(text = "Done")),
                isError = false,
                isStopped = false
            )
        )
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        val lastMessageAfterDone = runtime.state.value.persistedState.messages.last()
        assertEquals("item-1", lastMessageAfterDone.itemId)
        assertEquals(false, lastMessageAfterDone.isError)
        assertEquals(false, lastMessageAfterDone.isStopped)
        assertEquals(
            "Done",
            (lastMessageAfterDone.content.single() as AiChatContentPart.Text).text
        )

        liveEvents.emit(
            AiChatLiveEvent.RunTerminal(
                metadata = makeMetadata(runId = "run-1", cursor = "2"),
                outcome = AiChatRunTerminalOutcome.COMPLETED,
                message = null,
                assistantItemId = null,
                isError = null,
                isStopped = null
            )
        )
        advanceUntilIdle()

        assertNull(runtime.state.value.activeRun)
        assertFalse(runtime.state.value.isLiveAttached)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun runTerminalResetRequiredForcesBootstrapReload() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        liveEvents.emit(
            AiChatLiveEvent.RunTerminal(
                metadata = makeMetadata(runId = "run-1", cursor = "6"),
                outcome = AiChatRunTerminalOutcome.RESET_REQUIRED,
                message = "refresh",
                assistantItemId = null,
                isError = null,
                isStopped = null
            )
        )
        advanceUntilIdle()

        assertEquals(2, repository.loadBootstrapCalls)
        assertNull(runtime.state.value.activeRun)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertFalse(runtime.state.value.isLiveAttached)
    }

    private fun makeRuntime(scope: TestScope, repository: FakeAiChatRepository): AiChatRuntime {
        return AiChatRuntime(
            scope = scope,
            aiChatRepository = repository,
            appVersion = appVersion,
            hasConsent = { repository.consent.value },
            currentCloudState = { CloudAccountState.GUEST },
            currentServerConfiguration = { com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration() },
            currentSyncStatus = { SyncStatus.Idle }
        )
    }

    private fun makeAccessContext(workspaceId: String = "workspace-1"): AiAccessContext {
        return AiAccessContext(
            workspaceId = workspaceId,
            cloudState = CloudAccountState.GUEST,
            linkedUserId = null,
            activeWorkspaceId = null
        )
    }

    private fun makeMetadata(runId: String, cursor: String): AiChatLiveEventMetadata {
        return AiChatLiveEventMetadata(
            sessionId = "session-1",
            conversationScopeId = "session-1",
            runId = runId,
            cursor = cursor,
            sequenceNumber = 1,
            streamEpoch = runId
        )
    }

    private fun makeActiveRun(runId: String, cursor: String): AiChatActiveRun {
        return AiChatActiveRun(
            runId = runId,
            status = "running",
            live = AiChatActiveRunLive(
                cursor = cursor,
                stream = AiChatLiveStreamEnvelope(
                    url = "https://example.com/live",
                    authorization = "Live token",
                    expiresAt = 123L
                )
            ),
            lastHeartbeatAtMillis = 456L
        )
    }

    private fun makeBootstrapResponse(
        sessionId: String,
        activeRun: AiChatActiveRun?
    ): AiChatBootstrapResponse {
        return AiChatBootstrapResponse(
            sessionId = sessionId,
            conversationScopeId = sessionId,
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = emptyList(),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            ),
            composerSuggestions = emptyList(),
            chatConfig = defaultAiChatServerConfig,
            activeRun = activeRun
        )
    }

    private fun makeAcceptedStartRunResponse(
        sessionId: String,
        activeRun: AiChatActiveRun?,
        messages: List<com.flashcardsopensourceapp.data.local.model.AiChatMessage>,
        composerSuggestions: List<AiChatComposerSuggestion>
    ): AiChatStartRunResponse {
        return AiChatAcceptedConversationEnvelope(
            accepted = true,
            sessionId = sessionId,
            conversationScopeId = sessionId,
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = messages,
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            ),
            composerSuggestions = composerSuggestions,
            chatConfig = defaultAiChatServerConfig,
            activeRun = activeRun,
            deduplicated = false
        )
    }

    @Test
    fun accessContextSwitchCancelsBootstrapAndRestoresNewWorkspaceBaseline() = runTest {
        val repository = FakeAiChatRepository()
        val firstBootstrapGate = CompletableDeferred<Unit>()
        val secondBootstrapGate = CompletableDeferred<Unit>()
        repository.loadBootstrapGates += firstBootstrapGate
        repository.loadBootstrapGates += secondBootstrapGate
        repository.setPersistedState(
            workspaceId = "workspace-1",
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "persisted-session-1")
        )
        repository.setPersistedState(
            workspaceId = "workspace-2",
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "persisted-session-2")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-2",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = "workspace-1"))
        advanceUntilIdle()

        runtime.updateAccessContext(makeAccessContext(workspaceId = "workspace-2"))
        advanceUntilIdle()

        assertEquals("workspace-2", runtime.state.value.workspaceId)
        assertEquals("persisted-session-2", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.LOADING, runtime.state.value.conversationBootstrapState)

        secondBootstrapGate.complete(Unit)
        advanceUntilIdle()

        assertEquals("workspace-2", runtime.state.value.workspaceId)
        assertEquals("session-2", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(2, repository.loadBootstrapCalls)
    }

    @Test
    fun passiveBootstrapPreservesLocalDraftAndAttachmentsWhenIdle() = runTest {
        val repository = FakeAiChatRepository()
        repository.setPersistedState(
            workspaceId = "workspace-1",
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "session-1")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)
        val attachment = AiChatAttachment.Binary(
            id = "attachment-1",
            fileName = "notes.txt",
            mediaType = "text/plain",
            base64Data = "ZmlsZQ=="
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "Preserve me")
        runtime.addPendingAttachment(attachment = attachment)
        runtime.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
        advanceUntilIdle()

        assertEquals("Preserve me", runtime.state.value.draftMessage)
        assertEquals(listOf(attachment), runtime.state.value.pendingAttachments)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun stalePersistedChatOpensFreshLocalSessionAndSkipsBootstrap() = runTest {
        val repository = FakeAiChatRepository()
        val nowMillis = System.currentTimeMillis()
        val staleTimestamp = nowMillis - aiChatStalenessThresholdMillis - 1_000L
        val oldSessionId = "session-old"
        repository.setPersistedState(
            workspaceId = "workspace-1",
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = oldSessionId,
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Stale question")),
                        timestampMillis = staleTimestamp
                    ),
                    makeAssistantStatusMessage(timestampMillis = staleTimestamp + 1L)
                )
            )
        )
        repository.draftStates["workspace-1" to oldSessionId] = AiChatDraftState(
            draftMessage = "Keep me here",
            pendingAttachments = listOf(
                makeAiChatCardAttachment(
                    cardId = "card-keep",
                    frontText = "Front",
                    backText = "Back",
                    tags = listOf("tag"),
                    effortLevel = com.flashcardsopensourceapp.data.local.model.EffortLevel.MEDIUM
                )
            )
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        assertEquals(0, repository.loadBootstrapCalls)
        assertEquals(1, repository.createNewSessionRequests.size)
        val newSessionId = repository.createNewSessionRequests.single()
        assertTrue(newSessionId.isNotBlank())
        assertFalse(newSessionId == oldSessionId)
        assertEquals(newSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals("", runtime.state.value.draftMessage)
        assertTrue(runtime.state.value.pendingAttachments.isEmpty())
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
        assertEquals(
            "Keep me here",
            repository.draftStates["workspace-1" to oldSessionId]?.draftMessage
        )
        assertNull(repository.draftStates["workspace-1" to newSessionId])
    }

    @Test
    fun nonStalePersistedChatPreservesCurrentBootstrapPath() = runTest {
        val repository = FakeAiChatRepository()
        val nowMillis = System.currentTimeMillis()
        val recentTimestamp = nowMillis - 1_000L
        repository.setPersistedState(
            workspaceId = "workspace-1",
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = "session-1",
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Recent question")),
                        timestampMillis = recentTimestamp
                    ),
                    makeAssistantStatusMessage(timestampMillis = recentTimestamp + 1L)
                )
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun staleCardHandoffCreatesFreshSessionAndPreservesOldDraftState() = runTest {
        val repository = FakeAiChatRepository()
        repository.consent.value = false
        val nowMillis = System.currentTimeMillis()
        val staleTimestamp = nowMillis - aiChatStalenessThresholdMillis - 1_000L
        val oldSessionId = "session-old"
        repository.setPersistedState(
            workspaceId = "workspace-1",
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = oldSessionId,
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Very old question")),
                        timestampMillis = staleTimestamp
                    )
                )
            )
        )
        repository.draftStates["workspace-1" to oldSessionId] = AiChatDraftState(
            draftMessage = "Unsaved review note",
            pendingAttachments = emptyList()
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.startDictationRecording()
        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = com.flashcardsopensourceapp.data.local.model.EffortLevel.LONG
        )
        advanceUntilIdle()

        assertTrue(didHandoff)
        assertEquals(1, repository.createNewSessionRequests.size)
        val newSessionId = repository.createNewSessionRequests.single()
        assertTrue(newSessionId.isNotBlank())
        assertFalse(newSessionId == oldSessionId)
        assertEquals(newSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals("card-1", (runtime.state.value.pendingAttachments.single() as AiChatAttachment.Card).cardId)
        assertEquals(
            "Unsaved review note",
            repository.draftStates["workspace-1" to oldSessionId]?.draftMessage
        )
        assertEquals(
            listOf("card-1"),
            repository.draftStates["workspace-1" to newSessionId]?.pendingAttachments?.map { attachment ->
                (attachment as AiChatAttachment.Card).cardId
            }
        )
        assertEquals("", repository.draftStates["workspace-1" to newSessionId]?.draftMessage)
    }

    @Test
    fun assistantOnlyHistoryDoesNotAutoRollOver() = runTest {
        val repository = FakeAiChatRepository()
        repository.setPersistedState(
            workspaceId = "workspace-1",
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = "session-1",
                messages = listOf(
                    makeAssistantStatusMessage(
                        timestampMillis = System.currentTimeMillis() - aiChatStalenessThresholdMillis - 1_000L
                    )
                )
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        assertEquals(1, repository.loadBootstrapCalls)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)
    }

    @Test
    fun acceptedRunDoesNotAttachLiveWhenScreenIsHidden() = runTest {
        val repository = FakeAiChatRepository()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Hello")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertFalse(runtime.state.value.isLiveAttached)
        assertTrue(repository.attachRunIds.isEmpty())
    }

    @Test
    fun unexpectedLiveDetachTriggersBootstrapRecoveryError() = runTest {
        val repository = FakeAiChatRepository()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "6")
        )
        repository.liveFlows["run-1"] = emptyFlow()
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertEquals("AI live stream ended before message completion.", alert.message)
        assertNull(runtime.state.value.activeRun)
        assertFalse(runtime.state.value.isLiveAttached)
        assertEquals(2, repository.loadBootstrapCalls)
    }

    @Test
    fun accessContextRestoresSessionScopedDraftState() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.draftStates["workspace-1" to "session-1"] = AiChatDraftState(
            draftMessage = "Keep this draft",
            pendingAttachments = listOf(
                makeAiChatCardAttachment(
                    cardId = "card-1",
                    frontText = "Front",
                    backText = "Back",
                    tags = listOf("tag"),
                    effortLevel = com.flashcardsopensourceapp.data.local.model.EffortLevel.MEDIUM
                )
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        assertEquals("Keep this draft", runtime.state.value.draftMessage)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals("card-1", (runtime.state.value.pendingAttachments.single() as AiChatAttachment.Card).cardId)
    }

    @Test
    fun cleanCardHandoffReusesCurrentSessionAndAddsCardDraft() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = com.flashcardsopensourceapp.data.local.model.EffortLevel.FAST
        )
        advanceUntilIdle()

        assertTrue(didHandoff)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals("card-1", (runtime.state.value.pendingAttachments.single() as AiChatAttachment.Card).cardId)
    }

    @Test
    fun dirtyCardHandoffCreatesFreshSessionAndPreservesOldDraftState() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.draftStates["workspace-1" to "session-1"] = AiChatDraftState(
            draftMessage = "Unsaved note",
            pendingAttachments = emptyList()
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = com.flashcardsopensourceapp.data.local.model.EffortLevel.LONG
        )
        advanceUntilIdle()

        assertTrue(didHandoff)
        assertEquals(1, repository.createNewSessionRequests.size)
        val newSessionId = repository.createNewSessionRequests.single()
        assertTrue(newSessionId.isNotBlank())
        assertFalse(newSessionId == "session-1")
        assertEquals(newSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals("Unsaved note", repository.draftStates["workspace-1" to "session-1"]?.draftMessage)
        assertEquals(
            listOf("card-1"),
            repository.draftStates["workspace-1" to newSessionId]?.pendingAttachments?.map { attachment ->
                (attachment as AiChatAttachment.Card).cardId
            }
        )
        assertEquals("", repository.draftStates["workspace-1" to newSessionId]?.draftMessage)
    }

    @Test
    fun bootstrapWithoutPersistedSessionIdUsesLatestOrCreateBeforeCardHandoff() = runTest {
        val repository = FakeAiChatRepository()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-from-server",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        assertEquals(listOf<String?>(null), repository.loadBootstrapSessionIds)
        val didHandoff = runtime.handoffCardToChat(
            cardId = "card-1",
            frontText = "Front",
            backText = "Back",
            tags = listOf("tag"),
            effortLevel = com.flashcardsopensourceapp.data.local.model.EffortLevel.FAST
        )
        advanceUntilIdle()

        assertTrue(didHandoff)
        assertTrue(repository.createNewSessionRequests.isEmpty())
        assertEquals("session-from-server", runtime.state.value.persistedState.chatSessionId)
        assertEquals(1, runtime.state.value.pendingAttachments.size)
        assertEquals("card-1", (runtime.state.value.pendingAttachments.single() as AiChatAttachment.Card).cardId)
    }

    @Test
    fun bootstrapWithPersistedSessionIdReusesThatExactSessionId() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        assertEquals(listOf<String?>("session-1"), repository.loadBootstrapSessionIds)
        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
    }

    @Test
    fun missingSessionSendFailureKeepsSessionIdAndRestoresDraft() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.startRunError = AiChatRemoteException(
            message = "Chat session not found: session-1",
            statusCode = 404,
            code = "CHAT_SESSION_NOT_FOUND",
            stage = null,
            requestId = null,
            responseBody = null
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        runtime.updateDraftMessage(draftMessage = "retry me")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals("session-1", runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())
        assertEquals("retry me", runtime.state.value.draftMessage)
        assertEquals(AiComposerPhase.IDLE, runtime.state.value.composerPhase)
        assertFalse(runtime.state.value.isLiveAttached)
        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertTrue(alert.message.isNotEmpty())
    }

    @Test
    fun clearConversationSwitchesToLocalSessionBeforeServerEnsureCompletes() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()
        assertEquals(AiConversationBootstrapState.READY, runtime.state.value.conversationBootstrapState)

        runtime.clearConversation()
        runCurrent()

        assertEquals(1, repository.createNewSessionRequests.size)
        val localSessionId = repository.createNewSessionRequests.single()
        assertTrue(localSessionId.isNotBlank())
        assertFalse(localSessionId == "session-1")
        assertEquals(localSessionId, runtime.state.value.persistedState.chatSessionId)
        assertTrue(runtime.state.value.persistedState.messages.isEmpty())

        createSessionGate.complete(Unit)
        advanceUntilIdle()
    }

    @Test
    fun clearConversationIgnoresMismatchedEnsuredSessionResponse() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.createNewSessionResponses += makeSessionSnapshot(
            sessionId = "server-session-2",
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "suggestion-1",
                    text = "Server suggestion",
                    source = "server",
                    assistantItemId = null
                )
            )
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        runtime.clearConversation()
        runCurrent()

        val localSessionId = repository.createNewSessionRequests.single()
        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(localSessionId, runtime.state.value.persistedState.chatSessionId)
        assertEquals(localSessionId, runtime.state.value.conversationScopeId)
        assertTrue(runtime.state.value.serverComposerSuggestions.isEmpty())
        assertEquals(defaultAiChatServerConfig, runtime.state.value.persistedState.lastKnownChatConfig)
    }

    @Test
    fun lateEnsureResponseDoesNotOverwriteFreshSuggestionsAfterSend() = runTest {
        val repository = FakeAiChatRepository()
        repository.persistedStates["workspace-1"] = makeDefaultAiChatPersistedState().copy(
            chatSessionId = "session-1"
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        val createSessionGate = CompletableDeferred<Unit>()
        repository.createNewSessionGates += createSessionGate
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext())
        advanceUntilIdle()

        runtime.clearConversation()
        runCurrent()

        val newSessionId = repository.createNewSessionRequests.single()
        repository.createNewSessionResponses += makeSessionSnapshot(
            sessionId = newSessionId,
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "stale-suggestion",
                    text = "Stale ensure suggestion",
                    source = "server",
                    assistantItemId = null
                )
            )
        )
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = newSessionId,
            activeRun = null,
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Hello")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = listOf(
                AiChatComposerSuggestion(
                    id = "fresh-suggestion",
                    text = "Fresh run suggestion",
                    source = "assistant_follow_up",
                    assistantItemId = null
                )
            )
        )

        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(
            listOf("fresh-suggestion"),
            runtime.state.value.serverComposerSuggestions.map { suggestion -> suggestion.id }
        )

        createSessionGate.complete(Unit)
        advanceUntilIdle()

        assertEquals(
            listOf("fresh-suggestion"),
            runtime.state.value.serverComposerSuggestions.map { suggestion -> suggestion.id }
        )
    }

    private fun makeSessionSnapshot(
        sessionId: String,
        composerSuggestions: List<AiChatComposerSuggestion>
    ): AiChatSessionSnapshot {
        return com.flashcardsopensourceapp.data.local.model.AiChatConversationEnvelope(
            sessionId = sessionId,
            conversationScopeId = sessionId,
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = emptyList(),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            ),
            composerSuggestions = composerSuggestions,
            chatConfig = defaultAiChatServerConfig,
            activeRun = null
        )
    }
}

private class FakeAiChatRepository : AiChatRepository {
    val consent = MutableStateFlow(value = true)
    val bootstrapResponses = ArrayDeque<AiChatBootstrapResponse>()
    val loadBootstrapGates = ArrayDeque<CompletableDeferred<Unit>>()
    val liveFlows = mutableMapOf<String, Flow<AiChatLiveEvent>>()
    val attachRunIds = mutableListOf<String>()
    val loadBootstrapSessionIds = mutableListOf<String?>()
    val createNewSessionRequests = mutableListOf<String>()
    val createNewSessionGates = ArrayDeque<CompletableDeferred<Unit>>()
    val createNewSessionResponses = ArrayDeque<AiChatSessionSnapshot>()
    val persistedStates = mutableMapOf<String?, AiChatPersistedState>()
    val draftStates = mutableMapOf<Pair<String?, String?>, AiChatDraftState>()
    var startRunError: Exception? = null
    var loadBootstrapCalls: Int = 0
    var startRunResponse: AiChatStartRunResponse = AiChatAcceptedConversationEnvelope(
        accepted = true,
        sessionId = "session-1",
        conversationScopeId = "session-1",
        conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
            messages = emptyList(),
            updatedAtMillis = 100L,
            mainContentInvalidationVersion = 0L,
            hasOlder = false,
            oldestCursor = null
        ),
        composerSuggestions = emptyList(),
        chatConfig = defaultAiChatServerConfig,
        activeRun = null,
        deduplicated = false
    )

    override fun observeConsent(): Flow<Boolean> {
        return consent
    }

    override fun hasConsent(): Boolean {
        return consent.value
    }

    override fun updateConsent(hasConsent: Boolean) {
        consent.value = hasConsent
    }

    override suspend fun prepareSessionForAi(workspaceId: String?) {
        Unit
    }

    override suspend fun loadPersistedState(workspaceId: String?): AiChatPersistedState {
        return persistedStates[workspaceId] ?: makeDefaultAiChatPersistedState()
    }

    override suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState) {
        persistedStates[workspaceId] = state
    }

    override suspend fun clearPersistedState(workspaceId: String?) {
        persistedStates[workspaceId] = makeDefaultAiChatPersistedState()
    }

    override suspend fun loadDraftState(workspaceId: String?, sessionId: String?): AiChatDraftState {
        return draftStates[workspaceId to sessionId] ?: AiChatDraftState(
            draftMessage = "",
            pendingAttachments = emptyList()
        )
    }

    override suspend fun saveDraftState(workspaceId: String?, sessionId: String?, state: AiChatDraftState) {
        val key = workspaceId to sessionId
        if (state.draftMessage.isBlank() && state.pendingAttachments.isEmpty()) {
            draftStates.remove(key)
            return
        }

        draftStates[key] = state
    }

    override suspend fun clearDraftState(workspaceId: String?, sessionId: String?) {
        draftStates.remove(workspaceId to sessionId)
    }

    override suspend fun loadChatSnapshot(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot? {
        return null
    }

    override suspend fun loadBootstrap(
        workspaceId: String?,
        sessionId: String?,
        limit: Int,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): AiChatBootstrapResponse {
        loadBootstrapCalls += 1
        loadBootstrapSessionIds += sessionId
        if (loadBootstrapGates.isNotEmpty()) {
            loadBootstrapGates.removeFirst().await()
        }
        return bootstrapResponses.removeFirst()
    }

    override suspend fun createNewSession(
        workspaceId: String?,
        sessionId: String
    ): AiChatSessionSnapshot {
        createNewSessionRequests += sessionId
        if (createNewSessionGates.isNotEmpty()) {
            createNewSessionGates.removeFirst().await()
        }
        if (createNewSessionResponses.isNotEmpty()) {
            return createNewSessionResponses.removeFirst()
        }
        return com.flashcardsopensourceapp.data.local.model.AiChatConversationEnvelope(
            sessionId = sessionId,
            conversationScopeId = sessionId,
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = emptyList(),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            ),
            composerSuggestions = emptyList(),
            chatConfig = defaultAiChatServerConfig,
            activeRun = null
        )
    }

    override suspend fun transcribeAudio(
        workspaceId: String?,
        sessionId: String?,
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ): AiChatTranscriptionResult {
        throw IllegalStateException("Unexpected transcribeAudio call in test.")
    }

    override suspend fun warmUpLinkedSession() {
        Unit
    }

    override suspend fun startRun(
        workspaceId: String?,
        state: AiChatPersistedState,
        content: List<AiChatContentPart>
    ): AiChatStartRunResponse {
        startRunError?.let { error ->
            throw error
        }
        return startRunResponse
    }

    override fun attachLiveRun(
        workspaceId: String?,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ): Flow<AiChatLiveEvent> {
        attachRunIds += runId
        return liveFlows[runId] ?: emptyFlow()
    }

    override suspend fun stopRun(workspaceId: String?, sessionId: String): AiChatStopRunResponse {
        return AiChatStopRunResponse(
            sessionId = sessionId,
            conversationScopeId = sessionId,
            runId = null,
            stopped = true,
            stillRunning = false
        )
    }

    fun setPersistedState(
        workspaceId: String?,
        state: AiChatPersistedState
    ) {
        persistedStates[workspaceId] = state
    }
}

private class FakeSyncRepository : SyncRepository {
    private val status = MutableStateFlow(
        value = SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return status
    }

    override suspend fun scheduleSync() {
        Unit
    }

    override suspend fun syncNow() {
        status.update { current ->
            current.copy(status = SyncStatus.Idle)
        }
    }
}
