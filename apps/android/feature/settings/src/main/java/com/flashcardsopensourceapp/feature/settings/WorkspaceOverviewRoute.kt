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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp

const val workspaceOverviewNameFieldTag: String = "workspace_overview_name_field"
const val workspaceOverviewSaveNameButtonTag: String = "workspace_overview_save_name_button"
const val workspaceOverviewErrorMessageTag: String = "workspace_overview_error_message"
const val workspaceOverviewDeleteWorkspaceButtonTag: String = "workspace_overview_delete_workspace_button"
const val workspaceOverviewDeletePreviewDialogTag: String = "workspace_overview_delete_preview_dialog"
const val workspaceOverviewDeletePreviewBodyTag: String = "workspace_overview_delete_preview_body"
const val workspaceOverviewDeletePreviewContinueButtonTag: String = "workspace_overview_delete_preview_continue_button"
const val workspaceOverviewDeleteConfirmationDialogTag: String = "workspace_overview_delete_confirmation_dialog"
const val workspaceOverviewDeleteConfirmationPhraseTag: String = "workspace_overview_delete_confirmation_phrase"
const val workspaceOverviewDeleteConfirmationFieldTag: String = "workspace_overview_delete_confirmation_field"
const val workspaceOverviewDeleteConfirmationButtonTag: String = "workspace_overview_delete_confirmation_button"
const val workspaceOverviewDeleteConfirmationErrorTag: String = "workspace_overview_delete_confirmation_error"
const val workspaceOverviewDeleteConfirmationLoadingTag: String = "workspace_overview_delete_confirmation_loading"
const val workspaceOverviewTodayDueCountTag: String = "workspace_overview_today_due_count"
const val workspaceOverviewTodayNewCountTag: String = "workspace_overview_today_new_count"
const val workspaceOverviewTodayReviewedCountTag: String = "workspace_overview_today_reviewed_count"

@Composable
fun WorkspaceOverviewRoute(
    uiState: WorkspaceOverviewUiState,
    onWorkspaceNameChange: (String) -> Unit,
    onSaveWorkspaceName: () -> Unit,
    onRequestDeleteWorkspace: () -> Unit,
    onDismissDeletePreviewAlert: () -> Unit,
    onOpenDeleteConfirmation: () -> Unit,
    onDeleteConfirmationTextChange: (String) -> Unit,
    onDismissDeleteConfirmation: () -> Unit,
    onDeleteWorkspace: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Overview",
        onBack = onBack,
        isBackEnabled = true
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
                        Text(text = "Workspace", style = MaterialTheme.typography.titleMedium)
                        if (uiState.isLinked) {
                            OutlinedTextField(
                                value = uiState.workspaceNameDraft,
                                onValueChange = onWorkspaceNameChange,
                                label = {
                                    Text("Workspace name")
                                },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag(tag = workspaceOverviewNameFieldTag)
                            )
                            Button(
                                onClick = onSaveWorkspaceName,
                                enabled = uiState.isSavingName.not()
                                    && uiState.workspaceNameDraft.trim().isNotEmpty()
                                    && uiState.workspaceNameDraft != uiState.workspaceName,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .testTag(tag = workspaceOverviewSaveNameButtonTag)
                            ) {
                                Text(if (uiState.isSavingName) "Saving..." else "Save name")
                            }
                        } else {
                            Text(
                                text = uiState.workspaceName,
                                style = MaterialTheme.typography.headlineSmall
                            )
                            Text(
                                text = "Workspace rename is available only for linked cloud workspaces.",
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        HorizontalDivider()
                        OverviewRow(title = "Cards", value = uiState.totalCards)
                        OverviewRow(title = "Decks", value = uiState.deckCount)
                        OverviewRow(title = "Tags", value = uiState.tagCount)
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
                            text = "Today",
                            style = MaterialTheme.typography.titleMedium
                        )
                        OverviewRow(
                            title = "Due",
                            value = uiState.dueCount,
                            valueTag = workspaceOverviewTodayDueCountTag
                        )
                        OverviewRow(
                            title = "New",
                            value = uiState.newCount,
                            valueTag = workspaceOverviewTodayNewCountTag
                        )
                        OverviewRow(
                            title = "Reviewed",
                            value = uiState.reviewedCount,
                            valueTag = workspaceOverviewTodayReviewedCountTag
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
                            text = "Permanently delete this workspace and all cards, decks, reviews, and sync history inside it.",
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
                                    "Loading..."
                                } else {
                                    "Delete workspace"
                                }
                            )
                        }
                        if (uiState.isLinked.not()) {
                            Text(
                                text = "Workspace delete is available only for linked cloud workspaces.",
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
                    Text("Continue")
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissDeletePreviewAlert) {
                    Text("Cancel")
                }
            },
            title = {
                Text(
                    text = "Delete this workspace?",
                    modifier = Modifier.testTag(tag = workspaceOverviewDeletePreviewDialogTag)
                )
            },
            text = {
                Text(
                    if (uiState.deletePreview.isLastAccessibleWorkspace) {
                        "This permanently deletes ${uiState.deletePreview.activeCardCount} active cards. A new empty Personal workspace will be created immediately after deletion."
                    } else {
                        "This permanently deletes ${uiState.deletePreview.activeCardCount} active cards from this workspace."
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
                    Text(if (uiState.isDeletingWorkspace) "Deleting..." else "Delete workspace")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissDeleteConfirmation,
                    enabled = uiState.isDeletingWorkspace.not()
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text(
                    text = "Delete workspace",
                    modifier = Modifier.testTag(tag = workspaceOverviewDeleteConfirmationDialogTag)
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Warning! This action is permanent. Type the phrase below exactly to continue.",
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
                    Text(
                        text = uiState.deletePreview.confirmationText,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.testTag(tag = workspaceOverviewDeleteConfirmationPhraseTag)
                    )
                    OutlinedTextField(
                        value = uiState.deleteConfirmationText,
                        onValueChange = onDeleteConfirmationTextChange,
                        label = {
                            Text("Confirmation text")
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
