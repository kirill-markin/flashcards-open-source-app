package com.flashcardsopensourceapp.feature.ai.runtime.coordinators

import com.flashcardsopensourceapp.data.local.model.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.resolveAiChatSessionIdForWorkspace

internal class AiChatBootstrapSessionMismatchException(message: String) : IllegalStateException(message)

internal fun shouldPreserveConversationStateOnBootstrapFailure(
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

internal fun freshSessionDraftToPreserveOnBootstrapFailure(
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
        error::class.java.name == "com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException"
}
