package com.flashcardsopensourceapp.feature.settings.deck

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.cards.DeckFilterDefinition
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver

const val deckEditorDeleteButtonTag: String = "deck_editor_delete_button"
const val deckEditorConfirmDeleteButtonTag: String = "deck_editor_confirm_delete_button"
const val deckEditorCancelDeleteButtonTag: String = "deck_editor_cancel_delete_button"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckEditorRoute(
    uiState: DeckEditorUiState,
    onNameChange: (String) -> Unit,
    onToggleTag: (String) -> Unit,
    onSave: () -> Unit,
    onDelete: ((String) -> Unit)?,
    onBack: () -> Unit
) {
    val strings = createSettingsStringResolver(context = LocalContext.current)
    val isEditorEnabled: Boolean = !uiState.isLoading && !uiState.isDeckMissing && !uiState.isSubmitting
    var deleteTarget by remember(uiState.deleteTarget?.deckId) {
        mutableStateOf<DeckEditorDeleteTarget?>(null)
    }
    BackHandler(enabled = uiState.isSubmitting) {}
    val confirmationTarget = deleteTarget
    if (confirmationTarget != null && onDelete != null) {
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = {
                Text(stringResource(R.string.settings_deck_editor_delete_confirmation_title, confirmationTarget.name))
            },
            text = {
                Text(stringResource(R.string.settings_deck_editor_delete_confirmation_body))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        deleteTarget = null
                        onDelete(confirmationTarget.deckId)
                    },
                    enabled = isEditorEnabled,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.testTag(deckEditorConfirmDeleteButtonTag)
                ) {
                    Text(stringResource(R.string.settings_deck_editor_delete_button))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { deleteTarget = null },
                    modifier = Modifier.testTag(deckEditorCancelDeleteButtonTag)
                ) {
                    Text(stringResource(R.string.settings_deck_editor_cancel_button))
                }
            }
        )
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(uiState.title)
                },
                actions = {
                    if (uiState.isSubmitting) {
                        CircularProgressIndicator(modifier = Modifier.padding(12.dp).size(24.dp))
                    }
                    if (onDelete != null && uiState.deleteTarget != null) {
                        IconButton(
                            onClick = { deleteTarget = uiState.deleteTarget },
                            enabled = isEditorEnabled,
                            modifier = Modifier.testTag(deckEditorDeleteButtonTag)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Delete,
                                contentDescription = stringResource(R.string.settings_deck_editor_delete_button),
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
            )
        }
    ) { innerPadding ->
        if (uiState.isDeckMissing) {
            LazyColumn(
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 32.dp
                ),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(R.string.settings_deck_not_found),
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
                item {
                    OutlinedButton(
                        onClick = onBack,
                        enabled = !uiState.isSubmitting,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_deck_editor_cancel_button))
                    }
                }
            }
            return@Scaffold
        }

        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 32.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                if (uiState.errorMessage.isNotEmpty()) {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(16.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.settings_deck_editor_explainer_title),
                            style = MaterialTheme.typography.titleSmall
                        )
                        Text(
                            text = stringResource(R.string.settings_deck_editor_explainer_body),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = uiState.name,
                    onValueChange = onNameChange,
                    enabled = isEditorEnabled,
                    label = {
                        Text(stringResource(R.string.settings_deck_editor_name_label))
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Text(
                    text = stringResource(R.string.settings_deck_editor_tags_title),
                    style = MaterialTheme.typography.titleSmall
                )
            }

            if (uiState.availableTags.isEmpty()) {
                item {
                    Text(
                        text = stringResource(R.string.settings_deck_editor_no_tags),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                item {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        uiState.availableTags.forEach { tagSummary ->
                            FilterChip(
                                selected = uiState.selectedTags.contains(tagSummary.tag),
                                enabled = isEditorEnabled,
                                onClick = {
                                    onToggleTag(tagSummary.tag)
                                },
                                label = {
                                    Text(
                                        text = stringResource(
                                            id = R.string.settings_workspace_tag_with_count,
                                            tagSummary.tag,
                                            tagSummary.cardsCount
                                        )
                                    )
                                }
                            )
                        }
                    }
                }
            }

            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(16.dp)
                    ) {
                        Text(
                            text = stringResource(R.string.settings_deck_editor_rule_summary_title),
                            style = MaterialTheme.typography.titleSmall
                        )
                        Text(
                            text = formatDeckFilter(
                                filterDefinition = DeckFilterDefinition(
                                    version = 2,
                                    tags = uiState.selectedTags
                                ),
                                strings = strings
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            item {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = onBack,
                        enabled = !uiState.isSubmitting,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_deck_editor_cancel_button))
                    }
                    Button(
                        onClick = onSave,
                        enabled = isEditorEnabled,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_save))
                    }
                }
            }

        }
    }
}
