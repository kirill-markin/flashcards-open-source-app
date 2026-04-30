package com.flashcardsopensourceapp.feature.settings.deck

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckEditorRoute(
    uiState: DeckEditorUiState,
    onNameChange: (String) -> Unit,
    onToggleEffortLevel: (EffortLevel) -> Unit,
    onToggleTag: (String) -> Unit,
    onSave: () -> Unit,
    onDelete: (() -> Unit)?,
    onBack: () -> Unit
) {
    val strings = createSettingsStringResolver(context = LocalContext.current)
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(uiState.title)
                }
            )
        }
    ) { innerPadding ->
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
                OutlinedTextField(
                    value = uiState.name,
                    onValueChange = onNameChange,
                    label = {
                        Text(stringResource(R.string.settings_deck_editor_name_label))
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Text(
                    text = stringResource(R.string.settings_deck_editor_effort_title),
                    style = MaterialTheme.typography.titleSmall
                )
            }

            item {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    EffortLevel.entries.forEach { effortLevel ->
                        FilterChip(
                            selected = uiState.selectedEffortLevels.contains(effortLevel),
                            onClick = {
                                onToggleEffortLevel(effortLevel)
                            },
                            label = {
                                Text(
                                    when (effortLevel) {
                                        EffortLevel.FAST -> stringResource(R.string.settings_effort_fast)
                                        EffortLevel.MEDIUM -> stringResource(R.string.settings_effort_medium)
                                        EffortLevel.LONG -> stringResource(R.string.settings_effort_long)
                                    }
                                )
                            }
                        )
                    }
                }
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
                                    effortLevels = uiState.selectedEffortLevels,
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
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_deck_editor_cancel_button))
                    }
                    Button(
                        onClick = onSave,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(R.string.settings_save))
                    }
                }
            }

            if (onDelete != null) {
                item {
                    HorizontalDivider()
                }

                item {
                    OutlinedButton(
                        onClick = onDelete,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text(stringResource(R.string.settings_deck_editor_delete_button))
                    }
                }
            }
        }
    }
}
