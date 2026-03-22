package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

class AccountStatusViewModel(
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    val uiState: StateFlow<AccountStatusUiState> = workspaceRepository.observeAppMetadata().map { metadata ->
        AccountStatusUiState(
            workspaceName = metadata.workspaceName,
            cloudStatusTitle = "Not connected",
            syncStatusText = metadata.syncStatusText
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AccountStatusUiState(
            workspaceName = "Loading...",
            cloudStatusTitle = "Not connected",
            syncStatusText = "Loading..."
        )
    )
}

class DeviceDiagnosticsViewModel(
    workspaceRepository: WorkspaceRepository,
    appVersion: String,
    buildNumber: String
) : ViewModel() {
    val uiState: StateFlow<DeviceDiagnosticsUiState> = workspaceRepository.observeDeviceDiagnostics().map { diagnostics ->
        DeviceDiagnosticsUiState(
            workspaceName = diagnostics?.workspaceName ?: "Unavailable",
            workspaceId = diagnostics?.workspaceId ?: "Unavailable",
            appVersion = appVersion,
            buildNumber = buildNumber,
            operatingSystem = currentOperatingSystemLabel(),
            deviceModel = currentDeviceModelLabel(),
            clientLabel = "Jetpack Compose",
            storageLabel = "Room + SQLite",
            outboxEntriesCount = diagnostics?.outboxEntriesCount ?: 0,
            lastSyncCursor = diagnostics?.lastSyncCursor ?: "Unavailable",
            lastSyncAttempt = formatTimestampLabel(timestampMillis = diagnostics?.lastSyncAttemptAtMillis)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DeviceDiagnosticsUiState(
            workspaceName = "Loading...",
            workspaceId = "Loading...",
            appVersion = appVersion,
            buildNumber = buildNumber,
            operatingSystem = currentOperatingSystemLabel(),
            deviceModel = currentDeviceModelLabel(),
            clientLabel = "Jetpack Compose",
            storageLabel = "Room + SQLite",
            outboxEntriesCount = 0,
            lastSyncCursor = "Unavailable",
            lastSyncAttempt = "Never"
        )
    )
}

private data class WorkspaceExportDraftState(
    val isExporting: Boolean,
    val errorMessage: String
)

class WorkspaceExportViewModel(
    private val workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = WorkspaceExportDraftState(
            isExporting = false,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<WorkspaceExportUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        draftState
    ) { overview, draft ->
        WorkspaceExportUiState(
            workspaceName = overview?.workspaceName ?: "Unavailable",
            activeCardsCount = overview?.totalCards ?: 0,
            isExporting = draft.isExporting,
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceExportUiState(
            workspaceName = "Loading...",
            activeCardsCount = 0,
            isExporting = false,
            errorMessage = ""
        )
    )

    suspend fun prepareExportData(): WorkspaceExportData? {
        draftState.update { state ->
            state.copy(
                isExporting = true,
                errorMessage = ""
            )
        }

        return try {
            val exportData = workspaceRepository.loadWorkspaceExportData()
            if (exportData == null) {
                draftState.update { state ->
                    state.copy(
                        isExporting = false,
                        errorMessage = "Workspace export is unavailable."
                    )
                }
            }
            exportData
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(
                    isExporting = false,
                    errorMessage = error.message ?: "Android export could not be prepared."
                )
            }
            null
        } catch (error: IllegalStateException) {
            draftState.update { state ->
                state.copy(
                    isExporting = false,
                    errorMessage = error.message ?: "Android export could not be prepared."
                )
            }
            null
        }
    }

    fun finishExport() {
        draftState.update { state ->
            state.copy(isExporting = false)
        }
    }

    fun showExportError(message: String) {
        draftState.update { state ->
            state.copy(
                isExporting = false,
                errorMessage = message
            )
        }
    }

    fun clearErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }
}

fun createAccountStatusViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountStatusViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

fun createDeviceDiagnosticsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    appVersion: String,
    buildNumber: String
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeviceDiagnosticsViewModel(
                workspaceRepository = workspaceRepository,
                appVersion = appVersion,
                buildNumber = buildNumber
            )
        }
    }
}

fun createWorkspaceExportViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceExportViewModel(workspaceRepository = workspaceRepository)
        }
    }
}
