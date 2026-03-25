package com.flashcardsopensourceapp.feature.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatAttachment
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatDictationState
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.aiChatConsentRequiredMessage
import com.flashcardsopensourceapp.data.local.model.defaultAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.effectiveAiChatServerConfig
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaButtonTitle
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaReachedMessage
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusText
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
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
import java.util.UUID

private const val noSpeechRecordedMessage: String = "No speech was recorded."

private data class AiDraftState(
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

class AiViewModel(
    private val aiChatRepository: AiChatRepository,
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
        initialValue = AppMetadataSummary(
            currentWorkspaceName = "Loading...",
            workspaceName = "Loading...",
            deckCount = 0,
            cardCount = 0,
            localStorageLabel = "Room + SQLite",
            syncStatusText = "Loading..."
        )
    )
    private val cloudSettingsState = cloudAccountRepository.observeCloudSettings().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = com.flashcardsopensourceapp.data.local.model.CloudSettings(
            deviceId = "",
            cloudState = CloudAccountState.DISCONNECTED,
            linkedUserId = null,
            linkedWorkspaceId = null,
            linkedEmail = null,
            activeWorkspaceId = null,
            updatedAtMillis = 0L
        )
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
        value = AiDraftState(
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
    )
    private var activeSendJob: Job? = null
    private var activeWarmUpJob: Job? = null

    val uiState: StateFlow<AiUiState> = combine(
        metadataState,
        cloudSettingsState,
        consentState,
        draftState
    ) { metadata, cloudSettings, hasConsent, draft ->
        val isLinked = cloudSettings.cloudState == CloudAccountState.LINKED
        val hasMessages = draft.persistedState.messages.isNotEmpty()
        val hasDraftText = draft.draftMessage.trim().isNotEmpty()
        val canEditConversation = draft.isStreaming.not() && draft.dictationState == AiChatDictationState.IDLE
        val chatConfig = effectiveAiChatServerConfig(draft.persistedState.lastKnownChatConfig)

        AiUiState(
            currentWorkspaceName = metadata.currentWorkspaceName,
            messages = draft.persistedState.messages,
            pendingAttachments = draft.pendingAttachments,
            draftMessage = draft.draftMessage,
            chatConfig = chatConfig,
            isConsentRequired = hasConsent.not(),
            isLinked = isLinked,
            isStreaming = draft.isStreaming,
            canStopStreaming = draft.isStreaming,
            dictationState = draft.dictationState,
            canSend = hasConsent
                && draft.isStreaming.not()
                && draft.dictationState == AiChatDictationState.IDLE
                && (hasDraftText || draft.pendingAttachments.isNotEmpty()),
            canStartNewChat = canEditConversation
                && (hasMessages || hasDraftText || draft.pendingAttachments.isNotEmpty()),
            repairStatus = draft.repairStatus,
            activeAlert = draft.activeAlert,
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AiUiState(
            currentWorkspaceName = "Loading...",
            messages = emptyList(),
            pendingAttachments = emptyList(),
            draftMessage = "",
            chatConfig = defaultAiChatServerConfig,
            isConsentRequired = aiChatRepository.hasConsent().not(),
            isLinked = false,
            isStreaming = false,
            canStopStreaming = false,
            dictationState = AiChatDictationState.IDLE,
            canSend = false,
            canStartNewChat = false,
            repairStatus = null,
            activeAlert = null,
            errorMessage = ""
        )
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
                val transcript = aiChatRepository.transcribeAudio(
                    workspaceId = draftState.value.workspaceId,
                    fileName = fileName,
                    mediaType = mediaType,
                    audioBytes = audioBytes
                ).trim()

                require(transcript.isNotEmpty()) {
                    noSpeechRecordedMessage
                }

                draftState.update { state ->
                    state.copy(
                        draftMessage = appendTranscriptToDraft(
                            currentDraft = state.draftMessage,
                            transcript = transcript
                        ),
                        dictationState = AiChatDictationState.IDLE,
                        activeAlert = null,
                        errorMessage = ""
                    )
                }
            } catch (error: Exception) {
                val message = makeUserFacingErrorMessage(
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
                    sessionId = draftState.value.persistedState.chatSessionId
                )
                applyServerSnapshot(snapshot)
            } catch (error: Exception) {
                handleSendFailure(error)
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
        if (currentState.isStreaming) {
            return
        }
        if (consentState.value.not()) {
            return
        }
        if (cloudSettingsState.value.cloudState != CloudAccountState.LINKED) {
            return
        }
        if (activeWarmUpJob != null) {
            return
        }

        activeWarmUpJob = viewModelScope.launch {
            try {
                aiChatRepository.warmUpLinkedSession()
            } catch (error: Exception) {
                val message = makeUserFacingErrorMessage(
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

        val nextPersistedState = draftState.value.persistedState.copy(
            messages = draftState.value.persistedState.messages + listOf(
                makeUserMessage(content = outgoingContent),
                makeAssistantStatusMessage()
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
                draftState.update { state ->
                    state.copy(
                        persistedState = state.persistedState.copy(
                            chatSessionId = outcome.chatSessionId,
                            lastKnownChatConfig = outcome.chatConfig ?: state.persistedState.lastKnownChatConfig
                        )
                    )
                }
                persistCurrentState()
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
                                buttonTitle = aiChatGuestQuotaButtonTitle
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
                    draftState.update { state ->
                        state.copy(
                            persistedState = markAssistantError(
                                state = state.persistedState,
                                message = message
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
            draftState.update { state ->
                state.copy(
                    persistedState = appendAssistantAccountUpgradePrompt(
                        state = state.persistedState,
                        message = aiChatGuestQuotaReachedMessage,
                        buttonTitle = aiChatGuestQuotaButtonTitle
                    ),
                    errorMessage = ""
                )
            }
            return
        }

        val message = makeUserFacingErrorMessage(
            error = error,
            surface = AiErrorSurface.CHAT,
            configuration = serverConfigurationState.value
        )
        draftState.update { state ->
            state.copy(
                persistedState = markAssistantError(
                    state = state.persistedState,
                    message = message
                ),
                errorMessage = message
            )
        }
    }

    private fun switchWorkspace(workspaceId: String?) {
        activeSendJob?.cancel()
        activeWarmUpJob?.cancel()
        viewModelScope.launch {
            val persistedState = aiChatRepository.loadPersistedState(workspaceId = workspaceId)
            draftState.value = AiDraftState(
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
            persistCurrentState()
            try {
                val snapshot = aiChatRepository.loadChatSnapshot(
                    workspaceId = workspaceId,
                    sessionId = persistedState.chatSessionId
                )
                if (snapshot != null) {
                    applyServerSnapshot(snapshot)
                }
            } catch (_: Exception) {
            }
        }
    }

    private fun applyServerSnapshot(snapshot: AiChatSessionSnapshot) {
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

    private fun makeUserFacingErrorMessage(
        error: Exception,
        surface: AiErrorSurface,
        configuration: CloudServiceConfiguration
    ): String {
        val remoteError = error as? AiChatRemoteException
        return makeAiChatUserFacingErrorMessage(
            rawMessage = error.message ?: "AI request failed.",
            code = remoteError?.code,
            requestId = remoteError?.requestId,
            configurationMode = configuration.mode,
            surface = surface
        )
    }
}

private fun clearOptimisticAssistantStatusIfNeeded(
    state: AiChatPersistedState
): AiChatPersistedState {
    val lastMessage = state.messages.lastOrNull() ?: return state
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state
    }

    val updatedContent = removingOptimisticAssistantStatus(content = lastMessage.content)
    if (updatedContent == lastMessage.content) {
        return state
    }
    if (updatedContent.isEmpty()) {
        return state.copy(messages = state.messages.dropLast(1))
    }

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(content = updatedContent)
    )
}

fun createAiViewModelFactory(
    aiChatRepository: AiChatRepository,
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AiViewModel(
                aiChatRepository = aiChatRepository,
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository
            )
        }
    }
}

private fun makeUserMessage(content: List<AiChatContentPart>): AiChatMessage {
    return AiChatMessage(
        messageId = UUID.randomUUID().toString().lowercase(),
        role = AiChatRole.USER,
        content = content,
        timestampMillis = System.currentTimeMillis(),
        isError = false
    )
}

private fun makeAssistantStatusMessage(): AiChatMessage {
    return AiChatMessage(
        messageId = UUID.randomUUID().toString().lowercase(),
        role = AiChatRole.ASSISTANT,
        content = listOf(
            AiChatContentPart.Text(text = aiChatOptimisticAssistantStatusText)
        ),
        timestampMillis = System.currentTimeMillis(),
        isError = false
    )
}

private fun makeUserContent(
    draftMessage: String,
    pendingAttachments: List<AiChatAttachment>
): List<AiChatContentPart> {
    val attachmentContent = pendingAttachments.map(::makeAttachmentContentPart)
    val trimmedMessage = draftMessage.trim()
    if (trimmedMessage.isEmpty()) {
        return attachmentContent
    }

    return attachmentContent + AiChatContentPart.Text(text = trimmedMessage)
}

private fun makeAttachmentContentPart(attachment: AiChatAttachment): AiChatContentPart {
    return if (attachment.isImage) {
        AiChatContentPart.Image(
            fileName = attachment.fileName,
            mediaType = attachment.mediaType,
            base64Data = attachment.base64Data
        )
    } else {
        AiChatContentPart.File(
            fileName = attachment.fileName,
            mediaType = attachment.mediaType,
            base64Data = attachment.base64Data
        )
    }
}

private fun appendTranscriptToDraft(
    currentDraft: String,
    transcript: String
): String {
    val trimmedTranscript = transcript.trim()
    if (trimmedTranscript.isEmpty()) {
        return currentDraft
    }

    val trimmedDraft = currentDraft.trimEnd()
    if (trimmedDraft.isEmpty()) {
        return trimmedTranscript
    }

    return "$trimmedDraft\n$trimmedTranscript"
}

private fun appendAssistantText(
    state: AiChatPersistedState,
    text: String
): AiChatPersistedState {
    if (state.messages.isEmpty()) {
        return state
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state
    }

    val updatedContent = if (isOptimisticAssistantStatus(content = lastMessage.content)) {
        listOf(AiChatContentPart.Text(text = text))
    } else if (lastMessage.content.lastOrNull() is AiChatContentPart.Text) {
        lastMessage.content.dropLast(1) + AiChatContentPart.Text(
            text = (lastMessage.content.last() as AiChatContentPart.Text).text + text
        )
    } else {
        lastMessage.content + AiChatContentPart.Text(text = text)
    }

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(content = updatedContent)
    )
}

private fun upsertAssistantToolCall(
    state: AiChatPersistedState,
    toolCall: AiChatToolCall
): AiChatPersistedState {
    if (state.messages.isEmpty()) {
        return state
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state
    }

    val currentContent = removingOptimisticAssistantStatus(content = lastMessage.content)
    val existingIndex = currentContent.indexOfFirst { part ->
        part is AiChatContentPart.ToolCall && part.toolCall.toolCallId == toolCall.toolCallId
    }
    val updatedContent = if (existingIndex == -1) {
        currentContent + AiChatContentPart.ToolCall(toolCall = toolCall)
    } else {
        currentContent.mapIndexed { index, part ->
            if (index == existingIndex) {
                AiChatContentPart.ToolCall(toolCall = toolCall)
            } else {
                part
            }
        }
    }

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(content = updatedContent)
    )
}

private fun upsertAssistantToolCallRequest(
    state: AiChatPersistedState,
    toolCallRequest: AiToolCallRequest
): AiChatPersistedState {
    return upsertAssistantToolCall(
        state = state,
        toolCall = AiChatToolCall(
            toolCallId = toolCallRequest.toolCallId,
            name = toolCallRequest.name,
            status = AiChatToolCallStatus.STARTED,
            input = toolCallRequest.input,
            output = null
        )
    )
}

private fun markAssistantError(
    state: AiChatPersistedState,
    message: String
): AiChatPersistedState {
    if (state.messages.isEmpty()) {
        return state.copy(
            messages = listOf(
                AiChatMessage(
                    messageId = UUID.randomUUID().toString().lowercase(),
                    role = AiChatRole.ASSISTANT,
                    content = listOf(AiChatContentPart.Text(text = message)),
                    timestampMillis = System.currentTimeMillis(),
                    isError = true
                )
            )
        )
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state.copy(
            messages = state.messages + AiChatMessage(
                messageId = UUID.randomUUID().toString().lowercase(),
                role = AiChatRole.ASSISTANT,
                content = listOf(AiChatContentPart.Text(text = message)),
                timestampMillis = System.currentTimeMillis(),
                isError = true
            )
        )
    }

    val currentText = if (isOptimisticAssistantStatus(content = lastMessage.content)) {
        ""
    } else {
        lastMessage.content.filterIsInstance<AiChatContentPart.Text>()
            .joinToString(separator = "") { part -> part.text }
    }
    val separator = if (currentText.isEmpty()) "" else "\n\n"
    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(
            content = appendingAssistantTextPart(
                content = lastMessage.content,
                text = separator + message
            ),
            isError = true
        )
    )
}

private fun appendAssistantAccountUpgradePrompt(
    state: AiChatPersistedState,
    message: String,
    buttonTitle: String
): AiChatPersistedState {
    val prompt = AiChatContentPart.AccountUpgradePrompt(
        message = message,
        buttonTitle = buttonTitle
    )

    if (state.messages.isEmpty()) {
        return state.copy(
            messages = listOf(
                AiChatMessage(
                    messageId = UUID.randomUUID().toString().lowercase(),
                    role = AiChatRole.ASSISTANT,
                    content = listOf(prompt),
                    timestampMillis = System.currentTimeMillis(),
                    isError = false
                )
            )
        )
    }

    val lastMessage = state.messages.last()
    if (lastMessage.role != AiChatRole.ASSISTANT) {
        return state.copy(
            messages = state.messages + AiChatMessage(
                messageId = UUID.randomUUID().toString().lowercase(),
                role = AiChatRole.ASSISTANT,
                content = listOf(prompt),
                timestampMillis = System.currentTimeMillis(),
                isError = false
            )
        )
    }

    return state.copy(
        messages = state.messages.dropLast(1) + lastMessage.copy(
            content = listOf(prompt),
            isError = false
        )
    )
}

private fun appendingAssistantTextPart(
    content: List<AiChatContentPart>,
    text: String
): List<AiChatContentPart> {
    if (isOptimisticAssistantStatus(content = content)) {
        return listOf(AiChatContentPart.Text(text = text))
    }

    val textParts = content.filterIsInstance<AiChatContentPart.Text>()
    if (textParts.isEmpty()) {
        return content + AiChatContentPart.Text(text = text)
    }

    val lastTextPart = textParts.last()
    val textIndex = content.indexOfLast { part ->
        part is AiChatContentPart.Text
    }
    return content.mapIndexed { index, part ->
        if (index == textIndex) {
            AiChatContentPart.Text(text = lastTextPart.text + text)
        } else {
            part
        }
    }
}

private fun removingOptimisticAssistantStatus(
    content: List<AiChatContentPart>
): List<AiChatContentPart> {
    if (isOptimisticAssistantStatus(content = content)) {
        return emptyList()
    }

    return content.filterNot { part ->
        part is AiChatContentPart.Text && part.text == aiChatOptimisticAssistantStatusText
    }
}

private fun isOptimisticAssistantStatus(
    content: List<AiChatContentPart>
): Boolean {
    return content.size == 1
        && content[0] is AiChatContentPart.Text
        && (content[0] as AiChatContentPart.Text).text == aiChatOptimisticAssistantStatusText
}
