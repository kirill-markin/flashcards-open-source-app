package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.isSendableAiChatAttachment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class AiChatSendCoordinator(
    private val context: AiChatRuntimeContext,
    private val liveStreamCoordinator: AiChatLiveStreamCoordinator,
    private val sessionCoordinator: AiChatSessionCoordinator
) {
    fun sendMessage() {
        val currentState = context.runtimeStateMutable.value
        if (canSendMessage(state = currentState).not()) {
            if (hasConsent().not()) {
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        activeAlert = context.textProvider.generalError(
                            message = context.textProvider.consentRequiredMessage
                        ),
                        errorMessage = ""
                    )
                }
            }
            return
        }

        val outgoingContent = makeUserContent(
            draftMessage = currentState.draftMessage,
            pendingAttachments = currentState.pendingAttachments
        )
        if (outgoingContent.isEmpty()) {
            return
        }

        AiChatDiagnosticsLogger.info(
            event = "ui_send_message_requested",
            fields = listOf(
                "workspaceId" to currentState.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to currentState.persistedState.chatSessionId,
                "messageCount" to currentState.persistedState.messages.size.toString(),
                "pendingAttachmentCount" to currentState.pendingAttachments.size.toString(),
                "outgoingContentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = outgoingContent)
            )
        )

        val draftMessageBackup = currentState.draftMessage
        val pendingAttachmentsBackup = currentState.pendingAttachments
        val durableDraftState = AiChatDraftState(
            draftMessage = draftMessageBackup,
            pendingAttachments = pendingAttachmentsBackup
        )
        context.runtimeStateMutable.update { state ->
            state.copy(
                draftMessage = "",
                pendingAttachments = emptyList(),
                composerPhase = AiComposerPhase.PREPARING_SEND,
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }

        val initialPersistedState = context.runtimeStateMutable.value.persistedState

        context.activeSendJob?.cancel()
        var sendJob: Job? = null
        sendJob = context.scope.launch {
            var didAcceptRun = false
            var didAppendOptimisticMessages = false
            var requestSessionId = currentState.persistedState.chatSessionId
            var rollbackPersistedState = initialPersistedState
            try {
                // AI send is blocked on a direct sync so the backend run never starts
                // from stale local writes that are still sitting in the outbox.
                context.aiChatRepository.ensureReadyForSend(workspaceId = context.runtimeStateMutable.value.workspaceId)
                val ensuredSession = sessionCoordinator.ensureSessionIdIfNeededPreservingDraft(
                    draftState = durableDraftState
                )
                requestSessionId = ensuredSession.sessionId
                rollbackPersistedState = context.runtimeStateMutable.value.persistedState
                val nextPersistedState = rollbackPersistedState.copy(
                    messages = rollbackPersistedState.messages + listOf(
                        makeUserMessage(
                            content = outgoingContent,
                            timestampMillis = System.currentTimeMillis()
                        ),
                        makeAssistantStatusMessage(
                            timestampMillis = System.currentTimeMillis()
                        )
                    )
                )
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = setPendingToolRunPostSync(
                            state = nextPersistedState,
                            pendingToolRunPostSync = false
                        ),
                        composerPhase = AiComposerPhase.STARTING_RUN,
                        runHadToolCalls = false
                    )
                }
                context.persistCurrentStatePreservingDraft(draftState = durableDraftState)
                didAppendOptimisticMessages = true

                val response = context.aiChatRepository.startRun(
                    workspaceId = context.runtimeStateMutable.value.workspaceId,
                    state = nextPersistedState,
                    content = outgoingContent,
                    uiLocale = context.currentUiLocaleTag()
                )
                didAcceptRun = true
                applyAcceptedRunResponse(
                    response = response,
                    targetSessionId = requestSessionId
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: AiChatRemoteException) {
                handleSendFailure(
                    error = error,
                    targetSessionId = requestSessionId,
                    didAcceptRun = didAcceptRun,
                    didAppendOptimisticMessages = didAppendOptimisticMessages,
                    rollbackPersistedState = rollbackPersistedState,
                    draftMessage = draftMessageBackup,
                    pendingAttachments = pendingAttachmentsBackup
                )
            } catch (error: Exception) {
                handleSendFailure(
                    error = error,
                    targetSessionId = requestSessionId,
                    didAcceptRun = didAcceptRun,
                    didAppendOptimisticMessages = didAppendOptimisticMessages,
                    rollbackPersistedState = rollbackPersistedState,
                    draftMessage = draftMessageBackup,
                    pendingAttachments = pendingAttachmentsBackup
                )
            } finally {
                if (context.activeSendJob !== sendJob) {
                    return@launch
                }
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        composerPhase = when (state.composerPhase) {
                            AiComposerPhase.RUNNING, AiComposerPhase.STOPPING -> state.composerPhase
                            else -> AiComposerPhase.IDLE
                        },
                        isLiveAttached = if (state.composerPhase == AiComposerPhase.RUNNING || state.composerPhase == AiComposerPhase.STOPPING) {
                            state.isLiveAttached
                        } else {
                            false
                        },
                        repairStatus = null
                    )
                }
                context.persistCurrentState()
                context.activeSendJob = null
            }
        }
        context.activeSendJob = sendJob
    }

    fun stopStreaming() {
        val currentState: AiChatRuntimeState = context.runtimeStateMutable.value
        if (currentState.composerPhase != AiComposerPhase.RUNNING) {
            return
        }

        val sessionId: String = currentState.persistedState.chatSessionId
        val workspaceId: String? = currentState.workspaceId
        val runId: String? = currentState.activeRun?.runId?.ifBlank { null }

        context.runtimeStateMutable.update { state ->
            state.copy(
                composerPhase = AiComposerPhase.STOPPING,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        context.persistCurrentState()

        context.scope.launch {
            try {
                if (sessionId.isNotBlank()) {
                    val response = context.aiChatRepository.stopRun(
                        workspaceId = workspaceId,
                        sessionId = sessionId,
                        runId = runId
                    )
                    if (response.stopped.not()) {
                        liveStreamCoordinator.reconcileConversationAfterStopNoop()
                        return@launch
                    }
                    if (response.stopped && response.stillRunning.not()) {
                        liveStreamCoordinator.finalizeStoppedConversation()
                        return@launch
                    }
                    if (
                        context.activeSendJob?.isActive != true
                        && context.activeLiveJob?.isActive != true
                        && context.runtimeStateMutable.value.activeRun == null
                    ) {
                        liveStreamCoordinator.finalizeStoppedConversation()
                    }
                    return@launch
                }
                liveStreamCoordinator.finalizeStoppedConversation()
            } catch (_: CancellationException) {
                throw CancellationException("Stop run cancelled.")
            } catch (_: Exception) {
                liveStreamCoordinator.finalizeStoppedConversation()
            }
        }
    }

    private fun canSendMessage(state: AiChatRuntimeState): Boolean {
        if (hasConsent().not()) {
            return false
        }
        if (state.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return false
        }
        if (state.composerPhase != AiComposerPhase.IDLE) {
            return false
        }
        if (state.activeRun != null) {
            return false
        }
        if (state.dictationState != AiChatDictationState.IDLE) {
            return false
        }
        return state.draftMessage.trim().isNotEmpty()
            || state.pendingAttachments.any(::isSendableAiChatAttachment)
    }

    private suspend fun applyAcceptedRunResponse(
        response: com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse,
        targetSessionId: String
    ) {
        if (sessionCoordinator.canApplySessionScopedResult(targetSessionId = targetSessionId).not()) {
            return
        }
        // Accepted responses can still mirror older recovered history before the
        // current turn is fully visible. We intentionally keep the accepted-path
        // detection broad here because an occasional zero-diff post-run sync is
        // an acceptable tradeoff for simpler cross-client recovery behavior.
        val runHadToolCalls = snapshotRunHasToolCalls(
            activeRun = response.activeRun,
            messages = response.conversation.messages
        )
        context.runtimeStateMutable.update { state ->
            updateComposerSuggestions(
                state = state.copy(
                    persistedState = state.persistedState.copy(
                        messages = response.conversation.messages,
                        chatSessionId = response.sessionId,
                        lastKnownChatConfig = response.chatConfig,
                        pendingToolRunPostSync = state.persistedState.pendingToolRunPostSync
                            || runHadToolCalls
                    ),
                    conversationScopeId = response.conversationScopeId,
                    hasOlder = response.conversation.hasOlder,
                    oldestCursor = response.conversation.oldestCursor,
                    activeRun = response.activeRun,
                    runHadToolCalls = runHadToolCalls,
                    isLiveAttached = false,
                    draftMessage = "",
                    pendingAttachments = emptyList(),
                    composerPhase = if (response.activeRun != null) {
                        AiComposerPhase.RUNNING
                    } else {
                        AiComposerPhase.IDLE
                    },
                    dictationState = AiChatDictationState.IDLE,
                    activeAlert = null,
                    errorMessage = ""
                ),
                nextSuggestions = response.composerSuggestions
            )
        }
        if (response.activeRun != null) {
            liveStreamCoordinator.attachAcceptedLiveStreamIfNeeded(
                workspaceId = context.runtimeStateMutable.value.workspaceId,
                response = response
            )
        } else {
            context.triggerToolRunPostSyncIfNeeded(reason = "accepted_response_terminal")
        }
        context.persistCurrentState()
    }

    private fun handleSendFailure(
        error: Exception,
        targetSessionId: String,
        didAcceptRun: Boolean,
        didAppendOptimisticMessages: Boolean,
        rollbackPersistedState: com.flashcardsopensourceapp.data.local.model.AiChatPersistedState,
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>
    ) {
        if (sessionCoordinator.canApplySessionScopedResult(targetSessionId = targetSessionId).not()) {
            return
        }
        val remoteError = error as? AiChatRemoteException
        if (didAcceptRun.not()) {
            restorePreAcceptFailureState(
                didAppendOptimisticMessages = didAppendOptimisticMessages,
                rollbackPersistedState = rollbackPersistedState,
                draftMessage = draftMessage,
                pendingAttachments = pendingAttachments
            )
        }
        if (remoteError?.code == "GUEST_AI_LIMIT_REACHED") {
            AiChatDiagnosticsLogger.warn(
                event = "send_failure_guest_quota_reached",
                fields = listOf(
                    "workspaceId" to context.runtimeStateMutable.value.workspaceId,
                    "cloudState" to currentCloudState().name,
                    "chatSessionId" to context.runtimeStateMutable.value.persistedState.chatSessionId,
                    "requestId" to remoteError.requestId,
                    "statusCode" to remoteError.statusCode?.toString(),
                    "code" to remoteError.code,
                    "stage" to remoteError.stage
                )
            )
            context.runtimeStateMutable.update { state ->
                state.copy(
                    persistedState = appendAssistantAccountUpgradePrompt(
                        state = state.persistedState,
                        message = context.textProvider.guestQuotaReachedMessage,
                        buttonTitle = context.textProvider.guestQuotaButtonTitle,
                        timestampMillis = System.currentTimeMillis()
                    ),
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    errorMessage = ""
                )
            }
            return
        }

        if (didAcceptRun.not() && remoteError?.code == "CHAT_ACTIVE_RUN_IN_PROGRESS") {
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    activeAlert = context.textProvider.generalError(
                        message = context.textProvider.responseInProgress
                    ),
                    errorMessage = ""
                )
            }
            return
        }

        val message = makeAiUserFacingErrorMessage(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = currentServerConfiguration(),
            textProvider = context.textProvider
        )
        val currentState = context.runtimeStateMutable.value
        AiChatDiagnosticsLogger.error(
            event = "send_failure_handled",
            fields = listOf(
                "workspaceId" to currentState.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to currentState.persistedState.chatSessionId,
                "messageCount" to currentState.persistedState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )
        context.runtimeStateMutable.update { state ->
            state.copy(
                activeRun = null,
                isLiveAttached = false,
                composerPhase = AiComposerPhase.IDLE,
                activeAlert = context.textProvider.generalError(message = message),
                errorMessage = ""
            )
        }
    }

    private fun restorePreAcceptFailureState(
        didAppendOptimisticMessages: Boolean,
        rollbackPersistedState: com.flashcardsopensourceapp.data.local.model.AiChatPersistedState,
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>
    ) {
        context.runtimeStateMutable.update { state ->
            state.copy(
                persistedState = if (didAppendOptimisticMessages) {
                    rollbackPersistedState
                } else {
                    state.persistedState
                },
                draftMessage = draftMessage,
                pendingAttachments = pendingAttachments,
                activeRun = null,
                isLiveAttached = false,
                composerPhase = AiComposerPhase.IDLE,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    private fun hasConsent(): Boolean {
        return context.hasConsent()
    }

    private fun currentCloudState(): CloudAccountState {
        return context.currentCloudState()
    }

    private fun currentServerConfiguration(): CloudServiceConfiguration {
        return context.currentServerConfiguration()
    }

    private fun updateComposerSuggestions(
        state: AiChatRuntimeState,
        nextSuggestions: List<AiChatComposerSuggestion>
    ): AiChatRuntimeState {
        return state.copy(serverComposerSuggestions = nextSuggestions)
    }
}
