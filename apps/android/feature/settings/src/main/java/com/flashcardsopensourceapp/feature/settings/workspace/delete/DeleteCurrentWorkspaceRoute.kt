package com.flashcardsopensourceapp.feature.settings.workspace.delete

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.DestructiveConfirmationPhraseText
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import com.flashcardsopensourceapp.feature.settings.workspace.overview.WorkspaceOverviewUiState
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeleteConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeleteConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeleteConfirmationErrorTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeleteConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeleteConfirmationLoadingTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeleteConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeletePreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeletePreviewContinueButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeletePreviewDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewDeleteWorkspaceButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.overview.workspaceOverviewErrorMessageTag

@Composable
fun DeleteCurrentWorkspaceRoute(
    uiState: WorkspaceOverviewUiState,
    onRequestDeleteWorkspace: () -> Unit,
    onDismissDeletePreviewAlert: () -> Unit,
    onOpenDeleteConfirmation: () -> Unit,
    onDeleteConfirmationTextChange: (String) -> Unit,
    onDismissDeleteConfirmation: () -> Unit,
    onDeleteWorkspace: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_delete_current_workspace_title),
        onBack = onBack,
        isBackEnabled = uiState.isDeletingWorkspace.not()
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
                            modifier = Modifier
                                .padding(20.dp)
                                .testTag(tag = workspaceOverviewErrorMessageTag)
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
                            text = stringResource(R.string.settings_delete_current_workspace_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = uiState.workspaceName,
                            style = MaterialTheme.typography.bodyLarge
                        )
                        Text(
                            text = stringResource(R.string.settings_workspace_delete_body),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        OutlinedButton(
                            onClick = onRequestDeleteWorkspace,
                            enabled = uiState.isLinked &&
                                uiState.isDeletePreviewLoading.not() &&
                                uiState.isDeletingWorkspace.not(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(tag = workspaceOverviewDeleteWorkspaceButtonTag)
                        ) {
                            Text(
                                if (uiState.isDeletePreviewLoading) {
                                    stringResource(R.string.settings_loading)
                                } else {
                                    stringResource(R.string.settings_workspace_delete_button)
                                }
                            )
                        }
                        if (uiState.isLinked.not()) {
                            Text(
                                text = stringResource(R.string.settings_workspace_delete_guidance),
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }

    if (uiState.showDeletePreviewAlert && uiState.deletePreview != null) {
        AlertDialog(
            onDismissRequest = onDismissDeletePreviewAlert,
            confirmButton = {
                TextButton(
                    onClick = onOpenDeleteConfirmation,
                    modifier = Modifier.testTag(tag = workspaceOverviewDeletePreviewContinueButtonTag)
                ) {
                    Text(stringResource(R.string.settings_continue))
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissDeletePreviewAlert) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
            title = {
                Text(
                    text = stringResource(R.string.settings_workspace_delete_preview_title),
                    modifier = Modifier.testTag(tag = workspaceOverviewDeletePreviewDialogTag)
                )
            },
            text = {
                Text(
                    if (uiState.deletePreview.isLastAccessibleWorkspace) {
                        stringResource(
                            R.string.settings_workspace_delete_preview_last_workspace,
                            uiState.deletePreview.activeCardCount
                        )
                    } else {
                        stringResource(
                            R.string.settings_workspace_delete_preview_standard,
                            uiState.deletePreview.activeCardCount
                        )
                    },
                    modifier = Modifier.testTag(tag = workspaceOverviewDeletePreviewBodyTag)
                )
            }
        )
    }

    if (uiState.showDeleteConfirmation && uiState.deletePreview != null) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.isDeletingWorkspace.not()) {
                    onDismissDeleteConfirmation()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onDeleteWorkspace,
                    enabled = uiState.isDeletingWorkspace.not() &&
                        uiState.deleteConfirmationText == uiState.deletePreview.confirmationText,
                    modifier = Modifier.testTag(tag = workspaceOverviewDeleteConfirmationButtonTag)
                ) {
                    Text(
                        if (uiState.isDeletingWorkspace) {
                            stringResource(R.string.settings_deleting)
                        } else {
                            stringResource(R.string.settings_workspace_delete_button)
                        }
                    )
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissDeleteConfirmation,
                    enabled = uiState.isDeletingWorkspace.not()
                ) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
            title = {
                Text(
                    text = stringResource(R.string.settings_workspace_delete_dialog_title),
                    modifier = Modifier.testTag(tag = workspaceOverviewDeleteConfirmationDialogTag)
                )
            },
            text = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier
                        .heightIn(max = 420.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    Text(
                        text = stringResource(R.string.settings_workspace_delete_dialog_warning),
                        color = MaterialTheme.colorScheme.error
                    )
                    if (uiState.deleteState == DestructiveActionState.IN_PROGRESS) {
                        CircularProgressIndicator(
                            modifier = Modifier.testTag(tag = workspaceOverviewDeleteConfirmationLoadingTag)
                        )
                    }
                    if (uiState.deleteState == DestructiveActionState.FAILED && uiState.errorMessage.isNotEmpty()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag(tag = workspaceOverviewDeleteConfirmationErrorTag)
                        )
                    }
                    DestructiveConfirmationPhraseText(
                        text = uiState.deletePreview.confirmationText,
                        testTag = workspaceOverviewDeleteConfirmationPhraseTag,
                        modifier = Modifier
                    )
                    OutlinedTextField(
                        value = uiState.deleteConfirmationText,
                        onValueChange = onDeleteConfirmationTextChange,
                        label = {
                            Text(stringResource(R.string.settings_workspace_confirmation_label))
                        },
                        enabled = uiState.isDeletingWorkspace.not(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(tag = workspaceOverviewDeleteConfirmationFieldTag)
                    )
                }
            }
        )
    }
}
