package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

internal const val aiChatBootstrapPageLimit: Int = 20
internal const val aiChatClientPlatform: String = "android"

internal class AiChatRuntimeContext(
    val scope: CoroutineScope,
    val aiChatRepository: AiChatRepository,
    val appVersion: String,
    val hasConsent: () -> Boolean,
    val currentCloudState: () -> CloudAccountState,
    val currentServerConfiguration: () -> CloudServiceConfiguration,
    val currentSyncStatus: () -> SyncStatus
) {
    val runtimeStateMutable = MutableStateFlow(makeDefaultAiDraftState())
    var activeSendJob: Job? = null
    var activeLiveJob: Job? = null
    var activeWarmUpJob: Job? = null
    var activeBootstrapJob: Job? = null
    var pendingWarmUpAfterWorkspaceSwitch: Boolean = false
    var activeAccessContext: AiAccessContext? = null
    var isScreenVisible: Boolean = false
    var nextResumeAttemptId: Long = 0L

    val state: StateFlow<AiChatRuntimeState> = runtimeStateMutable.asStateFlow()

    fun nextResumeDiagnostics(): AiChatResumeDiagnostics {
        nextResumeAttemptId += 1L
        return AiChatResumeDiagnostics(
            resumeAttemptId = nextResumeAttemptId,
            clientPlatform = aiChatClientPlatform,
            clientVersion = appVersion
        )
    }

    fun persistCurrentState() {
        persistState(snapshot = runtimeStateMutable.value)
    }

    fun persistCurrentDraft() {
        persistDraft(snapshot = runtimeStateMutable.value)
    }

    fun persistState(snapshot: AiChatRuntimeState) {
        scope.launch {
            aiChatRepository.savePersistedState(
                workspaceId = snapshot.workspaceId,
                state = snapshot.persistedState
            )
            aiChatRepository.saveDraftState(
                workspaceId = snapshot.workspaceId,
                sessionId = snapshot.persistedState.chatSessionId.ifBlank { null },
                state = snapshot.toDraftState()
            )
        }
    }

    fun persistDraft(snapshot: AiChatRuntimeState) {
        scope.launch {
            aiChatRepository.saveDraftState(
                workspaceId = snapshot.workspaceId,
                sessionId = snapshot.persistedState.chatSessionId.ifBlank { null },
                state = snapshot.toDraftState()
            )
        }
    }
}

private fun AiChatRuntimeState.toDraftState(): com.flashcardsopensourceapp.data.local.model.AiChatDraftState {
    return com.flashcardsopensourceapp.data.local.model.AiChatDraftState(
        draftMessage = draftMessage,
        pendingAttachments = pendingAttachments
    )
}
