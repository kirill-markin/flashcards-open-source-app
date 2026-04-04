package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAcceptedConversationEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRunLive
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
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
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
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
            )
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
            syncRepository = FakeSyncRepository(),
            appVersion = appVersion,
            hasConsent = { repository.consent.value },
            currentCloudState = { CloudAccountState.GUEST },
            currentServerConfiguration = { com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration() },
            currentSyncStatus = { SyncStatus.Idle }
        )
    }

    private fun makeAccessContext(): AiAccessContext {
        return AiAccessContext(
            workspaceId = "workspace-1",
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
            chatConfig = defaultAiChatServerConfig,
            activeRun = activeRun
        )
    }

    private fun makeAcceptedStartRunResponse(
        sessionId: String,
        activeRun: AiChatActiveRun?,
        messages: List<com.flashcardsopensourceapp.data.local.model.AiChatMessage>
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
            chatConfig = defaultAiChatServerConfig,
            activeRun = activeRun,
            deduplicated = false
        )
    }
}

private class FakeAiChatRepository : AiChatRepository {
    val consent = MutableStateFlow(value = true)
    val bootstrapResponses = ArrayDeque<AiChatBootstrapResponse>()
    val liveFlows = mutableMapOf<String, Flow<AiChatLiveEvent>>()
    val attachRunIds = mutableListOf<String>()
    var persistedState: AiChatPersistedState = makeDefaultAiChatPersistedState()
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
        return persistedState
    }

    override suspend fun savePersistedState(workspaceId: String?, state: AiChatPersistedState) {
        persistedState = state
    }

    override suspend fun clearPersistedState(workspaceId: String?) {
        persistedState = makeDefaultAiChatPersistedState()
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
        return bootstrapResponses.removeFirst()
    }

    override suspend fun createNewSession(workspaceId: String?, sessionId: String?): AiChatSessionSnapshot {
        return com.flashcardsopensourceapp.data.local.model.AiChatConversationEnvelope(
            sessionId = sessionId ?: "session-new",
            conversationScopeId = sessionId ?: "session-new",
            conversation = com.flashcardsopensourceapp.data.local.model.AiChatConversation(
                messages = emptyList(),
                updatedAtMillis = 100L,
                mainContentInvalidationVersion = 0L,
                hasOlder = false,
                oldestCursor = null
            ),
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
