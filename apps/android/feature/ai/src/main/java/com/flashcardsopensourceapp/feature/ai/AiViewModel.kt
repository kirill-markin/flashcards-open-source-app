package com.flashcardsopensourceapp.feature.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.ai.AiChatRemoteException
import com.flashcardsopensourceapp.data.local.model.AiChatContentPart
import com.flashcardsopensourceapp.data.local.model.AiChatMessage
import com.flashcardsopensourceapp.data.local.model.AiChatPersistedState
import com.flashcardsopensourceapp.data.local.model.AiChatRepairAttemptStatus
import com.flashcardsopensourceapp.data.local.model.AiChatRole
import com.flashcardsopensourceapp.data.local.model.AiChatStreamEvent
import com.flashcardsopensourceapp.data.local.model.AiChatToolCall
import com.flashcardsopensourceapp.data.local.model.AiChatToolCallStatus
import com.flashcardsopensourceapp.data.local.model.AiToolCallRequest
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.aiChatConsentRequiredMessage
import com.flashcardsopensourceapp.data.local.model.aiChatDefaultModelId
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaButtonTitle
import com.flashcardsopensourceapp.data.local.model.aiChatGuestQuotaReachedMessage
import com.flashcardsopensourceapp.data.local.model.aiChatOptimisticAssistantStatusText
import com.flashcardsopensourceapp.data.local.model.availableAiChatModels
import com.flashcardsopensourceapp.data.local.model.enforceAllowedAiChatModel
import com.flashcardsopensourceapp.data.local.model.makeAiChatSessionId
import com.flashcardsopensourceapp.data.local.model.makeDefaultAiChatPersistedState
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
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

private data class AiDraftState(
    val workspaceId: String?,
    val persistedState: AiChatPersistedState,
    val draftMessage: String,
    val isStreaming: Boolean,
    val repairStatus: AiChatRepairAttemptStatus?,
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
        initialValue = com.flashcardsopensourceapp.data.local.model.AppMetadataSummary(
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
            isStreaming = false,
            repairStatus = null,
            errorMessage = ""
        )
    )
    private var activeSendJob: Job? = null

    val uiState: StateFlow<AiUiState> = combine(
        metadataState,
        cloudSettingsState,
        consentState,
        draftState
    ) { metadata, cloudSettings, hasConsent, draft ->
        val isLinked = cloudSettings.cloudState == CloudAccountState.LINKED
        val selectedModelId = enforceAllowedAiChatModel(
            selectedModelId = draft.persistedState.selectedModelId,
            isLinked = isLinked
        )
        val hasMessages = draft.persistedState.messages.isNotEmpty()
        val hasDraftText = draft.draftMessage.trim().isNotEmpty()
        AiUiState(
            currentWorkspaceName = metadata.currentWorkspaceName,
            messages = draft.persistedState.messages,
            draftMessage = draft.draftMessage,
            selectedModelId = selectedModelId,
            availableModels = availableAiChatModels(isLinked = isLinked),
            isConsentRequired = hasConsent.not(),
            isLinked = isLinked,
            isStreaming = draft.isStreaming,
            canSend = hasConsent && draft.isStreaming.not() && hasDraftText,
            canStartNewChat = draft.isStreaming.not() && (hasMessages || hasDraftText),
            isModelPickerEnabled = draft.isStreaming.not() && hasMessages.not() && isLinked,
            repairStatus = draft.repairStatus,
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AiUiState(
            currentWorkspaceName = "Loading...",
            messages = emptyList(),
            draftMessage = "",
            selectedModelId = aiChatDefaultModelId,
            availableModels = availableAiChatModels(isLinked = false),
            isConsentRequired = aiChatRepository.hasConsent().not(),
            isLinked = false,
            isStreaming = false,
            canSend = false,
            canStartNewChat = false,
            isModelPickerEnabled = false,
            repairStatus = null,
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
            state.copy(draftMessage = draftMessage)
        }
    }

    fun acceptConsent() {
        aiChatRepository.updateConsent(hasConsent = true)
    }

    fun selectModel(modelId: String) {
        val isLinked = cloudSettingsState.value.cloudState == CloudAccountState.LINKED
        draftState.update { state ->
            val nextPersistedState = state.persistedState.copy(
                selectedModelId = enforceAllowedAiChatModel(
                    selectedModelId = modelId,
                    isLinked = isLinked
                )
            )
            state.copy(persistedState = nextPersistedState)
        }
        persistCurrentState()
    }

    fun clearConversation() {
        if (draftState.value.isStreaming) {
            return
        }

        draftState.update { state ->
            state.copy(
                persistedState = makeDefaultAiChatPersistedState().copy(
                    selectedModelId = state.persistedState.selectedModelId
                ),
                draftMessage = "",
                repairStatus = null,
                errorMessage = ""
            )
        }
        persistCurrentState()
    }

    fun dismissErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
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

        val messageText = draftState.value.draftMessage.trim()
        if (messageText.isEmpty()) {
            return
        }

        val isLinked = cloudSettingsState.value.cloudState == CloudAccountState.LINKED
        val nextPersistedState = draftState.value.persistedState.copy(
            selectedModelId = enforceAllowedAiChatModel(
                selectedModelId = draftState.value.persistedState.selectedModelId,
                isLinked = isLinked
            ),
            messages = draftState.value.persistedState.messages + listOf(
                makeUserMessage(text = messageText),
                makeAssistantStatusMessage()
            )
        )
        draftState.update { state ->
            state.copy(
                persistedState = nextPersistedState,
                draftMessage = "",
                isStreaming = true,
                repairStatus = null,
                errorMessage = ""
            )
        }
        persistCurrentState()

        activeSendJob?.cancel()
        activeSendJob = viewModelScope.launch {
            try {
                val outcome = aiChatRepository.streamTurn(
                    workspaceId = draftState.value.workspaceId,
                    state = nextPersistedState,
                    totalCards = metadataState.value.cardCount,
                    onEvent = { event ->
                        applyStreamEvent(event = event)
                    }
                )
                draftState.update { state ->
                    state.copy(
                        persistedState = state.persistedState.copy(
                            codeInterpreterContainerId = outcome.codeInterpreterContainerId
                                ?: state.persistedState.codeInterpreterContainerId
                        )
                    )
                }
                persistCurrentState()
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
                    draftState.update { state ->
                        state.copy(
                            persistedState = markAssistantError(
                                state = state.persistedState,
                                message = event.error.message
                            ),
                            isStreaming = false,
                            repairStatus = null
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

        val message = error.message ?: "AI request failed."
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
        viewModelScope.launch {
            val persistedState = aiChatRepository.loadPersistedState(workspaceId = workspaceId)
            val isLinked = cloudSettingsState.value.cloudState == CloudAccountState.LINKED
            draftState.value = AiDraftState(
                workspaceId = workspaceId,
                persistedState = persistedState.copy(
                    selectedModelId = enforceAllowedAiChatModel(
                        selectedModelId = persistedState.selectedModelId,
                        isLinked = isLinked
                    )
                ),
                draftMessage = "",
                isStreaming = false,
                repairStatus = null,
                errorMessage = ""
            )
            persistCurrentState()
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

private fun makeUserMessage(text: String): AiChatMessage {
    return AiChatMessage(
        messageId = UUID.randomUUID().toString().lowercase(),
        role = AiChatRole.USER,
        content = listOf(
            AiChatContentPart.Text(text = text)
        ),
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
