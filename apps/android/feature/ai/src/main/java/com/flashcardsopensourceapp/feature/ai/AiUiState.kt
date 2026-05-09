package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig
import com.flashcardsopensourceapp.feature.ai.runtime.AiAlertState

data class AiBootstrapErrorPresentation(
    val message: String,
    val technicalDetails: String?
)

fun emptyAiBootstrapErrorPresentation(): AiBootstrapErrorPresentation {
    return AiBootstrapErrorPresentation(
        message = "",
        technicalDetails = null
    )
}

data class AiUiState(
    val currentWorkspaceName: String,
    val messages: List<AiChatMessage>,
    val pendingAttachments: List<AiChatAttachment>,
    val draftMessage: String,
    val focusComposerRequestVersion: Long,
    val composerSuggestions: List<AiChatComposerSuggestion>,
    val chatConfig: AiChatServerConfig,
    val isConsentRequired: Boolean,
    val isLinked: Boolean,
    val isConversationReady: Boolean,
    val isConversationLoading: Boolean,
    val isCardHandoffReady: Boolean,
    val conversationErrorPresentation: AiBootstrapErrorPresentation,
    val canRetryConversationLoad: Boolean,
    val showOpenAccountStatusForConversationError: Boolean,
    val isComposerBusy: Boolean,
    val isStreaming: Boolean,
    val canStopStreaming: Boolean,
    val canEditDraftText: Boolean,
    val canEditDraft: Boolean,
    val canManageDraftAttachments: Boolean,
    val canAddDraftAttachment: Boolean,
    val canToggleDictation: Boolean,
    val dictationState: AiChatDictationState,
    val canSend: Boolean,
    val canStartNewChat: Boolean,
    val repairStatus: AiChatRepairAttemptStatus?,
    val activeAlert: AiAlertState?,
    val errorMessage: String
)
