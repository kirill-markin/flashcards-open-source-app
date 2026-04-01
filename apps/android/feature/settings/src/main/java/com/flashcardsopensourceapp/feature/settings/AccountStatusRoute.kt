package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun AccountStatusRoute(
    uiState: AccountStatusUiState,
    onOpenSignIn: () -> Unit,
    onSyncNow: () -> Unit,
    onRequestLogout: () -> Unit,
    onDismissLogoutConfirmation: () -> Unit,
    onConfirmLogout: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Account Status",
        onBack = onBack,
        isBackEnabled = uiState.isSubmitting.not()
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            if (uiState.syncBlockedMessage != null) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(20.dp)
                        ) {
                            Text(
                                text = "Sync is blocked on this device",
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = uiState.syncBlockedMessage,
                                color = MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = "Use Log out to clear local cloud identity on this device before reconnecting."
                            )
                        }
                    }
                }
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
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Cloud status")
                        },
                        supportingContent = {
                            Text(uiState.cloudStatusTitle)
                        },
                        leadingContent = {
                            Icon(
                                imageVector = Icons.Outlined.LockOpen,
                                contentDescription = null
                            )
                        }
                    )
                }
            }

            item {
                DeviceInfoCard(
                    title = "Account",
                    rows = buildList {
                        add("Workspace" to uiState.workspaceName)
                        add("Installation ID" to uiState.installationId)
                        add("Sync" to uiState.syncStatusText)
                        add("Last successful sync" to uiState.lastSuccessfulSync)
                        if (uiState.linkedEmail != null) {
                            add("Linked email" to uiState.linkedEmail)
                        }
                    }
                )
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = "Actions",
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (uiState.isGuest) {
                            Text(
                                text = "Guest AI is active on this device. Create an account or log in to upgrade it into a linked cloud account.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (uiState.isLinked || uiState.isLinkingReady.not()) {
                            Button(
                                onClick = onOpenSignIn,
                                enabled = uiState.isSubmitting.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    when {
                                        uiState.isLinked -> "Switch account"
                                        uiState.isGuest -> "Sign in or sign up"
                                        else -> "Sign in or sign up"
                                    }
                                )
                            }
                        }
                        if (uiState.isLinked) {
                            Button(
                                onClick = onSyncNow,
                                enabled = uiState.isSubmitting.not() && uiState.isSyncBlocked.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (uiState.isSubmitting) "Syncing..." else "Sync now")
                            }
                            OutlinedButton(
                                onClick = onRequestLogout,
                                enabled = uiState.isSubmitting.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Log out")
                            }
                        }
                    }
                }
            }
        }
    }

    if (uiState.showLogoutConfirmation) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.isSubmitting.not()) {
                    onDismissLogoutConfirmation()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onConfirmLogout,
                    enabled = uiState.isSubmitting.not()
                ) {
                    Text(if (uiState.isSubmitting) "Logging out..." else "Log out")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissLogoutConfirmation,
                    enabled = uiState.isSubmitting.not()
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Log out and clear this device?")
            },
            text = {
                Text("All local workspaces and synced data will be removed from this device.")
            }
        )
    }
}
