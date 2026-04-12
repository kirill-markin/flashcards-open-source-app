package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.AutoSyncSource
import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.feature.ai.strings.AiTextProvider
import java.util.UUID
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

internal const val aiChatBootstrapPageLimit: Int = 20
internal const val aiChatClientPlatform: String = "android"

internal class AiChatRuntimeContext(
    val scope: CoroutineScope,
    val aiChatRepository: AiChatRepository,
    val autoSyncEventRepository: AutoSyncEventRepository,
    val appVersion: String,
    val textProvider: AiTextProvider,
    val hasConsent: () -> Boolean,
    val currentCloudState: () -> CloudAccountState,
    val currentServerConfiguration: () -> CloudServiceConfiguration,
    val currentSyncStatus: () -> SyncStatus,
    val currentUiLocaleTag: () -> String?
) {
    private data class ToolRunPostSyncOrigin(
        val workspaceId: String?,
        val sessionId: String
    )

    private val toolRunPostSyncMutex = Mutex()
    private val persistedStateWriteMutex = Mutex()
    private val persistedStateWriteRequestVersion = AtomicLong(0L)
    private var isToolRunPostSyncInFlight: Boolean = false
    val runtimeStateMutable = MutableStateFlow(makeDefaultAiDraftState())
    var activeSendJob: Job? = null
    var activeLiveJob: Job? = null
    var activeWarmUpJob: Job? = null
    var activeBootstrapJob: Job? = null
    var activeFreshSessionJob: Job? = null
    var activeFreshSessionTargetSessionId: String? = null
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
        val requestVersion = persistedStateWriteRequestVersion.incrementAndGet()
        scope.launch {
            persistedStateWriteMutex.withLock {
                if (requestVersion != persistedStateWriteRequestVersion.get()) {
                    return@withLock
                }
                persistStateSnapshot(snapshot = snapshot)
            }
        }
    }

    fun persistDraft(snapshot: AiChatRuntimeState) {
        scope.launch {
            val chatSessionId = snapshot.persistedState.chatSessionId.ifBlank { null }
            if (chatSessionId != null) {
                aiChatRepository.saveDraftState(
                    workspaceId = snapshot.workspaceId,
                    sessionId = chatSessionId,
                    state = snapshot.toDraftState()
                )
            }
        }
    }

    private suspend fun persistStateNow(snapshot: AiChatRuntimeState) {
        val requestVersion = persistedStateWriteRequestVersion.incrementAndGet()
        persistedStateWriteMutex.withLock {
            if (requestVersion != persistedStateWriteRequestVersion.get()) {
                return@withLock
            }
            persistStateSnapshot(snapshot = snapshot)
        }
    }

    private suspend fun persistStateSnapshot(snapshot: AiChatRuntimeState) {
        aiChatRepository.savePersistedState(
            workspaceId = snapshot.workspaceId,
            state = snapshot.persistedState
        )
        val chatSessionId = snapshot.persistedState.chatSessionId.ifBlank { null }
        if (chatSessionId != null) {
            aiChatRepository.saveDraftState(
                workspaceId = snapshot.workspaceId,
                sessionId = chatSessionId,
                state = snapshot.toDraftState()
            )
        }
    }

    suspend fun triggerToolRunPostSyncIfNeeded(reason: String) {
        val origin = toolRunPostSyncMutex.withLock {
            val currentState = runtimeStateMutable.value
            if (currentState.persistedState.pendingToolRunPostSync.not()) {
                return@withLock null
            }
            if (isToolRunPostSyncInFlight) {
                return@withLock null
            }

            isToolRunPostSyncInFlight = true
            ToolRunPostSyncOrigin(
                workspaceId = currentState.workspaceId,
                sessionId = currentState.persistedState.chatSessionId
            )
        }
        if (origin == null) {
            return
        }

        val request = AutoSyncRequest(
            requestId = UUID.randomUUID().toString(),
            source = AutoSyncSource.AI_CHAT_MUTATION,
            triggeredAtMillis = System.currentTimeMillis(),
            shouldExtendPolling = true,
            allowsVisibleChangeMessage = true
        )

        try {
            // AI tool-backed post-run sync goes through the normal auto-sync event pipeline so
            // review and other surfaces reconcile from the same completion signal.
            autoSyncEventRepository.runAutoSync(request = request)
            clearPendingToolRunPostSyncAfterSuccessfulAutoSync(
                origin = origin,
                reason = reason
            )
        } catch (error: CancellationException) {
            releaseToolRunPostSyncInFlight()
            throw error
        } catch (error: Exception) {
            releaseToolRunPostSyncInFlight()
            AiChatDiagnosticsLogger.warn(
                event = "ai_chat_post_run_sync_failed",
                fields = listOf(
                    "workspaceId" to origin.workspaceId,
                    "reason" to reason,
                    "message" to error.message
                )
            )
        }
    }

    private suspend fun clearPendingToolRunPostSyncAfterSuccessfulAutoSync(
        origin: ToolRunPostSyncOrigin,
        reason: String
    ) {
        toolRunPostSyncMutex.withLock {
            try {
                val currentState = runtimeStateMutable.value
                if (
                    currentState.workspaceId == origin.workspaceId
                    && currentState.persistedState.chatSessionId == origin.sessionId
                ) {
                    if (currentState.persistedState.pendingToolRunPostSync.not()) {
                        return@withLock
                    }

                    val nextState = currentState.copy(
                        persistedState = clearPendingToolRunPostSync(state = currentState.persistedState),
                        runHadToolCalls = false
                    )

                    try {
                        persistStateNow(snapshot = nextState)
                        runtimeStateMutable.value = nextState
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: Exception) {
                        AiChatDiagnosticsLogger.warn(
                            event = "ai_chat_post_run_sync_flag_persist_failed",
                            fields = listOf(
                                "workspaceId" to currentState.workspaceId,
                                "reason" to reason,
                                "message" to error.message
                            )
                        )
                    }
                    return@withLock
                }

                val persistedState = aiChatRepository.loadPersistedState(workspaceId = origin.workspaceId)
                if (
                    persistedState.pendingToolRunPostSync.not()
                    || persistedState.chatSessionId != origin.sessionId
                ) {
                    return@withLock
                }

                try {
                    aiChatRepository.savePersistedState(
                        workspaceId = origin.workspaceId,
                        state = clearPendingToolRunPostSync(state = persistedState)
                    )
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    AiChatDiagnosticsLogger.warn(
                        event = "ai_chat_post_run_sync_flag_persist_failed",
                        fields = listOf(
                            "workspaceId" to origin.workspaceId,
                            "reason" to reason,
                            "message" to error.message
                        )
                    )
                }
            } finally {
                isToolRunPostSyncInFlight = false
            }
        }
    }

    private suspend fun releaseToolRunPostSyncInFlight() {
        toolRunPostSyncMutex.withLock {
            isToolRunPostSyncInFlight = false
        }
    }
}

private fun AiChatRuntimeState.toDraftState(): com.flashcardsopensourceapp.data.local.model.AiChatDraftState {
    return com.flashcardsopensourceapp.data.local.model.AiChatDraftState(
        draftMessage = draftMessage,
        pendingAttachments = pendingAttachments
    )
}
