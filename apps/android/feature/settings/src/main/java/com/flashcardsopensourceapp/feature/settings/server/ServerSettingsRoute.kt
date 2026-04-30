package com.flashcardsopensourceapp.feature.settings.server

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.DeviceInfoCard
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

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
        title = stringResource(R.string.settings_server_title),
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
                    title = stringResource(R.string.settings_server_current_title),
                    rows = listOf(
                        stringResource(R.string.settings_server_mode_label) to uiState.modeTitle,
                        stringResource(R.string.settings_server_api_label) to uiState.apiBaseUrl,
                        stringResource(R.string.settings_server_auth_label) to uiState.authBaseUrl
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
                        Text(stringResource(R.string.settings_server_custom_origin_label))
                    },
                    supportingText = {
                        Text(stringResource(R.string.settings_server_custom_origin_supporting))
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (uiState.previewApiBaseUrl != null && uiState.previewAuthBaseUrl != null) {
                item {
                    DeviceInfoCard(
                        title = stringResource(R.string.settings_server_preview_title),
                        rows = listOf(
                            stringResource(R.string.settings_server_api_label) to uiState.previewApiBaseUrl,
                            stringResource(R.string.settings_server_auth_label) to uiState.previewAuthBaseUrl
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
                    Text(
                        if (uiState.isApplying) {
                            stringResource(R.string.settings_validating)
                        } else {
                            stringResource(R.string.settings_server_validate_button)
                        }
                    )
                }
            }

            item {
                Button(
                    onClick = onApplyPreviewConfiguration,
                    enabled = uiState.previewApiBaseUrl != null && uiState.isApplying.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.settings_server_apply_button))
                }
            }

            item {
                OutlinedButton(
                    onClick = onResetToOfficialServer,
                    enabled = uiState.isApplying.not(),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(stringResource(R.string.settings_server_reset_button))
                }
            }
        }
    }
}
