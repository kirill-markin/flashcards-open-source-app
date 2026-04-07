package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import java.util.UUID

internal enum class AiComposerPhase {
    IDLE,
    PREPARING_SEND,
    STARTING_RUN,
    RUNNING,
    STOPPING
}

internal enum class AiConversationBootstrapState {
    READY,
    LOADING,
    FAILED
}

internal data class AiAccessContext(
    val workspaceId: String?,
    val cloudState: com.flashcardsopensourceapp.data.local.model.CloudAccountState,
    val linkedUserId: String?,
    val activeWorkspaceId: String?
)

internal data class AiDraftState(
    val workspaceId: String?,
    val persistedState: AiChatPersistedState,
    val conversationScopeId: String?,
    val hasOlder: Boolean,
    val oldestCursor: String?,
    val activeRun: AiChatActiveRun?,
    val isLiveAttached: Boolean,
    val draftMessage: String,
    val pendingAttachments: List<AiChatAttachment>,
    val focusComposerRequestVersion: Long,
    val serverComposerSuggestions: List<AiChatComposerSuggestion>,
    val composerPhase: AiComposerPhase,
    val dictationState: AiChatDictationState,
    val conversationBootstrapState: AiConversationBootstrapState,
    val conversationBootstrapErrorMessage: String,
    val repairStatus: AiChatRepairAttemptStatus?,
    val activeAlert: AiAlertState?,
    val errorMessage: String
)

internal typealias AiChatRuntimeState = AiDraftState

internal fun makeDefaultAiDraftState(): AiDraftState {
    return AiDraftState(
        workspaceId = null,
        persistedState = makeDefaultAiChatPersistedState(),
        conversationScopeId = null,
        hasOlder = false,
        oldestCursor = null,
        activeRun = null,
        isLiveAttached = false,
        draftMessage = "",
        pendingAttachments = emptyList(),
        focusComposerRequestVersion = 0L,
        serverComposerSuggestions = emptyList(),
        composerPhase = AiComposerPhase.IDLE,
        dictationState = AiChatDictationState.IDLE,
        conversationBootstrapState = AiConversationBootstrapState.READY,
        conversationBootstrapErrorMessage = "",
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}

internal fun makeAiDraftState(
    workspaceId: String?,
    persistedState: AiChatPersistedState
): AiDraftState {
    val normalizedPersistedState = normalizeAiChatPersistedStateForWorkspace(
        workspaceId = workspaceId,
        persistedState = persistedState
    )
    return AiDraftState(
        workspaceId = workspaceId,
        persistedState = normalizedPersistedState,
        conversationScopeId = null,
        hasOlder = false,
        oldestCursor = null,
        activeRun = null,
        isLiveAttached = false,
        draftMessage = "",
        pendingAttachments = emptyList(),
        focusComposerRequestVersion = 0L,
        serverComposerSuggestions = emptyList(),
        composerPhase = AiComposerPhase.IDLE,
        dictationState = AiChatDictationState.IDLE,
        conversationBootstrapState = AiConversationBootstrapState.READY,
        conversationBootstrapErrorMessage = "",
        repairStatus = null,
        activeAlert = null,
        errorMessage = ""
    )
}

internal fun resolveAiChatSessionIdForWorkspace(
    workspaceId: String?,
    sessionId: String?
): String? {
    @Suppress("UNUSED_VARIABLE")
    val ignoredWorkspaceId = workspaceId
    return sessionId?.trim()?.takeIf { value -> value.isNotEmpty() }
}

internal fun normalizeAiChatPersistedStateForWorkspace(
    workspaceId: String?,
    persistedState: AiChatPersistedState
): AiChatPersistedState {
    val normalizedSessionId = resolveAiChatSessionIdForWorkspace(
        workspaceId = workspaceId,
        sessionId = persistedState.chatSessionId
    )
    if (normalizedSessionId == persistedState.chatSessionId) {
        return persistedState
    }

    return normalizedSessionId?.let { sessionId ->
        persistedState.copy(chatSessionId = sessionId)
    } ?: persistedState
}

internal fun makeAiChatSessionId(): String {
    return UUID.randomUUID().toString().lowercase()
}
