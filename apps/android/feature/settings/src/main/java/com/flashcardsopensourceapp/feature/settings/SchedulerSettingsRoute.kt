package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@Composable
fun SchedulerSettingsRoute(
    uiState: SchedulerSettingsUiState,
    onDesiredRetentionChange: (String) -> Unit,
    onLearningStepsChange: (String) -> Unit,
    onRelearningStepsChange: (String) -> Unit,
    onMaximumIntervalDaysChange: (String) -> Unit,
    onEnableFuzzChange: (Boolean) -> Unit,
    onRequestSave: () -> Unit,
    onDismissSaveConfirmation: () -> Unit,
    onConfirmSave: () -> Unit,
    onResetToDefaults: () -> Unit,
    onBack: () -> Unit
) {
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_scheduler_title),
        onBack = onBack,
        isBackEnabled = true
    ) { innerPadding ->
        LazyColumn(
            contentPadding = settingsScreenContentPadding(innerPadding = innerPadding),
            verticalArrangement = Arrangement.spacedBy(settingsScreenCardSpacing),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    androidx.compose.foundation.layout.Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.settings_scheduler_algorithm_title),
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(text = uiState.algorithm)
                        Text(
                            text = stringResource(R.string.settings_scheduler_updated_at, uiState.updatedAtLabel),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
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
                OutlinedTextField(
                    value = uiState.desiredRetentionText,
                    onValueChange = onDesiredRetentionChange,
                    label = {
                        Text(stringResource(R.string.settings_scheduler_desired_retention_label))
                    },
                    supportingText = {
                        Text(stringResource(R.string.settings_scheduler_desired_retention_supporting))
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(schedulerDesiredRetentionFieldTag)
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.learningStepsText,
                    onValueChange = onLearningStepsChange,
                    label = {
                        Text(stringResource(R.string.settings_scheduler_learning_steps_label))
                    },
                    supportingText = {
                        Text(stringResource(R.string.settings_scheduler_learning_steps_supporting))
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(schedulerLearningStepsFieldTag)
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.relearningStepsText,
                    onValueChange = onRelearningStepsChange,
                    label = {
                        Text(stringResource(R.string.settings_scheduler_relearning_steps_label))
                    },
                    supportingText = {
                        Text(stringResource(R.string.settings_scheduler_relearning_steps_supporting))
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(schedulerRelearningStepsFieldTag)
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.maximumIntervalDaysText,
                    onValueChange = onMaximumIntervalDaysChange,
                    label = {
                        Text(stringResource(R.string.settings_scheduler_max_interval_label))
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(schedulerMaximumIntervalFieldTag)
                )
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(stringResource(R.string.settings_scheduler_enable_fuzz_title))
                        },
                        supportingContent = {
                            Text(stringResource(R.string.settings_scheduler_enable_fuzz_body))
                        },
                        trailingContent = {
                            Switch(
                                checked = uiState.enableFuzz,
                                onCheckedChange = onEnableFuzzChange
                            )
                        }
                    )
                }
            }

            item {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = onResetToDefaults,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_reset))
                    }
                    Button(
                        onClick = onRequestSave,
                        modifier = Modifier
                            .weight(1f)
                            .testTag(schedulerSaveButtonTag)
                    ) {
                        Text(stringResource(R.string.settings_save))
                    }
                }
            }
        }
    }

    if (uiState.showSaveConfirmation) {
        AlertDialog(
            onDismissRequest = onDismissSaveConfirmation,
            confirmButton = {
                TextButton(
                    onClick = onConfirmSave,
                    modifier = Modifier.testTag(schedulerApplyButtonTag)
                ) {
                    Text(stringResource(R.string.settings_apply))
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissSaveConfirmation) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
            title = {
                Text(stringResource(R.string.settings_scheduler_apply_dialog_title))
            },
            text = {
                Text(stringResource(R.string.settings_scheduler_apply_dialog_body))
            }
        )
    }
}
