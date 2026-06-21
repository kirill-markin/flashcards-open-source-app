package com.flashcardsopensourceapp.feature.ai.runtime.coordinators.session

import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.ai.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.ai.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.AiChatPreparedRemoteSession
import com.flashcardsopensourceapp.feature.ai.emptyAiBootstrapErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.AiChatRuntimeContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAiChatSessionId
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.isRetryableBootstrapFailure
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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class AiChatSessionCoordinator(
    private val context: AiChatRuntimeContext,
    private val detachLiveStream: (String) -> Unit,
    private val cancelActiveDictation: (String) -> Unit
) {
    fun startFreshConversation(
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>,
        shouldFocusComposer: Boolean
    ) {
        cancelActiveDictation("AI dictation cancelled because a new chat was requested.")
        val currentState = context.runtimeStateMutable.value
        context.persistDraft(snapshot = currentState)
        val targetSessionId = makeAiChatSessionId()
        context.lastBootstrapFailureRetryable = false
        context.runtimeStateMutable.update { state ->
            state.copy(
                persistedState = state.persistedState.copy(
                    messages = emptyList(),
                    chatSessionId = targetSessionId,
                    pendingToolRunPostSync = false,
                    requiresRemoteSessionProvisioning = true
                ),
                conversationScopeId = targetSessionId,
                hasOlder = false,
                oldestCursor = null,
                activeRun = null,
                runHadToolCalls = false,
                isLiveAttached = false,
                draftMessage = draftMessage,
                pendingAttachments = pendingAttachments,
                focusComposerRequestVersion = if (shouldFocusComposer) {
                    state.focusComposerRequestVersion + 1L
                } else {
                    state.focusComposerRequestVersion
                },
                serverComposerSuggestions = emptyList(),
                composerPhase = AiComposerPhase.IDLE,
                dictationState = AiChatDictationState.IDLE,
                conversationBootstrapState = AiConversationBootstrapState.READY,
                conversationBootstrapErrorPresentation = emptyAiBootstrapErrorPresentation(),
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        context.persistCurrentState()
        initializeFreshConversation(
            workspaceId = currentState.workspaceId,
            targetSessionId = targetSessionId
        )
    }

    fun canApplySessionScopedResult(targetSessionId: String): Boolean {
        val state = context.runtimeStateMutable.value
        return state.persistedState.chatSessionId == targetSessionId
    }

    suspend fun ensureSessionIdIfNeeded(): AiChatSessionProvisioningResult {
        return ensureSessionIdIfNeeded(
            preparedSession = null,
            persistEnsuredSessionState = {
                context.persistCurrentState()
            }
        )
    }

    suspend fun ensureSessionIdIfNeededPreservingDraft(
        draftState: AiChatDraftState,
        preparedSession: AiChatPreparedRemoteSession?
    ): AiChatSessionProvisioningResult {
        return ensureSessionIdIfNeeded(
            preparedSession = preparedSession,
            persistEnsuredSessionState = {
                context.persistCurrentStatePreservingDraft(draftState = draftState)
            }
        )
    }

    private suspend fun ensureSessionIdIfNeeded(
        preparedSession: AiChatPreparedRemoteSession?,
        persistEnsuredSessionState: () -> Unit
    ): AiChatSessionProvisioningResult {
        var currentState: AiChatRuntimeState = context.runtimeStateMutable.value
        var currentSessionId: String = currentState.persistedState.chatSessionId
        if (
            currentSessionId.isNotBlank()
            && currentState.persistedState.requiresRemoteSessionProvisioning
        ) {
            cancelActiveFreshSessionProvisioningIfNeeded(targetSessionId = currentSessionId)
        } else if (currentSessionId.isNotBlank()) {
            awaitActiveFreshSessionProvisioningIfNeeded(targetSessionId = currentSessionId)
        }
        currentState = context.runtimeStateMutable.value
        currentSessionId = currentState.persistedState.chatSessionId
        if (
            currentSessionId.isNotBlank()
            && currentState.persistedState.requiresRemoteSessionProvisioning
        ) {
            val snapshot = createSessionSnapshotForSend(
                preparedSession = preparedSession,
                currentState = currentState,
                targetSessionId = currentSessionId
            )
            var didApplyProvisionedSession: Boolean = false
            context.runtimeStateMutable.update { state ->
                if (
                    state.workspaceId != currentState.workspaceId
                    || state.persistedState.chatSessionId != currentSessionId
                ) {
                    return@update state
                }
                didApplyProvisionedSession = true
                updateComposerSuggestions(
                    state = state.copy(
                        persistedState = state.persistedState.copy(
                            lastKnownChatConfig = snapshot.chatConfig,
                            requiresRemoteSessionProvisioning = false
                        ),
                        conversationScopeId = snapshot.conversationScopeId,
                        activeAlert = null,
                        errorMessage = ""
                    ),
                    nextSuggestions = snapshot.composerSuggestions
                )
            }
            if (didApplyProvisionedSession.not()) {
                throw CancellationException("AI pending session provisioning was superseded.")
            }
            persistEnsuredSessionState()
            context.lastBootstrapFailureRetryable = false
            return AiChatSessionProvisioningResult(
                sessionId = currentSessionId,
                snapshot = snapshot
            )
        }
        if (currentSessionId.isNotBlank()) {
            return AiChatSessionProvisioningResult(
                sessionId = currentSessionId,
                snapshot = null
            )
        }
        if (preparedSession != null) {
            return ensureNewSessionFromPreparedSession(
                preparedSession = preparedSession,
                currentState = currentState,
                persistEnsuredSessionState = persistEnsuredSessionState
            )
        }
        val ensuredSession = context.aiChatRepository.ensureSessionId(
            workspaceId = currentState.workspaceId,
            persistedState = currentState.persistedState,
            provisionalSessionId = null,
            uiLocale = context.currentUiLocaleTag()
        )
        val ensuredSnapshot = ensuredSession.snapshot
        if (ensuredSnapshot != null) {
            context.runtimeStateMutable.update { state ->
                if (state.persistedState.chatSessionId.isNotBlank()) {
                    return@update state
                }
                updateComposerSuggestions(
                    state = state.copy(
                        persistedState = state.persistedState.copy(
                            chatSessionId = ensuredSession.sessionId,
                            lastKnownChatConfig = ensuredSnapshot.chatConfig,
                            requiresRemoteSessionProvisioning = false
                        ),
                        conversationScopeId = ensuredSnapshot.conversationScopeId,
                        activeAlert = null,
                        errorMessage = ""
                    ),
                    nextSuggestions = ensuredSnapshot.composerSuggestions
                )
            }
            persistEnsuredSessionState()
            context.lastBootstrapFailureRetryable = false
        }
        return ensuredSession
    }

    private suspend fun createSessionSnapshotForSend(
        preparedSession: AiChatPreparedRemoteSession?,
        currentState: AiChatRuntimeState,
        targetSessionId: String
    ): AiChatSessionSnapshot {
        if (preparedSession != null) {
            return createNewAiChatSessionFromPreparedSessionOnce(
                context = context,
                preparedSession = preparedSession,
                targetSessionId = targetSessionId
            )
        }
        return createNewAiChatSessionOnce(
            context = context,
            workspaceId = currentState.workspaceId,
            targetSessionId = targetSessionId
        )
    }

    private suspend fun ensureNewSessionFromPreparedSession(
        preparedSession: AiChatPreparedRemoteSession,
        currentState: AiChatRuntimeState,
        persistEnsuredSessionState: () -> Unit
    ): AiChatSessionProvisioningResult {
        val ensuredSessionId = context.aiChatRepository.makeExplicitSessionId()
        val snapshot = createNewAiChatSessionFromPreparedSessionOnce(
            context = context,
            preparedSession = preparedSession,
            targetSessionId = ensuredSessionId
        )
        var didApplyEnsuredSession: Boolean = false
        context.runtimeStateMutable.update { state ->
            if (
                state.workspaceId != currentState.workspaceId
                || state.persistedState.chatSessionId.isNotBlank()
            ) {
                return@update state
            }
            didApplyEnsuredSession = true
            updateComposerSuggestions(
                state = state.copy(
                    persistedState = state.persistedState.copy(
                        chatSessionId = ensuredSessionId,
                        lastKnownChatConfig = snapshot.chatConfig,
                        requiresRemoteSessionProvisioning = false
                    ),
                    conversationScopeId = snapshot.conversationScopeId,
                    activeAlert = null,
                    errorMessage = ""
                ),
                nextSuggestions = snapshot.composerSuggestions
            )
        }
        if (didApplyEnsuredSession.not()) {
            throw CancellationException("AI session provisioning was superseded.")
        }
        persistEnsuredSessionState()
        context.lastBootstrapFailureRetryable = false
        return AiChatSessionProvisioningResult(
            sessionId = ensuredSessionId,
            snapshot = snapshot
        )
    }

    private suspend fun awaitActiveFreshSessionProvisioningIfNeeded(targetSessionId: String) {
        val activeFreshSessionJob = context.activeFreshSessionJob
        if (activeFreshSessionJob?.isActive != true) {
            return
        }
        if (context.activeFreshSessionTargetSessionId != targetSessionId) {
            return
        }
        activeFreshSessionJob.join()
    }

    private fun cancelActiveFreshSessionProvisioningIfNeeded(targetSessionId: String) {
        if (context.activeFreshSessionTargetSessionId != targetSessionId) {
            return
        }
        val activeFreshSessionJob = context.activeFreshSessionJob
        if (activeFreshSessionJob?.isActive == true) {
            activeFreshSessionJob.cancel(
                cause = CancellationException(
                    "AI fresh session creation cancelled because a user action is provisioning the session."
                )
            )
        }
        context.activeFreshSessionJob = null
        context.activeFreshSessionTargetSessionId = null
    }

    private fun initializeFreshConversation(
        workspaceId: String?,
        targetSessionId: String
    ) {
        context.activeFreshSessionJob?.cancel(
            cause = CancellationException("AI fresh session creation cancelled because a newer reset was requested.")
        )
        context.activeFreshSessionTargetSessionId = targetSessionId
        context.activeSendJob?.cancel(
            cause = CancellationException("AI send cancelled because a new chat was requested.")
        )
        context.activeSendJob = null
        context.activeBootstrapJob?.cancel(
            cause = CancellationException("AI bootstrap cancelled because a new chat was requested.")
        )
        context.activeBootstrapJob = null
        context.activeWarmUpJob?.cancel(
            cause = CancellationException("AI warm-up cancelled because a new chat was requested.")
        )
        context.activeWarmUpJob = null
        detachLiveStream("AI live stream detached because a new chat was requested.")
        var freshSessionJob: Job? = null
        freshSessionJob = context.scope.launch {
            try {
                val snapshot = createNewAiChatSessionWithBootstrapRetry(
                    context = context,
                    workspaceId = workspaceId,
                    targetSessionId = targetSessionId,
                    retryEvent = "new_chat_session_retrying"
                )
                if (context.activeFreshSessionJob !== freshSessionJob) {
                    return@launch
                }
                if (
                    context.runtimeStateMutable.value.workspaceId != workspaceId
                    || canApplySessionScopedResult(targetSessionId = targetSessionId).not()
                ) {
                    return@launch
                }
                context.lastBootstrapFailureRetryable = false
                context.runtimeStateMutable.update { state ->
                    updateComposerSuggestions(
                        state = state.copy(
                            workspaceId = workspaceId,
                            persistedState = state.persistedState.copy(
                                lastKnownChatConfig = snapshot.chatConfig,
                                requiresRemoteSessionProvisioning = false
                            ),
                            conversationScopeId = snapshot.conversationScopeId,
                            activeAlert = null,
                            errorMessage = ""
                        ),
                        nextSuggestions = snapshot.composerSuggestions
                    )
                }
                context.persistCurrentState()
            } catch (error: CancellationException) {
                context.observability.recordAiChatBreadcrumb(
                    breadcrumb = AiChatBreadcrumb.NewChatCancelled(
                        workspaceId = context.runtimeStateMutable.value.workspaceId,
                        cloudState = currentCloudState().name,
                        chatSessionId = context.runtimeStateMutable.value.persistedState.chatSessionId,
                        message = error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                if (context.activeFreshSessionJob !== freshSessionJob) {
                    return@launch
                }
                handleNewChatFailure(
                    workspaceId = workspaceId,
                    targetSessionId = targetSessionId,
                    error = error
                )
            } finally {
                if (context.activeFreshSessionJob === freshSessionJob) {
                    context.activeFreshSessionJob = null
                    context.activeFreshSessionTargetSessionId = null
                }
            }
        }
        context.activeFreshSessionJob = freshSessionJob
    }

    private fun handleNewChatFailure(
        workspaceId: String?,
        targetSessionId: String,
        error: Exception
    ) {
        if (
            context.runtimeStateMutable.value.workspaceId != workspaceId
            || canApplySessionScopedResult(targetSessionId = targetSessionId).not()
        ) {
            return
        }
        val remoteError = error as? AiChatRemoteException
        val presentation = makeAiBootstrapErrorPresentation(
            error = error,
            configuration = currentServerConfiguration(),
            textProvider = context.textProvider
        )
        context.lastBootstrapFailureRetryable = isRetryableBootstrapFailure(error = error)

        when (aiChatFailureIssueDisposition(error = error)) {
            AiChatFailureIssueDisposition.NONE -> Unit
            AiChatFailureIssueDisposition.WARNING -> {
                context.observability.recordAiChatWarning(
                    warning = AiChatWarning.NewChatFailureHandled(
                        workspaceId = context.runtimeStateMutable.value.workspaceId,
                        cloudState = currentCloudState().name,
                        chatSessionId = context.runtimeStateMutable.value.persistedState.chatSessionId,
                        messageCount = context.runtimeStateMutable.value.persistedState.messages.size,
                        remoteError = aiChatRemoteErrorDetails(error = remoteError),
                        message = aiChatFailureWarningMessage(error = error)
                    )
                )
            }
            AiChatFailureIssueDisposition.EXCEPTION -> {
                context.observability.recordAiChatException(
                    exception = AiChatExceptionEvent.NewChatFailureHandled(
                        workspaceId = context.runtimeStateMutable.value.workspaceId,
                        cloudState = currentCloudState().name,
                        chatSessionId = context.runtimeStateMutable.value.persistedState.chatSessionId,
                        messageCount = context.runtimeStateMutable.value.persistedState.messages.size,
                        userFacingMessage = presentation.message,
                        remoteError = aiChatRemoteErrorDetails(error = remoteError),
                        error = error
                    )
                )
            }
        }

        context.runtimeStateMutable.update { state ->
            state.copy(
                conversationBootstrapState = AiConversationBootstrapState.FAILED,
                conversationBootstrapErrorPresentation = presentation,
                activeAlert = null,
                errorMessage = ""
            )
        }
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
