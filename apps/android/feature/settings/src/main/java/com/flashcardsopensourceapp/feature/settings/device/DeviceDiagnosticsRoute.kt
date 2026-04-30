package com.flashcardsopensourceapp.feature.settings.device

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.flashcardsopensourceapp.feature.settings.DeviceInfoCard
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

@Composable
fun DeviceDiagnosticsRoute(
    uiState: DeviceDiagnosticsUiState,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_device_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                DeviceInfoCard(
                    title = stringResource(R.string.settings_section_workspace),
                    rows = listOf(
                        stringResource(R.string.settings_device_workspace_name_label) to uiState.workspaceName,
                        stringResource(R.string.settings_device_workspace_id_label) to uiState.workspaceId
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = stringResource(R.string.settings_device_app_info_title),
                    rows = listOf(
                        stringResource(R.string.settings_device_app_version_label) to uiState.appVersion,
                        stringResource(R.string.settings_device_build_number_label) to uiState.buildNumber,
                        stringResource(R.string.settings_device_client_label) to uiState.clientLabel,
                        stringResource(R.string.settings_device_storage_label) to uiState.storageLabel
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = stringResource(R.string.settings_section_device),
                    rows = listOf(
                        stringResource(R.string.settings_device_os_label) to uiState.operatingSystem,
                        stringResource(R.string.settings_device_model_label) to uiState.deviceModel
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = stringResource(R.string.settings_device_sync_diagnostics_title),
                    rows = listOf(
                        stringResource(R.string.settings_device_outbox_label) to uiState.outboxEntriesCount.toString(),
                        stringResource(R.string.settings_device_last_sync_cursor_label) to uiState.lastSyncCursor,
                        stringResource(R.string.settings_device_last_sync_attempt_label) to uiState.lastSyncAttempt,
                        stringResource(R.string.settings_device_last_successful_sync_label) to uiState.lastSuccessfulSync,
                        stringResource(R.string.settings_device_last_sync_error_label) to uiState.lastSyncError
                    )
                )
            }
        }
    }
}
