package com.flashcardsopensourceapp.feature.settings.device

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.DeviceInfoCard
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val deviceDiagnosticsScreenTag: String = "device_diagnostics_screen"

@Composable
fun DeviceDiagnosticsRoute(
    uiState: DeviceDiagnosticsUiState,
    onAppVersionTap: () -> Unit,
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
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = deviceDiagnosticsScreenTag)
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
                DeviceDiagnosticsInfoCard(
                    title = stringResource(R.string.settings_device_app_info_title),
                    rows = listOf(
                        DeviceDiagnosticsInfoRow(
                            label = stringResource(R.string.settings_device_app_version_label),
                            value = uiState.appVersion,
                            onClick = onAppVersionTap
                        ),
                        DeviceDiagnosticsInfoRow(
                            label = stringResource(R.string.settings_device_build_number_label),
                            value = uiState.buildNumber,
                            onClick = null
                        ),
                        DeviceDiagnosticsInfoRow(
                            label = stringResource(R.string.settings_device_client_label),
                            value = uiState.clientLabel,
                            onClick = null
                        ),
                        DeviceDiagnosticsInfoRow(
                            label = stringResource(R.string.settings_device_storage_label),
                            value = uiState.storageLabel,
                            onClick = null
                        )
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

private data class DeviceDiagnosticsInfoRow(
    val label: String,
    val value: String,
    val onClick: (() -> Unit)?
)

@Composable
private fun DeviceDiagnosticsInfoCard(
    title: String,
    rows: List<DeviceDiagnosticsInfoRow>
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium
            )

            rows.forEach { row: DeviceDiagnosticsInfoRow ->
                DeviceDiagnosticsInfoRowContent(row = row)
            }
        }
    }
}

@Composable
private fun DeviceDiagnosticsInfoRowContent(row: DeviceDiagnosticsInfoRow) {
    val onClick: (() -> Unit)? = row.onClick
    val rowModifier: Modifier = if (onClick != null) {
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    } else {
        Modifier.fillMaxWidth()
    }

    Column(modifier = rowModifier) {
        Text(
            text = row.label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = row.value,
            style = MaterialTheme.typography.bodyLarge
        )
    }
}
