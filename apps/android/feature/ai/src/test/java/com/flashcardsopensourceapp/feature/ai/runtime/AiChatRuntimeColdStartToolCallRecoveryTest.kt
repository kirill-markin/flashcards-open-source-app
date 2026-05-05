package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AiChatRuntimeColdStartToolCallRecoveryTest {
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
}
