package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
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
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

const val workspaceSettingsResetProgressButtonTag: String = "workspace_settings_reset_progress_button"
const val workspaceSettingsResetProgressLoadingTag: String = "workspace_settings_reset_progress_loading"
const val workspaceSettingsResetProgressErrorTag: String = "workspace_settings_reset_progress_error"
const val workspaceSettingsResetProgressDialogErrorTag: String =
    "workspace_settings_reset_progress_dialog_error"
const val workspaceSettingsResetProgressConfirmationDialogTag: String =
    "workspace_settings_reset_progress_confirmation_dialog"
const val workspaceSettingsResetProgressConfirmationPhraseTag: String =
    "workspace_settings_reset_progress_confirmation_phrase"
const val workspaceSettingsResetProgressConfirmationFieldTag: String =
    "workspace_settings_reset_progress_confirmation_field"
const val workspaceSettingsResetProgressConfirmationButtonTag: String =
    "workspace_settings_reset_progress_confirmation_button"
const val workspaceSettingsResetProgressPreviewDialogTag: String =
    "workspace_settings_reset_progress_preview_dialog"
const val workspaceSettingsResetProgressPreviewBodyTag: String =
    "workspace_settings_reset_progress_preview_body"
const val workspaceSettingsResetProgressPreviewButtonTag: String =
    "workspace_settings_reset_progress_preview_button"

@Composable
fun WorkspaceSettingsRoute(
    uiState: WorkspaceSettingsUiState,
    onOpenOverview: () -> Unit,
    onOpenDecks: () -> Unit,
    onOpenTags: () -> Unit,
    onOpenNotifications: () -> Unit,
    onOpenScheduler: () -> Unit,
    onOpenExport: () -> Unit,
    onOpenResetConfirmation: () -> Unit,
    onDismissResetConfirmation: () -> Unit,
    onResetConfirmationTextChange: (String) -> Unit,
    onRequestResetProgress: () -> Unit,
    onDismissResetPreviewAlert: () -> Unit,
    onResetProgress: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = "Workspace Settings",
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
                    ListItem(
                        headlineContent = {
                            Text("Overview")
                        },
                        supportingContent = {
                            Text("${uiState.workspaceName} | ${uiState.totalCards} cards")
                        },
                        modifier = Modifier.clickable(onClick = onOpenOverview)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Decks")
                        },
                        supportingContent = {
                            Text("${uiState.deckCount} filtered decks")
                        },
                        modifier = Modifier.clickable(onClick = onOpenDecks)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Tags")
                        },
                        supportingContent = {
                            Text("${uiState.tagCount} tags")
                        },
                        modifier = Modifier.clickable(onClick = onOpenTags)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Notifications")
                        },
                        supportingContent = {
                            Text(uiState.notificationsSummary)
                        },
                        modifier = Modifier.clickable(onClick = onOpenNotifications)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Scheduler")
                        },
                        supportingContent = {
                            Text(
                                text = uiState.schedulerSummary,
                                modifier = Modifier.testTag(workspaceSchedulerSummaryTag)
                            )
                        },
                        modifier = Modifier.clickable(onClick = onOpenScheduler)
                    )
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text("Export")
                        },
                        supportingContent = {
                            Text(uiState.exportSummary)
                        },
                        modifier = Modifier.clickable(onClick = onOpenExport)
                    )
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
                            text = "Reset study progress for every card in this workspace. Card content stays intact.",
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
                                    "Loading..."
                                } else {
                                    "Reset all progress"
                                }
                            )
                        }
                        if (uiState.isLinked.not()) {
                            Text(
                                text = "Sign in to a linked cloud workspace before resetting progress.",
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
                    enabled = uiState.resetConfirmationText == workspaceSettingsResetProgressConfirmationText &&
                        uiState.isResetPreviewLoading.not() &&
                        uiState.resetState != DestructiveActionState.IN_PROGRESS,
                    modifier = Modifier.testTag(tag = workspaceSettingsResetProgressConfirmationButtonTag)
                ) {
                    Text("OK")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissResetConfirmation,
                    enabled = uiState.isResetPreviewLoading.not() &&
                        uiState.resetState != DestructiveActionState.IN_PROGRESS
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text(
                    text = "Reset progress",
                    modifier = Modifier.testTag(tag = workspaceSettingsResetProgressConfirmationDialogTag)
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "Warning! This action is permanent. Type the phrase below exactly to continue.",
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
                        text = workspaceSettingsResetProgressConfirmationText,
                        modifier = Modifier.testTag(tag = workspaceSettingsResetProgressConfirmationPhraseTag)
                    )
                    OutlinedTextField(
                        value = uiState.resetConfirmationText,
                        onValueChange = onResetConfirmationTextChange,
                        label = {
                            Text("Confirmation text")
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
                    Text(if (uiState.resetState == DestructiveActionState.IN_PROGRESS) "Resetting..." else "OK")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = onDismissResetPreviewAlert,
                    enabled = uiState.resetState != DestructiveActionState.IN_PROGRESS
                ) {
                    Text("Cancel")
                }
            },
            title = {
                Text(
                    text = "Reset ${uiState.resetProgressPreview.workspaceName}?",
                    modifier = Modifier.testTag(tag = workspaceSettingsResetProgressPreviewDialogTag)
                )
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = if (uiState.resetProgressPreview.cardsToResetCount == 0) {
                            "No cards in this workspace currently have progress to reset."
                        } else {
                            "This will reset progress for ${uiState.resetProgressPreview.cardsToResetCount} cards in this workspace."
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
