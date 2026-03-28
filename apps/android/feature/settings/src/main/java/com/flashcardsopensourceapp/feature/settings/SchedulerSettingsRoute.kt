package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
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
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Scheduler")
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Back"
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 24.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    androidx.compose.foundation.layout.Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = "Algorithm",
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(text = uiState.algorithm)
                        Text(
                            text = "Updated: ${uiState.updatedAtLabel}",
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
                        Text("Desired retention")
                    },
                    supportingText = {
                        Text("Higher values bring cards back sooner.")
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
                        Text("Learning steps (minutes)")
                    },
                    supportingText = {
                        Text("Comma-separated step list, for example 1, 10")
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
                        Text("Relearning steps (minutes)")
                    },
                    supportingText = {
                        Text("Comma-separated step list after Again in review.")
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
                        Text("Maximum interval (days)")
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
                            Text("Enable fuzz")
                        },
                        supportingContent = {
                            Text("Spread long-term review intervals a bit to avoid clustering.")
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
                        Text("Reset")
                    }
                    Button(
                        onClick = onRequestSave,
                        modifier = Modifier
                            .weight(1f)
                            .testTag(schedulerSaveButtonTag)
                    ) {
                        Text("Save")
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
                    Text("Apply")
                }
            },
            dismissButton = {
                TextButton(onClick = onDismissSaveConfirmation) {
                    Text("Cancel")
                }
            },
            title = {
                Text("Apply scheduler settings?")
            },
            text = {
                Text("This changes future review intervals only and keeps current card history intact.")
            }
        )
    }
}
