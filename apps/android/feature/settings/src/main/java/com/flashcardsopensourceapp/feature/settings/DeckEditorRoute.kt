package com.flashcardsopensourceapp.feature.settings

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
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.formatDeckFilterDefinition

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
                        Text("Deck name")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Text(
                    text = "Effort",
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
                                Text(effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() })
                            }
                        )
                    }
                }
            }

            item {
                Text(
                    text = "Tags",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            if (uiState.availableTags.isEmpty()) {
                item {
                    Text(
                        text = "No tags available yet. Create cards first, then use their tags in a deck rule.",
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
                                    Text("${tagSummary.tag} (${tagSummary.cardsCount})")
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
                            text = "Rule summary",
                            style = MaterialTheme.typography.titleSmall
                        )
                        Text(
                            text = formatDeckFilterDefinition(
                                filterDefinition = DeckFilterDefinition(
                                    version = 2,
                                    effortLevels = uiState.selectedEffortLevels,
                                    tags = uiState.selectedTags
                                )
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
                        Text("Cancel")
                    }
                    Button(
                        onClick = onSave,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Save")
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
                        Text("Delete deck")
                    }
                }
            }
        }
    }
}
