package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

class SettingsViewModel(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository
) : ViewModel() {
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
}

fun createSettingsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SettingsViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository
            )
        }
    }
}
