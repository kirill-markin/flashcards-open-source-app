package com.flashcardsopensourceapp.feature.ai.runtime

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
    private val detachLiveStream: (String) -> Unit,
    private val cancelActiveDictation: (String) -> Unit
) {
    fun updateAccessContext(accessContext: AiAccessContext) {
        val previousAccessContext = context.activeAccessContext
        context.activeAccessContext = accessContext
        if (previousAccessContext?.runtimeKey() == accessContext.runtimeKey()) {
            retryBootstrapIfLoadingWithoutOwner(accessContext = accessContext)
            return
        }
        cancelActiveDictation("AI dictation cancelled because access context changed.")
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
        if (context.activeFreshSessionJob != null) {
            context.activeFreshSessionJob?.cancel(
                cause = CancellationException("AI fresh session creation cancelled because access context changed.")
            )
            context.activeFreshSessionJob = null
            context.activeFreshSessionTargetSessionId = null
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
            val persistedState = normalizeAiChatPersistedStateForWorkspace(
                workspaceId = accessContext.workspaceId,
                persistedState = context.aiChatRepository.loadPersistedState(workspaceId = accessContext.workspaceId)
            )
            val currentState = context.runtimeStateMutable.value
            val persistedSessionId = resolveAiChatSessionIdForWorkspace(
                workspaceId = accessContext.workspaceId,
                sessionId = persistedState.chatSessionId
            )
            val draftState = context.aiChatRepository.loadDraftState(
                workspaceId = accessContext.workspaceId,
                sessionId = persistedSessionId
            )
            val nextState = makeAiDraftState(
                workspaceId = accessContext.workspaceId,
                persistedState = persistedState
            ).copy(
                draftMessage = draftState.draftMessage,
                pendingAttachments = draftState.pendingAttachments,
                conversationBootstrapState = if (accessContext.workspaceId == null) {
                    AiConversationBootstrapState.LOADING
                } else if (shouldBootstrapConversation(
                        accessContext = accessContext,
                        hasConsent = context.hasConsent()
                    )
                ) {
                    AiConversationBootstrapState.LOADING
                } else {
                    AiConversationBootstrapState.READY
                }
            )

            context.runtimeStateMutable.value = nextState
            context.persistCurrentState()
            if (accessContext.workspaceId == null) {
                return@launch
            }
            if (shouldPrepareGuestAccess(
                    accessContext = accessContext,
                    hasConsent = context.hasConsent()
                )
            ) {
                prepareGuestAccessIfNeeded(accessContext = accessContext)
                return@launch
            }
            if (shouldBootstrapConversation(
                    accessContext = accessContext,
                    hasConsent = context.hasConsent()
                ).not()
            ) {
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
                if (shouldPrepareGuestAccess(
                        accessContext = accessContext,
                        hasConsent = context.hasConsent()
                    )
                ) {
                    context.aiChatRepository.prepareSessionForAi(workspaceId = accessContext.workspaceId)
                } else if (shouldBootstrapConversation(
                        accessContext = accessContext,
                        hasConsent = context.hasConsent()
                    )
                ) {
                    startConversationBootstrap(false, resumeDiagnostics)
                }
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
                    configuration = context.currentServerConfiguration(),
                    textProvider = context.textProvider
                )
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        activeAlert = context.textProvider.generalError(message = message),
                        errorMessage = ""
                    )
                }
            } finally {
                val shouldRetryWarmUp = shouldRetryWarmUpAfterWorkspaceSwitch()
                if (context.activeWarmUpJob === warmUpJob) {
                    context.activeWarmUpJob = null
                }
                if (context.pendingWarmUpAfterWorkspaceSwitch) {
                    context.pendingWarmUpAfterWorkspaceSwitch = false
                }
                if (shouldRetryWarmUp) {
                    warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
                }
            }
        }
        context.activeWarmUpJob = warmUpJob
    }

    private fun retryBootstrapIfLoadingWithoutOwner(accessContext: AiAccessContext) {
        val currentState = context.runtimeStateMutable.value
        if (
            currentState.workspaceId != accessContext.workspaceId ||
            currentState.conversationBootstrapState != AiConversationBootstrapState.LOADING
        ) {
            return
        }
        if (context.activeBootstrapJob != null || context.activeWarmUpJob != null) {
            return
        }
        if (shouldBootstrapConversation(accessContext = accessContext, hasConsent = context.hasConsent()).not()) {
            return
        }
        startConversationBootstrap(false, null)
    }

    private fun prepareGuestAccessIfNeeded(accessContext: AiAccessContext) {
        if (shouldPrepareGuestAccess(accessContext = accessContext, hasConsent = context.hasConsent()).not()) {
            return
        }
        if (context.activeWarmUpJob != null) {
            return
        }
        warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
    }

    private fun shouldRetryWarmUpAfterWorkspaceSwitch(): Boolean {
        if (context.pendingWarmUpAfterWorkspaceSwitch.not()) {
            return false
        }
        if (context.activeBootstrapJob != null) {
            return false
        }

        return shouldPrepareGuestAccess(
            accessContext = context.activeAccessContext,
            hasConsent = context.hasConsent()
        )
    }
}
