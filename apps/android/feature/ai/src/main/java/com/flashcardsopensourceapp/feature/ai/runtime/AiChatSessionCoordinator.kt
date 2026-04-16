package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatSessionProvisioningResult
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
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
        context.runtimeStateMutable.update { state ->
            state.copy(
                persistedState = state.persistedState.copy(
                    messages = emptyList(),
                    chatSessionId = targetSessionId,
                    pendingToolRunPostSync = false
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
                conversationBootstrapErrorMessage = "",
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
        val currentState = context.runtimeStateMutable.value
        val currentSessionId = currentState.persistedState.chatSessionId
        if (currentSessionId.isNotBlank()) {
            awaitActiveFreshSessionProvisioningIfNeeded(targetSessionId = currentSessionId)
        }
        val ensuredSession = context.aiChatRepository.ensureSessionId(
            workspaceId = currentState.workspaceId,
            persistedState = currentState.persistedState,
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
                            lastKnownChatConfig = ensuredSnapshot.chatConfig
                        ),
                        conversationScopeId = ensuredSnapshot.conversationScopeId,
                        activeAlert = null,
                        errorMessage = ""
                    ),
                    nextSuggestions = ensuredSnapshot.composerSuggestions
                )
            }
            context.persistCurrentState()
        }
        return ensuredSession
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
                val snapshot = context.aiChatRepository.createNewSession(
                    workspaceId = workspaceId,
                    sessionId = targetSessionId,
                    uiLocale = context.currentUiLocaleTag()
                )
                if (
                    snapshot.sessionId != targetSessionId
                    || context.runtimeStateMutable.value.workspaceId != workspaceId
                    || canApplySessionScopedResult(targetSessionId = targetSessionId).not()
                ) {
                    return@launch
                }
                context.runtimeStateMutable.update { state ->
                    updateComposerSuggestions(
                        state = state.copy(
                            workspaceId = workspaceId,
                            persistedState = state.persistedState.copy(
                                lastKnownChatConfig = snapshot.chatConfig
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
                AiChatDiagnosticsLogger.info(
                    event = "new_chat_cancelled",
                    fields = listOf(
                        "workspaceId" to context.runtimeStateMutable.value.workspaceId,
                        "cloudState" to currentCloudState().name,
                        "chatSessionId" to context.runtimeStateMutable.value.persistedState.chatSessionId,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
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
        val message = makeAiUserFacingErrorMessage(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = currentServerConfiguration(),
            textProvider = context.textProvider
        )

        AiChatDiagnosticsLogger.error(
            event = "new_chat_failure_handled",
            fields = listOf(
                "workspaceId" to context.runtimeStateMutable.value.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to context.runtimeStateMutable.value.persistedState.chatSessionId,
                "messageCount" to context.runtimeStateMutable.value.persistedState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )

        context.runtimeStateMutable.update { state ->
            state.copy(
                conversationBootstrapState = AiConversationBootstrapState.FAILED,
                conversationBootstrapErrorMessage = message,
                activeAlert = context.textProvider.generalError(message = message),
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
