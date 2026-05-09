package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedRemoteSession
import com.flashcardsopensourceapp.feature.ai.emptyAiBootstrapErrorPresentation
import java.io.IOException
import java.net.ConnectException
import java.net.MalformedURLException
import java.net.NoRouteToHostException
import java.net.ProtocolException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLProtocolException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlin.random.Random

private const val aiBootstrapMaxRetryCount: Int = 2
private const val aiBootstrapFirstRetryDelayMillis: Long = 300L
private const val aiBootstrapSecondRetryDelayMillis: Long = 900L
private const val aiBootstrapRetryJitterUpperBoundMillis: Long = 151L

internal class AiChatBootstrapCoordinator(
    private val context: AiChatRuntimeContext,
    private val attachBootstrapLiveStream: (
        String,
        AiChatBootstrapResponse,
        com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?
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
        return context.activeAccessContext?.runtimeKey() == expectedContext.runtimeKey()
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
        resumeDiagnostics: com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?
    ) {
        val accessContext = context.activeAccessContext ?: return
        val workspaceId = accessContext.workspaceId ?: return
        if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
            return
        }

        val bootstrapRequestToken = nextBootstrapRequestToken()
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
            val preBootstrapState = context.runtimeStateMutable.value
            try {
                val canPreserveLocalComposerState =
                    forceReloadState.not()
                        && context.runtimeStateMutable.value.composerPhase == AiComposerPhase.IDLE
                        && context.runtimeStateMutable.value.conversationBootstrapState == AiConversationBootstrapState.READY
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
                            serverComposerSuggestions = emptyList(),
                            composerPhase = AiComposerPhase.IDLE,
                            dictationState = com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE,
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
                            dictationState = com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE,
                            conversationBootstrapState = AiConversationBootstrapState.LOADING,
                            conversationBootstrapErrorPresentation = emptyAiBootstrapErrorPresentation(),
                            repairStatus = null,
                            activeAlert = null,
                            errorMessage = ""
                        )
                    }
                }

                val blockedSyncMessage = syncBlockedMessageOrNull()
                if (blockedSyncMessage != null) {
                    throw AiChatBootstrapBlockedException(blockedSyncMessage)
                }

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
                    return@launch
                }

                val remoteBootstrap = loadBootstrapRemoteResultWithRetry(
                    preparedSession = preparedSession,
                    persistedState = persistedState,
                    bootstrapProvisionalSessionId = bootstrapProvisionalSessionId,
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
                val didApplyBootstrap = applyBootstrap(
                    response = remoteBootstrap.bootstrap,
                    expectedSessionId = ensuredSession.sessionId,
                    preserveLocalComposerState = canPreserveLocalComposerState,
                    canApplyBootstrap = {
                        isCurrentBootstrapRequest(
                            expectedContext = accessContext,
                            expectedRequestToken = bootstrapRequestToken,
                            expectedJob = bootstrapJob
                        )
                            && canApplyBootstrapResult(
                                workspaceId = workspaceId,
                                sessionId = ensuredSession.sessionId
                            )
                    }
                )
                if (didApplyBootstrap.not()) {
                    return@launch
                }
                if (
                    isCurrentBootstrapRequest(
                        expectedContext = accessContext,
                        expectedRequestToken = bootstrapRequestToken,
                        expectedJob = bootstrapJob
                    ).not()
                    || canApplyBootstrapResult(
                        workspaceId = workspaceId,
                        sessionId = ensuredSession.sessionId
                    ).not()
                ) {
                    return@launch
                }
                attachBootstrapLiveStream(workspaceId, remoteBootstrap.bootstrap, resumeDiagnostics)
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "conversation_bootstrap_cancelled",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "message" to error.message
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
                AiChatDiagnosticsLogger.error(
                    event = "conversation_bootstrap_failed",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "userFacingMessage" to presentation.message
                    ) + remoteErrorFields(error = error as? AiChatRemoteException),
                    throwable = error
                )
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
                val shouldPreserveConversationState = shouldPreserveConversationStateOnBootstrapFailure(
                    error = error,
                    forceReloadState = forceReloadState,
                    preBootstrapState = preBootstrapState,
                    workspaceId = workspaceId,
                    persistedState = persistedState
                )
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
                        serverComposerSuggestions = emptyList(),
                        composerPhase = AiComposerPhase.IDLE,
                        dictationState = com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE,
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
            "errorType" to error::class.java.name,
            "message" to error.message
        )
        AiChatDiagnosticsLogger.warn(
            event = "conversation_bootstrap_retrying",
            fields = retryFields + remoteErrorFields(error = error as? AiChatRemoteException)
        )
    }

    private suspend fun loadBootstrapRemoteResultWithRetry(
        preparedSession: AiChatPreparedRemoteSession,
        persistedState: com.flashcardsopensourceapp.data.local.model.AiChatPersistedState,
        bootstrapProvisionalSessionId: String?,
        resumeDiagnostics: com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?,
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
                val ensuredSession = resolveRemoteBootstrapSession(
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
                        workspaceId = preparedSession.workspaceId,
                        expectedContext = accessContext,
                        stage = "ensure_session"
                    )
                    return null
                }

                val bootstrap = context.aiChatRepository.loadBootstrapFromPreparedSession(
                    preparedSession = preparedSession,
                    sessionId = ensuredSession.sessionId,
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
                        workspaceId = preparedSession.workspaceId,
                        expectedContext = accessContext,
                        stage = "load_bootstrap"
                    )
                    return null
                }
                return AiBootstrapRemoteResult(
                    ensuredSession = ensuredSession,
                    bootstrap = bootstrap
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (shouldRetryBootstrap(error = error, retryCount = retryCount).not()) {
                    throw error
                }
                logBootstrapRetry(
                    workspaceId = preparedSession.workspaceId,
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
                        workspaceId = preparedSession.workspaceId,
                        expectedContext = accessContext,
                        stage = "retry_delay"
                    )
                    return null
                }
            }
        }
    }

    private suspend fun resolveRemoteBootstrapSession(
        preparedSession: AiChatPreparedRemoteSession,
        persistedState: com.flashcardsopensourceapp.data.local.model.AiChatPersistedState,
        bootstrapProvisionalSessionId: String?,
        onInitialProvisioningAttempted: () -> Unit,
        onInitialProvisioningCompleted: () -> Unit,
        onRemoteSessionProvisioned: (String) -> Unit
    ): AiChatSessionProvisioningResult {
        val normalizedSessionId = persistedState.chatSessionId.trim().ifEmpty { null }
        if (normalizedSessionId != null && persistedState.requiresRemoteSessionProvisioning.not()) {
            return AiChatSessionProvisioningResult(
                sessionId = normalizedSessionId,
                snapshot = null
            )
        }

        val targetSessionId = normalizedSessionId ?: requireNotNull(bootstrapProvisionalSessionId) {
            "AI bootstrap requires a provisional session id when persisted session id is blank."
        }
        if (normalizedSessionId == null) {
            onInitialProvisioningAttempted()
        }
        val snapshot = createNewAiChatSessionFromPreparedSession(
            preparedSession = preparedSession,
            targetSessionId = targetSessionId
        )
        onRemoteSessionProvisioned(targetSessionId)
        if (normalizedSessionId == null) {
            onInitialProvisioningCompleted()
        }
        return AiChatSessionProvisioningResult(
            sessionId = targetSessionId,
            snapshot = snapshot
        )
    }

    private suspend fun createNewAiChatSessionFromPreparedSession(
        preparedSession: AiChatPreparedRemoteSession,
        targetSessionId: String
    ): AiChatSessionSnapshot {
        val snapshot = context.aiChatRepository.createNewSessionFromPreparedSession(
            preparedSession = preparedSession,
            sessionId = targetSessionId,
            uiLocale = context.currentUiLocaleTag()
        )
        if (snapshot.sessionId != targetSessionId) {
            throw IllegalStateException(
                "AI chat session provisioning returned mismatched sessionId. " +
                    "expected=$targetSessionId actual=${snapshot.sessionId}"
            )
        }
        return snapshot
    }

    suspend fun applyActiveBootstrap(response: AiChatBootstrapResponse, expectedSessionId: String) {
        applyBootstrap(
            response = response,
            expectedSessionId = expectedSessionId,
            preserveLocalComposerState = false,
            canApplyBootstrap = { true }
        )
    }

    private suspend fun applyBootstrap(
        response: AiChatBootstrapResponse,
        expectedSessionId: String,
        preserveLocalComposerState: Boolean,
        canApplyBootstrap: () -> Boolean
    ): Boolean {
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
        context.runtimeStateMutable.update { state ->
            if (canApplyBootstrap().not()) {
                return@update state
            }
            didApplyBootstrap = true
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
                        draftState?.draftMessage ?: ""
                    },
                    pendingAttachments = if (preserveLocalComposerState) {
                        state.pendingAttachments
                    } else {
                        draftState?.pendingAttachments ?: emptyList()
                    },
                    composerPhase = if (response.activeRun != null) {
                        AiComposerPhase.RUNNING
                    } else {
                        AiComposerPhase.IDLE
                    },
                    dictationState = if (preserveLocalComposerState) {
                        state.dictationState
                    } else {
                        com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE
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
        nextSuggestions: List<com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion>
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

    private fun syncBlockedMessageOrNull(): String? {
        val syncStatus = context.currentSyncStatus()
        return if (syncStatus is SyncStatus.Blocked) {
            syncStatus.message
        } else {
            null
        }
    }
}

internal class AiChatBootstrapBlockedException(message: String) : IllegalStateException(message)

private class AiChatBootstrapSessionMismatchException(message: String) : IllegalStateException(message)

private data class AiBootstrapRemoteResult(
    val ensuredSession: AiChatSessionProvisioningResult,
    val bootstrap: AiChatBootstrapResponse
)

private fun shouldPreserveConversationStateOnBootstrapFailure(
    error: Exception,
    forceReloadState: Boolean,
    preBootstrapState: AiChatRuntimeState,
    workspaceId: String,
    persistedState: AiChatPersistedState
): Boolean {
    if (isConversationPreservableBootstrapFailure(error = error).not()) {
        return false
    }
    if (forceReloadState) {
        return false
    }
    if (preBootstrapState.workspaceId != workspaceId) {
        return false
    }
    val preBootstrapSessionId = resolveAiChatSessionIdForWorkspace(
        workspaceId = workspaceId,
        sessionId = preBootstrapState.persistedState.chatSessionId
    )
    val targetSessionId = resolveAiChatSessionIdForWorkspace(
        workspaceId = workspaceId,
        sessionId = persistedState.chatSessionId
    )
    return preBootstrapSessionId != null && preBootstrapSessionId == targetSessionId
}

private fun freshSessionDraftToPreserveOnBootstrapFailure(
    forceReloadState: Boolean,
    preBootstrapState: AiChatRuntimeState,
    workspaceId: String,
    failureSessionId: String
): AiChatDraftState? {
    if (forceReloadState.not()) {
        return null
    }
    if (preBootstrapState.workspaceId != workspaceId) {
        return null
    }
    if (preBootstrapState.persistedState.requiresRemoteSessionProvisioning.not()) {
        return null
    }
    if (preBootstrapState.persistedState.messages.isNotEmpty()) {
        return null
    }
    val preBootstrapSessionId = resolveAiChatSessionIdForWorkspace(
        workspaceId = workspaceId,
        sessionId = preBootstrapState.persistedState.chatSessionId
    )
    val targetSessionId = resolveAiChatSessionIdForWorkspace(
        workspaceId = workspaceId,
        sessionId = failureSessionId
    )
    if (preBootstrapSessionId == null || preBootstrapSessionId != targetSessionId) {
        return null
    }
    if (preBootstrapState.draftMessage.isBlank() && preBootstrapState.pendingAttachments.isEmpty()) {
        return null
    }
    return AiChatDraftState(
        draftMessage = preBootstrapState.draftMessage,
        pendingAttachments = preBootstrapState.pendingAttachments
    )
}

private fun isConversationPreservableBootstrapFailure(error: Exception): Boolean {
    return error is AiChatBootstrapSessionMismatchException ||
        error::class.java.name == "com.flashcardsopensourceapp.data.local.cloud.CloudContractMismatchException"
}

internal fun shouldRetryBootstrap(error: Exception, retryCount: Int): Boolean {
    if (retryCount >= aiBootstrapMaxRetryCount) {
        return false
    }
    val remoteError = error as? AiChatRemoteException
    if (remoteError != null) {
        return shouldRetryRemoteBootstrapError(error = remoteError)
    }
    return error is IOException && isLikelyTransientBootstrapIoException(error = error)
}

private fun isLikelyTransientBootstrapIoException(error: IOException): Boolean {
    if (error is MalformedURLException || error is ProtocolException) {
        return false
    }
    if (
        error is SSLHandshakeException ||
        error is SSLPeerUnverifiedException ||
        error is SSLProtocolException
    ) {
        return false
    }
    if (
        error is SocketTimeoutException ||
        error is ConnectException ||
        error is UnknownHostException ||
        error is NoRouteToHostException ||
        error is SocketException
    ) {
        return true
    }
    if (error is SSLException) {
        return isTransportLikeSslException(error = error)
    }
    return hasTransientTransportMessage(error = error)
}

private fun isTransportLikeSslException(error: SSLException): Boolean {
    if (hasTransientTransportCause(error = error)) {
        return true
    }
    return hasTransientTransportMessage(error = error)
}

private fun hasTransientTransportMessage(error: Throwable): Boolean {
    val message = error.message?.lowercase() ?: return false
    val transportMessageFragments: List<String> = listOf(
        "connection reset",
        "connection closed",
        "connection abort",
        "broken pipe",
        "socket closed",
        "read error",
        "write error",
        "timed out",
        "timeout"
    )
    return transportMessageFragments.any { fragment -> message.contains(fragment) }
}

private fun hasTransientTransportCause(error: Throwable): Boolean {
    var currentCause: Throwable? = error.cause
    while (currentCause != null) {
        if (
            currentCause is SSLHandshakeException ||
            currentCause is SSLPeerUnverifiedException ||
            currentCause is SSLProtocolException
        ) {
            return false
        }
        if (
            currentCause is SocketTimeoutException ||
            currentCause is ConnectException ||
            currentCause is UnknownHostException ||
            currentCause is NoRouteToHostException ||
            currentCause is SocketException
        ) {
            return true
        }
        currentCause = currentCause.cause
    }
    return false
}

internal suspend fun createNewAiChatSessionWithBootstrapRetry(
    context: AiChatRuntimeContext,
    workspaceId: String?,
    targetSessionId: String,
    retryEvent: String
): AiChatSessionSnapshot {
    val preparedSession = context.aiChatRepository.prepareSessionForAi(workspaceId = workspaceId)
    var retryCount: Int = 0
    while (true) {
        try {
            return createNewAiChatSessionFromPreparedSessionOnce(
                context = context,
                preparedSession = preparedSession,
                targetSessionId = targetSessionId
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (shouldRetryBootstrap(error = error, retryCount = retryCount).not()) {
                throw error
            }
            logAiChatSessionProvisioningRetry(
                context = context,
                workspaceId = workspaceId,
                targetSessionId = targetSessionId,
                retryCount = retryCount,
                retryEvent = retryEvent,
                error = error
            )
            delay(timeMillis = nextBootstrapRetryDelayMillis(retryCount = retryCount))
            retryCount += 1
        }
    }
}

internal suspend fun createNewAiChatSessionOnce(
    context: AiChatRuntimeContext,
    workspaceId: String?,
    targetSessionId: String
): AiChatSessionSnapshot {
    val snapshot = context.aiChatRepository.createNewSession(
        workspaceId = workspaceId,
        sessionId = targetSessionId,
        uiLocale = context.currentUiLocaleTag()
    )
    if (snapshot.sessionId != targetSessionId) {
        throw IllegalStateException(
            "AI chat session provisioning returned mismatched sessionId. " +
                "expected=$targetSessionId actual=${snapshot.sessionId}"
        )
    }
    return snapshot
}

private suspend fun createNewAiChatSessionFromPreparedSessionOnce(
    context: AiChatRuntimeContext,
    preparedSession: AiChatPreparedRemoteSession,
    targetSessionId: String
): AiChatSessionSnapshot {
    val snapshot = context.aiChatRepository.createNewSessionFromPreparedSession(
        preparedSession = preparedSession,
        sessionId = targetSessionId,
        uiLocale = context.currentUiLocaleTag()
    )
    if (snapshot.sessionId != targetSessionId) {
        throw IllegalStateException(
            "AI chat session provisioning returned mismatched sessionId. " +
                "expected=$targetSessionId actual=${snapshot.sessionId}"
        )
    }
    return snapshot
}

private fun logAiChatSessionProvisioningRetry(
    context: AiChatRuntimeContext,
    workspaceId: String?,
    targetSessionId: String,
    retryCount: Int,
    retryEvent: String,
    error: Exception
) {
    val retryFields: List<Pair<String, String?>> = listOf(
        "workspaceId" to workspaceId,
        "cloudState" to context.currentCloudState().name,
        "chatSessionId" to targetSessionId,
        "nextAttempt" to (retryCount + 2).toString(),
        "errorType" to error::class.java.name,
        "message" to error.message
    )
    AiChatDiagnosticsLogger.warn(
        event = retryEvent,
        fields = retryFields + remoteErrorFields(error = error as? AiChatRemoteException)
    )
}

private fun shouldRetryRemoteBootstrapError(error: AiChatRemoteException): Boolean {
    val statusCode = error.statusCode ?: return false
    return statusCode == 408 || statusCode == 429 || statusCode in 500..599
}

private fun nextBootstrapRetryDelayMillis(retryCount: Int): Long {
    val baseDelayMillis = if (retryCount == 0) {
        aiBootstrapFirstRetryDelayMillis
    } else {
        aiBootstrapSecondRetryDelayMillis
    }
    return baseDelayMillis + Random.nextLong(
        from = 0L,
        until = aiBootstrapRetryJitterUpperBoundMillis
    )
}
