package com.flashcardsopensourceapp.feature.ai

import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.aiChatConsentRequiredMessage
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaButtonTitle
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaReachedMessage
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val noSpeechRecordedMessage: String = "No speech was recorded."
private const val aiChatBootstrapPageLimit: Int = 20
private const val aiChatClientPlatform: String = "android"

private enum class AiServerSnapshotApplyMode {
    ACTIVE,
    PASSIVE
}

private enum class AiLiveAttachDisposition {
    PENDING,
    TERMINAL_EVENT_SEEN
}

internal class AiChatRuntime(
    private val scope: CoroutineScope,
    private val aiChatRepository: AiChatRepository,
    private val syncRepository: SyncRepository,
    private val appVersion: String,
    private val hasConsent: () -> Boolean,
    private val currentCloudState: () -> CloudAccountState,
    private val currentServerConfiguration: () -> CloudServiceConfiguration,
    private val currentSyncStatus: () -> SyncStatus
) {
    private val runtimeStateMutable = MutableStateFlow(makeDefaultAiDraftState())
    private var activeSendJob: Job? = null
    private var activeLiveJob: Job? = null
    private var activeWarmUpJob: Job? = null
    private var activeBootstrapJob: Job? = null
    private var pendingWarmUpAfterWorkspaceSwitch: Boolean = false
    private var lastAppliedMainContentInvalidationVersion: Long = 0L
    private var activeAccessContext: AiAccessContext? = null
    private var isScreenVisible: Boolean = false
    private var nextResumeAttemptId: Long = 0L

    val state: StateFlow<AiChatRuntimeState> = runtimeStateMutable.asStateFlow()

    fun updateAccessContext(accessContext: AiAccessContext) {
        activeAccessContext = accessContext
        activeSendJob?.cancel(
            cause = CancellationException("AI send cancelled because access context changed.")
        )
        activeLiveJob?.cancel(
            cause = CancellationException("AI live attach cancelled because access context changed.")
        )
        activeLiveJob = null
        if (activeBootstrapJob != null) {
            activeBootstrapJob?.cancel(
                cause = CancellationException("AI bootstrap cancelled because access context changed.")
            )
            activeBootstrapJob = null
        }
        if (activeWarmUpJob != null) {
            pendingWarmUpAfterWorkspaceSwitch = true
            AiChatDiagnosticsLogger.info(
                event = "switch_access_context_cancelling_warm_up",
                fields = listOf(
                    "nextWorkspaceId" to accessContext.workspaceId,
                    "currentWorkspaceId" to runtimeStateMutable.value.workspaceId,
                    "cloudState" to accessContext.cloudState.name
                )
            )
            activeWarmUpJob?.cancel(
                cause = CancellationException("AI warm-up cancelled because access context changed.")
            )
        } else {
            pendingWarmUpAfterWorkspaceSwitch = false
        }
        lastAppliedMainContentInvalidationVersion = 0L
        scope.launch {
            val persistedState = aiChatRepository.loadPersistedState(workspaceId = accessContext.workspaceId)
            runtimeStateMutable.value = makeAiDraftState(
                workspaceId = accessContext.workspaceId,
                persistedState = persistedState
            ).copy(
                conversationBootstrapState = if (
                    accessContext.workspaceId != null
                    && hasConsent()
                    && accessContext.cloudState != CloudAccountState.LINKING_READY
                ) {
                    AiConversationBootstrapState.LOADING
                } else {
                    AiConversationBootstrapState.READY
                }
            )
            persistCurrentState()
            if (accessContext.workspaceId == null) {
                return@launch
            }
            if (hasConsent().not()) {
                return@launch
            }
            if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
                return@launch
            }
            startConversationBootstrap(forceReloadState = false, resumeDiagnostics = null)
        }
    }

    fun updateDraftMessage(draftMessage: String) {
        runtimeStateMutable.update { state ->
            state.copy(
                draftMessage = draftMessage,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun applyComposerSuggestion(suggestion: AiChatComposerSuggestion) {
        runtimeStateMutable.update { state ->
            val separator = if (state.draftMessage.isBlank() || state.draftMessage.endsWith(" ")) {
                ""
            } else {
                " "
            }
            state.copy(
                draftMessage = state.draftMessage + separator + suggestion.text,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    private fun updateComposerSuggestions(
        state: AiChatRuntimeState,
        nextSuggestions: List<AiChatComposerSuggestion>
    ): AiChatRuntimeState {
        return state.copy(
            serverComposerSuggestions = nextSuggestions
        )
    }

    fun addPendingAttachment(attachment: AiChatAttachment) {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        runtimeStateMutable.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments + attachment,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun removePendingAttachment(attachmentId: String) {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        runtimeStateMutable.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments.filter { attachment ->
                    attachment.id != attachmentId
                },
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun startDictationPermissionRequest() {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.REQUESTING_PERMISSION,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun startDictationRecording() {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.RECORDING,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun cancelDictation() {
        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null
            )
        }
    }

    fun transcribeRecordedAudio(
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ) {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.dictationState != AiChatDictationState.RECORDING) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                dictationState = AiChatDictationState.TRANSCRIBING,
                activeAlert = null,
                errorMessage = ""
            )
        }

        scope.launch {
            try {
                val transcription = aiChatRepository.transcribeAudio(
                    workspaceId = runtimeStateMutable.value.workspaceId,
                    sessionId = runtimeStateMutable.value.persistedState.chatSessionId.ifBlank { null },
                    fileName = fileName,
                    mediaType = mediaType,
                    audioBytes = audioBytes
                )
                val transcript = transcription.text.trim()

                require(transcript.isNotEmpty()) {
                    noSpeechRecordedMessage
                }

                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = state.persistedState.copy(chatSessionId = transcription.sessionId),
                        draftMessage = appendTranscriptToDraft(
                            currentDraft = state.draftMessage,
                            transcript = transcript
                        ),
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
                persistCurrentState()
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "dictation_transcription_cancelled",
                    fields = listOf(
                        "workspaceId" to runtimeStateMutable.value.workspaceId,
                        "cloudState" to currentCloudState().name,
                        "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.DICTATION,
                    configuration = currentServerConfiguration()
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = AiAlertState.GeneralError(message = message),
                        errorMessage = ""
                    )
                }
            }
        }
    }

    fun clearConversation() {
        if (runtimeStateMutable.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        val requestedSessionId = runtimeStateMutable.value.persistedState.chatSessionId.ifBlank { null }
        detachLiveStream(reason = "AI live stream detached because a new chat was requested.")
        runtimeStateMutable.update { state ->
            state.copy(
                persistedState = state.persistedState.copy(
                    messages = emptyList(),
                    chatSessionId = "",
                    lastKnownChatConfig = state.persistedState.lastKnownChatConfig
                ),
                conversationScopeId = null,
                hasOlder = false,
                oldestCursor = null,
                activeRun = null,
                isLiveAttached = false,
                draftMessage = "",
                pendingAttachments = emptyList(),
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
        persistCurrentState()

        scope.launch {
            try {
                val snapshot = aiChatRepository.createNewSession(
                    workspaceId = runtimeStateMutable.value.workspaceId,
                    sessionId = requestedSessionId
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = state.persistedState.copy(
                            messages = emptyList(),
                            chatSessionId = snapshot.sessionId,
                            lastKnownChatConfig = snapshot.chatConfig
                        ),
                        conversationScopeId = snapshot.conversationScopeId,
                        hasOlder = false,
                        oldestCursor = null,
                        activeRun = null,
                        isLiveAttached = false,
                        draftMessage = "",
                        pendingAttachments = emptyList(),
                        serverComposerSuggestions = snapshot.composerSuggestions,
                        composerPhase = AiComposerPhase.IDLE,
                        dictationState = AiChatDictationState.IDLE,
                        conversationBootstrapState = AiConversationBootstrapState.READY,
                        conversationBootstrapErrorMessage = "",
                        repairStatus = null,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
                persistCurrentState()
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "new_chat_cancelled",
                    fields = listOf(
                        "workspaceId" to runtimeStateMutable.value.workspaceId,
                        "cloudState" to currentCloudState().name,
                        "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                handleNewChatFailure(error = error)
            }
        }
    }

    fun dismissErrorMessage() {
        runtimeStateMutable.update { state ->
            state.copy(errorMessage = "")
        }
    }

    fun dismissAlert() {
        runtimeStateMutable.update { state ->
            state.copy(activeAlert = null)
        }
    }

    fun stopStreaming() {
        if (runtimeStateMutable.value.composerPhase != AiComposerPhase.RUNNING) {
            return
        }

        val sessionId = runtimeStateMutable.value.persistedState.chatSessionId
        val workspaceId = runtimeStateMutable.value.workspaceId

        runtimeStateMutable.update { state ->
            state.copy(
                composerPhase = AiComposerPhase.STOPPING,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentState()

        scope.launch {
            try {
                if (sessionId.isNotBlank()) {
                    val response = aiChatRepository.stopRun(
                        workspaceId = workspaceId,
                        sessionId = sessionId
                    )
                    if (response.stopped && response.stillRunning.not()) {
                        finalizeStoppedConversation()
                        return@launch
                    }
                    if (
                        activeSendJob?.isActive != true
                        && activeLiveJob?.isActive != true
                        && runtimeStateMutable.value.activeRun == null
                    ) {
                        finalizeStoppedConversation()
                    }
                    return@launch
                }
                finalizeStoppedConversation()
            } catch (_: CancellationException) {
                throw CancellationException("Stop run cancelled.")
            } catch (_: Exception) {
                finalizeStoppedConversation()
            }
        }
    }

    fun applyEntryPrefill(prefill: AiEntryPrefill) {
        val currentState = runtimeStateMutable.value
        if (
            currentState.conversationBootstrapState != AiConversationBootstrapState.READY
            || currentState.composerPhase != AiComposerPhase.IDLE
            || currentState.dictationState != AiChatDictationState.IDLE
        ) {
            return
        }

        runtimeStateMutable.update { state ->
            state.copy(
                draftMessage = aiEntryPrefillPrompt(prefill = prefill),
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun showAlert(alert: AiAlertState) {
        runtimeStateMutable.update { state ->
            state.copy(
                activeAlert = alert,
                errorMessage = ""
            )
        }
    }

    fun showErrorMessage(message: String) {
        runtimeStateMutable.update { state ->
            state.copy(
                activeAlert = AiAlertState.GeneralError(message = message),
                errorMessage = ""
            )
        }
    }

    fun retryBootstrap() {
        if (hasConsent().not()) {
            return
        }
        if (runtimeStateMutable.value.workspaceId == null) {
            return
        }

        startConversationBootstrap(forceReloadState = true, resumeDiagnostics = null)
    }

    fun onScreenVisible() {
        isScreenVisible = true
        warmUpLinkedSessionIfNeeded(resumeDiagnostics = nextResumeDiagnostics())
    }

    fun onScreenHidden() {
        isScreenVisible = false
        detachLiveStream(reason = "AI live stream detached because the screen is no longer visible.")
    }

    fun warmUpLinkedSessionIfNeeded(resumeDiagnostics: AiChatResumeDiagnostics?) {
        val currentState = runtimeStateMutable.value
        val accessContext = activeAccessContext
        if (
            currentState.composerPhase == AiComposerPhase.PREPARING_SEND
            || currentState.composerPhase == AiComposerPhase.STARTING_RUN
        ) {
            return
        }
        if (hasConsent().not()) {
            return
        }
        if (accessContext?.workspaceId == null) {
            return
        }
        if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
            return
        }
        if (activeWarmUpJob != null) {
            return
        }

        var warmUpJob: Job? = null
        warmUpJob = scope.launch {
            try {
                startConversationBootstrap(
                    forceReloadState = false,
                    resumeDiagnostics = resumeDiagnostics
                )
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "warm_up_cancelled",
                    fields = listOf(
                        "workspaceId" to accessContext.workspaceId,
                        "currentWorkspaceId" to runtimeStateMutable.value.workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "retryAfterWorkspaceSwitch" to pendingWarmUpAfterWorkspaceSwitch.toString(),
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                AiChatDiagnosticsLogger.error(
                    event = "warm_up_failed",
                    fields = listOf(
                        "workspaceId" to accessContext.workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "message" to error.message
                    ) + remoteErrorFields(error = error as? AiChatRemoteException),
                    throwable = error
                )
                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.CHAT,
                    configuration = currentServerConfiguration()
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        activeAlert = AiAlertState.GeneralError(message = message),
                        errorMessage = ""
                    )
                }
            } finally {
                val shouldRetryWarmUp = pendingWarmUpAfterWorkspaceSwitch
                if (activeWarmUpJob === warmUpJob) {
                    activeWarmUpJob = null
                }
                if (shouldRetryWarmUp) {
                    pendingWarmUpAfterWorkspaceSwitch = false
                    warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
                }
            }
        }
        activeWarmUpJob = warmUpJob
    }

    fun sendMessage() {
        val currentState = runtimeStateMutable.value
        if (canSendMessage(state = currentState).not()) {
            if (hasConsent().not()) {
                runtimeStateMutable.update { state ->
                    state.copy(
                        activeAlert = AiAlertState.GeneralError(message = aiChatConsentRequiredMessage),
                        errorMessage = ""
                    )
                }
            }
            return
        }

        val outgoingContent = makeUserContent(
            draftMessage = currentState.draftMessage,
            pendingAttachments = currentState.pendingAttachments
        )
        if (outgoingContent.isEmpty()) {
            return
        }

        AiChatDiagnosticsLogger.info(
            event = "ui_send_message_requested",
            fields = listOf(
                "workspaceId" to currentState.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to currentState.persistedState.chatSessionId,
                "messageCount" to currentState.persistedState.messages.size.toString(),
                "pendingAttachmentCount" to currentState.pendingAttachments.size.toString(),
                "outgoingContentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = outgoingContent)
            )
        )

        runtimeStateMutable.update { state ->
            state.copy(
                composerPhase = AiComposerPhase.PREPARING_SEND,
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }

        val previousPersistedState = runtimeStateMutable.value.persistedState
        val nextPersistedState = runtimeStateMutable.value.persistedState.copy(
            messages = runtimeStateMutable.value.persistedState.messages + listOf(
                makeUserMessage(
                    content = outgoingContent,
                    timestampMillis = System.currentTimeMillis()
                ),
                makeAssistantStatusMessage(
                    timestampMillis = System.currentTimeMillis()
                )
            )
        )
        val draftMessageBackup = runtimeStateMutable.value.draftMessage
        val pendingAttachmentsBackup = runtimeStateMutable.value.pendingAttachments

        activeSendJob?.cancel()
        activeSendJob = scope.launch {
            var didAcceptRun = false
            var didAppendOptimisticMessages = false
            try {
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = nextPersistedState,
                        composerPhase = AiComposerPhase.STARTING_RUN
                    )
                }
                persistCurrentState()
                didAppendOptimisticMessages = true

                val response = aiChatRepository.startRun(
                    workspaceId = runtimeStateMutable.value.workspaceId,
                    state = nextPersistedState,
                    content = outgoingContent
                )
                didAcceptRun = true
                applyAcceptedRunResponse(response = response)
            } catch (error: CancellationException) {
                throw error
            } catch (error: AiChatRemoteException) {
                handleSendFailure(
                    error = error,
                    didAcceptRun = didAcceptRun,
                    didAppendOptimisticMessages = didAppendOptimisticMessages,
                    previousPersistedState = previousPersistedState,
                    draftMessage = draftMessageBackup,
                    pendingAttachments = pendingAttachmentsBackup
                )
            } catch (error: Exception) {
                handleSendFailure(
                    error = error,
                    didAcceptRun = didAcceptRun,
                    didAppendOptimisticMessages = didAppendOptimisticMessages,
                    previousPersistedState = previousPersistedState,
                    draftMessage = draftMessageBackup,
                    pendingAttachments = pendingAttachmentsBackup
                )
            } finally {
                runtimeStateMutable.update { state ->
                    state.copy(
                        composerPhase = when (state.composerPhase) {
                            AiComposerPhase.RUNNING, AiComposerPhase.STOPPING -> state.composerPhase
                            else -> AiComposerPhase.IDLE
                        },
                        isLiveAttached = if (state.composerPhase == AiComposerPhase.RUNNING || state.composerPhase == AiComposerPhase.STOPPING) {
                            state.isLiveAttached
                        } else {
                            false
                        },
                        repairStatus = null
                    )
                }
                persistCurrentState()
                activeSendJob = null
            }
        }
    }

    private fun nextResumeDiagnostics(): AiChatResumeDiagnostics {
        nextResumeAttemptId += 1L
        return AiChatResumeDiagnostics(
            resumeAttemptId = nextResumeAttemptId,
            clientPlatform = aiChatClientPlatform,
            clientVersion = appVersion
        )
    }

    private fun updateActiveRunCursor(activeRun: AiChatActiveRun?, cursor: String?): AiChatActiveRun? {
        if (activeRun == null) {
            return null
        }
        return activeRun.copy(
            live = activeRun.live.copy(cursor = cursor)
        )
    }

    private fun isCurrentLiveEvent(event: AiChatLiveEvent): Boolean {
        val activeRun = runtimeStateMutable.value.activeRun ?: return false
        val metadata = when (event) {
            is AiChatLiveEvent.AssistantDelta -> event.metadata
            is AiChatLiveEvent.AssistantToolCall -> event.metadata
            is AiChatLiveEvent.AssistantReasoningStarted -> event.metadata
            is AiChatLiveEvent.AssistantReasoningSummary -> event.metadata
            is AiChatLiveEvent.AssistantReasoningDone -> event.metadata
            is AiChatLiveEvent.AssistantMessageDone -> event.metadata
            is AiChatLiveEvent.ComposerSuggestionsUpdated -> event.metadata
            is AiChatLiveEvent.RepairStatus -> event.metadata
            is AiChatLiveEvent.RunTerminal -> event.metadata
        }
        return metadata.sessionId == runtimeStateMutable.value.persistedState.chatSessionId
            && metadata.runId == activeRun.runId
    }

    private fun canSendMessage(state: AiChatRuntimeState): Boolean {
        if (hasConsent().not()) {
            return false
        }
        if (state.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return false
        }
        if (state.composerPhase != AiComposerPhase.IDLE) {
            return false
        }
        if (state.activeRun != null) {
            return false
        }
        if (state.dictationState != AiChatDictationState.IDLE) {
            return false
        }
        return state.draftMessage.trim().isNotEmpty() || state.pendingAttachments.isNotEmpty()
    }

    private suspend fun applyAcceptedRunResponse(response: AiChatStartRunResponse) {
        runtimeStateMutable.update { state ->
            updateComposerSuggestions(
                state = state.copy(
                persistedState = state.persistedState.copy(
                    messages = response.conversation.messages,
                    chatSessionId = response.sessionId,
                    lastKnownChatConfig = response.chatConfig
                ),
                conversationScopeId = response.conversationScopeId,
                hasOlder = response.conversation.hasOlder,
                oldestCursor = response.conversation.oldestCursor,
                activeRun = response.activeRun,
                isLiveAttached = false,
                draftMessage = "",
                pendingAttachments = emptyList(),
                composerPhase = if (response.activeRun != null) {
                    AiComposerPhase.RUNNING
                } else {
                    AiComposerPhase.IDLE
                },
                dictationState = AiChatDictationState.IDLE,
                activeAlert = null,
                errorMessage = ""
                ),
                nextSuggestions = response.composerSuggestions
            )
        }
        if (response.activeRun != null) {
            attachAcceptedLiveStreamIfNeeded(
                workspaceId = runtimeStateMutable.value.workspaceId,
                response = response
            )
        }
        persistCurrentState()
    }

    private suspend fun applyLiveEvent(event: AiChatLiveEvent) {
        if (isCurrentLiveEvent(event).not()) {
            return
        }
        when (event) {
            is AiChatLiveEvent.AssistantDelta -> {
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = upsertAssistantText(
                            state = state.persistedState,
                            text = event.text,
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        )
                    )
                }
            }

            is AiChatLiveEvent.AssistantToolCall -> {
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = upsertAssistantToolCall(
                            state = state.persistedState,
                            toolCall = event.toolCall,
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantReasoningStarted -> {
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = upsertAssistantReasoningSummary(
                            state = state.persistedState,
                            reasoningSummary = AiChatReasoningSummary(
                                reasoningId = event.reasoningId,
                                summary = "",
                                status = AiChatToolCallStatus.STARTED
                            ),
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantReasoningSummary -> {
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = upsertAssistantReasoningSummary(
                            state = state.persistedState,
                            reasoningSummary = event.reasoningSummary,
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantReasoningDone -> {
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = completeAssistantReasoningSummary(
                            state = state.persistedState,
                            reasoningId = event.reasoningId,
                            itemId = event.itemId,
                            cursor = requireNotNull(event.metadata.cursor)
                        ),
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.AssistantMessageDone -> {
                val finalizedState = finalizeAssistantMessage(
                    state = runtimeStateMutable.value.persistedState,
                    content = event.content,
                    itemId = event.itemId,
                    cursor = event.metadata.cursor ?: "",
                    isError = event.isError,
                    isStopped = event.isStopped
                )
                if (finalizedState == null) {
                    startConversationBootstrap(forceReloadState = true, resumeDiagnostics = null)
                    return
                }
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = finalizedState,
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatLiveEvent.ComposerSuggestionsUpdated -> {
                runtimeStateMutable.update { state ->
                    updateComposerSuggestions(
                        state = state,
                        nextSuggestions = event.suggestions
                    )
                }
            }

            is AiChatLiveEvent.RepairStatus -> {
                runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = updateActiveRunCursor(
                            activeRun = state.activeRun,
                            cursor = event.metadata.cursor
                        ),
                        repairStatus = event.status
                    )
                }
            }

            is AiChatLiveEvent.RunTerminal -> when (event.outcome) {
                AiChatRunTerminalOutcome.RESET_REQUIRED -> {
                    startConversationBootstrap(forceReloadState = true, resumeDiagnostics = null)
                    return
                }

                AiChatRunTerminalOutcome.COMPLETED -> {
                    runtimeStateMutable.update { state ->
                        state.copy(
                            activeRun = null,
                            isLiveAttached = false,
                            composerPhase = AiComposerPhase.IDLE,
                            repairStatus = null,
                            errorMessage = ""
                        )
                    }
                }

                AiChatRunTerminalOutcome.STOPPED -> {
                    finalizeStoppedConversation()
                    return
                }

                AiChatRunTerminalOutcome.ERROR -> {
                    runtimeStateMutable.update { state ->
                        state.copy(
                            activeRun = null,
                            isLiveAttached = false,
                            serverComposerSuggestions = emptyList(),
                            composerPhase = AiComposerPhase.IDLE,
                            repairStatus = null,
                            activeAlert = AiAlertState.GeneralError(
                                message = event.message
                                    ?: latestAssistantErrorMessage(messages = state.persistedState.messages)
                                    ?: "AI chat failed."
                            ),
                            errorMessage = ""
                        )
                    }
                }
            }
        }
        persistCurrentState()
    }

    private fun handleSendFailure(
        error: Exception,
        didAcceptRun: Boolean,
        didAppendOptimisticMessages: Boolean,
        previousPersistedState: com.flashcardsopensourceapp.data.local.model.AiChatPersistedState,
        draftMessage: String,
        pendingAttachments: List<AiChatAttachment>
    ) {
        val remoteError = error as? AiChatRemoteException
        if (remoteError?.code == "GUEST_AI_LIMIT_REACHED") {
            AiChatDiagnosticsLogger.warn(
                event = "send_failure_guest_quota_reached",
                fields = listOf(
                    "workspaceId" to runtimeStateMutable.value.workspaceId,
                    "cloudState" to currentCloudState().name,
                    "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                    "requestId" to remoteError.requestId,
                    "statusCode" to remoteError.statusCode?.toString(),
                    "code" to remoteError.code,
                    "stage" to remoteError.stage
                )
            )
            runtimeStateMutable.update { state ->
                state.copy(
                    persistedState = appendAssistantAccountUpgradePrompt(
                        state = state.persistedState,
                        message = aiChatGuestQuotaReachedMessage,
                        buttonTitle = aiChatGuestQuotaButtonTitle,
                        timestampMillis = System.currentTimeMillis()
                    ),
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    errorMessage = ""
                )
            }
            return
        }

        if (didAcceptRun.not() && didAppendOptimisticMessages) {
            runtimeStateMutable.update { state ->
                state.copy(
                    persistedState = previousPersistedState,
                    draftMessage = draftMessage,
                    pendingAttachments = pendingAttachments,
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    repairStatus = null
                )
            }
        }

        if (didAcceptRun.not() && remoteError?.code == "CHAT_ACTIVE_RUN_IN_PROGRESS") {
            runtimeStateMutable.update { state ->
                state.copy(
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    activeAlert = AiAlertState.GeneralError(
                        message = "A response is already in progress. Wait for it to finish or stop it before sending another message."
                    ),
                    errorMessage = ""
                )
            }
            return
        }

        val message = makeAiUserFacingErrorMessage(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = currentServerConfiguration()
        )
        val previousState = runtimeStateMutable.value.persistedState
        val repairedState = clearMissingChatSessionIdIfNeeded(
            state = previousState,
            error = error
        )
        AiChatDiagnosticsLogger.error(
            event = "send_failure_handled",
            fields = listOf(
                "workspaceId" to runtimeStateMutable.value.workspaceId,
                "cloudState" to currentCloudState().name,
                "previousChatSessionId" to previousState.chatSessionId,
                "repairedChatSessionId" to repairedState.chatSessionId,
                "clearedMissingChatSessionId" to (previousState.chatSessionId != repairedState.chatSessionId).toString(),
                "messageCount" to previousState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )
        runtimeStateMutable.update { state ->
            state.copy(
                persistedState = repairedState,
                activeRun = null,
                isLiveAttached = false,
                composerPhase = AiComposerPhase.IDLE,
                activeAlert = AiAlertState.GeneralError(message = message),
                errorMessage = ""
            )
        }
    }

    private fun handleNewChatFailure(error: Exception) {
        val remoteError = error as? AiChatRemoteException
        val message = makeAiUserFacingErrorMessage(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = currentServerConfiguration()
        )

        AiChatDiagnosticsLogger.error(
            event = "new_chat_failure_handled",
            fields = listOf(
                "workspaceId" to runtimeStateMutable.value.workspaceId,
                "cloudState" to currentCloudState().name,
                "chatSessionId" to runtimeStateMutable.value.persistedState.chatSessionId,
                "messageCount" to runtimeStateMutable.value.persistedState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )

        runtimeStateMutable.update { state ->
            state.copy(
                activeAlert = AiAlertState.GeneralError(message = message),
                errorMessage = ""
            )
        }
    }

    private fun startConversationBootstrap(
        forceReloadState: Boolean,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ) {
        val accessContext = activeAccessContext ?: return
        val workspaceId = accessContext.workspaceId ?: return
        if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
            return
        }

        activeBootstrapJob?.cancel(
            cause = CancellationException("AI bootstrap restarted.")
        )
        var bootstrapJob: Job? = null
        bootstrapJob = scope.launch {
            try {
                activeLiveJob?.cancel(
                    cause = CancellationException("AI live attach cancelled because bootstrap restarted.")
                )
                activeLiveJob = null
                if (forceReloadState) {
                    val persistedState = aiChatRepository.loadPersistedState(workspaceId = workspaceId)
                    runtimeStateMutable.update { state ->
                        state.copy(
                            workspaceId = workspaceId,
                            persistedState = persistedState,
                            conversationScopeId = null,
                            hasOlder = false,
                            oldestCursor = null,
                            activeRun = null,
                            isLiveAttached = false,
                            draftMessage = "",
                            pendingAttachments = emptyList(),
                            composerPhase = AiComposerPhase.IDLE,
                            dictationState = AiChatDictationState.IDLE,
                            conversationBootstrapState = AiConversationBootstrapState.LOADING,
                            conversationBootstrapErrorMessage = "",
                            repairStatus = null,
                            activeAlert = null,
                            errorMessage = ""
                        )
                    }
                } else {
                    runtimeStateMutable.update { state ->
                        state.copy(
                            activeRun = state.activeRun,
                            isLiveAttached = false,
                            composerPhase = AiComposerPhase.IDLE,
                            dictationState = AiChatDictationState.IDLE,
                            conversationBootstrapState = AiConversationBootstrapState.LOADING,
                            conversationBootstrapErrorMessage = "",
                            repairStatus = null,
                            activeAlert = null,
                            errorMessage = ""
                        )
                    }
                }

                val blockedSyncMessage = syncBlockedMessageOrNull()
                if (blockedSyncMessage != null) {
                    throw IllegalStateException(blockedSyncMessage)
                }

                aiChatRepository.prepareSessionForAi(workspaceId = workspaceId)
                if (activeAccessContext != accessContext) {
                    return@launch
                }

                val persistedState = aiChatRepository.loadPersistedState(workspaceId = workspaceId)
                val bootstrap = aiChatRepository.loadBootstrap(
                    workspaceId = workspaceId,
                    sessionId = persistedState.chatSessionId.ifBlank { null },
                    limit = aiChatBootstrapPageLimit,
                    resumeDiagnostics = resumeDiagnostics
                )
                if (activeAccessContext != accessContext) {
                    return@launch
                }

                applyBootstrap(
                    response = bootstrap,
                    applyMode = if (forceReloadState) {
                        AiServerSnapshotApplyMode.ACTIVE
                    } else {
                        AiServerSnapshotApplyMode.PASSIVE
                    }
                )
                attachBootstrapLiveIfNeeded(
                    workspaceId = workspaceId,
                    response = bootstrap,
                    resumeDiagnostics = resumeDiagnostics
                )
            } catch (error: CancellationException) {
                AiChatDiagnosticsLogger.info(
                    event = "conversation_bootstrap_cancelled",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                if (activeAccessContext != accessContext) {
                    return@launch
                }

                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.CHAT,
                    configuration = currentServerConfiguration()
                )
                AiChatDiagnosticsLogger.error(
                    event = "conversation_bootstrap_failed",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "cloudState" to accessContext.cloudState.name,
                        "userFacingMessage" to message
                    ) + remoteErrorFields(error = error as? AiChatRemoteException),
                    throwable = error
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        persistedState = state.persistedState.copy(
                            messages = emptyList(),
                            chatSessionId = ""
                        ),
                        conversationScopeId = null,
                        hasOlder = false,
                        oldestCursor = null,
                        activeRun = null,
                        isLiveAttached = false,
                        draftMessage = "",
                        pendingAttachments = emptyList(),
                        composerPhase = AiComposerPhase.IDLE,
                        dictationState = AiChatDictationState.IDLE,
                        conversationBootstrapState = AiConversationBootstrapState.FAILED,
                        conversationBootstrapErrorMessage = message,
                        repairStatus = null,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
            } finally {
                if (activeBootstrapJob === bootstrapJob) {
                    activeBootstrapJob = null
                }
            }
        }
        activeBootstrapJob = bootstrapJob
    }

    private fun syncBlockedMessageOrNull(): String? {
        val syncStatus = currentSyncStatus()
        return if (syncStatus is SyncStatus.Blocked) {
            syncStatus.message
        } else {
            null
        }
    }

    private fun attachBootstrapLiveIfNeeded(
        workspaceId: String,
        response: AiChatBootstrapResponse,
        resumeDiagnostics: AiChatResumeDiagnostics?
    ) {
        val activeRun = response.activeRun
        if (activeRun == null) {
            detachLiveStream(reason = "AI live stream detached because the run is no longer active.")
            return
        }
        if (isScreenVisible.not()) {
            detachLiveStream(reason = "AI live stream detached because the screen is hidden.")
            return
        }

        attachLiveStream(
            workspaceId = workspaceId,
            sessionId = response.sessionId,
            runId = activeRun.runId,
            liveStream = activeRun.live.stream,
            afterCursor = activeRun.live.cursor,
            resumeDiagnostics = resumeDiagnostics,
            cancellationMessage = "AI live attach restarted from bootstrap."
        )
    }

    private fun attachAcceptedLiveStreamIfNeeded(
        workspaceId: String?,
        response: AiChatStartRunResponse
    ) {
        val activeRun = response.activeRun ?: return
        if (activeRun.status != "running") {
            return
        }
        if (isScreenVisible.not()) {
            return
        }
        attachLiveStream(
            workspaceId = workspaceId,
            sessionId = response.sessionId,
            runId = activeRun.runId,
            liveStream = activeRun.live.stream,
            afterCursor = activeRun.live.cursor,
            resumeDiagnostics = null,
            cancellationMessage = "AI live attach restarted from accepted run."
        )
    }

    private fun attachLiveStream(
        workspaceId: String?,
        sessionId: String,
        runId: String,
        liveStream: com.flashcardsopensourceapp.data.local.model.AiChatLiveStreamEnvelope,
        afterCursor: String?,
        resumeDiagnostics: AiChatResumeDiagnostics?,
        cancellationMessage: String
    ) {
        activeLiveJob?.cancel(
            cause = CancellationException(cancellationMessage)
        )
        var liveJob: Job? = null
        liveJob = scope.launch {
            var liveAttachDisposition = AiLiveAttachDisposition.PENDING
            runtimeStateMutable.update { state ->
                state.copy(isLiveAttached = true)
            }
            persistCurrentState()
            try {
                aiChatRepository.attachLiveRun(
                    workspaceId = workspaceId,
                    sessionId = sessionId,
                    runId = runId,
                    liveStream = liveStream,
                    afterCursor = afterCursor,
                    resumeDiagnostics = resumeDiagnostics
                ).collect { event ->
                    if (event is AiChatLiveEvent.RunTerminal) {
                        liveAttachDisposition = AiLiveAttachDisposition.TERMINAL_EVENT_SEEN
                    }
                    applyLiveEvent(event = event)
                }
                if (
                    liveAttachDisposition == AiLiveAttachDisposition.PENDING
                    && isScreenVisible
                ) {
                    reconcileUnexpectedLiveStreamDetach(
                        workspaceId = workspaceId,
                        sessionId = sessionId
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.CHAT,
                    configuration = currentServerConfiguration()
                )
                runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = null,
                        isLiveAttached = false,
                        composerPhase = AiComposerPhase.IDLE,
                        repairStatus = null,
                        activeAlert = AiAlertState.GeneralError(message = message),
                        errorMessage = ""
                    )
                }
                persistCurrentState()
            } finally {
                if (activeLiveJob === liveJob) {
                    activeLiveJob = null
                }
                runtimeStateMutable.update { state ->
                    if (state.composerPhase == AiComposerPhase.RUNNING || state.composerPhase == AiComposerPhase.STOPPING) {
                        state
                    } else {
                        state.copy(isLiveAttached = false)
                    }
                }
                persistCurrentState()
            }
        }
        activeLiveJob = liveJob
    }

    private suspend fun reconcileUnexpectedLiveStreamDetach(
        workspaceId: String?,
        sessionId: String
    ) {
        try {
            val bootstrap = aiChatRepository.loadBootstrap(
                workspaceId = workspaceId,
                sessionId = sessionId,
                limit = aiChatBootstrapPageLimit,
                resumeDiagnostics = null
            )
            applyBootstrap(
                response = bootstrap,
                applyMode = AiServerSnapshotApplyMode.ACTIVE
            )

            val errorMessage = latestAssistantErrorMessage(messages = bootstrap.conversation.messages)
            if (errorMessage != null) {
                runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = null,
                        composerPhase = AiComposerPhase.IDLE,
                        activeAlert = AiAlertState.GeneralError(message = errorMessage),
                        errorMessage = ""
                    )
                }
                persistCurrentState()
                return
            }

            if (bootstrap.activeRun != null) {
                runtimeStateMutable.update { state ->
                    state.copy(
                        activeRun = null,
                        isLiveAttached = false,
                        composerPhase = AiComposerPhase.IDLE,
                        repairStatus = null,
                        activeAlert = AiAlertState.GeneralError(
                            message = "AI live stream ended before message completion."
                        ),
                        errorMessage = ""
                    )
                }
                persistCurrentState()
            }
        } catch (error: Exception) {
            val message = makeAiUserFacingErrorMessage(
                error = error,
                surface = AiErrorSurface.CHAT,
                configuration = currentServerConfiguration()
            )
            runtimeStateMutable.update { state ->
                state.copy(
                    activeRun = null,
                    isLiveAttached = false,
                    composerPhase = AiComposerPhase.IDLE,
                    repairStatus = null,
                    activeAlert = AiAlertState.GeneralError(message = message),
                    errorMessage = ""
                )
            }
            persistCurrentState()
        }
    }

    private fun detachLiveStream(reason: String) {
        activeLiveJob?.cancel(
            cause = CancellationException(reason)
        )
        activeLiveJob = null
        runtimeStateMutable.update { state ->
            state.copy(isLiveAttached = false)
        }
        persistCurrentState()
    }

    private suspend fun applyBootstrap(
        response: AiChatBootstrapResponse,
        applyMode: AiServerSnapshotApplyMode
    ) {
        runtimeStateMutable.update { state ->
            val preserveLocalComposerState =
                applyMode == AiServerSnapshotApplyMode.PASSIVE
                    && state.composerPhase == AiComposerPhase.IDLE
                    && state.conversationBootstrapState == AiConversationBootstrapState.READY
            updateComposerSuggestions(
                state = state.copy(
                persistedState = state.persistedState.copy(
                    messages = response.conversation.messages,
                    chatSessionId = response.sessionId,
                    lastKnownChatConfig = response.chatConfig
                ),
                conversationScopeId = response.conversationScopeId,
                hasOlder = response.conversation.hasOlder,
                oldestCursor = response.conversation.oldestCursor,
                activeRun = response.activeRun,
                isLiveAttached = false,
                draftMessage = if (preserveLocalComposerState) state.draftMessage else "",
                pendingAttachments = if (preserveLocalComposerState) state.pendingAttachments else emptyList(),
                composerPhase = if (response.activeRun != null) {
                    AiComposerPhase.RUNNING
                } else {
                    AiComposerPhase.IDLE
                },
                dictationState = if (preserveLocalComposerState) {
                    state.dictationState
                } else {
                    AiChatDictationState.IDLE
                },
                conversationBootstrapState = AiConversationBootstrapState.READY,
                conversationBootstrapErrorMessage = "",
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
                ),
                nextSuggestions = response.composerSuggestions
            )
        }
        persistCurrentState()
    }

    private fun finalizeStoppedConversation() {
        runtimeStateMutable.update { state ->
            state.copy(
                persistedState = clearOptimisticAssistantStatusIfNeeded(state = state.persistedState),
                activeRun = null,
                isLiveAttached = false,
                serverComposerSuggestions = emptyList(),
                composerPhase = AiComposerPhase.IDLE,
                repairStatus = null
            )
        }
        persistCurrentState()
    }

    private suspend fun syncMainContentIfInvalidated(
        workspaceId: String?,
        mainContentInvalidationVersion: Long
    ) {
        if (workspaceId == null) {
            return
        }
        if (
            currentCloudState() != CloudAccountState.LINKED
            && currentCloudState() != CloudAccountState.GUEST
        ) {
            return
        }
        if (mainContentInvalidationVersion <= 0L) {
            return
        }
        if (mainContentInvalidationVersion <= lastAppliedMainContentInvalidationVersion) {
            return
        }

        try {
            syncRepository.syncNow()
            lastAppliedMainContentInvalidationVersion = mainContentInvalidationVersion
        } catch (error: CancellationException) {
            AiChatDiagnosticsLogger.info(
                event = "main_content_refresh_cancelled",
                fields = listOf(
                    "workspaceId" to workspaceId,
                    "mainContentInvalidationVersion" to mainContentInvalidationVersion.toString(),
                    "cloudState" to currentCloudState().name,
                    "message" to error.message
                )
            )
            throw error
        } catch (error: Exception) {
            val message = error.message ?: error.javaClass.simpleName
            AiChatDiagnosticsLogger.error(
                event = "main_content_refresh_failed",
                fields = listOf(
                    "workspaceId" to workspaceId,
                    "mainContentInvalidationVersion" to mainContentInvalidationVersion.toString(),
                    "cloudState" to currentCloudState().name,
                    "message" to message
                ),
                throwable = error
            )
            runtimeStateMutable.update { state ->
                state.copy(
                    activeAlert = AiAlertState.GeneralError(message = "Chat content refresh failed. $message"),
                    errorMessage = ""
                )
            }
        }
    }

    private fun persistCurrentState() {
        val snapshot = runtimeStateMutable.value
        scope.launch {
            aiChatRepository.savePersistedState(
                workspaceId = snapshot.workspaceId,
                state = snapshot.persistedState
            )
        }
    }
}
