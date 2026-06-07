package com.flashcardsopensourceapp.feature.settings.workspace.reset

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.settingsScreenCardSpacing
import com.flashcardsopensourceapp.feature.settings.settingsScreenContentPadding
import com.flashcardsopensourceapp.feature.settings.workspace.settings.WorkspaceSettingsUiState
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressConfirmationButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressConfirmationDialogTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressConfirmationFieldTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressConfirmationPhraseTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressDialogErrorTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressErrorTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressLoadingTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressPreviewBodyTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressPreviewButtonTag
import com.flashcardsopensourceapp.feature.settings.workspace.settings.workspaceSettingsResetProgressPreviewDialogTag
import com.flashcardsopensourceapp.feature.settings.workspaceResetProgressConfirmationText

@Composable
fun ResetStudyProgressRoute(
    uiState: WorkspaceSettingsUiState,
    onOpenResetConfirmation: () -> Unit,
    onDismissResetConfirmation: () -> Unit,
    onResetConfirmationTextChange: (String) -> Unit,
    onRequestResetProgress: () -> Unit,
    onDismissResetPreviewAlert: () -> Unit,
    onResetProgress: () -> Unit,
    onBack: () -> Unit
) {
    val confirmationPhrase = workspaceResetProgressConfirmationText(
        strings = createSettingsStringResolver(context = LocalContext.current)
    )
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_reset_study_progress_title),
        onBack = onBack,
        isBackEnabled = uiState.resetState != DestructiveActionState.IN_PROGRESS
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
                                .testTag(tag = workspaceSettingsResetProgressErrorTag)
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
                            text = stringResource(R.string.settings_reset_study_progress_title),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                        Text(
                            text = stringResource(R.string.settings_workspace_reset_body),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (uiState.isResetPreviewLoading) {
                            CircularProgressIndicator(
                                modifier = Modifier.testTag(tag = workspaceSettingsResetProgressLoadingTag)
                            )
                        }
                        OutlinedButton(
                            onClick = onOpenResetConfirmation,
                            enabled = uiState.isLinked &&
                                uiState.isResetPreviewLoading.not() &&
                                uiState.resetState != DestructiveActionState.IN_PROGRESS,
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = MaterialTheme.colorScheme.error
                            ),
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag(tag = workspaceSettingsResetProgressButtonTag)
                        ) {
                            Text(
                                if (uiState.isResetPreviewLoading) {
                                    stringResource(R.string.settings_loading)
                                } else {
                                    stringResource(R.string.settings_workspace_reset_button)
                                }
                            )
                        }
                        if (uiState.isLinked.not()) {
                            Text(
                                text = stringResource(R.string.settings_workspace_reset_sign_in_guidance),
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                    }
                }
            }
        }
    }

    if (uiState.showResetConfirmation) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.resetState != DestructiveActionState.IN_PROGRESS) {
                    onDismissResetConfirmation()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onRequestResetProgress,
                    enabled = uiState.resetConfirmationText == confirmationPhrase &&
                        uiState.isResetPreviewLoading.not() &&
                        uiState.resetState != DestructiveActionState.IN_PROGRESS,
                    modifier = Modifier.testTag(tag = workspaceSettingsResetProgressConfirmationButtonTag)
                ) {
                    Text(stringResource(R.string.settings_ok))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissResetConfirmation,
                    enabled = uiState.isResetPreviewLoading.not() &&
                        uiState.resetState != DestructiveActionState.IN_PROGRESS
                ) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
            title = {
                Text(
                    text = stringResource(R.string.settings_workspace_reset_dialog_title),
                    modifier = Modifier.testTag(tag = workspaceSettingsResetProgressConfirmationDialogTag)
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = stringResource(R.string.settings_workspace_reset_dialog_body),
                        color = MaterialTheme.colorScheme.error
                    )
                    if (uiState.errorMessage.isNotEmpty()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag(tag = workspaceSettingsResetProgressDialogErrorTag)
                        )
                    }
                    Text(
                        text = confirmationPhrase,
                        modifier = Modifier.testTag(tag = workspaceSettingsResetProgressConfirmationPhraseTag)
                    )
                    OutlinedTextField(
                        value = uiState.resetConfirmationText,
                        onValueChange = onResetConfirmationTextChange,
                        label = {
                            Text(stringResource(R.string.settings_workspace_confirmation_label))
                        },
                        enabled = uiState.isResetPreviewLoading.not() &&
                            uiState.resetState != DestructiveActionState.IN_PROGRESS,
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag(tag = workspaceSettingsResetProgressConfirmationFieldTag)
                    )
                }
            }
        )
    }

    if (uiState.showResetPreviewAlert && uiState.resetProgressPreview != null) {
        AlertDialog(
            onDismissRequest = {
                if (uiState.resetState != DestructiveActionState.IN_PROGRESS) {
                    onDismissResetPreviewAlert()
                }
            },
            confirmButton = {
                TextButton(
                    onClick = onResetProgress,
                    enabled = uiState.resetState != DestructiveActionState.IN_PROGRESS,
                    modifier = Modifier.testTag(tag = workspaceSettingsResetProgressPreviewButtonTag)
                ) {
                    Text(
                        if (uiState.resetState == DestructiveActionState.IN_PROGRESS) {
                            stringResource(R.string.settings_workspace_resetting)
                        } else {
                            stringResource(R.string.settings_workspace_reset_confirm_button)
                        }
                    )
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissResetPreviewAlert,
                    enabled = uiState.resetState != DestructiveActionState.IN_PROGRESS
                ) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
            title = {
                Text(
                    text = stringResource(R.string.settings_workspace_reset_preview_title),
                    modifier = Modifier.testTag(tag = workspaceSettingsResetProgressPreviewDialogTag)
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = if (uiState.resetProgressPreview.cardsToResetCount == 0) {
                            stringResource(R.string.settings_workspace_reset_preview_empty)
                        } else {
                            stringResource(
                                R.string.settings_workspace_reset_preview_body,
                                uiState.resetProgressPreview.cardsToResetCount
                            )
                        },
                        modifier = Modifier.testTag(tag = workspaceSettingsResetProgressPreviewBodyTag)
                    )
                    if (uiState.resetState == DestructiveActionState.IN_PROGRESS) {
                        CircularProgressIndicator()
                    }
                    if (uiState.errorMessage.isNotEmpty()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag(tag = workspaceSettingsResetProgressDialogErrorTag)
                        )
                    }
                }
            }
        )
    }
}
