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
            lastSyncAttempt = formatTimestampLabel(timestampMillis = diagnostics?.lastSyncAttemptAtMillis),
            lastSuccessfulSync = formatTimestampLabel(timestampMillis = diagnostics?.lastSuccessfulSyncAtMillis),
            lastSyncError = diagnostics?.lastSyncErrorMessage ?: "None"
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
            lastSyncAttempt = "Never",
            lastSuccessfulSync = "Never",
            lastSyncError = "None"
        )
    )
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
