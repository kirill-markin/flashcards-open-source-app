package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection

@Composable
fun CloudPostAuthRoute(
    uiState: CloudPostAuthUiState,
    onAutoContinue: () -> Unit,
    onSelectWorkspace: (CloudWorkspaceLinkSelection) -> Unit,
    onRetry: () -> Unit,
    onLogout: () -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(uiState.mode, uiState.pendingWorkspaceTitle) {
        if (uiState.mode == CloudPostAuthMode.READY_TO_AUTO_LINK) {
            onAutoContinue()
        }
    }

    val isBackEnabled = uiState.mode != CloudPostAuthMode.PROCESSING &&
        uiState.mode != CloudPostAuthMode.READY_TO_AUTO_LINK

    SettingsScreenScaffold(
        title = "Cloud sync",
        onBack = onBack,
        isBackEnabled = isBackEnabled
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        if (uiState.verifiedEmail != null) {
                            Text(
                                text = uiState.verifiedEmail,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        when (uiState.mode) {
                            CloudPostAuthMode.READY_TO_AUTO_LINK -> {
                                Text(
                                    if (uiState.isGuestUpgrade) {
                                        "Preparing to upgrade Guest AI into ${uiState.pendingWorkspaceTitle ?: "your workspace"}..."
                                    } else {
                                        "Preparing ${uiState.pendingWorkspaceTitle ?: "your workspace"}..."
                                    }
                                )
                            }

                            CloudPostAuthMode.CHOOSE_WORKSPACE -> {
                                Text(
                                    if (uiState.isGuestUpgrade) {
                                        "Choose the linked workspace that should receive this Guest AI session, or create a new one."
                                    } else {
                                        "Choose a linked workspace to open on this Android device, or create a new one."
                                    }
                                )
                            }

                            CloudPostAuthMode.PROCESSING -> {
                                CircularProgressIndicator()
                                Text(uiState.processingTitle)
                                Text(
                                    text = uiState.processingMessage,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }

                            CloudPostAuthMode.FAILED -> {
                                Text(
                                    text = uiState.errorMessage,
                                    color = MaterialTheme.colorScheme.error
                                )
                            }

                            CloudPostAuthMode.IDLE -> {
                                Text(
                                    text = "Cloud account setup is idle.",
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }

            if (uiState.mode == CloudPostAuthMode.CHOOSE_WORKSPACE) {
                items(uiState.workspaces, key = { item -> item.workspaceId }) { workspace ->
                    OutlinedButton(
                        onClick = {
                            if (workspace.isCreateNew) {
                                onSelectWorkspace(CloudWorkspaceLinkSelection.CreateNew)
                            } else {
                                onSelectWorkspace(
                                    CloudWorkspaceLinkSelection.Existing(workspaceId = workspace.workspaceId)
                                )
                            }
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(workspace.title)
                    }
                }
            }

            if (uiState.mode == CloudPostAuthMode.FAILED) {
                item {
                    Button(
                        onClick = onRetry,
                        enabled = uiState.canRetry,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Retry")
                    }
                }
                item {
                    OutlinedButton(
                        onClick = onLogout,
                        enabled = uiState.canLogout,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Log out")
                    }
                }
            }
        }
    }
}
