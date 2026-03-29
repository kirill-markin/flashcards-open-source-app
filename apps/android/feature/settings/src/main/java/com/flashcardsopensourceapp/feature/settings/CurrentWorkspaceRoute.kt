package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

const val currentWorkspaceCreateButtonTag: String = "current_workspace_create_button"

@Composable
fun CurrentWorkspaceRoute(
    uiState: CurrentWorkspaceUiState,
    onReload: () -> Unit,
    onSwitchToExistingWorkspace: (String) -> Unit,
    onCreateWorkspace: () -> Unit,
    onOpenSignIn: () -> Unit,
    onRetryLastWorkspaceAction: () -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(uiState.isLinked, uiState.workspaces.isEmpty(), uiState.isLoading) {
        if (uiState.isLinked && uiState.workspaces.isEmpty() && uiState.isLoading.not()) {
            onReload()
        }
    }

    SettingsScreenScaffold(
        title = "Current Workspace",
        onBack = onBack,
        isBackEnabled = uiState.isSwitching.not()
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
                        Text(
                            text = "Current workspace",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(uiState.currentWorkspaceName)
                        Text(
                            text = "Cloud status: ${uiState.cloudStatusTitle}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (uiState.linkedEmail != null) {
                            Text(
                                text = uiState.linkedEmail,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        if (uiState.pendingWorkspaceTitle != null) {
                            Text(
                                text = when (uiState.operation) {
                                    CurrentWorkspaceOperation.SWITCHING -> "Switching to ${uiState.pendingWorkspaceTitle}..."
                                    CurrentWorkspaceOperation.SYNCING -> "Syncing ${uiState.pendingWorkspaceTitle}..."
                                    CurrentWorkspaceOperation.IDLE,
                                    CurrentWorkspaceOperation.LOADING -> ""
                                },
                                color = MaterialTheme.colorScheme.onSurfaceVariant
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
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = "Linked workspaces",
                            style = MaterialTheme.typography.titleMedium
                        )
                        when {
                            uiState.isLinked.not() && uiState.isLinkingReady.not() -> {
                                Text(
                                    text = if (uiState.isGuest) {
                                        "Create an account or log in to upgrade Guest AI before managing linked workspaces."
                                    } else {
                                        "Sign in first to load linked cloud workspaces."
                                    },
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Button(
                                    onClick = onOpenSignIn,
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text(if (uiState.isGuest) "Create account or Log in" else "Sign in")
                                }
                            }

                            uiState.isLoading -> {
                                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                    CircularProgressIndicator()
                                    Text("Loading linked workspaces...")
                                }
                            }

                            uiState.workspaces.isEmpty() -> {
                                Button(
                                    onClick = onReload,
                                    enabled = uiState.isSwitching.not(),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Text("Load linked workspaces")
                                }
                            }

                            else -> {
                                uiState.workspaces.forEach { workspace ->
                                    OutlinedButton(
                                        onClick = {
                                            if (workspace.isCreateNew) {
                                                onCreateWorkspace()
                                            } else {
                                                onSwitchToExistingWorkspace(workspace.workspaceId)
                                            }
                                        },
                                        enabled = uiState.isSwitching.not(),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .then(
                                                if (workspace.isCreateNew) {
                                                    Modifier.testTag(tag = currentWorkspaceCreateButtonTag)
                                                } else {
                                                    Modifier
                                                }
                                            )
                                    ) {
                                        Text(
                                            if (workspace.isSelected) {
                                                "${workspace.title} (Current)"
                                            } else {
                                                workspace.title
                                            }
                                        )
                                    }
                                }
                                if (uiState.canRetryLastWorkspaceAction && uiState.errorMessage.isNotEmpty()) {
                                    OutlinedButton(
                                        onClick = onRetryLastWorkspaceAction,
                                        modifier = Modifier.fillMaxWidth()
                                    ) {
                                        Text("Retry last workspace action")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
