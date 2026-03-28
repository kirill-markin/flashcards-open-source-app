package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

class WorkspaceSettingsViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    val uiState: StateFlow<WorkspaceSettingsUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        workspaceRepository.observeWorkspaceSchedulerSettings()
    ) { overview, schedulerSettings ->
        WorkspaceSettingsUiState(
            workspaceName = overview?.workspaceName ?: "Unavailable",
            deckCount = overview?.deckCount ?: 0,
            totalCards = overview?.totalCards ?: 0,
            tagCount = overview?.tagsCount ?: 0,
            schedulerSummary = schedulerSettings?.let(::formatWorkspaceSchedulerSummary) ?: "Unavailable",
            exportSummary = "CSV"
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceSettingsUiState(
            workspaceName = "Loading...",
            deckCount = 0,
            totalCards = 0,
            tagCount = 0,
            schedulerSummary = "Loading...",
            exportSummary = "CSV"
        )
    )
}

fun createWorkspaceSettingsViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceSettingsViewModel(workspaceRepository = workspaceRepository)
        }
    }
}
