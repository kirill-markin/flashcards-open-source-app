package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class SettingsViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    val uiState: StateFlow<SettingsUiState> = workspaceRepository.observeAppMetadata().map { metadata ->
        SettingsUiState(
            workspaceName = metadata.workspaceName,
            cardCount = metadata.cardCount,
            deckCount = metadata.deckCount,
            storageLabel = metadata.localStorageLabel,
            syncStatusText = metadata.syncStatusText
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = SettingsUiState(
            workspaceName = "Loading...",
            cardCount = 0,
            deckCount = 0,
            storageLabel = "Room + SQLite",
            syncStatusText = "Loading..."
        )
    )
}

fun createSettingsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            SettingsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}
