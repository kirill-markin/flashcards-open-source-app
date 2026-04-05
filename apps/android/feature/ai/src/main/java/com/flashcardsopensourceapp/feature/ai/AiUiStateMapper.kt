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
        installationId = "",
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
    isCloudIdentityBlocked: Boolean,
    hasConsent: Boolean,
    runtimeState: AiChatRuntimeState
): AiUiState {
    val isLinked = cloudState == CloudAccountState.LINKED
    val hasMessages = runtimeState.persistedState.messages.isNotEmpty()
    val hasDraftText = runtimeState.draftMessage.trim().isNotEmpty()
    val isConversationReady = runtimeState.conversationBootstrapState == AiConversationBootstrapState.READY
    val isConversationLoading = runtimeState.conversationBootstrapState == AiConversationBootstrapState.LOADING
    val hasActiveRun = runtimeState.activeRun != null
    val isStreaming = hasActiveRun || runtimeState.composerPhase == AiComposerPhase.STOPPING
    val isComposerBusy = runtimeState.composerPhase != AiComposerPhase.IDLE || isConversationLoading || hasActiveRun
    val canEditConversation = isComposerBusy.not()
        && isConversationReady
        && runtimeState.dictationState == com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE
    val composerSuggestions = if (
        isConversationReady
        && runtimeState.composerPhase == AiComposerPhase.IDLE
        && hasActiveRun.not()
        && runtimeState.dictationState == com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE
        && runtimeState.pendingAttachments.isEmpty()
        && runtimeState.draftMessage.trim().isEmpty()
    ) {
        runtimeState.serverComposerSuggestions
    } else {
        emptyList()
    }

    return AiUiState(
        currentWorkspaceName = metadata.currentWorkspaceName,
        messages = runtimeState.persistedState.messages,
        pendingAttachments = runtimeState.pendingAttachments,
        draftMessage = runtimeState.draftMessage,
        composerSuggestions = composerSuggestions,
        chatConfig = effectiveAiChatServerConfig(runtimeState.persistedState.lastKnownChatConfig),
        isConsentRequired = hasConsent.not(),
        isLinked = isLinked,
        isConversationReady = isConversationReady,
        isConversationLoading = isConversationLoading,
        conversationErrorMessage = runtimeState.conversationBootstrapErrorMessage,
        canRetryConversationLoad = isCloudIdentityBlocked.not(),
        showOpenAccountStatusForConversationError = isCloudIdentityBlocked,
        isComposerBusy = isComposerBusy,
        isStreaming = isStreaming,
        canStopStreaming = hasActiveRun && runtimeState.composerPhase != AiComposerPhase.STOPPING,
        dictationState = runtimeState.dictationState,
        canSend = hasConsent
            && isConversationReady
            && runtimeState.composerPhase == AiComposerPhase.IDLE
            && hasActiveRun.not()
            && runtimeState.dictationState == com.flashcardsopensourceapp.data.local.model.AiChatDictationState.IDLE
            && (hasDraftText || runtimeState.pendingAttachments.isNotEmpty()),
        canStartNewChat = canEditConversation
            && (hasMessages || hasDraftText || runtimeState.pendingAttachments.isNotEmpty()),
        repairStatus = runtimeState.repairStatus,
        activeAlert = runtimeState.activeAlert,
        errorMessage = runtimeState.errorMessage
    )
}

internal fun makeInitialAiUiState(hasConsent: Boolean): AiUiState {
    return AiUiState(
        currentWorkspaceName = "Loading...",
        messages = emptyList(),
        pendingAttachments = emptyList(),
        draftMessage = "",
        composerSuggestions = emptyList(),
        chatConfig = defaultAiChatServerConfig,
        isConsentRequired = hasConsent.not(),
        isLinked = false,
        isConversationReady = true,
        isConversationLoading = false,
        conversationErrorMessage = "",
        canRetryConversationLoad = true,
        showOpenAccountStatusForConversationError = false,
        isComposerBusy = false,
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
