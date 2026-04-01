package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatServerConfig

data class AiUiState(
    val currentWorkspaceName: String,
    val messages: List<AiChatMessage>,
    val pendingAttachments: List<AiChatAttachment>,
    val draftMessage: String,
    val chatConfig: AiChatServerConfig,
    val isConsentRequired: Boolean,
    val isLinked: Boolean,
    val isConversationReady: Boolean,
    val isConversationLoading: Boolean,
    val conversationErrorMessage: String,
    val canRetryConversationLoad: Boolean,
    val showOpenAccountStatusForConversationError: Boolean,
    val isComposerBusy: Boolean,
    val isStreaming: Boolean,
    val canStopStreaming: Boolean,
    val dictationState: AiChatDictationState,
    val canSend: Boolean,
    val canStartNewChat: Boolean,
    val repairStatus: AiChatRepairAttemptStatus?,
    val activeAlert: AiAlertState?,
    val errorMessage: String
)
