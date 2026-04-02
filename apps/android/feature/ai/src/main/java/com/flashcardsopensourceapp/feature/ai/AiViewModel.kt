package com.flashcardsopensourceapp.feature.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatActiveRun
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatBootstrapResponse
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatLiveEvent
import com.flashcardsopensourceapp.data.local.model.AiChatReasoningSummary
import com.flashcardsopensourceapp.data.local.model.AiChatResumeDiagnostics
import com.flashcardsopensourceapp.data.local.model.AiChatRunTerminalOutcome
import com.flashcardsopensourceapp.data.local.model.AiChatStartRunResponse
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.aiChatConsentRequiredMessage
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaButtonTitle
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaReachedMessage
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val noSpeechRecordedMessage: String = "No speech was recorded."
private const val aiChatBootstrapPageLimit: Int = 20
private const val aiChatClientPlatform: String = "android"
private const val aiChatClientVersion: String = "1.0.0"

private enum class AiServerSnapshotApplyMode {
    ACTIVE,
    PASSIVE
}

private enum class AiLiveAttachDisposition {
    PENDING,
    TERMINAL_EVENT_SEEN
}

class AiViewModel(
    private val aiChatRepository: AiChatRepository,
    private val syncRepository: SyncRepository,
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository
) : ViewModel() {
    private val workspaceState = workspaceRepository.observeWorkspace().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = null
    )
    private val metadataState = workspaceRepository.observeAppMetadata().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = initialAiAppMetadataSummary()
    )
    private val cloudSettingsState = cloudAccountRepository.observeCloudSettings().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = initialAiCloudSettings()
    )
    private val serverConfigurationState = cloudAccountRepository.observeServerConfiguration().stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = makeOfficialCloudServiceConfiguration()
    )
    private val syncStatusState = syncRepository.observeSyncStatus().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )
    private val consentState = aiChatRepository.observeConsent().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = aiChatRepository.hasConsent()
    )
    private val draftState = MutableStateFlow(
        value = makeDefaultAiDraftState()
    )
    private var activeSendJob: Job? = null
    private var activeLiveJob: Job? = null
    private var activeWarmUpJob: Job? = null
    private var activeBootstrapJob: Job? = null
    private var pendingWarmUpAfterWorkspaceSwitch: Boolean = false
    private var lastAppliedMainContentInvalidationVersion: Long = 0L
    private var lastPreparedGuestWorkspaceId: String? = null
    private var activeAccessContext: AiAccessContext? = null
    private var isScreenVisible: Boolean = false
    private var nextResumeAttemptId: Long = 0L

    val uiState: StateFlow<AiUiState> = combine(
        metadataState,
        cloudSettingsState,
        syncStatusState,
        consentState,
        draftState
    ) { metadata, cloudSettings, syncStatus, hasConsent, draft ->
        mapToAiUiState(
            metadata = metadata,
            cloudState = cloudSettings.cloudState,
            isCloudIdentityBlocked = syncStatus.status is SyncStatus.Blocked,
            hasConsent = hasConsent,
            draft = draft
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = makeInitialAiUiState(hasConsent = aiChatRepository.hasConsent())
    )

    private fun nextResumeDiagnostics(): AiChatResumeDiagnostics {
        nextResumeAttemptId += 1L
        return AiChatResumeDiagnostics(
            resumeAttemptId = nextResumeAttemptId,
            clientPlatform = aiChatClientPlatform,
            clientVersion = aiChatClientVersion
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
        val activeRun = draftState.value.activeRun ?: return false
        val metadata = when (event) {
            is AiChatLiveEvent.AssistantDelta -> event.metadata
            is AiChatLiveEvent.AssistantToolCall -> event.metadata
            is AiChatLiveEvent.AssistantReasoningStarted -> event.metadata
            is AiChatLiveEvent.AssistantReasoningSummary -> event.metadata
            is AiChatLiveEvent.AssistantReasoningDone -> event.metadata
            is AiChatLiveEvent.AssistantMessageDone -> event.metadata
            is AiChatLiveEvent.RepairStatus -> event.metadata
            is AiChatLiveEvent.RunTerminal -> event.metadata
        }
        return metadata.sessionId == draftState.value.persistedState.chatSessionId
            && metadata.runId == activeRun.runId
    }

    init {
        viewModelScope.launch {
            combine(
                workspaceState.map { workspace ->
                    workspace?.workspaceId
                },
                cloudSettingsState
            ) { workspaceId, cloudSettings ->
                AiAccessContext(
                    workspaceId = workspaceId,
                    cloudState = cloudSettings.cloudState,
                    linkedUserId = cloudSettings.linkedUserId,
                    activeWorkspaceId = cloudSettings.activeWorkspaceId
                )
            }.distinctUntilChanged().collect { accessContext ->
                switchAccessContext(accessContext = accessContext)
            }
        }
    }

    fun updateDraftMessage(draftMessage: String) {
        draftState.update { state ->
            state.copy(
                draftMessage = draftMessage,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun acceptConsent() {
        aiChatRepository.updateConsent(hasConsent = true)
        warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
    }

    fun addPendingAttachment(attachment: AiChatAttachment) {
        if (draftState.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        draftState.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments + attachment,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun removePendingAttachment(attachmentId: String) {
        if (draftState.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        draftState.update { state ->
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
        if (draftState.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (draftState.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        draftState.update { state ->
            state.copy(
                dictationState = AiChatDictationState.REQUESTING_PERMISSION,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun startDictationRecording() {
        if (draftState.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (draftState.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        draftState.update { state ->
            state.copy(
                dictationState = AiChatDictationState.RECORDING,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun cancelDictation() {
        draftState.update { state ->
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
        if (draftState.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (draftState.value.dictationState != AiChatDictationState.RECORDING) {
            return
        }

        draftState.update { state ->
            state.copy(
                dictationState = AiChatDictationState.TRANSCRIBING,
                activeAlert = null,
                errorMessage = ""
            )
        }

        viewModelScope.launch {
            try {
                val transcription = aiChatRepository.transcribeAudio(
                    workspaceId = draftState.value.workspaceId,
                    sessionId = draftState.value.persistedState.chatSessionId.ifBlank { null },
                    fileName = fileName,
                    mediaType = mediaType,
                    audioBytes = audioBytes
                )
                val transcript = transcription.text.trim()

                require(transcript.isNotEmpty()) {
                    noSpeechRecordedMessage
                }

                draftState.update { state ->
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
                        "workspaceId" to draftState.value.workspaceId,
                        "cloudState" to cloudSettingsState.value.cloudState.name,
                        "chatSessionId" to draftState.value.persistedState.chatSessionId,
                        "message" to error.message
                    )
                )
                throw error
            } catch (error: Exception) {
                val message = makeAiUserFacingErrorMessage(
                    error = error,
                    surface = AiErrorSurface.DICTATION,
                    configuration = serverConfigurationState.value
                )
                draftState.update { state ->
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
        if (draftState.value.conversationBootstrapState != AiConversationBootstrapState.READY) {
            return
        }
        if (draftState.value.composerPhase != AiComposerPhase.IDLE) {
            return
        }

        val requestedSessionId = draftState.value.persistedState.chatSessionId.ifBlank { null }
        detachLiveStream(reason = "AI live stream detached because a new chat was requested.")
        draftState.update { state ->
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

        viewModelScope.launch {
            try {
                val snapshot = aiChatRepository.createNewSession(
                    workspaceId = draftState.value.workspaceId,
                    sessionId = requestedSessionId
                )
                draftState.update { state ->
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
                        "workspaceId" to draftState.value.workspaceId,
                        "cloudState" to cloudSettingsState.value.cloudState.name,
                        "chatSessionId" to draftState.value.persistedState.chatSessionId,
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
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }

    fun dismissAlert() {
        draftState.update { state ->
            state.copy(activeAlert = null)
        }
    }

    fun cancelStreaming() {
        if (draftState.value.composerPhase != AiComposerPhase.RUNNING) {
            return
        }

        val sessionId = draftState.value.persistedState.chatSessionId
        val workspaceId = draftState.value.workspaceId

        draftState.update { state ->
            state.copy(
                composerPhase = AiComposerPhase.STOPPING,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentState()

        viewModelScope.launch {
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
                        && draftState.value.activeRun == null
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
        val currentState = draftState.value
        if (
            currentState.conversationBootstrapState != AiConversationBootstrapState.READY
            || currentState.composerPhase != AiComposerPhase.IDLE
            || currentState.dictationState != AiChatDictationState.IDLE
        ) {
            return
        }

        draftState.update { state ->
            state.copy(
                draftMessage = aiEntryPrefillPrompt(prefill = prefill),
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun showAlert(alert: AiAlertState) {
        draftState.update { state ->
            state.copy(
                activeAlert = alert,
                errorMessage = ""
            )
        }
    }

    fun showErrorMessage(message: String) {
        draftState.update { state ->
            state.copy(
                activeAlert = AiAlertState.GeneralError(message = message),
                errorMessage = ""
            )
        }
    }

    fun retryConversationBootstrap() {
        if (consentState.value.not()) {
            return
        }
        if (draftState.value.workspaceId == null) {
            return
        }

        startConversationBootstrap(forceReloadState = true, resumeDiagnostics = null)
    }

    /**
     * Marks the AI screen visible and resumes from bootstrap instead of
     * reconnecting live blindly. Bootstrap decides whether a new live attach is
     * still needed for the current run.
     */
    fun onScreenVisible() {
        isScreenVisible = true
        warmUpLinkedSessionIfNeeded(resumeDiagnostics = nextResumeDiagnostics())
    }

    /**
     * Hidden screens must not keep the live SSE overlay attached.
     */
    fun onScreenHidden() {
        isScreenVisible = false
        detachLiveStream(reason = "AI live stream detached because the screen is no longer visible.")
    }

    fun warmUpLinkedSessionIfNeeded(resumeDiagnostics: AiChatResumeDiagnostics?) {
        val currentState = draftState.value
        val accessContext = activeAccessContext
        val cloudSettings = cloudSettingsState.value
        if (
            currentState.composerPhase == AiComposerPhase.PREPARING_SEND
            || currentState.composerPhase == AiComposerPhase.STARTING_RUN
        ) {
            return
        }
        if (consentState.value.not()) {
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
        warmUpJob = viewModelScope.launch {
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
                        "currentWorkspaceId" to draftState.value.workspaceId,
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
                    configuration = serverConfigurationState.value
                )
                draftState.update { state ->
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
        val currentUiState = uiState.value
        if (currentUiState.canSend.not()) {
            if (currentUiState.isConsentRequired) {
                draftState.update { state ->
                    state.copy(
                        activeAlert = AiAlertState.GeneralError(message = aiChatConsentRequiredMessage),
                        errorMessage = ""
                    )
                }
            }
            return
        }

        val outgoingContent = makeUserContent(
            draftMessage = draftState.value.draftMessage,
            pendingAttachments = draftState.value.pendingAttachments
        )
        if (outgoingContent.isEmpty()) {
            return
        }

        AiChatDiagnosticsLogger.info(
            event = "ui_send_message_requested",
            fields = listOf(
                "workspaceId" to draftState.value.workspaceId,
                "cloudState" to cloudSettingsState.value.cloudState.name,
                "chatSessionId" to draftState.value.persistedState.chatSessionId,
                "messageCount" to draftState.value.persistedState.messages.size.toString(),
                "pendingAttachmentCount" to draftState.value.pendingAttachments.size.toString(),
                "outgoingContentSummary" to AiChatDiagnosticsLogger.summarizeOutgoingContent(content = outgoingContent)
            )
        )

        draftState.update { state ->
            state.copy(
                composerPhase = AiComposerPhase.PREPARING_SEND,
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }

        val previousPersistedState = draftState.value.persistedState
        val nextPersistedState = draftState.value.persistedState.copy(
            messages = draftState.value.persistedState.messages + listOf(
                makeUserMessage(
                    content = outgoingContent,
                    timestampMillis = System.currentTimeMillis()
                ),
                makeAssistantStatusMessage(
                    timestampMillis = System.currentTimeMillis()
                )
            )
        )
        val draftMessageBackup = draftState.value.draftMessage
        val pendingAttachmentsBackup = draftState.value.pendingAttachments

        activeSendJob?.cancel()
        activeSendJob = viewModelScope.launch {
            var didAcceptRun = false
            var didAppendOptimisticMessages = false
            try {
                draftState.update { state ->
                    state.copy(
                        persistedState = nextPersistedState,
                        composerPhase = AiComposerPhase.STARTING_RUN
                    )
                }
                persistCurrentState()
                didAppendOptimisticMessages = true

                val outcome = aiChatRepository.startRun(
                    workspaceId = draftState.value.workspaceId,
                    state = nextPersistedState,
                    content = outgoingContent,
                    onAccepted = { response ->
                        didAcceptRun = true
                        draftState.update { state ->
                            state.copy(
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
                            )
                        }
                        if (response.activeRun != null) {
                            attachAcceptedLiveStreamIfNeeded(
                                workspaceId = draftState.value.workspaceId,
                                response = response
                            )
                        }
                        persistCurrentState()
                    },
                    onEvent = { event ->
                        applyLiveEvent(event = event)
                    }
                )
                draftState.update { state ->
                    val nextChatConfig = outcome.chatConfig ?: state.persistedState.lastKnownChatConfig
                    state.copy(
                        persistedState = state.persistedState.copy(
                            chatSessionId = outcome.chatSessionId,
                            lastKnownChatConfig = nextChatConfig
                        ),
                        isLiveAttached = false
                    )
                }
                persistCurrentState()
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
                draftState.update { state ->
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

    /**
     * Applies one typed live event on top of the last trusted bootstrap state.
     * The live stream is only an overlay for the currently active run and never
     * replaces bootstrap as the source of truth.
     */
    private suspend fun applyLiveEvent(event: AiChatLiveEvent) {
        if (isCurrentLiveEvent(event).not()) {
            return
        }
        when (event) {
            is AiChatLiveEvent.AssistantDelta -> {
                draftState.update { state ->
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
                draftState.update { state ->
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
                draftState.update { state ->
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
                draftState.update { state ->
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
                draftState.update { state ->
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
                    state = draftState.value.persistedState,
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
                draftState.update { state ->
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

            is AiChatLiveEvent.RepairStatus -> {
                draftState.update { state ->
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
                    draftState.update { state ->
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
                    draftState.update { state ->
                        state.copy(
                            activeRun = null,
                            isLiveAttached = false,
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
                    "workspaceId" to draftState.value.workspaceId,
                    "cloudState" to cloudSettingsState.value.cloudState.name,
                    "chatSessionId" to draftState.value.persistedState.chatSessionId,
                    "requestId" to remoteError.requestId,
                    "statusCode" to remoteError.statusCode?.toString(),
                    "code" to remoteError.code,
                    "stage" to remoteError.stage
                )
            )
            draftState.update { state ->
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
            draftState.update { state ->
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
            draftState.update { state ->
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
            configuration = serverConfigurationState.value
        )
        val previousState = draftState.value.persistedState
        val repairedState = clearMissingChatSessionIdIfNeeded(
            state = previousState,
            error = error
        )
        AiChatDiagnosticsLogger.error(
            event = "send_failure_handled",
            fields = listOf(
                "workspaceId" to draftState.value.workspaceId,
                "cloudState" to cloudSettingsState.value.cloudState.name,
                "previousChatSessionId" to previousState.chatSessionId,
                "repairedChatSessionId" to repairedState.chatSessionId,
                "clearedMissingChatSessionId" to (previousState.chatSessionId != repairedState.chatSessionId).toString(),
                "messageCount" to previousState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )
        draftState.update { state ->
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
            configuration = serverConfigurationState.value
        )

        AiChatDiagnosticsLogger.error(
            event = "new_chat_failure_handled",
            fields = listOf(
                "workspaceId" to draftState.value.workspaceId,
                "cloudState" to cloudSettingsState.value.cloudState.name,
                "chatSessionId" to draftState.value.persistedState.chatSessionId,
                "messageCount" to draftState.value.persistedState.messages.size.toString(),
                "userFacingMessage" to message
            ) + remoteErrorFields(error = remoteError),
            throwable = error
        )

        draftState.update { state ->
            state.copy(
                activeAlert = AiAlertState.GeneralError(message = message),
                errorMessage = ""
            )
        }
    }

    private fun switchAccessContext(accessContext: AiAccessContext) {
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
                    "currentWorkspaceId" to draftState.value.workspaceId,
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
        lastPreparedGuestWorkspaceId = null
        viewModelScope.launch {
            val persistedState = aiChatRepository.loadPersistedState(workspaceId = accessContext.workspaceId)
            draftState.value = makeAiDraftState(
                workspaceId = accessContext.workspaceId,
                persistedState = persistedState
            ).copy(
                conversationBootstrapState = if (
                    accessContext.workspaceId != null
                    && consentState.value
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
            if (consentState.value.not()) {
                return@launch
            }
            if (accessContext.cloudState == CloudAccountState.LINKING_READY) {
                return@launch
            }
            startConversationBootstrap(forceReloadState = false, resumeDiagnostics = null)
        }
    }

    /**
     * Refreshes the full conversation snapshot before any resumed live attach.
     * This is the only supported resume path after hidden/background or reset.
     */
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
        bootstrapJob = viewModelScope.launch {
            try {
                activeLiveJob?.cancel(
                    cause = CancellationException("AI live attach cancelled because bootstrap restarted.")
                )
                activeLiveJob = null
                if (forceReloadState) {
                    val persistedState = aiChatRepository.loadPersistedState(workspaceId = workspaceId)
                    draftState.update { state ->
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
                    draftState.update { state ->
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
                if (
                    accessContext.cloudState == CloudAccountState.GUEST
                    && draftState.value.workspaceId == workspaceId
                ) {
                    lastPreparedGuestWorkspaceId = workspaceId
                }
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
                    configuration = serverConfigurationState.value
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
                draftState.update { state ->
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
        val syncStatus = syncStatusState.value.status
        return if (syncStatus is SyncStatus.Blocked) {
            syncStatus.message
        } else {
            null
        }
    }

    /**
     * Bootstrap may reopen live SSE only when the refreshed server state is
     * still running and the screen remains visible.
     */
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

    /**
     * Existing sessions resume live streaming after the latest known cursor so
     * replayed terminal events from older turns cannot close the current
     * optimistic assistant message.
     */
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

    /**
     * Starts the Android live SSE overlay for the active run. Callers must
     * already know that bootstrap or the accepted run response permits attach.
     */
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
        liveJob = viewModelScope.launch {
            var liveAttachDisposition = AiLiveAttachDisposition.PENDING
            draftState.update { state ->
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
                    resumeDiagnostics = resumeDiagnostics,
                    onEvent = { event ->
                        if (event is AiChatLiveEvent.RunTerminal) {
                            liveAttachDisposition = AiLiveAttachDisposition.TERMINAL_EVENT_SEEN
                        }
                        applyLiveEvent(event = event)
                    }
                )
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
                    configuration = serverConfigurationState.value
                )
                draftState.update { state ->
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
                draftState.update { state ->
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
                draftState.update { state ->
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
                draftState.update { state ->
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
                configuration = serverConfigurationState.value
            )
            draftState.update { state ->
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

    /**
     * Cancels the active live SSE overlay and clears local attached state.
     */
    private fun detachLiveStream(reason: String) {
        activeLiveJob?.cancel(
            cause = CancellationException(reason)
        )
        activeLiveJob = null
        draftState.update { state ->
            state.copy(isLiveAttached = false)
        }
        persistCurrentState()
    }

    private suspend fun applyBootstrap(
        response: AiChatBootstrapResponse,
        applyMode: AiServerSnapshotApplyMode
    ) {
        draftState.update { state ->
            val preserveLocalComposerState =
                applyMode == AiServerSnapshotApplyMode.PASSIVE
                    && state.composerPhase == AiComposerPhase.IDLE
                    && state.conversationBootstrapState == AiConversationBootstrapState.READY
            state.copy(
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
            )
        }
        persistCurrentState()
    }

    private fun finalizeStoppedConversation() {
        draftState.update { state ->
            state.copy(
                persistedState = clearOptimisticAssistantStatusIfNeeded(state = state.persistedState),
                activeRun = null,
                isLiveAttached = false,
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
            cloudSettingsState.value.cloudState != CloudAccountState.LINKED
            && cloudSettingsState.value.cloudState != CloudAccountState.GUEST
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
                    "cloudState" to cloudSettingsState.value.cloudState.name,
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
                    "cloudState" to cloudSettingsState.value.cloudState.name,
                    "message" to message
                ),
                throwable = error
            )
            draftState.update { state ->
                state.copy(
                    activeAlert = AiAlertState.GeneralError(message = "Chat content refresh failed. $message"),
                    errorMessage = ""
                )
            }
        }
    }

    private fun persistCurrentState() {
        val snapshot = draftState.value
        viewModelScope.launch {
            aiChatRepository.savePersistedState(
                workspaceId = snapshot.workspaceId,
                state = snapshot.persistedState
            )
        }
    }
}

fun createAiViewModelFactory(
    aiChatRepository: AiChatRepository,
    syncRepository: SyncRepository,
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AiViewModel(
                aiChatRepository = aiChatRepository,
                syncRepository = syncRepository,
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository
            )
        }
    }
}
