package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState

internal data class AiDraftState(
    val workspaceId: String?,
    val persistedState: AiChatPersistedState,
    val draftMessage: String,
    val pendingAttachments: List<AiChatAttachment>,
    val isStreaming: Boolean,
    val dictationState: AiChatDictationState,
    val repairStatus: AiChatRepairAttemptStatus?,
    val activeAlert: AiAlertState?,
    val errorMessage: String
)

internal fun makeDefaultAiDraftState(): AiDraftState {
    return AiDraftState(
        workspaceId = null,
        persistedState = makeDefaultAiChatPersistedState(),
        draftMessage = "",
        pendingAttachments = emptyList(),
        isStreaming = false,
        dictationState = AiChatDictationState.IDLE,
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}

internal fun makeAiDraftState(
    workspaceId: String?,
    persistedState: AiChatPersistedState
): AiDraftState {
    return AiDraftState(
        workspaceId = workspaceId,
        persistedState = persistedState,
        draftMessage = "",
        pendingAttachments = emptyList(),
        isStreaming = false,
        dictationState = AiChatDictationState.IDLE,
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}
