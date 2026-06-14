package com.flashcardsopensourceapp.feature.ai.runtime.coordinators.lifecycle

import com.flashcardsopensourceapp.data.local.ai.remote.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.ai.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.feature.ai.runtime.AiChatRuntimeContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiAccessContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.isAiChatConversationStale
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeAiDraftState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.normalizeAiChatPersistedStateForWorkspace
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.resolveAiChatSessionIdForWorkspace
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.runtimeKey
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.shouldBootstrapConversation
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.shouldPrepareGuestAccess
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.nextBootstrapRetryDelayMillis
import com.flashcardsopensourceapp.feature.ai.runtime.coordinators.bootstrap.shouldRetryBootstrap
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatExceptionEvent
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatWarning
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatFailureIssueDisposition
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatFailureWarningMessage
import com.flashcardsopensourceapp.feature.ai.runtime.observability.aiChatRemoteErrorDetails
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatBreadcrumb
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatException
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatWarning
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal class AiChatRuntimeLifecycleCoordinator(
    private val context: AiChatRuntimeContext,
    private val startConversationBootstrap: (Boolean, AiChatResumeDiagnostics?) -> Unit,
    private val startFreshConversation: () -> Unit,
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
            context.observability.recordAiChatBreadcrumb(
                breadcrumb = AiChatBreadcrumb.SwitchAccessContextCancellingWarmUp(
                    nextWorkspaceId = accessContext.workspaceId,
                    currentWorkspaceId = context.runtimeStateMutable.value.workspaceId,
                    cloudState = accessContext.cloudState.name
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
            if (
                shouldStartFreshConversationForStaleState(
                    state = nextState,
                    accessContext = accessContext
                )
            ) {
                startFreshConversation()
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
        resumeDiagnostics: AiChatResumeDiagnostics?
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
        if (
            shouldStartFreshConversationForStaleState(
                state = currentState,
                accessContext = accessContext
            )
        ) {
            startFreshConversation()
            return
        }
        if (
            currentState.conversationBootstrapState == AiConversationBootstrapState.FAILED
            && context.lastBootstrapFailureRetryable.not()
        ) {
            return
        }

        lateinit var warmUpJob: Job
        warmUpJob = context.scope.launch(start = CoroutineStart.LAZY) {
            try {
                if (shouldPrepareGuestAccess(
                        accessContext = accessContext,
                        hasConsent = context.hasConsent()
                    )
                ) {
                    prepareGuestAccessWithRetry(accessContext = accessContext)
                } else if (shouldBootstrapConversation(
                        accessContext = accessContext,
                        hasConsent = context.hasConsent()
                    )
                ) {
                    startConversationBootstrap(false, resumeDiagnostics)
                }
            } catch (error: CancellationException) {
                context.observability.recordAiChatBreadcrumb(
                    breadcrumb = AiChatBreadcrumb.WarmUpCancelled(
                        workspaceId = accessContext.workspaceId,
                        currentWorkspaceId = context.runtimeStateMutable.value.workspaceId,
                        cloudState = accessContext.cloudState.name,
                        retryAfterWorkspaceSwitch = context.pendingWarmUpAfterWorkspaceSwitch,
                        message = error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                val remoteError = error as? AiChatRemoteException
                when (aiChatFailureIssueDisposition(error = error)) {
                    AiChatFailureIssueDisposition.NONE -> Unit
                    AiChatFailureIssueDisposition.WARNING -> {
                        context.observability.recordAiChatWarning(
                            warning = AiChatWarning.WarmUpFailureHandled(
                                workspaceId = accessContext.workspaceId,
                                cloudState = accessContext.cloudState.name,
                                remoteError = aiChatRemoteErrorDetails(error = remoteError),
                                message = aiChatFailureWarningMessage(error = error)
                            )
                        )
                    }
                    AiChatFailureIssueDisposition.EXCEPTION -> {
                        context.observability.recordAiChatException(
                            exception = AiChatExceptionEvent.WarmUpFailed(
                                workspaceId = accessContext.workspaceId,
                                cloudState = accessContext.cloudState.name,
                                message = null,
                                remoteError = aiChatRemoteErrorDetails(error = remoteError),
                                error = error
                            )
                        )
                    }
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
        warmUpJob.start()
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

    private suspend fun prepareGuestAccessWithRetry(accessContext: AiAccessContext) {
        var retryCount: Int = 0
        while (true) {
            try {
                context.aiChatRepository.prepareSessionForAi(workspaceId = accessContext.workspaceId)
                return
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (shouldRetryBootstrap(error = error, retryCount = retryCount).not()) {
                    throw error
                }
                delay(timeMillis = nextBootstrapRetryDelayMillis(retryCount = retryCount))
                retryCount += 1
            }
        }
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

    private fun shouldStartFreshConversationForStaleState(
        state: AiChatRuntimeState,
        accessContext: AiAccessContext
    ): Boolean {
        val hasConsent = context.hasConsent()
        val canUseAi = shouldPrepareGuestAccess(
            accessContext = accessContext,
            hasConsent = hasConsent
        ) || shouldBootstrapConversation(
            accessContext = accessContext,
            hasConsent = hasConsent
        )
        if (canUseAi.not()) {
            return false
        }
        if (context.activeFreshSessionJob != null) {
            return false
        }

        return isAiChatConversationStale(
            messages = state.persistedState.messages,
            nowMillis = System.currentTimeMillis()
        )
    }
}
