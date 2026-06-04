package com.flashcardsopensourceapp.feature.ai.runtime

import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.data.local.model.ai.AiChatDraftState
import com.flashcardsopensourceapp.data.local.model.ai.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncSource
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiAccessContext
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.AiChatRuntimeState
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.clearPendingToolRunPostSync
import com.flashcardsopensourceapp.feature.ai.runtime.conversation.makeDefaultAiDraftState
import com.flashcardsopensourceapp.feature.ai.runtime.observability.AiChatWarning
import com.flashcardsopensourceapp.feature.ai.runtime.observability.createAiChatRuntimeObservability
import com.flashcardsopensourceapp.feature.ai.runtime.observability.recordAiChatWarning
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
    appVersion: String,
    versionCode: Int,
    val textProvider: AiTextProvider,
    val hasConsent: () -> Boolean,
    val currentCloudState: () -> CloudAccountState,
    val currentServerConfiguration: () -> CloudServiceConfiguration,
    val currentSyncStatus: () -> SyncStatus,
    val currentUiLocaleTag: () -> String?,
    observability: AppObservability
) {
    val appVersion: String = appVersion
    val observability: AppObservability = createAiChatRuntimeObservability(
        observability = observability,
        appVersion = appVersion,
        versionCode = versionCode
    )

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
    var activeDictationJob: Job? = null
    var activeLiveJob: Job? = null
    var activeWarmUpJob: Job? = null
    var activeBootstrapJob: Job? = null
    var activeFreshSessionJob: Job? = null
    var activeFreshSessionTargetSessionId: String? = null
    var pendingWarmUpAfterWorkspaceSwitch: Boolean = false
    var lastBootstrapFailureRetryable: Boolean = false
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

    fun persistCurrentStatePreservingDraft(draftState: AiChatDraftState) {
        persistStatePreservingDraft(
            snapshot = runtimeStateMutable.value,
            draftState = draftState
        )
    }

    fun persistCurrentDraft() {
        persistDraft(snapshot = runtimeStateMutable.value)
    }

    fun persistState(snapshot: AiChatRuntimeState) {
        persistStateWithDraft(
            snapshot = snapshot,
            draftState = snapshot.toDraftState()
        )
    }

    fun persistStatePreservingDraft(
        snapshot: AiChatRuntimeState,
        draftState: AiChatDraftState
    ) {
        persistStateWithDraft(
            snapshot = snapshot,
            draftState = draftState
        )
    }

    private fun persistStateWithDraft(
        snapshot: AiChatRuntimeState,
        draftState: AiChatDraftState
    ) {
        val requestVersion = persistedStateWriteRequestVersion.incrementAndGet()
        scope.launch {
            persistedStateWriteMutex.withLock {
                if (requestVersion != persistedStateWriteRequestVersion.get()) {
                    return@withLock
                }
                persistStateSnapshot(
                    snapshot = snapshot,
                    draftState = draftState
                )
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
            persistStateSnapshot(
                snapshot = snapshot,
                draftState = snapshot.toDraftState()
            )
        }
    }

    private suspend fun persistStateSnapshot(
        snapshot: AiChatRuntimeState,
        draftState: AiChatDraftState
    ) {
        aiChatRepository.savePersistedState(
            workspaceId = snapshot.workspaceId,
            state = snapshot.persistedState
        )
        val chatSessionId = snapshot.persistedState.chatSessionId.ifBlank { null }
        if (chatSessionId != null) {
            aiChatRepository.saveDraftState(
                workspaceId = snapshot.workspaceId,
                sessionId = chatSessionId,
                state = draftState
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
            observability.recordAiChatWarning(
                warning = AiChatWarning.PostRunSyncFailed(
                    workspaceId = origin.workspaceId,
                    reason = reason,
                    error = error
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
                        observability.recordAiChatWarning(
                            warning = AiChatWarning.PostRunSyncFlagPersistFailed(
                                workspaceId = currentState.workspaceId,
                                reason = reason,
                                error = error
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
                    observability.recordAiChatWarning(
                        warning = AiChatWarning.PostRunSyncFlagPersistFailed(
                            workspaceId = origin.workspaceId,
                            reason = reason,
                            error = error
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

private fun AiChatRuntimeState.toDraftState(): AiChatDraftState {
    return AiChatDraftState(
        draftMessage = draftMessage,
        pendingAttachments = pendingAttachments
    )
}
