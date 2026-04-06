package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

internal class AiChatBootstrapCoordinator(
    private val context: AiChatRuntimeContext,
    private val attachBootstrapLiveStream: (
        String,
        AiChatBootstrapResponse,
        com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?
    ) -> Unit
) {
    fun startConversationBootstrap(
        forceReloadState: Boolean,
        resumeDiagnostics: com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics?
    ) {
        val accessContext = context.activeAccessContext ?: return
        val workspaceId = accessContext.workspaceId ?: return
        if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
            return
        }

        context.activeBootstrapJob?.cancel(
            cause = CancellationException("AI bootstrap restarted.")
        )
        var bootstrapJob: Job? = null
        bootstrapJob = context.scope.launch {
            val persistedState = normalizeAiChatPersistedStateForWorkspace(
                workspaceId = workspaceId,
                persistedState = context.aiChatRepository.loadPersistedState(workspaceId = workspaceId)
            )
            val persistedSessionId = resolveAiChatSessionIdForWorkspace(
                workspaceId = workspaceId,
                sessionId = persistedState.chatSessionId
            )
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
                            composerPhase = AiComposerPhase.IDLE,
                            dictationState = com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE,
                            conversationBootstrapState = AiConversationBootstrapState.LOADING,
                            conversationBootstrapErrorMessage = "",
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
                            conversationBootstrapErrorMessage = "",
                            repairStatus = null,
                            activeAlert = null,
                            errorMessage = ""
                        )
                    }
                }

                val blockedSyncMessage = syncBlockedMessageOrNull()
                if (blockedSyncMessage != null) {
                    throw IllegalStateException(blockedSyncMessage)
                }

                context.aiChatRepository.prepareSessionForAi(workspaceId = workspaceId)
                if (context.activeAccessContext != accessContext) {
                    return@launch
                }

                val bootstrap = context.aiChatRepository.loadBootstrap(
                    workspaceId = workspaceId,
                    sessionId = persistedSessionId,
                    limit = aiChatBootstrapPageLimit,
                    resumeDiagnostics = resumeDiagnostics
                )
                if (context.activeAccessContext != accessContext) {
                    return@launch
                }

                applyBootstrap(
                    response = bootstrap,
                    preserveLocalComposerState = canPreserveLocalComposerState
                )
                attachBootstrapLiveStream(workspaceId, bootstrap, resumeDiagnostics)
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
                if (context.activeAccessContext != accessContext) {
                    return@launch
                }

                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.CHAT,
                    configuration = context.currentServerConfiguration()
                )
                AiChatDiagnosticsLogger.error(
                    event = "conversation_bootstrap_failed",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "userFacingMessage" to message
                    ) + remoteErrorFields(error = error as? AiChatRemoteException),
                    throwable = error
                )
                val currentSessionId = resolveAiChatSessionIdForWorkspace(
                    workspaceId = workspaceId,
                    sessionId = context.runtimeStateMutable.value.persistedState.chatSessionId
                )
                context.runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = state.persistedState.copy(
                            messages = emptyList(),
                            chatSessionId = currentSessionId ?: persistedState.chatSessionId
                        ),
                        conversationScopeId = null,
                        hasOlder = false,
                        oldestCursor = null,
                        activeRun = null,
                        isLiveAttached = false,
                        draftMessage = "",
                        pendingAttachments = emptyList(),
                        composerPhase = AiComposerPhase.IDLE,
                        dictationState = com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE,
                        conversationBootstrapState = AiConversationBootstrapState.FAILED,
                        conversationBootstrapErrorMessage = message,
                        repairStatus = null,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
            } finally {
                if (context.activeBootstrapJob === bootstrapJob) {
                    context.activeBootstrapJob = null
                }
            }
        }
        context.activeBootstrapJob = bootstrapJob
    }

    suspend fun applyActiveBootstrap(response: AiChatBootstrapResponse) {
        applyBootstrap(
            response = response,
            preserveLocalComposerState = false
        )
    }

    private suspend fun applyBootstrap(
        response: AiChatBootstrapResponse,
        preserveLocalComposerState: Boolean
    ) {
        val workspaceId = context.runtimeStateMutable.value.workspaceId
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
        context.runtimeStateMutable.update { state ->
            updateComposerSuggestions(
                state = state.copy(
                    persistedState = state.persistedState.copy(
                        messages = response.conversation.messages,
                        chatSessionId = resolvedSessionId,
                        lastKnownChatConfig = response.chatConfig
                    ),
                    conversationScopeId = resolvedConversationScopeId,
                    hasOlder = response.conversation.hasOlder,
                    oldestCursor = response.conversation.oldestCursor,
                    activeRun = response.activeRun,
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
                    conversationBootstrapErrorMessage = "",
                    repairStatus = null,
                    activeAlert = null,
                    errorMessage = ""
                ),
                nextSuggestions = response.composerSuggestions
            )
        }
        context.persistCurrentState()
    }

    private fun updateComposerSuggestions(
        state: AiChatRuntimeState,
        nextSuggestions: List<com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion>
    ): AiChatRuntimeState {
        return state.copy(serverComposerSuggestions = nextSuggestions)
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
