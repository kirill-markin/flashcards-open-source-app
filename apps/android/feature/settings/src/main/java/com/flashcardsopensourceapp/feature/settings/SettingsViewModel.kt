package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.repository.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SettingsViewModel(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository
) : ViewModel() {
    private val visibleAppScreenState = visibleAppScreenRepository.observeVisibleAppScreen().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = VisibleAppScreen.OTHER
    )
    private var pendingAutoSyncRequestId: String? = null
    private var settingsSignatureAtAutoSyncStart: SettingsVisibleSignature? = null
    private var lastVisibleAutoSyncChangeSignature: SettingsVisibleSignature? = null

    val uiState: StateFlow<SettingsUiState> = combine(
        workspaceRepository.observeAppMetadata(),
        cloudAccountRepository.observeCloudSettings()
    ) { metadata, cloudSettings ->
        SettingsUiState(
            currentWorkspaceName = metadata.currentWorkspaceName,
            workspaceName = metadata.workspaceName,
            cardCount = metadata.cardCount,
            deckCount = metadata.deckCount,
            storageLabel = metadata.localStorageLabel,
            syncStatusText = metadata.syncStatusText,
            accountStatusTitle = when (cloudSettings.cloudState) {
                CloudAccountState.DISCONNECTED -> "Disconnected"
                CloudAccountState.LINKING_READY -> "Choose workspace"
                CloudAccountState.GUEST -> "Guest AI"
                CloudAccountState.LINKED -> cloudSettings.linkedEmail ?: "Linked"
            }
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = SettingsUiState(
            currentWorkspaceName = "Loading...",
            workspaceName = "Loading...",
            cardCount = 0,
            deckCount = 0,
            storageLabel = "Room + SQLite",
            syncStatusText = "Loading...",
            accountStatusTitle = "Loading..."
        )
    )

    init {
        observeAutoSyncDrivenSettingsChanges()
    }

    private fun observeAutoSyncDrivenSettingsChanges() {
        viewModelScope.launch {
            autoSyncEventRepository.observeAutoSyncEvents().collect { event ->
                when (event) {
                    is AutoSyncEvent.Requested -> {
                        handleAutoSyncRequested(request = event.request)
                    }

                    is AutoSyncEvent.Completed -> {
                        handleAutoSyncCompleted(completion = event.completion)
                    }
                }
            }
        }
    }

    private fun handleAutoSyncRequested(request: AutoSyncRequest) {
        if (request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_ROOT) {
            return
        }

        pendingAutoSyncRequestId = request.requestId
        settingsSignatureAtAutoSyncStart = buildSettingsVisibleSignature(uiState = uiState.value)
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val settingsSignatureBeforeSync = settingsSignatureAtAutoSyncStart
        settingsSignatureAtAutoSyncStart = null

        if (completion.outcome !is AutoSyncOutcome.Succeeded) {
            return
        }
        if (completion.request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.SETTINGS_ROOT) {
            return
        }

        val currentSettingsSignature = buildSettingsVisibleSignature(uiState = uiState.value)
        if (settingsSignatureBeforeSync == null || settingsSignatureBeforeSync == currentSettingsSignature) {
            return
        }
        if (currentSettingsSignature == lastVisibleAutoSyncChangeSignature) {
            return
        }

        lastVisibleAutoSyncChangeSignature = currentSettingsSignature
        messageController.showMessage(message = workspaceUpdatedOnAnotherDeviceMessage)
    }
}

private data class SettingsVisibleSignature(
    val currentWorkspaceName: String,
    val workspaceName: String,
    val cardCount: Int,
    val deckCount: Int
)

private fun buildSettingsVisibleSignature(uiState: SettingsUiState): SettingsVisibleSignature {
    return SettingsVisibleSignature(
        currentWorkspaceName = uiState.currentWorkspaceName,
        workspaceName = uiState.workspaceName,
        cardCount = uiState.cardCount,
        deckCount = uiState.deckCount
    )
}

fun createSettingsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    visibleAppScreenRepository: VisibleAppScreenRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SettingsViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                visibleAppScreenRepository = visibleAppScreenRepository
            )
        }
    }
}
