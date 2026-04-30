package com.flashcardsopensourceapp.feature.settings.device

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.currentDeviceModelLabel
import com.flashcardsopensourceapp.feature.settings.currentOperatingSystemLabel
import com.flashcardsopensourceapp.feature.settings.formatTimestampLabel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class DeviceDiagnosticsViewModel(
    workspaceRepository: WorkspaceRepository,
    appVersion: String,
    buildNumber: String,
    private val strings: SettingsStringResolver
) : ViewModel() {
    val uiState: StateFlow<DeviceDiagnosticsUiState> = workspaceRepository.observeDeviceDiagnostics().map { diagnostics ->
        DeviceDiagnosticsUiState(
            workspaceName = diagnostics?.workspaceName ?: strings.get(R.string.settings_unavailable),
            workspaceId = diagnostics?.workspaceId ?: strings.get(R.string.settings_unavailable),
            appVersion = appVersion,
            buildNumber = buildNumber,
            operatingSystem = currentOperatingSystemLabel(strings = strings),
            deviceModel = currentDeviceModelLabel(strings = strings),
            clientLabel = strings.get(R.string.settings_device_client_jetpack_compose),
            storageLabel = strings.get(R.string.settings_device_storage_room_sqlite),
            outboxEntriesCount = diagnostics?.outboxEntriesCount ?: 0,
            lastSyncCursor = diagnostics?.lastSyncCursor ?: strings.get(R.string.settings_unavailable),
            lastSyncAttempt = formatTimestampLabel(
                timestampMillis = diagnostics?.lastSyncAttemptAtMillis,
                strings = strings
            ),
            lastSuccessfulSync = formatTimestampLabel(
                timestampMillis = diagnostics?.lastSuccessfulSyncAtMillis,
                strings = strings
            ),
            lastSyncError = diagnostics?.lastSyncErrorMessage ?: strings.get(R.string.settings_none)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DeviceDiagnosticsUiState(
            workspaceName = strings.get(R.string.settings_loading),
            workspaceId = strings.get(R.string.settings_loading),
            appVersion = appVersion,
            buildNumber = buildNumber,
            operatingSystem = currentOperatingSystemLabel(strings = strings),
            deviceModel = currentDeviceModelLabel(strings = strings),
            clientLabel = strings.get(R.string.settings_device_client_jetpack_compose),
            storageLabel = strings.get(R.string.settings_device_storage_room_sqlite),
            outboxEntriesCount = 0,
            lastSyncCursor = strings.get(R.string.settings_unavailable),
            lastSyncAttempt = strings.get(R.string.settings_never),
            lastSuccessfulSync = strings.get(R.string.settings_never),
            lastSyncError = strings.get(R.string.settings_none)
        )
    )
}

fun createDeviceDiagnosticsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    appVersion: String,
    buildNumber: String,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeviceDiagnosticsViewModel(
                workspaceRepository = workspaceRepository,
                appVersion = appVersion,
                buildNumber = buildNumber,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
