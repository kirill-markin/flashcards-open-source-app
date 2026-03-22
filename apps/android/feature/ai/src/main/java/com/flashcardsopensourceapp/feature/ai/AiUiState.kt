package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatModelOption
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus

data class AiUiState(
    val currentWorkspaceName: String,
    val messages: List<AiChatMessage>,
    val draftMessage: String,
    val selectedModelId: String,
    val availableModels: List<AiChatModelOption>,
    val isConsentRequired: Boolean,
    val isLinked: Boolean,
    val isStreaming: Boolean,
    val canSend: Boolean,
    val canStartNewChat: Boolean,
    val isModelPickerEnabled: Boolean,
    val repairStatus: AiChatRepairAttemptStatus?,
    val errorMessage: String
)
