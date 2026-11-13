package com.flashcardsopensourceapp.feature.ai.runtime.coordinators.send

import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRequestTooLargeException
import com.flashcardsopensourceapp.data.local.ai.remote.isAiChatAttachmentUnsupportedTypeRemoteError
import com.flashcardsopensourceapp.data.local.ai.remote.isAiChatRequestTooLargeRemoteError
import com.flashcardsopensourceapp.data.local.ai.remote.isAiChatSessionNotCurrentRemoteError
import com.flashcardsopensourceapp.data.local.ai.remote.isAiLimitReachedRemoteError
import com.flashcardsopensourceapp.data.local.ai.remote.requireAiChatStartRunRequestSize
import com.flashcardsopensourceapp.data.local.model.ai.AiChatImportRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiImportPersistenceException
import com.flashcardsopensourceapp.data.local.model.ai.AiImportTargetChangedException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunRequest
import com.flashcardsopensourceapp.data.local.model.ai.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.ai.buildAiChatRequestContent
import com.flashcardsopensourceapp.data.local.model.ai.findAiChatAttachmentLimitViolation
import com.flashcardsopensourceapp.data.local.model.ai.isSendableAiChatAttachment
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedRemoteSession
import com.flashcardsopensourceapp.feature.ai.input.deleteAiChatAttachmentStagedFiles
import com.flashcardsopensourceapp.feature.ai.input.isAiChatAttachmentStaged
import com.flashcardsopensourceapp.feature.ai.runtime.AiChatRuntimeContext
import com.flashcardsopensourceapp.feature.ai.runtime.aiChatBootstrapPageLimit
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
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiAlertState
import com.flashcardsopensourceapp.feature.ai.runtime.errors.AiUserFacingErrorPresentation
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
    private val sessionCoordinator: AiChatSessionCoordinator,
    private val applyActiveBootstrap: suspend (AiChatBootstrapResponse, String) -> Unit
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

        val importRequest = currentState.importRequest
        if (importRequest != null && canRetryImport(state = currentState, request = importRequest).not()) {
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeAlert = context.textProvider.generalError(
                        message = context.textProvider.importRetryUnavailable
                    ),
                    errorMessage = ""
                )
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

        val attachmentLimitViolation = findAiChatAttachmentLimitViolation(
            pendingAttachments = currentState.pendingAttachments
        )
        if (attachmentLimitViolation != null) {
            context.runtimeStateMutable.update { state ->
                state.copy(
                    activeAlert = context.textProvider.attachmentLimitAlert(violation = attachmentLimitViolation),
                    errorMessage = ""
                )
            }
            return
        }

        if (canSendStartRunRequestWithinSizeLimit(state = currentState).not()) {
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
            pendingAttachments = pendingAttachmentsBackup,
            importRequest = importRequest
        )
        context.runtimeStateMutable.update { state ->
            state.copy(
                draftMessage = if (importRequest == null) "" else draftMessageBackup,
                pendingAttachments = if (importRequest == null) emptyList() else pendingAttachmentsBackup,
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
                var preparedSession: AiChatPreparedRemoteSession? = null
                if (importRequest != null) {
                    context.persistImportNow(snapshot = currentState)
                } else if (currentCloudState() == CloudAccountState.DISCONNECTED) {
                    preparedSession = context.aiChatRepository.prepareSessionForAi(
                        workspaceId = context.runtimeStateMutable.value.workspaceId
                    )
                }
                // AI send is blocked on a direct sync so the backend run never starts
                // from stale local writes that are still sitting in the outbox.
                context.aiChatRepository.ensureReadyForSend(
                    workspaceId = importRequest?.target?.workspaceId ?: context.runtimeStateMutable.value.workspaceId
                )
                val preparedImport = importRequest?.let { request ->
                    context.aiChatRepository.prepareImportSession(request = request)
                }
                if (importRequest != null && context.isImportOriginCurrent(request = importRequest).not()) {
                    throw AiImportTargetChangedException()
                }
                val ensuredSession = sessionCoordinator.ensureSessionIdIfNeededPreservingDraft(
                    draftState = durableDraftState,
                    preparedSession = preparedImport?.remoteSession ?: preparedSession
                )
                requestSessionId = ensuredSession.sessionId
                if (importRequest != null) {
                    if (context.isImportOriginCurrent(request = importRequest).not()) {
                        throw AiImportTargetChangedException()
                    }
                    // Make the original request recoverable before uploading or dispatching it.
                    context.persistImportNow(snapshot = context.runtimeStateMutable.value)
                    if (context.isImportOriginCurrent(request = importRequest).not()) {
                        throw AiImportTargetChangedException()
                    }
                }
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
                if (importRequest == null) {
                    context.persistCurrentStatePreservingDraft(draftState = durableDraftState)
                }
                didAppendOptimisticMessages = true

                val response = context.aiChatRepository.startRun(
                    workspaceId = importRequest?.target?.workspaceId ?: context.runtimeStateMutable.value.workspaceId,
                    state = nextPersistedState,
                    draftMessage = draftMessageBackup,
                    pendingAttachments = pendingAttachmentsBackup,
                    uiLocale = context.currentUiLocaleTag(),
                    preparedImport = preparedImport
                )
                didAcceptRun = true
                if (importRequest == null) {
                    deleteAiChatAttachmentStagedFiles(attachments = pendingAttachmentsBackup)
                }
                applyAcceptedRunResponse(
                    response = response,
                    targetSessionId = requestSessionId,
                    rollbackPersistedState = rollbackPersistedState,
                    draftState = durableDraftState
                )
            } catch (error: CancellationException) {
                if (
                    importRequest != null && didAcceptRun.not() && didAppendOptimisticMessages &&
                    context.isImportOriginCurrent(request = importRequest)
                ) {
                    context.runtimeStateMutable.update { state -> state.copy(persistedState = rollbackPersistedState) }
                }
                throw error
            } catch (_: AiImportTargetChangedException) {
                if (importRequest != null && context.isImportOriginCurrent(request = importRequest)) {
                    restorePreAcceptFailureState(
                        didAppendOptimisticMessages = didAppendOptimisticMessages,
                        rollbackPersistedState = rollbackPersistedState,
                        draftMessage = draftMessageBackup,
                        pendingAttachments = pendingAttachmentsBackup
                    )
                    context.runtimeStateMutable.update { state ->
                        state.copy(
                            activeAlert = context.textProvider.generalError(
                                message = context.textProvider.importRetryUnavailable
                            )
                        )
                    }
                }
            } catch (error: Exception) {
                handleSendFailure(
                    error = error,
                    targetSessionId = requestSessionId,
                    didAcceptRun = didAcceptRun,
                    didAppendOptimisticMessages = didAppendOptimisticMessages,
                    rollbackPersistedState = rollbackPersistedState,
                    draftState = durableDraftState
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
                if (importRequest == null || context.isImportOriginCurrent(request = importRequest)) {
                    context.persistCurrentState()
                }
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

    private fun canRetryImport(state: AiChatRuntimeState, request: AiChatImportRequest): Boolean {
        return context.isImportOriginCurrent(request = request)
            && request.matchesDraft(message = state.draftMessage, attachments = state.pendingAttachments)
            && state.pendingAttachments.all(::isAiChatAttachmentStaged)
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
        if (state.isImportingAttachment) {
            return false
        }
        return state.draftMessage.trim().isNotEmpty()
            || state.pendingAttachments.any(::isSendableAiChatAttachment)
    }

    private suspend fun applyAcceptedRunResponse(
        response: AiChatStartRunResponse,
        targetSessionId: String,
        rollbackPersistedState: AiChatPersistedState,
        draftState: AiChatDraftState
    ) {
        val importRequest = draftState.importRequest
        if (importRequest == null && sessionCoordinator.canApplySessionScopedResult(targetSessionId = targetSessionId).not()) {
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
        val applyResponse: (AiChatRuntimeState) -> AiChatRuntimeState = { state ->
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
                    importRequest = null,
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
        if (importRequest == null) {
            context.runtimeStateMutable.update(applyResponse)
        } else {
            val applied = context.finishImport(
                request = importRequest,
                attachments = draftState.pendingAttachments,
                rollbackPersistedState = rollbackPersistedState,
                applyResult = applyResponse
            )
            if (applied.not()) {
                return
            }
        }
        if (response.activeRun != null) {
            liveStreamCoordinator.attachAcceptedLiveStreamIfNeeded(
                workspaceId = context.runtimeStateMutable.value.workspaceId,
                response = response
            )
        } else {
            context.refreshAiUsage()
            context.triggerToolRunPostSyncIfNeeded(reason = "accepted_response_terminal")
        }
        if (importRequest == null) {
            context.persistCurrentState()
        }
    }

    private suspend fun handleSendFailure(
        error: Exception,
        targetSessionId: String,
        didAcceptRun: Boolean,
        didAppendOptimisticMessages: Boolean,
        rollbackPersistedState: AiChatPersistedState,
        draftState: AiChatDraftState
    ) {
        val importRequest = draftState.importRequest
        val startRunError = error as? AiChatRemoteException
        val failure = if (
            importRequest != null && didAcceptRun.not() &&
            startRunError?.let(::isAiChatSessionNotCurrentRemoteError) == true
        ) {
            try {
                finishStaleImport(
                    request = importRequest,
                    rollbackPersistedState = rollbackPersistedState,
                    attachments = draftState.pendingAttachments
                )
                return
            } catch (clearError: AiImportPersistenceException) {
                clearError
            }
        } else {
            error
        }
        if (
            sessionCoordinator.canApplySessionScopedResult(targetSessionId = targetSessionId).not() ||
            (importRequest != null && context.isImportOriginCurrent(request = importRequest).not())
        ) {
            return
        }
        val remoteError = failure as? AiChatRemoteException
        if (didAcceptRun.not() && remoteError?.let(::isAiChatSessionNotCurrentRemoteError) == true) {
            switchToCurrentChatAfterNotCurrentRefusal(
                staleSessionId = targetSessionId,
                didAppendOptimisticMessages = didAppendOptimisticMessages,
                rollbackPersistedState = rollbackPersistedState,
                draftMessage = draftState.draftMessage,
                pendingAttachments = draftState.pendingAttachments
            )
            return
        }
        if (didAcceptRun.not() || importRequest != null) {
            restorePreAcceptFailureState(
                didAppendOptimisticMessages = didAppendOptimisticMessages,
                rollbackPersistedState = rollbackPersistedState,
                draftMessage = draftState.draftMessage,
                pendingAttachments = draftState.pendingAttachments
            )
        }
        if (remoteError?.let(::isAiLimitReachedRemoteError) == true) {
            val message = context.textProvider.aiLimitReachedAccountMessageWithoutDate
            val alert = context.textProvider.generalError(message = message)
            context.refreshAiUsage()
            context.runtimeStateMutable.update { state ->
                state.copy(
                    persistedState = if (currentCloudState() == CloudAccountState.GUEST) {
                        appendAssistantAccountUpgradePrompt(
                            state = state.persistedState,
                            message = message,
                            buttonTitle = context.textProvider.guestQuotaButtonTitle,
                            timestampMillis = System.currentTimeMillis()
                        )
                    } else {
                        state.persistedState
                    },
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    activeAlert = AiAlertState.AiLimitReached(
                        requestId = UUID.randomUUID().toString(),
                        code = requireNotNull(remoteError.code),
                        title = alert.title,
                        message = message
                    ),
                    errorMessage = message
                )
            }
            return
        }

        if (
            failure is AiChatRequestTooLargeException
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

        val presentation = if (failure is AiImportPersistenceException) {
            AiUserFacingErrorPresentation(message = context.textProvider.importPersistenceFailed, technicalError = failure)
        } else {
            makeAiUserFacingErrorPresentation(
                error = failure,
                surface = AiErrorSurface.CHAT,
                configuration = currentServerConfiguration(),
                textProvider = context.textProvider
            )
        }
        val currentState = context.runtimeStateMutable.value
        val issueDisposition = aiChatFailureIssueDisposition(error = failure)
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
                        message = aiChatFailureWarningMessage(error = failure)
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
                        error = failure
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

    private suspend fun finishStaleImport(
        request: AiChatImportRequest,
        rollbackPersistedState: AiChatPersistedState,
        attachments: List<AiChatAttachment>
    ) {
        context.finishImport(
            request = request,
            attachments = attachments,
            rollbackPersistedState = rollbackPersistedState
        ) { state ->
            state.copy(
                persistedState = rollbackPersistedState,
                draftMessage = "",
                pendingAttachments = emptyList(),
                importRequest = null,
                activeAlert = context.textProvider.generalError(message = context.textProvider.importChatReplaced)
            )
        }
    }

    private suspend fun switchToCurrentChatAfterNotCurrentRefusal(
        staleSessionId: String,
        didAppendOptimisticMessages: Boolean,
        rollbackPersistedState: AiChatPersistedState,
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>
    ) {
        // The composer stays busy so neither a resend nor a warm-up bootstrap races the switch.
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
                composerPhase = AiComposerPhase.PREPARING_SEND,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        val workspaceId = context.runtimeStateMutable.value.workspaceId
        try {
            val currentChat = context.aiChatRepository.loadCurrentBootstrap(
                workspaceId = workspaceId,
                limit = aiChatBootstrapPageLimit
            )
            if (
                context.runtimeStateMutable.value.workspaceId != workspaceId
                || sessionCoordinator.canApplySessionScopedResult(targetSessionId = staleSessionId).not()
            ) {
                return
            }
            val refusedDraft = AiChatDraftState(draftMessage = draftMessage, pendingAttachments = pendingAttachments)
            val didSaveSourceDraft = context.aiChatRepository.saveDraftState(
                workspaceId = workspaceId,
                sessionId = staleSessionId,
                state = refusedDraft
            )
            val didSaveDestinationDraft = didSaveSourceDraft && (currentChat.sessionId == staleSessionId ||
                context.aiChatRepository.saveDraftState(
                    workspaceId = workspaceId,
                    sessionId = currentChat.sessionId,
                    state = refusedDraft
                ))
            if (
                context.runtimeStateMutable.value.workspaceId != workspaceId ||
                sessionCoordinator.canApplySessionScopedResult(targetSessionId = staleSessionId).not()
            ) {
                return
            }
            applyActiveBootstrap(currentChat, currentChat.sessionId)
            val currentState = context.runtimeStateMutable.value
            if (currentState.workspaceId != workspaceId || currentState.persistedState.chatSessionId != currentChat.sessionId) {
                return
            }
            val didMoveDraft = didSaveDestinationDraft &&
                currentState.importRequest == null &&
                currentState.draftMessage == draftMessage &&
                currentState.pendingAttachments == pendingAttachments
            val activeAlert = if (didMoveDraft) {
                context.textProvider.generalError(message = context.textProvider.chatNotCurrentNotice)
            } else {
                AiAlertState.UnsentMessage(
                    title = context.textProvider.errorTitle,
                    message = if (currentState.importRequest != null) {
                        context.textProvider.chatNotCurrentImportNotice
                    } else {
                        context.textProvider.chatNotCurrentUnsentMessageNotice
                    },
                    draftMessage = draftMessage
                )
            }
            context.runtimeStateMutable.update { state ->
                state.copy(activeAlert = activeAlert, errorMessage = "")
            }
            if (didMoveDraft && staleSessionId != currentChat.sessionId) {
                context.aiChatRepository.clearDraftState(workspaceId = workspaceId, sessionId = staleSessionId)
            }
            liveStreamCoordinator.attachBootstrapLiveIfNeeded(
                workspaceId = requireNotNull(workspaceId) {
                    "AI chat switched to the current chat without a workspace."
                },
                response = currentChat,
                resumeDiagnostics = null
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            handleSendFailure(
                error = error,
                targetSessionId = staleSessionId,
                didAcceptRun = false,
                didAppendOptimisticMessages = false,
                rollbackPersistedState = rollbackPersistedState,
                draftState = AiChatDraftState(
                    draftMessage = draftMessage,
                    pendingAttachments = pendingAttachments
                )
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

    private fun canSendStartRunRequestWithinSizeLimit(state: AiChatRuntimeState): Boolean {
        val requestSessionId = state.persistedState.chatSessionId.ifBlank {
            makeAiChatSessionId()
        }
        // Upload ids are not known before the uploads; attachment ids are UUIDs of the same length.
        val standInUploadIdsByAttachmentId = state.pendingAttachments.associate { attachment ->
            attachment.id to attachment.id
        }
        val request = AiChatStartRunRequest(
            sessionId = requestSessionId,
            workspaceId = state.workspaceId,
            clientRequestId = UUID.randomUUID().toString().lowercase(),
            content = buildAiChatRequestContent(
                draftMessage = state.draftMessage,
                pendingAttachments = state.pendingAttachments,
                uploadIdsByAttachmentId = standInUploadIdsByAttachmentId
            ),
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
