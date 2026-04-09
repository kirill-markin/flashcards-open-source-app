package com.flashcardsopensourceapp.feature.cards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.EffortLevel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardEditorRoute(
    uiState: CardEditorUiState,
    onOpenFrontTextEditor: () -> Unit,
    onOpenBackTextEditor: () -> Unit,
    onOpenTagsEditor: () -> Unit,
    onEditWithAi: (() -> Unit)?,
    onRemoveTag: (String) -> Unit,
    onEffortLevelChange: (EffortLevel) -> Unit,
    onSave: () -> Unit,
    onDelete: (() -> Unit)?,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(uiState.title)
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
                bottom = innerPadding.calculateBottomPadding() + 32.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Front text stays the review prompt. Back text stays the answer. Both can be long-form and are edited on dedicated Android surfaces.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(16.dp)
                    )
                }
            }

            if (uiState.errorMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.errorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }

            if (onEditWithAi != null) {
                item {
                    OutlinedButton(
                        onClick = onEditWithAi,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Edit with AI")
                    }
                }
            }

            item {
                Text(
                    text = "Text",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            item {
                NavigationSummaryCard(
                    modifier = Modifier.testTag(cardEditorFrontSummaryCardTag),
                    title = "Front",
                    summary = formatCardTextPreview(text = uiState.frontText),
                    supportingText = "Question or prompt shown first during review",
                    icon = {
                        Icon(
                            imageVector = Icons.Outlined.Description,
                            contentDescription = null
                        )
                    },
                    onClick = onOpenFrontTextEditor
                )
            }

            if (uiState.frontTextErrorMessage.isNotEmpty()) {
                item {
                    Text(
                        text = uiState.frontTextErrorMessage,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(start = 16.dp)
                    )
                }
            }

            item {
                NavigationSummaryCard(
                    modifier = Modifier.testTag(cardEditorBackSummaryCardTag),
                    title = "Back",
                    summary = formatCardTextPreview(text = uiState.backText),
                    supportingText = "Answer shown after revealing the card",
                    icon = {
                        Icon(
                            imageVector = Icons.Outlined.Description,
                            contentDescription = null
                        )
                    },
                    onClick = onOpenBackTextEditor
                )
            }

            if (uiState.backTextErrorMessage.isNotEmpty()) {
                item {
                    Text(
                        text = uiState.backTextErrorMessage,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(start = 16.dp)
                    )
                }
            }

            item {
                Text(
                    text = "Metadata",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            item {
                NavigationSummaryCard(
                    modifier = Modifier,
                    title = "Tags",
                    summary = formatTagSelectionSummary(tags = uiState.selectedTags),
                    supportingText = if (uiState.availableTagSuggestions.isEmpty()) {
                        "No workspace tags yet. You can still add custom tags."
                    } else {
                        "${uiState.availableTagSuggestions.size} workspace tags available"
                    },
                    icon = {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.Label,
                            contentDescription = null
                        )
                    },
                    onClick = onOpenTagsEditor
                )
            }

            if (uiState.tagsErrorMessage.isNotEmpty()) {
                item {
                    Text(
                        text = uiState.tagsErrorMessage,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(start = 16.dp)
                    )
                }
            }

            if (uiState.selectedTags.isNotEmpty()) {
                item {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        uiState.selectedTags.forEach { tag ->
                            InputChip(
                                selected = true,
                                onClick = {
                                    onRemoveTag(tag)
                                },
                                label = {
                                    Text(tag)
                                },
                                trailingIcon = {
                                    Icon(
                                        imageVector = Icons.Outlined.Close,
                                        contentDescription = null
                                    )
                                }
                            )
                        }
                    }
                }
            }

            item {
                Text(
                    text = "Effort level",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            item {
                SingleChoiceSegmentedButtonRow(
                    modifier = Modifier.fillMaxWidth()
                ) {
                    val options = EffortLevel.entries
                    options.forEachIndexed { index, option ->
                        SegmentedButton(
                            selected = uiState.effortLevel == option,
                            onClick = {
                                onEffortLevelChange(option)
                            },
                            shape = SegmentedButtonDefaults.itemShape(
                                index = index,
                                count = options.size
                            )
                        ) {
                            Text(formatEffortLevelTitle(effortLevel = option))
                        }
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
                        Text("Delete card")
                    }
                }
            }
        }
    }
}
