package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.ai.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.ai.AiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.ai.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.ai.effectiveAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.ai.isSendableAiChatAttachment
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataStorage
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSyncStatus
import com.flashcardsopensourceapp.feature.ai.AiUiState
import com.flashcardsopensourceapp.feature.ai.emptyAiBootstrapErrorPresentation
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiAccessContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiConversationBootstrapState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canEditAiDraft
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canEditAiDraftText
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canManageAiDraftAttachments
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.canPrepareAiDraftInComposerPhase
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.shouldPrepareGuestAccess
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider

internal fun initialAiAppMetadataSummary(textProvider: AiTextProvider): AppMetadataSummary {
    return AppMetadataSummary(
        currentWorkspaceName = textProvider.loadingLabel,
        workspaceName = textProvider.loadingLabel,
        deckCount = 0,
        cardCount = 0,
        localStorage = AppMetadataStorage.ROOM_SQLITE,
        syncStatus = AppMetadataSyncStatus.Message(text = textProvider.loadingLabel)
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
    areComposerSuggestionsEnabled: Boolean,
    runtimeState: AiChatRuntimeState,
    textProvider: AiTextProvider
): AiUiState {
    val isLinked = cloudState == CloudAccountState.LINKED
    val hasMessages = runtimeState.persistedState.messages.isNotEmpty()
    val hasDraftText = runtimeState.draftMessage.trim().isNotEmpty()
    val hasSendableAttachments = runtimeState.pendingAttachments.any(::isSendableAiChatAttachment)
    val isConversationReady = runtimeState.conversationBootstrapState == AiConversationBootstrapState.READY
    val isConversationLoading = runtimeState.conversationBootstrapState == AiConversationBootstrapState.LOADING
        || runtimeState.conversationBootstrapState == AiConversationBootstrapState.RESETTING
    val chatConfig = effectiveAiChatServerConfig(runtimeState.persistedState.lastKnownChatConfig)
    val isCardHandoffReady = hasConsent &&
        runtimeState.workspaceId != null &&
        isConversationReady &&
        runtimeState.dictationState == AiChatDictationState.IDLE &&
        canPrepareAiDraftInComposerPhase(composerPhase = runtimeState.composerPhase) &&
        shouldPrepareGuestAccess(
            accessContext = AiAccessContext(
                workspaceId = runtimeState.workspaceId,
                cloudState = cloudState,
                linkedUserId = null,
                activeWorkspaceId = null
            ),
            hasConsent = hasConsent
        ).not()
    val hasActiveRun = runtimeState.activeRun != null
    val isStreaming = hasActiveRun || runtimeState.composerPhase == AiComposerPhase.STOPPING
    val isComposerBusy = runtimeState.composerPhase != AiComposerPhase.IDLE || isConversationLoading || hasActiveRun
    val canEditConversation = isComposerBusy.not()
        && isConversationReady
        && runtimeState.dictationState == AiChatDictationState.IDLE
    val canEditDraftText = canEditAiDraftText(state = runtimeState)
    val canEditDraft = canEditAiDraft(state = runtimeState)
    val canManageDraftAttachments = canManageAiDraftAttachments(state = runtimeState)
    val composerSuggestions = if (
        areComposerSuggestionsEnabled
        && isConversationReady
        && runtimeState.composerPhase == AiComposerPhase.IDLE
        && hasActiveRun.not()
        && runtimeState.dictationState == AiChatDictationState.IDLE
        && runtimeState.pendingAttachments.isEmpty()
        && runtimeState.draftMessage.trim().isEmpty()
    ) {
        runtimeState.serverComposerSuggestions
    } else {
        emptyList()
    }

    return AiUiState(
        currentWorkspaceName = metadata.currentWorkspaceName ?: textProvider.unavailableLabel,
        conversationScrollStateKey = aiConversationScrollStateKey(runtimeState = runtimeState),
        messages = runtimeState.persistedState.messages,
        pendingAttachments = runtimeState.pendingAttachments,
        draftMessage = runtimeState.draftMessage,
        focusComposerRequestVersion = runtimeState.focusComposerRequestVersion,
        composerSuggestions = composerSuggestions,
        chatConfig = chatConfig,
        isConsentRequired = hasConsent.not(),
        isLinked = isLinked,
        isConversationReady = isConversationReady,
        isConversationLoading = isConversationLoading,
        isCardHandoffReady = isCardHandoffReady,
        conversationErrorPresentation = runtimeState.conversationBootstrapErrorPresentation,
        canRetryConversationLoad = isCloudIdentityBlocked.not(),
        showOpenAccountStatusForConversationError = isCloudIdentityBlocked,
        isComposerBusy = isComposerBusy,
        isStreaming = isStreaming,
        canStopStreaming = hasActiveRun && runtimeState.composerPhase != AiComposerPhase.STOPPING,
        canEditDraftText = canEditDraftText,
        canEditDraft = canEditDraft,
        canManageDraftAttachments = canManageDraftAttachments,
        canAddDraftAttachment = canManageDraftAttachments && chatConfig.features.attachmentsEnabled,
        canToggleDictation = canToggleDictation(
            runtimeState = runtimeState,
            chatConfig = chatConfig
        ),
        dictationState = runtimeState.dictationState,
        canSend = hasConsent
            && isConversationReady
            && runtimeState.composerPhase == AiComposerPhase.IDLE
            && hasActiveRun.not()
            && runtimeState.dictationState == AiChatDictationState.IDLE
            && (hasDraftText || hasSendableAttachments),
        canStartNewChat = canEditConversation
            && (hasMessages || hasDraftText || runtimeState.pendingAttachments.isNotEmpty()),
        repairStatus = runtimeState.repairStatus,
        activeAlert = runtimeState.activeAlert,
        errorMessage = runtimeState.errorMessage
    )
}

internal fun makeInitialAiUiState(hasConsent: Boolean, textProvider: AiTextProvider): AiUiState {
    return AiUiState(
        currentWorkspaceName = textProvider.loadingLabel,
        conversationScrollStateKey = emptyAiConversationScrollStateKey(),
        messages = emptyList(),
        pendingAttachments = emptyList(),
        draftMessage = "",
        focusComposerRequestVersion = 0L,
        composerSuggestions = emptyList(),
        chatConfig = defaultAiChatServerConfig,
        isConsentRequired = hasConsent.not(),
        isLinked = false,
        isConversationReady = false,
        isConversationLoading = true,
        isCardHandoffReady = false,
        conversationErrorPresentation = emptyAiBootstrapErrorPresentation(),
        canRetryConversationLoad = true,
        showOpenAccountStatusForConversationError = false,
        isComposerBusy = false,
        isStreaming = false,
        canStopStreaming = false,
        canEditDraftText = false,
        canEditDraft = false,
        canManageDraftAttachments = false,
        canAddDraftAttachment = false,
        canToggleDictation = false,
        dictationState = AiChatDictationState.IDLE,
        canSend = false,
        canStartNewChat = false,
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}

private fun canToggleDictation(
    runtimeState: AiChatRuntimeState,
    chatConfig: AiChatServerConfig
): Boolean {
    if (runtimeState.dictationState == AiChatDictationState.RECORDING) {
        return true
    }
    if (runtimeState.dictationState != AiChatDictationState.IDLE) {
        return false
    }
    return chatConfig.features.dictationEnabled && canPrepareAiDraftInComposerPhase(
        composerPhase = runtimeState.composerPhase
    ) && runtimeState.conversationBootstrapState == AiConversationBootstrapState.READY
}

private fun aiConversationScrollStateKey(runtimeState: AiChatRuntimeState): String {
    val chatSessionId: String = runtimeState.persistedState.chatSessionId.trim()
    if (chatSessionId.isNotEmpty()) {
        return "session:$chatSessionId"
    }

    val conversationScopeId: String? = runtimeState.conversationScopeId?.trim()
    if (conversationScopeId != null && conversationScopeId.isNotEmpty()) {
        return "scope:$conversationScopeId"
    }

    return aiConversationMessageSetScrollStateKey(messages = runtimeState.persistedState.messages)
}

private fun aiConversationMessageSetScrollStateKey(messages: List<AiChatMessage>): String {
    val firstMessage: AiChatMessage = messages.firstOrNull() ?: return emptyAiConversationScrollStateKey()
    return "messages:${firstMessage.messageId}:${firstMessage.timestampMillis}"
}

private fun emptyAiConversationScrollStateKey(): String {
    return "empty"
}
