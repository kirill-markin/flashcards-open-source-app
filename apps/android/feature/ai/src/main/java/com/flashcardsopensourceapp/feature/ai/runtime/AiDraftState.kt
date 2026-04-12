package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
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
    RESETTING,
    FAILED
}

internal data class AiAccessContextRuntimeKey(
    val workspaceId: String?,
    val cloudState: CloudAccountState
)

internal data class AiAccessContext(
    val workspaceId: String?,
    val cloudState: CloudAccountState,
    val linkedUserId: String?,
    val activeWorkspaceId: String?
)

internal fun AiAccessContext.runtimeKey(): AiAccessContextRuntimeKey {
    return AiAccessContextRuntimeKey(
        workspaceId = workspaceId,
        cloudState = cloudState
    )
}

internal fun shouldBootstrapConversation(
    accessContext: AiAccessContext?,
    hasConsent: Boolean
): Boolean {
    val resolvedAccessContext = accessContext ?: return false
    if (resolvedAccessContext.workspaceId == null || hasConsent.not()) {
        return false
    }

    return resolvedAccessContext.cloudState == CloudAccountState.GUEST ||
        resolvedAccessContext.cloudState == CloudAccountState.LINKED
}

internal fun shouldPrepareGuestAccess(
    accessContext: AiAccessContext?,
    hasConsent: Boolean
): Boolean {
    val resolvedAccessContext = accessContext ?: return false
    return resolvedAccessContext.workspaceId != null &&
        hasConsent &&
        resolvedAccessContext.cloudState == CloudAccountState.DISCONNECTED
}

internal data class AiDraftState(
    val workspaceId: String?,
    val persistedState: AiChatPersistedState,
    val conversationScopeId: String?,
    val hasOlder: Boolean,
    val oldestCursor: String?,
    val activeRun: AiChatActiveRun?,
    val runHadToolCalls: Boolean,
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
        runHadToolCalls = false,
        isLiveAttached = false,
        draftMessage = "",
        pendingAttachments = emptyList(),
        focusComposerRequestVersion = 0L,
        serverComposerSuggestions = emptyList(),
        composerPhase = AiComposerPhase.IDLE,
        dictationState = AiChatDictationState.IDLE,
        conversationBootstrapState = AiConversationBootstrapState.LOADING,
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
        runHadToolCalls = normalizedPersistedState.pendingToolRunPostSync,
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
