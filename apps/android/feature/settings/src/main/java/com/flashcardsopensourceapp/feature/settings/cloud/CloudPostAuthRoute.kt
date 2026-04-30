package com.flashcardsopensourceapp.feature.settings.cloud

import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

const val cloudPostAuthExistingButtonTagPrefix: String = "cloud_post_auth_existing_button:"
const val cloudPostAuthWorkspaceRowTag: String = "cloud_post_auth_workspace_row"
const val cloudPostAuthSelectedIndicatorTagPrefix: String = "cloud_post_auth_selected_indicator:"

fun cloudPostAuthExistingButtonTag(workspaceId: String): String {
    return cloudPostAuthExistingButtonTagPrefix + workspaceId
}

fun cloudPostAuthSelectedIndicatorTag(workspaceId: String): String {
    return cloudPostAuthSelectedIndicatorTagPrefix + workspaceId
}

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

    val shouldBlockBack = uiState.mode == CloudPostAuthMode.PROCESSING
        || uiState.mode == CloudPostAuthMode.READY_TO_AUTO_LINK
    val isBackEnabled = uiState.mode != CloudPostAuthMode.PROCESSING &&
        uiState.mode != CloudPostAuthMode.READY_TO_AUTO_LINK

    BackHandler(enabled = shouldBlockBack) {
        // Keep the post-auth cloud setup flow on screen until it either
        // finishes successfully or reaches an explicit failure state.
    }

    SettingsScreenScaffold(
        title = stringResource(R.string.settings_post_auth_title),
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
                                        stringResource(
                                            R.string.settings_post_auth_prepare_guest_title,
                                            uiState.pendingWorkspaceTitle
                                                ?: stringResource(R.string.settings_current_workspace_selected)
                                        )
                                    } else {
                                        stringResource(
                                            R.string.settings_post_auth_prepare_title,
                                            uiState.pendingWorkspaceTitle
                                                ?: stringResource(R.string.settings_current_workspace_selected)
                                        )
                                    }
                                )
                            }

                            CloudPostAuthMode.CHOOSE_WORKSPACE -> {
                                Text(
                                    if (uiState.isGuestUpgrade) {
                                        stringResource(R.string.settings_post_auth_choose_guest_workspace_body)
                                    } else {
                                        stringResource(R.string.settings_post_auth_choose_workspace_body)
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
                                    text = stringResource(R.string.settings_post_auth_idle),
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
                        enabled = uiState.mode == CloudPostAuthMode.CHOOSE_WORKSPACE,
                        modifier = Modifier
                            .fillMaxWidth()
                            .then(
                                if (workspace.isCreateNew) {
                                    Modifier
                                } else {
                                    Modifier.testTag(tag = cloudPostAuthWorkspaceRowTag)
                                }
                            )
                            .then(
                                if (workspace.isCreateNew) {
                                    Modifier
                                } else {
                                    Modifier.testTag(
                                        tag = cloudPostAuthExistingButtonTag(
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
                                    stringResource(
                                        R.string.settings_post_auth_current_workspace_suffix,
                                        workspace.title
                                    )
                                } else {
                                    workspace.title
                                },
                                modifier = if (workspace.isSelected) {
                                    Modifier.testTag(
                                        tag = cloudPostAuthSelectedIndicatorTag(
                                            workspaceId = workspace.workspaceId
                                        )
                                    )
                                } else {
                                    Modifier
                                }
                            )
                            Text(
                                text = workspace.subtitle,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }

            if (uiState.mode == CloudPostAuthMode.FAILED) {
                item {
                    Button(
                        onClick = onRetry,
                        enabled = uiState.canRetry && uiState.mode == CloudPostAuthMode.FAILED,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_retry))
                    }
                }
                item {
                    OutlinedButton(
                        onClick = onLogout,
                        enabled = uiState.canLogout && uiState.mode == CloudPostAuthMode.FAILED,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_logout))
                    }
                }
            }
        }
    }
}
