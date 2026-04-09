package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
fun AccountDangerZoneRoute(
    uiState: AccountDangerZoneUiState,
    onRequestDeleteConfirmation: () -> Unit,
    onDismissDeleteConfirmation: () -> Unit,
    onConfirmationTextChange: (String) -> Unit,
    onDeleteAccount: () -> Unit,
    onBack: () -> Unit
) {
    val strings = createSettingsStringResolver(context = LocalContext.current)
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_account_danger_zone_title),
        onBack = onBack,
        isBackEnabled = uiState.isDeleting.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
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

            if (uiState.successMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.successMessage,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.settings_account_danger_zone_card_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = stringResource(R.string.settings_account_danger_zone_body),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (uiState.deleteState == DestructiveActionState.IN_PROGRESS) {
                            CircularProgressIndicator()
                        }
                        Button(
                            onClick = onRequestDeleteConfirmation,
                            enabled = uiState.isLinked && uiState.isDeleting.not(),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                if (uiState.isDeleting) {
                                    stringResource(R.string.settings_deleting)
                                } else {
                                    stringResource(R.string.settings_account_danger_zone_delete_button)
                                }
                            )
                        }
                        if (uiState.isLinked.not()) {
                            Text(
                                text = stringResource(R.string.settings_account_danger_zone_sign_in_guidance),
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }

    if (uiState.showDeleteConfirmation) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.isDeleting.not()) {
                    onDismissDeleteConfirmation()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onDeleteAccount,
                    enabled = uiState.isDeleting.not() &&
                        uiState.confirmationText == accountDeletionConfirmationText(strings = strings)
                ) {
                    Text(
                        if (uiState.isDeleting) {
                            stringResource(R.string.settings_deleting)
                        } else {
                            stringResource(R.string.settings_account_danger_zone_delete_button)
                        }
                    )
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissDeleteConfirmation,
                    enabled = uiState.isDeleting.not()
                ) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
            title = {
                Text(stringResource(R.string.settings_account_danger_zone_dialog_title))
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = stringResource(R.string.settings_account_danger_zone_dialog_warning),
                        color = MaterialTheme.colorScheme.error
                    )
                    if (uiState.deleteState == DestructiveActionState.IN_PROGRESS) {
                        CircularProgressIndicator()
                    }
                    if (uiState.deleteState == DestructiveActionState.FAILED && uiState.errorMessage.isNotEmpty()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error
                        )
                    }
                    Text(
                        text = accountDeletionConfirmationText(strings = strings),
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedTextField(
                        value = uiState.confirmationText,
                        onValueChange = onConfirmationTextChange,
                        label = {
                            Text(stringResource(R.string.settings_account_danger_zone_confirmation_label))
                        },
                        enabled = uiState.isDeleting.not(),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        )
    }
}
