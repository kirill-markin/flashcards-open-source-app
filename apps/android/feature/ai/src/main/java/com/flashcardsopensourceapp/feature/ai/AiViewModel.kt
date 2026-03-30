package com.flashcardsopensourceapp.feature.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.AiChatDiagnosticsLogger
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
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
    private val consentState = aiChatRepository.observeConsent().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = aiChatRepository.hasConsent()
    )
    private val draftState = MutableStateFlow(
        value = makeDefaultAiDraftState()
    )
    private var activeSendJob: Job? = null
    private var activeWarmUpJob: Job? = null
    private var lastAppliedMainContentInvalidationVersion: Long = 0L

    val uiState: StateFlow<AiUiState> = combine(
        metadataState,
        cloudSettingsState,
        consentState,
        draftState
    ) { metadata, cloudSettings, hasConsent, draft ->
        mapToAiUiState(
            metadata = metadata,
            cloudState = cloudSettings.cloudState,
            hasConsent = hasConsent,
            draft = draft
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = makeInitialAiUiState(hasConsent = aiChatRepository.hasConsent())
    )

    init {
        viewModelScope.launch {
            workspaceState.map { workspace ->
                workspace?.workspaceId
            }.distinctUntilChanged().collect { workspaceId ->
                switchWorkspace(workspaceId = workspaceId)
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
    }

    fun addPendingAttachment(attachment: AiChatAttachment) {
        draftState.update { state ->
            state.copy(
                pendingAttachments = state.pendingAttachments + attachment,
                activeAlert = null,
                errorMessage = ""
            )
        }
    }

    fun removePendingAttachment(attachmentId: String) {
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
        if (draftState.value.isStreaming) {
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
        if (draftState.value.isStreaming) {
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
        if (draftState.value.isStreaming) {
            return
        }

        viewModelScope.launch {
            try {
                val snapshot = aiChatRepository.resetSession(
                    workspaceId = draftState.value.workspaceId,
                    sessionId = null
                )
                applyServerSnapshot(snapshot = snapshot)
            } catch (error: Exception) {
                handleSendFailure(error = error)
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
        if (draftState.value.isStreaming.not()) {
            return
        }

        activeSendJob?.cancel()
        activeSendJob = null
        draftState.update { state ->
            state.copy(
                persistedState = clearOptimisticAssistantStatusIfNeeded(state = state.persistedState),
                isStreaming = false,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentState()
    }

    fun applyEntryPrefill(prefill: AiEntryPrefill) {
        val currentState = draftState.value
        if (currentState.isStreaming || currentState.dictationState != AiChatDictationState.IDLE) {
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

    fun warmUpLinkedSessionIfNeeded() {
        val currentState = draftState.value
        val cloudSettings = cloudSettingsState.value
        if (currentState.isStreaming) {
            return
        }
        if (consentState.value.not()) {
            return
        }
        if (currentState.workspaceId == null) {
            return
        }
        if (cloudSettings.cloudState == CloudAccountState.LINKING_READY) {
            return
        }
        if (
            cloudSettings.cloudState == CloudAccountState.GUEST
            && cloudSettings.activeWorkspaceId != null
            && currentState.workspaceId != cloudSettings.activeWorkspaceId
        ) {
            return
        }
        if (activeWarmUpJob != null) {
            return
        }

        activeWarmUpJob = viewModelScope.launch {
            try {
                aiChatRepository.prepareSessionForAi(workspaceId = currentState.workspaceId)
            } catch (error: Exception) {
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
                activeWarmUpJob = null
            }
        }
    }

    fun sendMessage() {
        val currentUiState = uiState.value
        if (currentUiState.canSend.not()) {
            if (currentUiState.isConsentRequired) {
                draftState.update { state ->
                    state.copy(errorMessage = aiChatConsentRequiredMessage)
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
        draftState.update { state ->
            state.copy(
                persistedState = nextPersistedState,
                draftMessage = "",
                pendingAttachments = emptyList(),
                isStreaming = true,
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentState()

        activeSendJob?.cancel()
        activeSendJob = viewModelScope.launch {
            try {
                val outcome = aiChatRepository.startRun(
                    workspaceId = draftState.value.workspaceId,
                    state = nextPersistedState,
                    content = outgoingContent,
                    onEvent = { event ->
                        applyStreamEvent(event = event)
                    }
                )
                val finalSnapshot = outcome.finalSnapshot
                if (finalSnapshot != null) {
                    applyServerSnapshot(snapshot = finalSnapshot)
                } else {
                    draftState.update { state ->
                        val nextChatConfig = outcome.chatConfig ?: state.persistedState.lastKnownChatConfig
                        state.copy(
                            persistedState = state.persistedState.copy(
                                chatSessionId = outcome.chatSessionId,
                                lastKnownChatConfig = nextChatConfig
                            )
                        )
                    }
                    persistCurrentState()
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: AiChatRemoteException) {
                handleSendFailure(error = error)
            } catch (error: Exception) {
                handleSendFailure(error = error)
            } finally {
                draftState.update { state ->
                    state.copy(
                        isStreaming = false,
                        repairStatus = null
                    )
                }
                persistCurrentState()
                activeSendJob = null
            }
        }
    }

    private suspend fun applyStreamEvent(event: AiChatStreamEvent) {
        when (event) {
            is AiChatStreamEvent.Delta -> {
                draftState.update { state ->
                    state.copy(
                        persistedState = appendAssistantText(
                            state = state.persistedState,
                            text = event.text
                        )
                    )
                }
            }

            is AiChatStreamEvent.ToolCall -> {
                draftState.update { state ->
                    state.copy(
                        persistedState = upsertAssistantToolCall(
                            state = state.persistedState,
                            toolCall = event.toolCall
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatStreamEvent.ToolCallRequest -> {
                draftState.update { state ->
                    state.copy(
                        persistedState = upsertAssistantToolCallRequest(
                            state = state.persistedState,
                            toolCallRequest = event.toolCallRequest
                        ),
                        repairStatus = null
                    )
                }
            }

            is AiChatStreamEvent.RepairAttempt -> {
                draftState.update { state ->
                    state.copy(repairStatus = event.status)
                }
            }

            AiChatStreamEvent.Done -> {
                draftState.update { state ->
                    state.copy(
                        isStreaming = false,
                        repairStatus = null
                    )
                }
            }

            is AiChatStreamEvent.Error -> {
                if (event.error.code == "GUEST_AI_LIMIT_REACHED") {
                    draftState.update { state ->
                        state.copy(
                            persistedState = appendAssistantAccountUpgradePrompt(
                                state = state.persistedState,
                                message = aiChatGuestQuotaReachedMessage,
                                buttonTitle = aiChatGuestQuotaButtonTitle,
                                timestampMillis = System.currentTimeMillis()
                            ),
                            isStreaming = false,
                            repairStatus = null
                        )
                    }
                } else {
                    val message = makeAiChatUserFacingErrorMessage(
                        rawMessage = event.error.message,
                        code = event.error.code,
                        requestId = event.error.requestId,
                        configurationMode = serverConfigurationState.value.mode,
                        surface = AiErrorSurface.CHAT
                    )
                    AiChatDiagnosticsLogger.error(
                        event = "stream_error_event_received",
                        fields = listOf(
                            "workspaceId" to draftState.value.workspaceId,
                            "cloudState" to cloudSettingsState.value.cloudState.name,
                            "chatSessionId" to draftState.value.persistedState.chatSessionId,
                            "requestId" to event.error.requestId,
                            "code" to event.error.code,
                            "stage" to event.error.stage,
                            "message" to event.error.message
                        )
                    )
                    draftState.update { state ->
                        state.copy(
                            persistedState = markAssistantError(
                                state = state.persistedState,
                                message = message,
                                timestampMillis = System.currentTimeMillis()
                            ),
                            isStreaming = false,
                            repairStatus = null,
                            errorMessage = message
                        )
                    }
                }
            }
        }
        persistCurrentState()
    }

    private fun handleSendFailure(error: Exception) {
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
                persistedState = markAssistantError(
                    state = repairedState,
                    message = message,
                    timestampMillis = System.currentTimeMillis()
                ),
                errorMessage = message
            )
        }
    }

    private fun switchWorkspace(workspaceId: String?) {
        activeSendJob?.cancel()
        activeWarmUpJob?.cancel()
        lastAppliedMainContentInvalidationVersion = 0L
        viewModelScope.launch {
            val persistedState = aiChatRepository.loadPersistedState(workspaceId = workspaceId)
            draftState.value = makeAiDraftState(
                workspaceId = workspaceId,
                persistedState = persistedState
            )
            persistCurrentState()
            if (workspaceId == null) {
                return@launch
            }
            try {
                val snapshot = aiChatRepository.loadChatSnapshot(
                    workspaceId = workspaceId,
                    sessionId = persistedState.chatSessionId
                )
                when {
                    snapshot != null -> applyServerSnapshot(snapshot = snapshot)
                    persistedState.chatSessionId.isNotBlank() -> {
                        AiChatDiagnosticsLogger.warn(
                            event = "switch_workspace_repaired_missing_session",
                            fields = listOf(
                                "workspaceId" to workspaceId,
                                "cloudState" to cloudSettingsState.value.cloudState.name,
                                "missingChatSessionId" to persistedState.chatSessionId,
                                "messageCount" to persistedState.messages.size.toString()
                            )
                        )
                        val repairedState = persistedState.copy(chatSessionId = "")
                        draftState.update { state ->
                            state.copy(persistedState = repairedState)
                        }
                        persistCurrentState()
                        aiChatRepository.loadChatSnapshot(
                            workspaceId = workspaceId,
                            sessionId = null
                        )?.let { repairedSnapshot ->
                            applyServerSnapshot(snapshot = repairedSnapshot)
                        }
                    }
                }
            } catch (error: Exception) {
                AiChatDiagnosticsLogger.error(
                    event = "switch_workspace_snapshot_load_failed",
                    fields = listOf(
                        "workspaceId" to workspaceId,
                        "cloudState" to cloudSettingsState.value.cloudState.name,
                        "chatSessionId" to persistedState.chatSessionId,
                        "messageCount" to persistedState.messages.size.toString()
                    ) + remoteErrorFields(error = error as? AiChatRemoteException),
                    throwable = error
                )
            }
        }
    }

    private suspend fun applyServerSnapshot(snapshot: AiChatSessionSnapshot) {
        draftState.update { state ->
            state.copy(
                persistedState = state.persistedState.copy(
                    messages = snapshot.messages,
                    chatSessionId = snapshot.sessionId,
                    lastKnownChatConfig = snapshot.chatConfig
                ),
                draftMessage = "",
                pendingAttachments = emptyList(),
                isStreaming = snapshot.runState == "running",
                dictationState = AiChatDictationState.IDLE,
                repairStatus = null,
                activeAlert = null,
                errorMessage = ""
            )
        }
        persistCurrentState()
        syncMainContentIfInvalidated(
            workspaceId = draftState.value.workspaceId,
            mainContentInvalidationVersion = snapshot.mainContentInvalidationVersion
        )
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
                state.copy(errorMessage = "Chat content refresh failed. $message")
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
