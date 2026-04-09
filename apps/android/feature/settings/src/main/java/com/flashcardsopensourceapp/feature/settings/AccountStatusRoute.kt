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
import androidx.compose.ui.res.stringResource
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
        title = stringResource(R.string.settings_account_status_screen_title),
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
                                text = stringResource(R.string.settings_account_status_sync_blocked_title),
                                style = MaterialTheme.typography.titleMedium
                            )
                            Text(
                                text = uiState.syncBlockedMessage,
                                color = MaterialTheme.colorScheme.error
                            )
                            Text(
                                text = stringResource(R.string.settings_account_status_sync_blocked_body)
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
                            Text(stringResource(R.string.settings_account_status_cloud_status_label))
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
                    title = stringResource(R.string.settings_section_account),
                    rows = buildList {
                        add(stringResource(R.string.settings_section_workspace) to uiState.workspaceName)
                        add(stringResource(R.string.settings_account_status_installation_id_label) to uiState.installationId)
                        add(stringResource(R.string.settings_account_status_sync_status_label) to uiState.syncStatusText)
                        add(stringResource(R.string.settings_account_status_last_successful_sync_label) to uiState.lastSuccessfulSync)
                        if (uiState.linkedEmail != null) {
                            add(stringResource(R.string.settings_account_status_linked_email_label) to uiState.linkedEmail)
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
                            text = stringResource(R.string.settings_account_actions_title),
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (uiState.isGuest) {
                            Text(
                                text = stringResource(R.string.settings_current_workspace_load_guest_message),
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
                                        uiState.isLinked -> stringResource(R.string.settings_account_status_sign_in_button)
                                        uiState.isGuest -> stringResource(R.string.settings_account_status_sign_in_button)
                                        else -> stringResource(R.string.settings_account_status_sign_in_button)
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
                                Text(
                                    if (uiState.isSubmitting) {
                                        stringResource(R.string.settings_sync_status_syncing)
                                    } else {
                                        stringResource(R.string.settings_account_status_sync_now_button)
                                    }
                                )
                            }
                            OutlinedButton(
                                onClick = onRequestLogout,
                                enabled = uiState.isSubmitting.not(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(stringResource(R.string.settings_logout))
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
                    Text(
                        if (uiState.isSubmitting) {
                            stringResource(R.string.settings_logout)
                        } else {
                            stringResource(R.string.settings_logout)
                        }
                    )
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissLogoutConfirmation,
                    enabled = uiState.isSubmitting.not()
                ) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
            title = {
                Text(stringResource(R.string.settings_account_status_logout_dialog_title))
            },
            text = {
                Text(stringResource(R.string.settings_account_status_logout_dialog_body))
            }
        )
    }
}
