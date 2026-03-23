package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatModelOption
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus

data class AiUiState(
    val currentWorkspaceName: String,
    val messages: List<AiChatMessage>,
    val pendingAttachments: List<AiChatAttachment>,
    val draftMessage: String,
    val selectedModelId: String,
    val availableModels: List<AiChatModelOption>,
    val isConsentRequired: Boolean,
    val isLinked: Boolean,
    val isStreaming: Boolean,
    val dictationState: AiChatDictationState,
    val canSend: Boolean,
    val canStartNewChat: Boolean,
    val isModelPickerEnabled: Boolean,
    val repairStatus: AiChatRepairAttemptStatus?,
    val activeAlert: AiAlertState?,
    val errorMessage: String
)
