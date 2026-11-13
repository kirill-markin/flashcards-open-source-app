package com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap

import com.flashcardsopensourceapp.data.local.ai.diagnostics.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.ai.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.feature.ai.emptyAiBootstrapErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.AiChatRuntimeContext
import com.flashcardsopensourceapp.feature.ai.runtime.aiChatBootstrapPageLimit
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiAccessContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.forSession
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.normalizeAiChatPersistedStateForWorkspace
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.resolveAiChatSessionIdForWorkspace
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.runtimeKey
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.snapshotRunHasToolCalls
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.session.resolveRemoteBootstrapSession
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatExceptionEvent
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatWarning
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatFailureWarningMessage
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatRemoteErrorDetails
import com.flashcardsopensourceapp.feature.ai.runtime.observability.makeAiBootstrapErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatException
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatWarning
import com.flashcardsopensourceapp.feature.ai.runtime.observability.remoteErrorFields
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class AiChatBootstrapCoordinator(
    private val context: AiChatRuntimeContext,
    private val attachBootstrapLiveStream: (
        String,
        AiChatBootstrapResponse,
        AiChatResumeDiagnostics?
    ) -> Unit
) {
    private var activeBootstrapRequestToken: Long = 0L

    private fun nextBootstrapRequestToken(): Long {
        activeBootstrapRequestToken += 1L
        return activeBootstrapRequestToken
    }

    private fun isCurrentBootstrapRequest(
        expectedContext: AiAccessContext,
        expectedRequestToken: Long,
        expectedJob: Job?
    ): Boolean {
        if (activeBootstrapRequestToken != expectedRequestToken) {
            return false
        }
        if (expectedJob == null || context.activeBootstrapJob !== expectedJob) {
            return false
        }
        val currentKey = context.activeAccessContext?.runtimeKey() ?: return false
        return expectedContext.runtimeKey().matchesCurrentAccess(current = currentKey)
    }

    private fun canApplyBootstrapResult(
        workspaceId: String,
        sessionId: String
    ): Boolean {
        val currentState = context.runtimeStateMutable.value
        if (currentState.workspaceId != workspaceId) {
            return false
        }
        val currentSessionId = currentState.persistedState.chatSessionId
        return currentSessionId.isBlank() || currentSessionId == sessionId
    }

    fun startConversationBootstrap(
        forceReloadState: Boolean,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ) {
        val accessContext = context.activeAccessContext ?: return
        val workspaceId = accessContext.workspaceId ?: return
        if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
            return
        }

        val currentState = context.runtimeStateMutable.value
        if (currentState.importRequest != null && currentState.persistedState.requiresRemoteSessionProvisioning) {
            // Leave provisioning to the import send, which verifies the original account and server.
            context.runtimeStateMutable.update { state ->
                state.copy(conversationBootstrapState = AiConversationBootstrapState.READY)
            }
            return
        }

        val bootstrapRequestToken = nextBootstrapRequestToken()
        context.lastBootstrapFailureRetryable = false
        context.activeBootstrapJob?.cancel(
            cause = CancellationException("AI bootstrap restarted.")
        )
        var bootstrapJob: Job? = null
        bootstrapJob = context.scope.launch(start = CoroutineStart.LAZY) {
            var persistedState = normalizeAiChatPersistedStateForWorkspace(
                workspaceId = workspaceId,
                persistedState = context.aiChatRepository.loadPersistedState(workspaceId = workspaceId)
            )
            if (
                isCurrentBootstrapRequest(
                    expectedContext = accessContext,
                    expectedRequestToken = bootstrapRequestToken,
                    expectedJob = bootstrapJob
                ).not()
            ) {
                logBootstrapSuperseded(
                    workspaceId = workspaceId,
                    expectedContext = accessContext,
                    stage = "load_persisted_state"
                )
                return@launch
            }
            val bootstrapProvisionalSessionId = if (persistedState.chatSessionId.isBlank()) {
                context.aiChatRepository.makeExplicitSessionId()
            } else {
                null
            }
            var didAttemptInitialRemoteSessionProvisioning: Boolean = false
            var didProvisionInitialRemoteSession: Boolean = false
            var provisionedRemoteSessionId: String? = null
            var switchTargetSessionId: String? = null
            val preBootstrapState = context.runtimeStateMutable.value
            try {
                val canPreserveLocalComposerState =
                    forceReloadState.not()
                        && context.runtimeStateMutable.value.composerPhase == AiComposerPhase.IDLE
                        && context.runtimeStateMutable.value.conversationBootstrapState == AiConversationBootstrapState.READY
                // Forced reloads recover a run or a failure in the shown chat, so only an idle reload
                // follows the current chat.
                val canLoadCurrentChat =
                    forceReloadState.not()
                        && preBootstrapState.activeRun == null
                        && preBootstrapState.importRequest == null
                        && preBootstrapState.composerPhase == AiComposerPhase.IDLE
                context.activeLiveJob?.cancel(
                    cause = CancellationException("AI live attach cancelled because bootstrap restarted.")
                )
                context.activeLiveJob = null
                if (forceReloadState) {
                    context.runtimeStateMutable.update { state ->
                        state.copy(
                            workspaceId = workspaceId,
                            persistedState = persistedState,
                            conversationScopeId = null,
                            hasOlder = false,
                            oldestCursor = null,
                            activeRun = null,
                            isLiveAttached = false,
                            draftMessage = "",
                            pendingAttachments = emptyList(),
                            importRequest = null,
                            serverComposerSuggestions = persistedState.composerSuggestions,
                            composerPhase = AiComposerPhase.IDLE,
                            dictationState = com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState.IDLE,
                            conversationBootstrapState = AiConversationBootstrapState.LOADING,
                            conversationBootstrapErrorPresentation = emptyAiBootstrapErrorPresentation(),
                            repairStatus = null,
                            activeAlert = null,
                            errorMessage = ""
                        )
                    }
                } else {
                    context.runtimeStateMutable.update { state ->
                        state.copy(
                            activeRun = state.activeRun,
                            isLiveAttached = false,
                            composerPhase = AiComposerPhase.IDLE,
                            dictationState = com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState.IDLE,
                            conversationBootstrapState = AiConversationBootstrapState.LOADING,
                            conversationBootstrapErrorPresentation = emptyAiBootstrapErrorPresentation(),
                            repairStatus = null,
                            activeAlert = null,
                            errorMessage = ""
                        )
                    }
                }

                if (isSyncBlocked()) {
                    throw AiChatBootstrapBlockedException()
                }

                val remoteBootstrap = loadBootstrapRemoteResultWithRetry(
                    workspaceId = workspaceId,
                    persistedState = persistedState,
                    bootstrapProvisionalSessionId = bootstrapProvisionalSessionId,
                    canLoadCurrentChat = canLoadCurrentChat,
                    resumeDiagnostics = resumeDiagnostics,
                    accessContext = accessContext,
                    bootstrapRequestToken = bootstrapRequestToken,
                    bootstrapJob = bootstrapJob,
                    onInitialProvisioningAttempted = {
                        didAttemptInitialRemoteSessionProvisioning = true
                    },
                    onInitialProvisioningCompleted = {
                        didProvisionInitialRemoteSession = true
                    },
                    onRemoteSessionProvisioned = { sessionId ->
                        provisionedRemoteSessionId = sessionId
                    }
                ) ?: return@launch
                val ensuredSession = remoteBootstrap.ensuredSession
                if (canApplyBootstrapResult(workspaceId = workspaceId, sessionId = ensuredSession.sessionId).not()) {
                    return@launch
                }
                val ensuredSnapshot = ensuredSession.snapshot
                if (ensuredSnapshot != null) {
                    context.runtimeStateMutable.update { state ->
                        if (canApplyBootstrapResult(workspaceId = workspaceId, sessionId = ensuredSession.sessionId).not()) {
                            return@update state
                        }
                        state.copy(
                            persistedState = state.persistedState.copy(
                                chatSessionId = ensuredSession.sessionId,
                                lastKnownChatConfig = ensuredSnapshot.chatConfig,
                                requiresRemoteSessionProvisioning = false
                            )
                        )
                    }
                }
                val currentChatSessionId = remoteBootstrap.requestedSessionId
                    ?: resolveAiChatSessionIdForWorkspace(
                        workspaceId = workspaceId,
                        sessionId = remoteBootstrap.bootstrap.sessionId
                    )
                    ?: throw AiChatBootstrapSessionMismatchException(
                        "AI bootstrap returned a blank sessionId. workspaceId=$workspaceId expectedSessionId=${ensuredSession.sessionId}"
                    )
                val draftMove = if (currentChatSessionId == ensuredSession.sessionId) {
                    null
                } else {
                    switchTargetSessionId = currentChatSessionId
                    AiBootstrapDraftMove(
                        shownSessionId = ensuredSession.sessionId,
                        storedDraft = if (canPreserveLocalComposerState) {
                            null
                        } else {
                            context.aiChatRepository.loadDraftState(
                                workspaceId = workspaceId,
                                sessionId = ensuredSession.sessionId
                            )
                        }
                    )
                }
                val didApplyBootstrap = applyBootstrap(
                    response = remoteBootstrap.bootstrap,
                    expectedSessionId = currentChatSessionId,
                    preserveLocalComposerState = canPreserveLocalComposerState && draftMove == null,
                    draftMove = draftMove,
                    canApplyBootstrap = {
                        isCurrentBootstrapRequest(
                            expectedContext = accessContext,
                            expectedRequestToken = bootstrapRequestToken,
                            expectedJob = bootstrapJob
                        )
                            && (
                                canApplyBootstrapResult(
                                    workspaceId = workspaceId,
                                    sessionId = ensuredSession.sessionId
                                ) || canApplyBootstrapResult(
                                    workspaceId = workspaceId,
                                    sessionId = currentChatSessionId
                                )
                            )
                    }
                )
                if (didApplyBootstrap.not()) {
                    return@launch
                }
                context.lastBootstrapFailureRetryable = false
                if (
                    isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    ).not()
                    || canApplyBootstrapResult(
                        workspaceId = workspaceId,
                        sessionId = currentChatSessionId
                    ).not()
                ) {
                    return@launch
                }
                if (draftMove != null) {
                    AiChatDiagnosticsLogger.info(
                        event = "conversation_bootstrap_switched_to_current_chat",
                        fields = listOf(
                            "workspaceId" to workspaceId,
                            "shownSessionId" to ensuredSession.sessionId,
                            "currentChatSessionId" to currentChatSessionId
                        )
                    )
                }
                attachBootstrapLiveStream(workspaceId, remoteBootstrap.bootstrap, resumeDiagnostics)
            } catch (error: CancellationException) {
                context.observability.recordAiChatBreadcrumb(
                    breadcrumb = AiChatBreadcrumb.ConversationBootstrapCancelled(
                        workspaceId = workspaceId,
                        cloudState = accessContext.cloudState.name
                    )
                )
                throw error
            } catch (error: Exception) {
                if (
                    isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    ).not()
                ) {
                    logBootstrapSuperseded(
                        workspaceId = workspaceId,
                        expectedContext = accessContext,
                        stage = "failure"
                    )
                    return@launch
                }

                val presentation = makeAiBootstrapErrorPresentation(
                    error = error,
                    configuration = context.currentServerConfiguration(),
                    textProvider = context.textProvider
                )
                val remoteError = error as? AiChatRemoteException
                context.lastBootstrapFailureRetryable = isRetryableBootstrapFailure(error = error)
                val diagnosticFields = listOf(
                    "workspaceId" to workspaceId,
                    "cloudState" to accessContext.cloudState.name,
                    "userFacingMessage" to presentation.message,
                    "errorType" to error::class.java.name
                ) + remoteErrorFields(error = remoteError)
                when (aiChatFailureIssueDisposition(error = error)) {
                    AiChatFailureIssueDisposition.NONE -> {
                        AiChatDiagnosticsLogger.warn(
                            event = "conversation_bootstrap_failed",
                            fields = diagnosticFields
                        )
                    }
                    AiChatFailureIssueDisposition.WARNING -> {
                        context.observability.recordAiChatWarning(
                            warning = AiChatWarning.ConversationBootstrapFailed(
                                workspaceId = workspaceId,
                                cloudState = accessContext.cloudState.name,
                                remoteError = aiChatRemoteErrorDetails(error = remoteError),
                                message = aiChatFailureWarningMessage(error = error)
                            )
                        )
                        AiChatDiagnosticsLogger.warn(
                            event = "conversation_bootstrap_failed",
                            fields = diagnosticFields
                        )
                    }
                    AiChatFailureIssueDisposition.EXCEPTION -> {
                        context.observability.recordAiChatException(
                            exception = AiChatExceptionEvent.ConversationBootstrapFailed(
                                workspaceId = workspaceId,
                                cloudState = accessContext.cloudState.name,
                                remoteError = aiChatRemoteErrorDetails(error = remoteError),
                                error = error
                            )
                        )
                        AiChatDiagnosticsLogger.error(
                            event = "conversation_bootstrap_failed",
                            fields = diagnosticFields,
                            throwable = error
                        )
                    }
                }
                val currentSessionId = resolveAiChatSessionIdForWorkspace(
                    workspaceId = workspaceId,
                    sessionId = context.runtimeStateMutable.value.persistedState.chatSessionId
                )
                val failedProvisionalSessionId = if (
                    currentSessionId == null
                    && bootstrapProvisionalSessionId != null
                    && didAttemptInitialRemoteSessionProvisioning
                ) {
                    bootstrapProvisionalSessionId
                } else {
                    null
                }
                var didApplyFailureState: Boolean = false
                // Once the switch landed, the pre-bootstrap state is an older chat; restoring it would move back.
                val didSwitchChat = switchTargetSessionId != null && currentSessionId == switchTargetSessionId
                val shouldPreserveConversationState = didSwitchChat.not()
                    && (preBootstrapState.importRequest != null || shouldPreserveConversationStateOnBootstrapFailure(
                        error = error,
                        forceReloadState = forceReloadState,
                        preBootstrapState = preBootstrapState,
                        workspaceId = workspaceId,
                        persistedState = persistedState
                    ))
                val failureSessionId = failedProvisionalSessionId
                    ?: currentSessionId
                    ?: persistedState.chatSessionId
                val draftStateToPreserve = freshSessionDraftToPreserveOnBootstrapFailure(
                    forceReloadState = forceReloadState,
                    preBootstrapState = preBootstrapState,
                    workspaceId = workspaceId,
                    failureSessionId = failureSessionId
                )
                context.runtimeStateMutable.update { state ->
                    if (
                        isCurrentBootstrapRequest(
                            expectedContext = accessContext,
                            expectedRequestToken = bootstrapRequestToken,
                            expectedJob = bootstrapJob
                        ).not()
                    ) {
                        return@update state
                    }
                    didApplyFailureState = true
                    if (shouldPreserveConversationState) {
                        return@update state.copy(
                            persistedState = preBootstrapState.persistedState,
                            conversationScopeId = preBootstrapState.conversationScopeId,
                            hasOlder = preBootstrapState.hasOlder,
                            oldestCursor = preBootstrapState.oldestCursor,
                            activeRun = preBootstrapState.activeRun,
                            runHadToolCalls = preBootstrapState.runHadToolCalls,
                            isLiveAttached = false,
                            draftMessage = preBootstrapState.draftMessage,
                            pendingAttachments = preBootstrapState.pendingAttachments,
                            importRequest = preBootstrapState.importRequest,
                            composerPhase = preBootstrapState.composerPhase,
                            dictationState = preBootstrapState.dictationState,
                            serverComposerSuggestions = preBootstrapState.serverComposerSuggestions,
                            conversationBootstrapState = AiConversationBootstrapState.FAILED,
                            conversationBootstrapErrorPresentation = presentation,
                            repairStatus = null,
                            activeAlert = null,
                            errorMessage = ""
                        )
                    }
                    val didProvisionFailureSession = provisionedRemoteSessionId == failureSessionId
                    val requiresRemoteSessionProvisioning = when {
                        failedProvisionalSessionId != null -> didProvisionInitialRemoteSession.not()
                        didProvisionFailureSession -> false
                        else -> state.persistedState.requiresRemoteSessionProvisioning
                    }
                    state.copy(
                        persistedState = state.persistedState.copy(
                            messages = emptyList(),
                            chatSessionId = failureSessionId,
                            requiresRemoteSessionProvisioning = requiresRemoteSessionProvisioning
                        ),
                        conversationScopeId = null,
                        hasOlder = false,
                        oldestCursor = null,
                        activeRun = null,
                        isLiveAttached = false,
                        draftMessage = draftStateToPreserve?.draftMessage ?: "",
                        pendingAttachments = draftStateToPreserve?.pendingAttachments ?: emptyList(),
                        importRequest = draftStateToPreserve?.importRequest,
                        serverComposerSuggestions = emptyList(),
                        composerPhase = AiComposerPhase.IDLE,
                        dictationState = com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState.IDLE,
                        conversationBootstrapState = AiConversationBootstrapState.FAILED,
                        conversationBootstrapErrorPresentation = presentation,
                        repairStatus = null,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
                if (
                    didApplyFailureState
                    && shouldPreserveConversationState.not()
                    && (failedProvisionalSessionId != null || provisionedRemoteSessionId != null)
                    && isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    )
                ) {
                    if (draftStateToPreserve == null) {
                        context.persistCurrentState()
                    } else {
                        context.persistCurrentStatePreservingDraft(draftState = draftStateToPreserve)
                    }
                }
            } finally {
                if (
                    activeBootstrapRequestToken == bootstrapRequestToken
                    && context.activeBootstrapJob === bootstrapJob
                ) {
                    context.activeBootstrapJob = null
                }
            }
        }
        context.activeBootstrapJob = bootstrapJob
        bootstrapJob.start()
    }

    private fun logBootstrapSuperseded(
        workspaceId: String,
        expectedContext: AiAccessContext,
        stage: String
    ) {
        val currentAccessContext = context.activeAccessContext
        AiChatDiagnosticsLogger.info(
            event = "conversation_bootstrap_superseded",
            fields = listOf(
                "workspaceId" to workspaceId,
                "expectedWorkspaceId" to expectedContext.workspaceId,
                "expectedCloudState" to expectedContext.cloudState.name,
                "currentWorkspaceId" to currentAccessContext?.workspaceId,
                "currentCloudState" to currentAccessContext?.cloudState?.name,
                "stage" to stage
            )
        )
    }

    private fun logBootstrapRetry(
        workspaceId: String,
        accessContext: AiAccessContext,
        retryCount: Int,
        error: Exception
    ) {
        val retryFields: List<Pair<String, String?>> = listOf(
            "workspaceId" to workspaceId,
            "cloudState" to accessContext.cloudState.name,
            "nextAttempt" to (retryCount + 2).toString(),
            "errorType" to error::class.java.name
        )
        AiChatDiagnosticsLogger.warn(
            event = "conversation_bootstrap_retrying",
            fields = retryFields + remoteErrorFields(error = error as? AiChatRemoteException)
        )
    }

    private suspend fun loadBootstrapRemoteResultWithRetry(
        workspaceId: String,
        persistedState: AiChatPersistedState,
        bootstrapProvisionalSessionId: String?,
        canLoadCurrentChat: Boolean,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        accessContext: AiAccessContext,
        bootstrapRequestToken: Long,
        bootstrapJob: Job?,
        onInitialProvisioningAttempted: () -> Unit,
        onInitialProvisioningCompleted: () -> Unit,
        onRemoteSessionProvisioned: (String) -> Unit
    ): AiBootstrapRemoteResult? {
        var retryCount: Int = 0
        while (true) {
            try {
                val preparedSession = context.aiChatRepository.prepareSessionForAi(workspaceId = workspaceId)
                if (
                    isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    ).not()
                ) {
                    logBootstrapSuperseded(
                        workspaceId = workspaceId,
                        expectedContext = accessContext,
                        stage = "prepare_session"
                    )
                    return null
                }

                val ensuredSession = resolveRemoteBootstrapSession(
                    context = context,
                    preparedSession = preparedSession,
                    persistedState = persistedState,
                    bootstrapProvisionalSessionId = bootstrapProvisionalSessionId,
                    onInitialProvisioningAttempted = onInitialProvisioningAttempted,
                    onInitialProvisioningCompleted = onInitialProvisioningCompleted,
                    onRemoteSessionProvisioned = onRemoteSessionProvisioned
                )
                if (
                    isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    ).not()
                ) {
                    logBootstrapSuperseded(
                        workspaceId = workspaceId,
                        expectedContext = accessContext,
                        stage = "ensure_session"
                    )
                    return null
                }

                // A chat the server already had loads as the current chat, so one started on another
                // device replaces it. A chat provisioned just now loads by id, so a reload never moves
                // back from a new local chat to an older one.
                val requestedSessionId = if (canLoadCurrentChat && ensuredSession.snapshot == null) {
                    null
                } else {
                    ensuredSession.sessionId
                }
                val bootstrap = context.aiChatRepository.loadBootstrapFromPreparedSession(
                    preparedSession = preparedSession,
                    sessionId = requestedSessionId,
                    limit = aiChatBootstrapPageLimit,
                    resumeDiagnostics = resumeDiagnostics
                )
                if (
                    isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    ).not()
                ) {
                    logBootstrapSuperseded(
                        workspaceId = workspaceId,
                        expectedContext = accessContext,
                        stage = "load_bootstrap"
                    )
                    return null
                }
                return AiBootstrapRemoteResult(
                    ensuredSession = ensuredSession,
                    requestedSessionId = requestedSessionId,
                    bootstrap = bootstrap
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (shouldRetryBootstrap(error = error, retryCount = retryCount).not()) {
                    throw error
                }
                logBootstrapRetry(
                    workspaceId = workspaceId,
                    accessContext = accessContext,
                    retryCount = retryCount,
                    error = error
                )
                delay(timeMillis = nextBootstrapRetryDelayMillis(retryCount = retryCount))
                retryCount += 1
                if (
                    isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    ).not()
                ) {
                    logBootstrapSuperseded(
                        workspaceId = workspaceId,
                        expectedContext = accessContext,
                        stage = "retry_delay"
                    )
                    return null
                }
            }
        }
    }

    suspend fun applyActiveBootstrap(response: AiChatBootstrapResponse, expectedSessionId: String) {
        applyBootstrap(
            response = response,
            expectedSessionId = expectedSessionId,
            preserveLocalComposerState = false,
            draftMove = null,
            canApplyBootstrap = { true }
        )
    }

    private suspend fun applyBootstrap(
        response: AiChatBootstrapResponse,
        expectedSessionId: String,
        preserveLocalComposerState: Boolean,
        draftMove: AiBootstrapDraftMove?,
        canApplyBootstrap: () -> Boolean
    ): Boolean {
        check(draftMove == null || preserveLocalComposerState.not()) {
            "AI bootstrap cannot both keep the live composer and move a draft into another chat."
        }
        val workspaceId = context.runtimeStateMutable.value.workspaceId
        validateBootstrapSession(
            workspaceId = workspaceId,
            expectedSessionId = expectedSessionId,
            response = response
        )
        val previousState = context.runtimeStateMutable.value
        val recoveredActiveRunHadToolCalls = snapshotRunHasToolCalls(
            activeRun = response.activeRun,
            messages = response.conversation.messages
        )
        val shouldPersistPendingToolRunPostSync =
            previousState.persistedState.pendingToolRunPostSync || recoveredActiveRunHadToolCalls
        val resolvedSessionId = resolveAiChatSessionIdForWorkspace(
            workspaceId = workspaceId,
            sessionId = response.sessionId
        ) ?: response.sessionId
        val resolvedConversationScopeId = resolveAiChatSessionIdForWorkspace(
            workspaceId = workspaceId,
            sessionId = response.conversationScopeId
        ) ?: resolvedSessionId
        val draftState = if (preserveLocalComposerState) {
            null
        } else {
            context.aiChatRepository.loadDraftState(
                workspaceId = workspaceId,
                sessionId = resolvedSessionId
            )
        }
        if (canApplyBootstrap().not()) {
            return false
        }
        var didApplyBootstrap: Boolean = false
        var didMoveDraft: Boolean = false
        var sourceStateToPreserve: AiChatRuntimeState? = null
        context.runtimeStateMutable.update { state ->
            if (canApplyBootstrap().not()) {
                return@update state
            }
            didApplyBootstrap = true
            // Installed with the switch itself, so the composer never shows the target's draft first.
            // An empty source never overwrites the target's stored draft.
            val movedDraft = draftMove?.let { move ->
                move.storedDraft ?: AiChatDraftState(
                    draftMessage = state.draftMessage,
                    pendingAttachments = state.pendingAttachments,
                    importRequest = state.importRequest
                )
            }?.takeIf { draft ->
                draftState?.importRequest == null && draft.importRequest == null &&
                    (draft.draftMessage.isNotBlank() || draft.pendingAttachments.isNotEmpty())
            }
            didMoveDraft = movedDraft != null
            if (draftMove != null && draftState?.importRequest != null && draftMove.storedDraft == null) {
                sourceStateToPreserve = state
            }
            val composerDraft = movedDraft ?: draftState?.forSession(workspaceId = workspaceId, sessionId = resolvedSessionId)
            updateComposerSuggestions(
                state = state.copy(
                    persistedState = state.persistedState.copy(
                        messages = response.conversation.messages,
                        chatSessionId = resolvedSessionId,
                        lastKnownChatConfig = response.chatConfig,
                        pendingToolRunPostSync = shouldPersistPendingToolRunPostSync
                    ),
                    conversationScopeId = resolvedConversationScopeId,
                    hasOlder = response.conversation.hasOlder,
                    oldestCursor = response.conversation.oldestCursor,
                    activeRun = response.activeRun,
                    runHadToolCalls = state.runHadToolCalls || recoveredActiveRunHadToolCalls,
                    isLiveAttached = false,
                    draftMessage = if (preserveLocalComposerState) {
                        state.draftMessage
                    } else {
                        composerDraft?.draftMessage ?: ""
                    },
                    pendingAttachments = if (preserveLocalComposerState) {
                        state.pendingAttachments
                    } else {
                        composerDraft?.pendingAttachments ?: emptyList()
                    },
                    importRequest = if (preserveLocalComposerState) {
                        state.importRequest
                    } else {
                        composerDraft?.importRequest
                    },
                    composerPhase = if (response.activeRun != null) {
                        AiComposerPhase.RUNNING
                    } else {
                        AiComposerPhase.IDLE
                    },
                    dictationState = if (preserveLocalComposerState) {
                        state.dictationState
                    } else {
                        com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState.IDLE
                    },
                    conversationBootstrapState = AiConversationBootstrapState.READY,
                    conversationBootstrapErrorPresentation = emptyAiBootstrapErrorPresentation(),
                    repairStatus = null,
                    activeAlert = null,
                    errorMessage = ""
                ),
                nextSuggestions = response.composerSuggestions
            )
        }
        if (didApplyBootstrap.not() || canApplyBootstrap().not()) {
            return false
        }
        if (draftMove != null && didMoveDraft) {
            // Before the post-run sync can suspend: the moved draft is written first, the shown chat's copy last.
            context.persistCurrentState()
            context.aiChatRepository.clearDraftState(
                workspaceId = workspaceId,
                sessionId = draftMove.shownSessionId
            )
        }
        sourceStateToPreserve?.let(context::persistDraft)
        if (response.activeRun == null && shouldPersistPendingToolRunPostSync) {
            context.triggerToolRunPostSyncIfNeeded(reason = "bootstrap_terminal")
        }
        if (canApplyBootstrap().not()) {
            return false
        }
        context.persistCurrentState()
        return true
    }

    private fun updateComposerSuggestions(
        state: AiChatRuntimeState,
        nextSuggestions: List<AiChatComposerSuggestion>
    ): AiChatRuntimeState {
        return state.copy(serverComposerSuggestions = nextSuggestions)
    }

    private fun validateBootstrapSession(
        workspaceId: String?,
        expectedSessionId: String,
        response: AiChatBootstrapResponse
    ) {
        val resolvedResponseSessionId = resolveAiChatSessionIdForWorkspace(
            workspaceId = workspaceId,
            sessionId = response.sessionId
        )
        if (resolvedResponseSessionId != expectedSessionId) {
            throw AiChatBootstrapSessionMismatchException(
                "AI bootstrap returned mismatched sessionId. workspaceId=$workspaceId expectedSessionId=$expectedSessionId responseSessionId=${response.sessionId}"
            )
        }

        val resolvedConversationScopeId = resolveAiChatSessionIdForWorkspace(
            workspaceId = workspaceId,
            sessionId = response.conversationScopeId
        )
        if (resolvedConversationScopeId != expectedSessionId) {
            throw AiChatBootstrapSessionMismatchException(
                "AI bootstrap returned mismatched conversationScopeId. workspaceId=$workspaceId expectedSessionId=$expectedSessionId responseSessionId=${response.sessionId} responseConversationScopeId=${response.conversationScopeId}"
            )
        }
    }

    private fun isSyncBlocked(): Boolean {
        val syncStatus = context.currentSyncStatus()
        return syncStatus is SyncStatus.Blocked
    }
}

internal class AiChatBootstrapBlockedException : IllegalStateException(
    "AI chat bootstrap is blocked by cloud sync status."
)

/** Moves the shown chat's unsent draft into the chat a bootstrap switches to. */
private data class AiBootstrapDraftMove(
    val shownSessionId: String,
    /** The shown chat's stored draft; null reads the live composer inside the switching update. */
    val storedDraft: AiChatDraftState?
)

private data class AiBootstrapRemoteResult(
    val ensuredSession: AiChatSessionProvisioningResult,
    /** Null when the request asked for the current chat instead of the shown one. */
    val requestedSessionId: String?,
    val bootstrap: AiChatBootstrapResponse
)
