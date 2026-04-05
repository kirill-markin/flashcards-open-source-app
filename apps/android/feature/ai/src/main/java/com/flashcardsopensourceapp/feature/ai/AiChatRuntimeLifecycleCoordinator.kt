package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class AiChatRuntimeLifecycleCoordinator(
    private val context: AiChatRuntimeContext,
    private val startConversationBootstrap: (Boolean, com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?) -> Unit,
    private val detachLiveStream: (String) -> Unit
) {
    fun updateAccessContext(accessContext: AiAccessContext) {
        context.activeAccessContext = accessContext
        context.activeSendJob?.cancel(
            cause = CancellationException("AI send cancelled because access context changed.")
        )
        context.activeLiveJob?.cancel(
            cause = CancellationException("AI live attach cancelled because access context changed.")
        )
        context.activeLiveJob = null
        if (context.activeBootstrapJob != null) {
            context.activeBootstrapJob?.cancel(
                cause = CancellationException("AI bootstrap cancelled because access context changed.")
            )
            context.activeBootstrapJob = null
        }
        if (context.activeWarmUpJob != null) {
            context.pendingWarmUpAfterWorkspaceSwitch = true
            AiChatDiagnosticsLogger.info(
                event = "switch_access_context_cancelling_warm_up",
                fields = listOf(
                    "nextWorkspaceId" to accessContext.workspaceId,
                    "currentWorkspaceId" to context.runtimeStateMutable.value.workspaceId,
                    "cloudState" to accessContext.cloudState.name
                )
            )
            context.activeWarmUpJob?.cancel(
                cause = CancellationException("AI warm-up cancelled because access context changed.")
            )
        } else {
            context.pendingWarmUpAfterWorkspaceSwitch = false
        }

        context.scope.launch {
            val persistedState = context.aiChatRepository.loadPersistedState(workspaceId = accessContext.workspaceId)
            context.runtimeStateMutable.value = makeAiDraftState(
                workspaceId = accessContext.workspaceId,
                persistedState = persistedState
            ).copy(
                conversationBootstrapState = if (
                    accessContext.workspaceId != null
                    && context.hasConsent()
                    && accessContext.cloudState != CloudAccountState.LINKING_READY
                ) {
                    AiConversationBootstrapState.LOADING
                } else {
                    AiConversationBootstrapState.READY
                }
            )
            context.persistCurrentState()
            if (accessContext.workspaceId == null) {
                return@launch
            }
            if (context.hasConsent().not()) {
                return@launch
            }
            if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
                return@launch
            }
            startConversationBootstrap(false, null)
        }
    }

    fun onScreenVisible() {
        context.isScreenVisible = true
        warmUpLinkedSessionIfNeeded(resumeDiagnostics = context.nextResumeDiagnostics())
    }

    fun onScreenHidden() {
        context.isScreenVisible = false
        detachLiveStream("AI live stream detached because the screen is no longer visible.")
    }

    fun warmUpLinkedSessionIfNeeded(
        resumeDiagnostics: com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?
    ) {
        val currentState = context.runtimeStateMutable.value
        val accessContext = context.activeAccessContext
        if (
            currentState.composerPhase == AiComposerPhase.PREPARING_SEND
            || currentState.composerPhase == AiComposerPhase.STARTING_RUN
        ) {
            return
        }
        if (context.hasConsent().not()) {
            return
        }
        if (accessContext?.workspaceId == null) {
            return
        }
        if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
            return
        }
        if (context.activeWarmUpJob != null) {
            return
        }

        var warmUpJob: Job? = null
        warmUpJob = context.scope.launch {
            try {
                startConversationBootstrap(false, resumeDiagnostics)
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "warm_up_cancelled",
                    fields = listOf(
                        "workspaceId" to accessContext.workspaceId,
                        "currentWorkspaceId" to context.runtimeStateMutable.value.workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "retryAfterWorkspaceSwitch" to context.pendingWarmUpAfterWorkspaceSwitch.toString(),
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                AiChatDiagnosticsLogger.error(
                    event = "warm_up_failed",
                    fields = listOf(
                        "workspaceId" to accessContext.workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "message" to error.message
                    ) + remoteErrorFields(error = error as? AiChatRemoteException),
                    throwable = error
                )
                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.CHAT,
                    configuration = context.currentServerConfiguration()
                )
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        activeAlert = AiAlertState.GeneralError(message = message),
                        errorMessage = ""
                    )
                }
            } finally {
                val shouldRetryWarmUp = context.pendingWarmUpAfterWorkspaceSwitch
                if (context.activeWarmUpJob === warmUpJob) {
                    context.activeWarmUpJob = null
                }
                if (shouldRetryWarmUp) {
                    context.pendingWarmUpAfterWorkspaceSwitch = false
                    warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
                }
            }
        }
        context.activeWarmUpJob = warmUpJob
    }
}
