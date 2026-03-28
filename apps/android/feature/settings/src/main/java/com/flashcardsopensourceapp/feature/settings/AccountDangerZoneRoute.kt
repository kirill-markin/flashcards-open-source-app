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
    SettingsScreenScaffold(
        title = "Danger Zone",
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
                            text = "Danger zone",
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = "Permanently delete this account and all cloud data.",
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
                            Text(if (uiState.isDeleting) "Deleting..." else "Delete my account")
                        }
                        if (uiState.isLinked.not()) {
                            Text(
                                text = "Sign in to a linked cloud account before deleting it.",
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
                        uiState.confirmationText == accountDeletionConfirmationText
                ) {
                    Text(if (uiState.isDeleting) "Deleting..." else "Delete my account")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissDeleteConfirmation,
                    enabled = uiState.isDeleting.not()
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Delete account")
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Warning! This action is permanent. Type the phrase below exactly to continue.",
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
                        text = accountDeletionConfirmationText,
                        style = MaterialTheme.typography.bodyMedium
                    )
                    OutlinedTextField(
                        value = uiState.confirmationText,
                        onValueChange = onConfirmationTextChange,
                        label = {
                            Text("Confirmation text")
                        },
                        enabled = uiState.isDeleting.not(),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }
        )
    }
}
