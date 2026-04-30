package com.flashcardsopensourceapp.feature.settings.workspace

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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.OverviewRow
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding

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
        title = stringResource(R.string.settings_workspace_overview_screen_title),
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
                        Text(
                            text = stringResource(R.string.settings_workspace_name_section_title),
                            style = MaterialTheme.typography.titleMedium
                        )
                        if (uiState.isLinked) {
                            OutlinedTextField(
                                value = uiState.workspaceNameDraft,
                                onValueChange = onWorkspaceNameChange,
                                label = {
                                    Text(stringResource(R.string.settings_workspace_name_label))
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
                                Text(
                                    if (uiState.isSavingName) {
                                        stringResource(R.string.settings_saving)
                                    } else {
                                        stringResource(R.string.settings_workspace_save_name_button)
                                    }
                                )
                            }
                        } else {
                            Text(
                                text = uiState.workspaceName,
                                style = MaterialTheme.typography.headlineSmall
                            )
                            Text(
                                text = stringResource(R.string.settings_workspace_rename_guidance),
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }

                        HorizontalDivider()
                        OverviewRow(title = stringResource(R.string.settings_cards_title), value = uiState.totalCards)
                        OverviewRow(title = stringResource(R.string.settings_workspace_decks_title), value = uiState.deckCount)
                        OverviewRow(title = stringResource(R.string.settings_workspace_tags_title), value = uiState.tagCount)
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
                            text = stringResource(R.string.settings_workspace_today_title),
                            style = MaterialTheme.typography.titleMedium
                        )
                        OverviewRow(
                            title = stringResource(R.string.settings_workspace_due_title),
                            value = uiState.dueCount,
                            valueTag = workspaceOverviewTodayDueCountTag
                        )
                        OverviewRow(
                            title = stringResource(R.string.settings_workspace_new_title),
                            value = uiState.newCount,
                            valueTag = workspaceOverviewTodayNewCountTag
                        )
                        OverviewRow(
                            title = stringResource(R.string.settings_workspace_reviewed_title),
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
                            text = stringResource(R.string.settings_account_danger_zone_card_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.error
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
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
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
