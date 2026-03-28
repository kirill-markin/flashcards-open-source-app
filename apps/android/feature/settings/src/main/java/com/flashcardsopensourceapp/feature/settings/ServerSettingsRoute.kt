package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun ServerSettingsRoute(
    uiState: ServerSettingsUiState,
    onCustomOriginChange: (String) -> Unit,
    onValidateCustomServer: () -> Unit,
    onApplyPreviewConfiguration: () -> Unit,
    onResetToOfficialServer: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Server",
        onBack = onBack,
        isBackEnabled = uiState.isApplying.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                DeviceInfoCard(
                    title = "Current server",
                    rows = listOf(
                        "Mode" to uiState.modeTitle,
                        "API" to uiState.apiBaseUrl,
                        "Auth" to uiState.authBaseUrl
                    )
                )
            }

            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.customOrigin,
                    onValueChange = onCustomOriginChange,
                    label = {
                        Text("Custom origin")
                    },
                    supportingText = {
                        Text("Use a base HTTPS URL like https://example.com")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (uiState.previewApiBaseUrl != null && uiState.previewAuthBaseUrl != null) {
                item {
                    DeviceInfoCard(
                        title = "Preview",
                        rows = listOf(
                            "API" to uiState.previewApiBaseUrl,
                            "Auth" to uiState.previewAuthBaseUrl
                        )
                    )
                }
            }

            item {
                Button(
                    onClick = onValidateCustomServer,
                    enabled = uiState.isApplying.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (uiState.isApplying) "Validating..." else "Validate custom server")
                }
            }

            item {
                Button(
                    onClick = onApplyPreviewConfiguration,
                    enabled = uiState.previewApiBaseUrl != null && uiState.isApplying.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Apply custom server")
                }
            }

            item {
                OutlinedButton(
                    onClick = onResetToOfficialServer,
                    enabled = uiState.isApplying.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text("Reset to official server")
                }
            }
        }
    }
}
