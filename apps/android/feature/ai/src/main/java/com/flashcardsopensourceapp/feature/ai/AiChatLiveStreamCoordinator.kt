package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private enum class AiLiveAttachDisposition {
    PENDING,
    TERMINAL_EVENT_SEEN
}

internal class AiChatLiveStreamCoordinator(
    private val context: AiChatRuntimeContext,
    private val restartConversationBootstrap: (Boolean, com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?) -> Unit,
    private val applyActiveBootstrap: suspend (AiChatBootstrapResponse) -> Unit
) {
    fun attachBootstrapLiveIfNeeded(
        workspaceId: String,
        response: AiChatBootstrapResponse,
        resumeDiagnostics: com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?
    ) {
        val activeRun = response.activeRun
        if (activeRun == null) {
            detachLiveStream("AI live stream detached because the run is no longer active.")
            return
        }
        if (context.isScreenVisible.not()) {
            detachLiveStream("AI live stream detached because the screen is hidden.")
            return
        }

        attachLiveStream(
            workspaceId = workspaceId,
            sessionId = response.sessionId,
            runId = activeRun.runId,
            liveStream = activeRun.live.stream,
            afterCursor = activeRun.live.cursor,
            resumeDiagnostics = resumeDiagnostics,
            cancellationMessage = "AI live attach restarted from bootstrap."
        )
    }

    fun attachAcceptedLiveStreamIfNeeded(
        workspaceId: String?,
        response: AiChatStartRunResponse
    ) {
        val activeRun = response.activeRun ?: return
        if (activeRun.status != "running") {
            return
        }
        if (context.isScreenVisible.not()) {
            return
        }
        attachLiveStream(
            workspaceId = workspaceId,
            sessionId = response.sessionId,
            runId = activeRun.runId,
            liveStream = activeRun.live.stream,
            afterCursor = activeRun.live.cursor,
            resumeDiagnostics = null,
            cancellationMessage = "AI live attach restarted from accepted run."
        )
    }

    fun detachLiveStream(reason: String) {
        context.activeLiveJob?.cancel(
            cause = CancellationException(reason)
        )
        context.activeLiveJob = null
        context.runtimeStateMutable.update { state ->
            state.copy(isLiveAttached = false)
        }
        context.persistCurrentState()
    }

    fun finalizeStoppedConversation() {
        context.runtimeStateMutable.update { state ->
            state.copy(
                persistedState = clearOptimisticAssistantStatusIfNeeded(state = state.persistedState),
                activeRun = null,
                runHadToolCalls = state.runHadToolCalls,
                isLiveAttached = false,
                serverComposerSuggestions = emptyList(),
                composerPhase = AiComposerPhase.IDLE,
                repairStatus = null
            )
        }
        context.persistCurrentState()
    }

    private fun attachLiveStream(
        workspaceId: String?,
        sessionId: String,
        runId: String,
        liveStream: AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?,
        cancellationMessage: String
    ) {
        context.activeLiveJob?.cancel(
            cause = CancellationException(cancellationMessage)
        )
        var liveJob: Job? = null
        liveJob = context.scope.launch {
            var liveAttachDisposition = AiLiveAttachDisposition.PENDING
            context.runtimeStateMutable.update { state ->
                state.copy(isLiveAttached = true)
            }
            context.persistCurrentState()
            try {
                context.aiChatRepository.attachLiveRun(
                    workspaceId = workspaceId,
                    sessionId = sessionId,
                    runId = runId,
                    liveStream = liveStream,
                    afterCursor = afterCursor,
                    resumeDiagnostics = resumeDiagnostics
                ).collect { event ->
                    if (event is AiChatLiveEvent.RunTerminal) {
                        liveAttachDisposition = AiLiveAttachDisposition.TERMINAL_EVENT_SEEN
                    }
                    applyLiveEvent(event = event)
                }
                if (
                    liveAttachDisposition == AiLiveAttachDisposition.PENDING
                    && context.isScreenVisible
                ) {
                    reconcileUnexpectedLiveStreamDetach(
                        workspaceId = workspaceId,
                        sessionId = sessionId
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.CHAT,
                    configuration = context.currentServerConfiguration(),
                    textProvider = context.textProvider
                )
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = null,
                        isLiveAttached = false,
                        composerPhase = AiComposerPhase.IDLE,
                        repairStatus = null,
                        activeAlert = context.textProvider.generalError(message = message),
                        errorMessage = ""
                    )
                }
                context.persistCurrentState()
            } finally {
                if (context.activeLiveJob === liveJob) {
                    context.activeLiveJob = null
                }
                context.runtimeStateMutable.update { state ->
                    if (state.composerPhase == AiComposerPhase.RUNNING || state.composerPhase == AiComposerPhase.STOPPING) {
                        state
                    } else {
                        state.copy(isLiveAttached = false)
                    }
                }
                context.persistCurrentState()
            }
        }
        context.activeLiveJob = liveJob
    }

    private suspend fun applyLiveEvent(event: AiChatLiveEvent) {
        if (isCurrentLiveEvent(event).not()) {
            return
        }
        when (event) {
            is AiChatLiveEvent.AssistantDelta -> {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = upsertAssistantText(
                            state = state.persistedState,
                            text = event.text,
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        )
                    )
                }
            }

            is AiChatLiveEvent.AssistantToolCall -> {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = setPendingToolRunPostSync(
                            state = upsertAssistantToolCall(
                                state = state.persistedState,
                                toolCall = event.toolCall,
                                itemId = event.itemId,
                                cursor = requireNotNull(event.metadata.cursor)
                            ),
                            pendingToolRunPostSync = true
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        runHadToolCalls = true,
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantReasoningStarted -> {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = upsertAssistantReasoningSummary(
                            state = state.persistedState,
                            reasoningSummary = AiChatReasoningSummary(
                                reasoningId = event.reasoningId,
                                summary = "",
                                status = AiChatToolCallStatus.STARTED
                            ),
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantReasoningSummary -> {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = upsertAssistantReasoningSummary(
                            state = state.persistedState,
                            reasoningSummary = event.reasoningSummary,
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantReasoningDone -> {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = completeAssistantReasoningSummary(
                            state = state.persistedState,
                            reasoningId = event.reasoningId,
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantMessageDone -> {
                val finalizedState = finalizeAssistantMessage(
                    state = context.runtimeStateMutable.value.persistedState,
                    content = event.content,
                    itemId = event.itemId,
                    cursor = event.metadata.cursor ?: "",
                    isError = event.isError,
                    isStopped = event.isStopped
                )
                if (finalizedState == null) {
                    restartConversationBootstrap(true, null)
                    return
                }
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = finalizedState,
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.ComposerSuggestionsUpdated -> {
                context.runtimeStateMutable.update { state ->
                    state.copy(serverComposerSuggestions = event.suggestions)
                }
            }

            is AiChatLiveEvent.RepairStatus -> {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = event.status
                    )
                }
            }

            is AiChatLiveEvent.RunTerminal -> when (event.outcome) {
                AiChatRunTerminalOutcome.RESET_REQUIRED -> {
                    restartConversationBootstrap(true, null)
                    return
                }

                AiChatRunTerminalOutcome.COMPLETED -> {
                    context.runtimeStateMutable.update { state ->
                        state.copy(
                            activeRun = null,
                            isLiveAttached = false,
                            composerPhase = AiComposerPhase.IDLE,
                            repairStatus = null,
                            errorMessage = ""
                        )
                    }
                    context.triggerToolRunPostSyncIfNeeded(reason = "run_terminal_completed")
                }

                AiChatRunTerminalOutcome.STOPPED -> {
                    finalizeStoppedConversation()
                    context.triggerToolRunPostSyncIfNeeded(reason = "run_terminal_stopped")
                    return
                }

                AiChatRunTerminalOutcome.ERROR -> {
                    context.runtimeStateMutable.update { state ->
                        state.copy(
                            activeRun = null,
                            isLiveAttached = false,
                            serverComposerSuggestions = emptyList(),
                            composerPhase = AiComposerPhase.IDLE,
                            repairStatus = null,
                            activeAlert = context.textProvider.generalError(
                                message = event.message
                                    ?: latestAssistantErrorMessage(messages = state.persistedState.messages)
                                    ?: context.textProvider.chatFailed
                            ),
                            errorMessage = ""
                        )
                    }
                    context.triggerToolRunPostSyncIfNeeded(reason = "run_terminal_error")
                }
            }
        }
        context.persistCurrentState()
    }

    private suspend fun reconcileUnexpectedLiveStreamDetach(
        workspaceId: String?,
        sessionId: String
    ) {
        try {
            val bootstrap = context.aiChatRepository.loadBootstrap(
                workspaceId = workspaceId,
                sessionId = sessionId,
                limit = aiChatBootstrapPageLimit,
                resumeDiagnostics = null
            )
            applyActiveBootstrap(bootstrap)

            val errorMessage = latestAssistantErrorMessage(messages = bootstrap.conversation.messages)
            if (errorMessage != null) {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = null,
                        composerPhase = AiComposerPhase.IDLE,
                        activeAlert = context.textProvider.generalError(message = errorMessage),
                        errorMessage = ""
                    )
                }
                context.persistCurrentState()
                return
            }

            if (bootstrap.activeRun != null) {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = null,
                        isLiveAttached = false,
                        composerPhase = AiComposerPhase.IDLE,
                        repairStatus = null,
                        activeAlert = context.textProvider.generalError(
                            message = context.textProvider.liveStreamEndedBeforeCompletion
                        ),
                        errorMessage = ""
                    )
                }
                context.persistCurrentState()
            }
        } catch (error: Exception) {
            val message = makeAiUserFacingErrorMessage(
                error = error,
                surface = AiErrorSurface.CHAT,
                configuration = context.currentServerConfiguration(),
                textProvider = context.textProvider
            )
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    repairStatus = null,
                    activeAlert = context.textProvider.generalError(message = message),
                    errorMessage = ""
                )
            }
            context.persistCurrentState()
        }
    }

    private fun updateActiveRunCursor(activeRun: AiChatActiveRun?, cursor: String?): AiChatActiveRun? {
        if (activeRun == null) {
            return null
        }
        return activeRun.copy(
            live = activeRun.live.copy(cursor = cursor)
        )
    }

    private fun isCurrentLiveEvent(event: AiChatLiveEvent): Boolean {
        val activeRun = context.runtimeStateMutable.value.activeRun ?: return false
        val metadata = when (event) {
            is AiChatLiveEvent.AssistantDelta -> event.metadata
            is AiChatLiveEvent.AssistantToolCall -> event.metadata
            is AiChatLiveEvent.AssistantReasoningStarted -> event.metadata
            is AiChatLiveEvent.AssistantReasoningSummary -> event.metadata
            is AiChatLiveEvent.AssistantReasoningDone -> event.metadata
            is AiChatLiveEvent.AssistantMessageDone -> event.metadata
            is AiChatLiveEvent.ComposerSuggestionsUpdated -> event.metadata
            is AiChatLiveEvent.RepairStatus -> event.metadata
            is AiChatLiveEvent.RunTerminal -> event.metadata
        }
        return metadata.sessionId == context.runtimeStateMutable.value.persistedState.chatSessionId
            && metadata.runId == activeRun.runId
    }
}
