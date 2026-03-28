package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.effectiveAiChatServerConfig

internal fun initialAiAppMetadataSummary(): AppMetadataSummary {
    return AppMetadataSummary(
        currentWorkspaceName = "Loading...",
        workspaceName = "Loading...",
        deckCount = 0,
        cardCount = 0,
        localStorageLabel = "Room + SQLite",
        syncStatusText = "Loading..."
    )
}

internal fun initialAiCloudSettings(): CloudSettings {
    return CloudSettings(
        deviceId = "",
        cloudState = CloudAccountState.DISCONNECTED,
        linkedUserId = null,
        linkedWorkspaceId = null,
        linkedEmail = null,
        activeWorkspaceId = null,
        updatedAtMillis = 0L
    )
}

internal fun mapToAiUiState(
    metadata: AppMetadataSummary,
    cloudState: CloudAccountState,
    hasConsent: Boolean,
    draft: AiDraftState
): AiUiState {
    val isLinked = cloudState == CloudAccountState.LINKED
    val hasMessages = draft.persistedState.messages.isNotEmpty()
    val hasDraftText = draft.draftMessage.trim().isNotEmpty()
    val canEditConversation = draft.isStreaming.not() && draft.dictationState == com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE

    return AiUiState(
        currentWorkspaceName = metadata.currentWorkspaceName,
        messages = draft.persistedState.messages,
        pendingAttachments = draft.pendingAttachments,
        draftMessage = draft.draftMessage,
        chatConfig = effectiveAiChatServerConfig(draft.persistedState.lastKnownChatConfig),
        isConsentRequired = hasConsent.not(),
        isLinked = isLinked,
        isStreaming = draft.isStreaming,
        canStopStreaming = draft.isStreaming,
        dictationState = draft.dictationState,
        canSend = hasConsent
            && draft.isStreaming.not()
            && draft.dictationState == com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE
            && (hasDraftText || draft.pendingAttachments.isNotEmpty()),
        canStartNewChat = canEditConversation
            && (hasMessages || hasDraftText || draft.pendingAttachments.isNotEmpty()),
        repairStatus = draft.repairStatus,
        activeAlert = draft.activeAlert,
        errorMessage = draft.errorMessage
    )
}

internal fun makeInitialAiUiState(hasConsent: Boolean): AiUiState {
    return AiUiState(
        currentWorkspaceName = "Loading...",
        messages = emptyList(),
        pendingAttachments = emptyList(),
        draftMessage = "",
        chatConfig = defaultAiChatServerConfig,
        isConsentRequired = hasConsent.not(),
        isLinked = false,
        isStreaming = false,
        canStopStreaming = false,
        dictationState = com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE,
        canSend = false,
        canStartNewChat = false,
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}
