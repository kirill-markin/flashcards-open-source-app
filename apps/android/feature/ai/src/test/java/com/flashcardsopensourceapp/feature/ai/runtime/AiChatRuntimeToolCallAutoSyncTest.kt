package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeToolCallAutoSyncTest {
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
    fun acceptedTerminalResponseWithToolCallTriggersOneAutoSync() = runTest {
        val repository = FakeAiChatRepository()
        val autoSyncEventRepository = FakeAutoSyncEventRepository()
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
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

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
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
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
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

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
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
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
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

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
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
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
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

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
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
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
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

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
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
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
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

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        runtime.updateDraftMessage(draftMessage = "Check my due cards")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertTrue(runtime.state.value.runHadToolCalls)
        assertTrue(runtime.state.value.persistedState.pendingToolRunPostSync)
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
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
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
        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
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
        repository.nextEnsureSessionId = "session-1"
        repository.bootstrapResponses += makeBootstrapResponse(
            sessionId = "session-1",
            activeRun = null
        )
        repository.startRunResponse = makeAcceptedStartRunResponse(
            sessionId = "session-1",
            activeRun = makeActiveRun(runId = "run-1", cursor = "0"),
            messages = emptyList(),
            composerSuggestions = emptyList()
        )
        val runtime = makeRuntime(scope = this, repository = repository)

        runtime.updateAccessContext(makeAccessContext(workspaceId = defaultTestWorkspaceId))
        advanceUntilIdle()
        runtime.updateDraftMessage(draftMessage = "Hello")
        runtime.sendMessage()
        advanceUntilIdle()

        assertEquals("run-1", runtime.state.value.activeRun?.runId)
        assertFalse(runtime.state.value.runHadToolCalls)
        assertFalse(runtime.state.value.persistedState.pendingToolRunPostSync)
    }
}
