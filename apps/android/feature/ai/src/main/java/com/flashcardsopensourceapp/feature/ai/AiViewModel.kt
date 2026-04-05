package com.flashcardsopensourceapp.feature.ai

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.AiChatComposerSuggestion
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.makeOfficialCloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.repository.AiChatRepository
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class AiViewModel(
    private val aiChatRepository: AiChatRepository,
    private val syncRepository: SyncRepository,
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    appVersion: String
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
    private val chatRuntime = AiChatRuntime(
        scope = viewModelScope,
        aiChatRepository = aiChatRepository,
        syncRepository = syncRepository,
        appVersion = appVersion,
        hasConsent = { consentState.value },
        currentCloudState = { cloudSettingsState.value.cloudState },
        currentServerConfiguration = { serverConfigurationState.value },
        currentSyncStatus = { syncStatusState.value.status }
    )

    val uiState: StateFlow<AiUiState> = combine(
        metadataState,
        cloudSettingsState,
        syncStatusState,
        consentState,
        chatRuntime.state
    ) { metadata, cloudSettings, syncStatus, hasConsent, runtimeState ->
        mapToAiUiState(
            metadata = metadata,
            cloudState = cloudSettings.cloudState,
            isCloudIdentityBlocked = syncStatus.status is SyncStatus.Blocked,
            hasConsent = hasConsent,
            runtimeState = runtimeState
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = makeInitialAiUiState(hasConsent = aiChatRepository.hasConsent())
    )

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
                chatRuntime.updateAccessContext(accessContext = accessContext)
            }
        }
    }

    fun updateDraftMessage(draftMessage: String) {
        chatRuntime.updateDraftMessage(draftMessage = draftMessage)
    }

    fun applyComposerSuggestion(suggestion: AiChatComposerSuggestion) {
        chatRuntime.applyComposerSuggestion(suggestion = suggestion)
    }

    fun sendMessage() {
        chatRuntime.sendMessage()
    }

    fun acceptConsent() {
        aiChatRepository.updateConsent(hasConsent = true)
        chatRuntime.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
    }

    fun addPendingAttachment(attachment: com.flashcardsopensourceapp.data.local.model.AiChatAttachment) {
        chatRuntime.addPendingAttachment(attachment = attachment)
    }

    fun removePendingAttachment(attachmentId: String) {
        chatRuntime.removePendingAttachment(attachmentId = attachmentId)
    }

    fun startDictationPermissionRequest() {
        chatRuntime.startDictationPermissionRequest()
    }

    fun startDictationRecording() {
        chatRuntime.startDictationRecording()
    }

    fun cancelDictation() {
        chatRuntime.cancelDictation()
    }

    fun transcribeRecordedAudio(
        fileName: String,
        mediaType: String,
        audioBytes: ByteArray
    ) {
        chatRuntime.transcribeRecordedAudio(
            fileName = fileName,
            mediaType = mediaType,
            audioBytes = audioBytes
        )
    }

    fun clearConversation() {
        chatRuntime.clearConversation()
    }

    fun dismissErrorMessage() {
        chatRuntime.dismissErrorMessage()
    }

    fun dismissAlert() {
        chatRuntime.dismissAlert()
    }

    fun cancelStreaming() {
        chatRuntime.stopStreaming()
    }

    fun applyEntryPrefill(prefill: AiEntryPrefill) {
        chatRuntime.applyEntryPrefill(prefill = prefill)
    }

    fun showAlert(alert: AiAlertState) {
        chatRuntime.showAlert(alert = alert)
    }

    fun showErrorMessage(message: String) {
        chatRuntime.showErrorMessage(message = message)
    }

    fun retryConversationBootstrap() {
        chatRuntime.retryBootstrap()
    }

    fun onScreenVisible() {
        chatRuntime.onScreenVisible()
    }

    fun onScreenHidden() {
        chatRuntime.onScreenHidden()
    }

    fun warmUpLinkedSessionIfNeeded() {
        chatRuntime.warmUpLinkedSessionIfNeeded(resumeDiagnostics = null)
    }
}

fun createAiViewModelFactory(
    aiChatRepository: AiChatRepository,
    syncRepository: SyncRepository,
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    appVersion: String
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AiViewModel(
                aiChatRepository = aiChatRepository,
                syncRepository = syncRepository,
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                appVersion = appVersion
            )
        }
    }
}
