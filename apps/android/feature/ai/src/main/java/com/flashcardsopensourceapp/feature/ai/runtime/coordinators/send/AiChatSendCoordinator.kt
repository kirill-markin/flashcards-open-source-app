package com.flashcardsopensourceapp.feature.ai.runtime.coordinators.send

import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRequestTooLargeException
import com.flashcardsopensourceapp.data.local.ai.remote.isAiChatAttachmentUnsupportedTypeRemoteError
import com.flashcardsopensourceapp.data.local.ai.remote.isAiChatRequestTooLargeRemoteError
import com.flashcardsopensourceapp.data.local.ai.remote.requireAiChatStartRunRequestSize
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.ai.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.ai.buildAiChatRequestContent
import com.flashcardsopensourceapp.data.local.model.ai.isSendableAiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.requireAiChatAttachmentSize
import com.flashcardsopensourceapp.feature.ai.runtime.AiChatRuntimeContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.appendAssistantAccountUpgradePrompt
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAiChatSessionId
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAssistantStatusMessage
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeUserContent
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeUserMessage
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.setPendingToolRunPostSync
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.snapshotRunHasToolCalls
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.live.AiChatLiveStreamCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.session.AiChatSessionCoordinator
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiErrorSurface
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatExceptionEvent
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatWarning
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatFailureWarningMessage
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatRemoteErrorDetails
import com.flashcardsopensourceapp.feature.ai.runtime.observability.countAiChatContentParts
import com.flashcardsopensourceapp.feature.ai.runtime.observability.makeAiErrorAlert
import com.flashcardsopensourceapp.feature.ai.runtime.observability.makeAiUserFacingErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatException
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatWarning
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.TimeZone
import java.util.UUID

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

        if (canSendAttachmentsWithinSizeLimit(pendingAttachments = currentState.pendingAttachments).not()) {
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeAlert = context.textProvider.requestTooLargeAlert(),
                    errorMessage = ""
                )
            }
            return
        }

        if (canSendStartRunRequestWithinSizeLimit(state = currentState, outgoingContent = outgoingContent).not()) {
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeAlert = context.textProvider.requestTooLargeAlert(),
                    errorMessage = ""
                )
            }
            return
        }

        context.observability.recordAiChatBreadcrumb(
            breadcrumb = AiChatBreadcrumb.UiSendMessageRequested(
                workspaceId = currentState.workspaceId,
                cloudState = currentCloudState().name,
                chatSessionId = currentState.persistedState.chatSessionId,
                messageCount = currentState.persistedState.messages.size,
                pendingAttachmentCount = currentState.pendingAttachments.size,
                contentCounts = countAiChatContentParts(content = outgoingContent)
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
                if (currentCloudState() == CloudAccountState.DISCONNECTED) {
                    context.aiChatRepository.prepareSessionForAi(
                        workspaceId = context.runtimeStateMutable.value.workspaceId
                    )
                }
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
        response: AiChatStartRunResponse,
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
        rollbackPersistedState: AiChatPersistedState,
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

        if (
            error is AiChatRequestTooLargeException
            || remoteError?.let(::isAiChatRequestTooLargeRemoteError) == true
        ) {
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    activeAlert = context.textProvider.requestTooLargeAlert(),
                    errorMessage = ""
                )
            }
            return
        }

        if (remoteError?.let(::isAiChatAttachmentUnsupportedTypeRemoteError) == true) {
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    activeAlert = context.textProvider.attachmentUnsupportedAlert(),
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

        val presentation = makeAiUserFacingErrorPresentation(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = currentServerConfiguration(),
            textProvider = context.textProvider
        )
        val currentState = context.runtimeStateMutable.value
        val issueDisposition = aiChatFailureIssueDisposition(error = error)
        when (issueDisposition) {
            AiChatFailureIssueDisposition.NONE -> Unit
            AiChatFailureIssueDisposition.WARNING -> {
                context.observability.recordAiChatWarning(
                    warning = AiChatWarning.SendFailureHandled(
                        workspaceId = currentState.workspaceId,
                        cloudState = currentCloudState().name,
                        chatSessionId = currentState.persistedState.chatSessionId,
                        messageCount = currentState.persistedState.messages.size,
                        remoteError = aiChatRemoteErrorDetails(error = remoteError),
                        message = aiChatFailureWarningMessage(error = error)
                    )
                )
            }
            AiChatFailureIssueDisposition.EXCEPTION -> {
                context.observability.recordAiChatException(
                    exception = AiChatExceptionEvent.SendFailureHandled(
                        workspaceId = currentState.workspaceId,
                        cloudState = currentCloudState().name,
                        chatSessionId = currentState.persistedState.chatSessionId,
                        messageCount = currentState.persistedState.messages.size,
                        userFacingMessage = presentation.message,
                        remoteError = aiChatRemoteErrorDetails(error = remoteError),
                        error = error
                    )
                )
            }
        }
        context.runtimeStateMutable.update { state ->
            state.copy(
                activeRun = null,
                isLiveAttached = false,
                composerPhase = AiComposerPhase.IDLE,
                activeAlert = makeAiErrorAlert(
                    presentation = presentation,
                    technicalErrorAlreadyObserved = issueDisposition != AiChatFailureIssueDisposition.NONE,
                    textProvider = context.textProvider
                ),
                errorMessage = ""
            )
        }
    }

    private fun restorePreAcceptFailureState(
        didAppendOptimisticMessages: Boolean,
        rollbackPersistedState: AiChatPersistedState,
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

    private fun canSendAttachmentsWithinSizeLimit(pendingAttachments: List<AiChatAttachment>): Boolean {
        return try {
            pendingAttachments.forEach(::requireAiChatAttachmentSize)
            true
        } catch (_: IllegalArgumentException) {
            false
        }
    }

    private fun canSendStartRunRequestWithinSizeLimit(
        state: AiChatRuntimeState,
        outgoingContent: List<AiChatContentPart>
    ): Boolean {
        val requestSessionId = state.persistedState.chatSessionId.ifBlank {
            makeAiChatSessionId()
        }
        val request = AiChatStartRunRequest(
            sessionId = requestSessionId,
            workspaceId = state.workspaceId,
            clientRequestId = UUID.randomUUID().toString().lowercase(),
            content = buildAiChatRequestContent(content = outgoingContent),
            timezone = TimeZone.getDefault().id,
            uiLocale = context.currentUiLocaleTag()
        )

        return try {
            requireAiChatStartRunRequestSize(request = request)
            true
        } catch (_: AiChatRequestTooLargeException) {
            false
        }
    }

    private fun updateComposerSuggestions(
        state: AiChatRuntimeState,
        nextSuggestions: List<AiChatComposerSuggestion>
    ): AiChatRuntimeState {
        return state.copy(serverComposerSuggestions = nextSuggestions)
    }
}
