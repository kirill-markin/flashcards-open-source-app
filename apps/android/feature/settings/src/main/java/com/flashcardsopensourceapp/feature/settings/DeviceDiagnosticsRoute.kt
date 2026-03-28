package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
fun DeviceDiagnosticsRoute(
    uiState: DeviceDiagnosticsUiState,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "This Device",
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
                    title = "Workspace",
                    rows = listOf(
                        "Name" to uiState.workspaceName,
                        "Workspace ID" to uiState.workspaceId
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = "App",
                    rows = listOf(
                        "Version" to uiState.appVersion,
                        "Build" to uiState.buildNumber,
                        "Client" to uiState.clientLabel,
                        "Storage" to uiState.storageLabel
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = "Device",
                    rows = listOf(
                        "Operating system" to uiState.operatingSystem,
                        "Model" to uiState.deviceModel
                    )
                )
            }

            item {
                DeviceInfoCard(
                    title = "Local sync diagnostics",
                    rows = listOf(
                        "Outbox entries" to uiState.outboxEntriesCount.toString(),
                        "Last sync cursor" to uiState.lastSyncCursor,
                        "Last sync attempt" to uiState.lastSyncAttempt,
                        "Last successful sync" to uiState.lastSuccessfulSync,
                        "Last sync error" to uiState.lastSyncError
                    )
                )
            }
        }
    }
}
