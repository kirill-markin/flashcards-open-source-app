package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState

internal enum class AiComposerPhase {
    IDLE,
    PREPARING_SEND,
    STARTING_RUN,
    RUNNING,
    STOPPING
}

internal data class AiDraftState(
    val workspaceId: String?,
    val persistedState: AiChatPersistedState,
    val draftMessage: String,
    val pendingAttachments: List<AiChatAttachment>,
    val composerPhase: AiComposerPhase,
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
        composerPhase = AiComposerPhase.IDLE,
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
        composerPhase = AiComposerPhase.IDLE,
        dictationState = AiChatDictationState.IDLE,
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}
