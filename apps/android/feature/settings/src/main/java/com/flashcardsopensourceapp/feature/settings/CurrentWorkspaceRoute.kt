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
const val currentWorkspaceExistingRowTag: String = "current_workspace_existing_row"
const val currentWorkspaceSelectedSummaryTag: String = "current_workspace_selected_summary"
const val currentWorkspaceExistingButtonTagPrefix: String = "current_workspace_existing_button:"
const val currentWorkspaceSelectedIndicatorTagPrefix: String = "current_workspace_selected_indicator:"
const val currentWorkspaceListTag: String = "current_workspace_list"
const val currentWorkspaceNameTag: String = "current_workspace_name"
const val currentWorkspaceErrorMessageTag: String = "current_workspace_error_message"
const val currentWorkspaceOperationMessageTag: String = "current_workspace_operation_message"
const val currentWorkspaceLoadingStateTag: String = "current_workspace_loading_state"
const val currentWorkspaceReloadButtonTag: String = "current_workspace_reload_button"

fun currentWorkspaceExistingButtonTag(workspaceId: String): String {
    return currentWorkspaceExistingButtonTagPrefix + workspaceId
}

fun currentWorkspaceSelectedIndicatorTag(workspaceId: String): String {
    return currentWorkspaceSelectedIndicatorTagPrefix + workspaceId
}

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
    LaunchedEffect(
        uiState.isLinked,
        uiState.workspaceLoadState
    ) {
        if (
            uiState.isLinked
            && uiState.workspaceLoadState == CurrentWorkspaceLoadState.Loading
        ) {
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
            modifier = Modifier
                .fillMaxSize()
                .testTag(tag = currentWorkspaceListTag)
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
                        Text(
                            text = uiState.currentWorkspaceName,
                            modifier = Modifier.testTag(tag = currentWorkspaceNameTag)
                        )
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
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.testTag(tag = currentWorkspaceOperationMessageTag)
                            )
                        }
                    }
                }
            }

            if (uiState.errorMessage.isNotEmpty() && uiState.operation == CurrentWorkspaceOperation.IDLE) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier
                                .padding(20.dp)
                                .testTag(tag = currentWorkspaceErrorMessageTag)
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

                            uiState.workspaceLoadState == CurrentWorkspaceLoadState.Loading -> {
                                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.testTag(tag = currentWorkspaceLoadingStateTag)
                                    )
                                    Text("Loading linked workspaces...")
                                }
                            }

                            uiState.workspaceLoadState == CurrentWorkspaceLoadState.Failed -> {
                                Button(
                                    onClick = onReload,
                                    enabled = uiState.isSwitching.not(),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .testTag(tag = currentWorkspaceReloadButtonTag)
                                ) {
                                    Text("Load linked workspaces")
                                }
                            }

                            else -> {
                                // The live smoke verifies structural workspace changes by
                                // counting linked workspace rows instead of relying on
                                // transient snackbar copy.
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
                                                    Modifier
                                                } else {
                                                    Modifier.testTag(tag = currentWorkspaceExistingRowTag)
                                                }
                                            )
                                            .then(
                                                if (workspace.isCreateNew) {
                                                    Modifier.testTag(tag = currentWorkspaceCreateButtonTag)
                                                } else {
                                                    Modifier.testTag(
                                                        tag = currentWorkspaceExistingButtonTag(
                                                            workspaceId = workspace.workspaceId
                                                        )
                                                    )
                                                }
                                            )
                                    ) {
                                        Column(
                                            verticalArrangement = Arrangement.spacedBy(4.dp),
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Text(
                                                text = if (workspace.isSelected) {
                                                    "${workspace.title} (Current)"
                                                } else {
                                                    workspace.title
                                                },
                                                modifier = if (workspace.isCreateNew) {
                                                    Modifier
                                                } else if (workspace.isSelected) {
                                                    Modifier.testTag(tag = currentWorkspaceExistingRowTag)
                                                } else {
                                                    Modifier.testTag(tag = currentWorkspaceExistingRowTag)
                                                }
                                            )
                                            Text(
                                                text = workspace.subtitle,
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                                modifier = if (workspace.isSelected) {
                                                    Modifier.testTag(tag = currentWorkspaceSelectedSummaryTag)
                                                } else {
                                                    Modifier
                                                }
                                            )
                                        }
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
