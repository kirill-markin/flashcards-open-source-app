package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeBootstrapAndLiveStreamTest {
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
    fun reasoningSummaryStaysAfterExistingTextWhenItArrivesLater() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "What should I study next?")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateDraftMessage(draftMessage = "What should I study next?")
        runtime.sendMessage()
        advanceUntilIdle()

        // This ordering is the behavior we want to preserve: the transcript should
        // reflect arrival order, not jump a later reasoning block back to the top.
        liveEvents.emit(
            AiChatLiveEvent.AssistantDelta(
                metadata = makeMetadata(runId = "run-1", cursor = "1"),
                text = "I'm checking your due cards.",
                itemId = "item-1"
            )
        )
        advanceUntilIdle()

        liveEvents.emit(
            AiChatLiveEvent.AssistantReasoningStarted(
                metadata = makeMetadata(runId = "run-1", cursor = "2"),
                reasoningId = "reasoning-1",
                itemId = "item-1",
                outputIndex = 0
            )
        )
        advanceUntilIdle()

        val assistantMessage = runtime.state.value.persistedState.messages.last()
        assertEquals(2, assistantMessage.content.size)
        assertTrue(assistantMessage.content[0] is AiChatContentPart.Text)
        assertTrue(assistantMessage.content[1] is AiChatContentPart.ReasoningSummary)
        assertEquals(
            "I'm checking your due cards.",
            (assistantMessage.content[0] as AiChatContentPart.Text).text
        )
        assertEquals(
            "reasoning-1",
            (assistantMessage.content[1] as AiChatContentPart.ReasoningSummary).reasoningSummary.reasoningId
        )

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

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
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(listOf("run-1"), repository.attachRunIds)
        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertTrue(runtime.state.value.isLiveAttached)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun bootstrapWithActiveRunAndTrailingToolCallTriggersAutoSyncOnTerminalCompletion() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        ).copy(
            conversation = makeBootstrapResponse(
                sessionId = "session-1",
                activeRun = makeActiveRun(runId = "run-1", cursor = "5")
            ).conversation.copy(
                messages = listOf(
                    makeAssistantStatusMessage(timestampMillis = 1L).copy(
                        content = listOf(
                            AiChatContentPart.ToolCall(
                                toolCall = AiChatToolCall(
                                    toolCallId = "tool-1",
                                    name = "sql",
                                    status = AiChatToolCallStatus.STARTED,
                                    input = "{\"sql\":\"select 1\"}",
                                    output = null
                                )
                            )
                        ),
                        itemId = "item-1"
                    )
                )
            )
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertTrue(runtime.state.value.runHadToolCalls)
        assertTrue(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: false
        )

        liveEvents.emit(
            AiChatLiveEvent.RunTerminal(
                metadata = makeMetadata(runId = "run-1", cursor = "6"),
                outcome = AiChatRunTerminalOutcome.COMPLETED,
                message = null,
                assistantItemId = null,
                isError = null,
                isStopped = null
            )
        )
        advanceUntilIdle()

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: true
        )

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
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
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
    fun acceptedTerminalResponseWithToolCallTriggersOneAutoSync() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = null,
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Check my cards")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L).copy(
                    content = listOf(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = "tool-1",
                                name = "sql",
                                status = AiChatToolCallStatus.COMPLETED,
                                input = "{\"sql\":\"select 1\"}",
                                output = "{\"rows\":[]}"
                            )
                        )
                    ),
                    itemId = "item-1"
                )
            ),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.updateDraftMessage(draftMessage = "Check my cards")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertNull(runtime.state.value.activeRun)
    }

    @Test
    fun acceptedTerminalAssistantOnlyResponseWithToolCallTriggersOneAutoSync() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = null,
            messages = listOf(
                makeAssistantStatusMessage(timestampMillis = 2L).copy(
                    content = listOf(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = "tool-1",
                                name = "sql",
                                status = AiChatToolCallStatus.COMPLETED,
                                input = "{\"sql\":\"select 1\"}",
                                output = "{\"rows\":[]}"
                            )
                        )
                    ),
                    itemId = "item-1"
                )
            ),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.updateDraftMessage(draftMessage = "Check my cards")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertNull(runtime.state.value.activeRun)
    }

    @Test
    fun acceptedTerminalResponseWithToolCallKeepsPendingFlagWhenAutoSyncFails() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        autoSyncEventRepository.runAutoSyncErrors += IllegalStateException("sync failed")
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = null,
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Check my cards")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L).copy(
                    content = listOf(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = "tool-1",
                                name = "sql",
                                status = AiChatToolCallStatus.COMPLETED,
                                input = "{\"sql\":\"select 1\"}",
                                output = "{\"rows\":[]}"
                            )
                        )
                    ),
                    itemId = "item-1"
                )
            ),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.updateDraftMessage(draftMessage = "Check my cards")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertTrue(runtime.state.value.runHadToolCalls)
        assertTrue(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[runtime.state.value.workspaceId]?.pendingToolRunPostSync
                ?: false
        )
        assertNull(runtime.state.value.activeRun)
    }

    @Test
    fun acceptedTerminalResponseWithHistoricalToolCallAndNewPlainTextDoesNotTriggerAutoSync() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = null,
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Check my due cards")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L).copy(
                    content = listOf(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = "tool-1",
                                name = "sql",
                                status = AiChatToolCallStatus.COMPLETED,
                                input = "{\"sql\":\"select 1\"}",
                                output = "{\"rows\":[]}"
                            )
                        )
                    ),
                    itemId = "item-1"
                ),
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Explain spaced repetition")),
                    timestampMillis = 3L
                ),
                makeAssistantStatusMessage(timestampMillis = 4L).copy(
                    content = listOf(
                        AiChatContentPart.Text(text = "Spaced repetition schedules reviews over time.")
                    ),
                    itemId = "item-2"
                )
            ),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.updateDraftMessage(draftMessage = "Explain spaced repetition")
        runtime.sendMessage()
        advanceUntilIdle()

        assertTrue(autoSyncEventRepository.requests.isEmpty())
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertNull(runtime.state.value.activeRun)
    }

    @Test
    fun acceptedTerminalAssistantOnlyPlainTextWithOlderToolCallDoesNotTriggerAutoSync() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = null,
            messages = listOf(
                makeAssistantStatusMessage(timestampMillis = 1L).copy(
                    content = listOf(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = "tool-1",
                                name = "sql",
                                status = AiChatToolCallStatus.COMPLETED,
                                input = "{\"sql\":\"select 1\"}",
                                output = "{\"rows\":[]}"
                            )
                        )
                    ),
                    itemId = "item-1"
                ),
                makeAssistantStatusMessage(timestampMillis = 2L).copy(
                    content = listOf(
                        AiChatContentPart.Text(text = "Spaced repetition schedules reviews over time.")
                    ),
                    itemId = "item-2"
                )
            ),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.updateDraftMessage(draftMessage = "Explain spaced repetition")
        runtime.sendMessage()
        advanceUntilIdle()

        assertTrue(autoSyncEventRepository.requests.isEmpty())
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertNull(runtime.state.value.activeRun)
    }

    @Test
    fun acceptedResponseWithActiveRunAndTrailingToolCallRaisesPendingFlag() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = listOf(
                makeAssistantStatusMessage(timestampMillis = 1L).copy(
                    content = listOf(
                        AiChatContentPart.ToolCall(
                            toolCall = AiChatToolCall(
                                toolCallId = "tool-1",
                                name = "sql",
                                status = AiChatToolCallStatus.COMPLETED,
                                input = "{\"sql\":\"select 1\"}",
                                output = "{\"rows\":[]}"
                            )
                        )
                    ),
                    itemId = "item-1"
                )
            ),
            composerSuggestions = emptyList()
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateDraftMessage(draftMessage = "Check my due cards")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertTrue(runtime.state.value.runHadToolCalls)
        assertTrue(runtime.state.value.persistedState.pendingToolRunPostSync)
    }

    @Test
    fun coldStartBootstrapRetriesAutoSyncWhenPersistedPendingFlagExists() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(
                chatSessionId = "session-1",
                pendingToolRunPostSync = true
            )
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        ).copy(
            conversation = makeBootstrapResponse(
                sessionId = "session-1",
                activeRun = null
            ).conversation.copy(
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Check my due cards")),
                        timestampMillis = 1L
                    ),
                    makeAssistantStatusMessage(timestampMillis = 2L).copy(
                        content = listOf(
                            AiChatContentPart.ToolCall(
                                toolCall = AiChatToolCall(
                                    toolCallId = "tool-1",
                                    name = "sql",
                                    status = AiChatToolCallStatus.COMPLETED,
                                    input = "{\"sql\":\"select 1\"}",
                                    output = "{\"rows\":[]}"
                                )
                            )
                        ),
                        itemId = "item-1"
                    )
                )
            )
        )
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: true
        )
    }

    @Test
    fun coldStartBootstrapRecoversMissedTerminalToolCallAndRunsAutoSync() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "session-1")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        ).copy(
            conversation = makeBootstrapResponse(
                sessionId = "session-1",
                activeRun = null
            ).conversation.copy(
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Check my due cards")),
                        timestampMillis = 1L
                    ),
                    makeAssistantStatusMessage(timestampMillis = 2L).copy(
                        content = listOf(
                            AiChatContentPart.ToolCall(
                                toolCall = AiChatToolCall(
                                    toolCallId = "tool-1",
                                    name = "sql",
                                    status = AiChatToolCallStatus.COMPLETED,
                                    input = "{\"sql\":\"select 1\"}",
                                    output = "{\"rows\":[]}"
                                )
                            )
                        ),
                        itemId = "item-1"
                    )
                )
            )
        )
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals(1, autoSyncEventRepository.requests.size)
        assertNull(runtime.state.value.activeRun)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(
            repository.persistedStates[defaultTestWorkspaceId]?.pendingToolRunPostSync ?: true
        )
    }

    @Test
    fun bootstrapWithHistoricalToolCallBeforeLatestUserDoesNotTriggerAutoSyncForActiveRun() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.setPersistedState(
            workspaceId = defaultTestWorkspaceId,
            state = makeDefaultAiChatPersistedState().copy(chatSessionId = "session-1")
        )
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "5")
        ).copy(
            conversation = makeBootstrapResponse(
                sessionId = "session-1",
                activeRun = makeActiveRun(runId = "run-1", cursor = "5")
            ).conversation.copy(
                messages = listOf(
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Check my due cards")),
                        timestampMillis = 1L
                    ),
                    makeAssistantStatusMessage(timestampMillis = 2L).copy(
                        content = listOf(
                            AiChatContentPart.ToolCall(
                                toolCall = AiChatToolCall(
                                    toolCallId = "tool-1",
                                    name = "sql",
                                    status = AiChatToolCallStatus.COMPLETED,
                                    input = "{\"sql\":\"select 1\"}",
                                    output = "{\"rows\":[]}"
                                )
                            )
                        ),
                        itemId = "item-1"
                    ),
                    makeUserMessage(
                        content = listOf(AiChatContentPart.Text(text = "Explain spaced repetition")),
                        timestampMillis = 3L
                    ),
                    makeAssistantStatusMessage(timestampMillis = 4L).copy(
                        content = listOf(
                            AiChatContentPart.Text(text = "Working on it.")
                        ),
                        itemId = "item-2"
                    )
                )
            )
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntimeWithAutoSync(
            scope = this,
            repository = repository,
            autoSyncEventRepository = autoSyncEventRepository
        )

        runtime.onScreenVisible()
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertTrue(autoSyncEventRepository.requests.isEmpty())
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertFalse(runtime.state.value.runHadToolCalls)

        liveEvents.emit(
            AiChatLiveEvent.RunTerminal(
                metadata = makeMetadata(runId = "run-1", cursor = "6"),
                outcome = AiChatRunTerminalOutcome.COMPLETED,
                message = null,
                assistantItemId = null,
                isError = null,
                isStopped = null
            )
        )
        advanceUntilIdle()

        assertTrue(autoSyncEventRepository.requests.isEmpty())
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertFalse(runtime.state.value.runHadToolCalls)

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun liveAssistantToolCallDuringActiveRunRaisesPendingFlag() = runTest {
        val repository = FakeAiChatRepository()
        val liveEvents = MutableSharedFlow<AiChatLiveEvent>()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = listOf(
                makeUserMessage(
                    content = listOf(AiChatContentPart.Text(text = "Check my due cards")),
                    timestampMillis = 1L
                ),
                makeAssistantStatusMessage(timestampMillis = 2L)
            ),
            composerSuggestions = emptyList()
        )
        repository.liveFlows["run-1"] = liveEvents
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.onScreenVisible()
        runtime.updateDraftMessage(draftMessage = "Check my due cards")
        runtime.sendMessage()
        advanceUntilIdle()

        liveEvents.emit(
            AiChatLiveEvent.AssistantToolCall(
                metadata = makeMetadata(runId = "run-1", cursor = "1"),
                itemId = "item-1",
                outputIndex = 0,
                providerStatus = null,
                toolCall = AiChatToolCall(
                    toolCallId = "tool-1",
                    name = "sql",
                    status = AiChatToolCallStatus.STARTED,
                    input = "{\"sql\":\"select 1\"}",
                    output = null
                )
            )
        )
        advanceUntilIdle()

        assertTrue(runtime.state.value.runHadToolCalls)
        assertTrue(runtime.state.value.persistedState.pendingToolRunPostSync)
        assertTrue(
            repository.persistedStates[runtime.state.value.workspaceId]?.pendingToolRunPostSync
                ?: false
        )

        runtime.onScreenHidden()
        advanceUntilIdle()
    }

    @Test
    fun acceptedResponseWithEmptyConversationMessagesAndActiveRunDoesNotRaisePendingToolCallFlag() = runTest {
        val repository = FakeAiChatRepository()
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = emptyList(),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
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
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()

        val alert = runtime.state.value.activeAlert as AiAlertState.GeneralError
        assertEquals("AI live stream ended before message completion.", alert.message)
        assertNull(runtime.state.value.activeRun)
        assertFalse(runtime.state.value.isLiveAttached)
        assertEquals(2, repository.loadBootstrapCalls)
    }
}
