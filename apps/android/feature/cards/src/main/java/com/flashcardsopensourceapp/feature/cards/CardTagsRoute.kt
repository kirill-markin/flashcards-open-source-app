package com.flashcardsopensourceapp.feature.cards

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.normalizeTagKey

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardTagsRoute(
    uiState: CardEditorUiState,
    onToggleSuggestedTag: (String) -> Unit,
    onAddTag: (String) -> Unit,
    onRemoveTag: (String) -> Unit,
    onBack: () -> Unit
) {
    var draftTagValue by rememberSaveable { mutableStateOf(value = "") }
    val normalizedDraftKey = normalizeTagKey(tag = draftTagValue)
    val filteredSuggestions = remember(uiState.availableTagSuggestions, draftTagValue) {
        uiState.availableTagSuggestions.filter { tagSummary ->
            normalizedDraftKey.isEmpty() || normalizeTagKey(tag = tagSummary.tag).contains(other = normalizedDraftKey)
        }
    }
    val selectedTagKeys = remember(uiState.selectedTags) {
        uiState.selectedTags.map(::normalizeTagKey).toSet()
    }
    val canAddCustomTag = draftTagValue.trim().isNotEmpty() && selectedTagKeys.contains(normalizedDraftKey).not()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(stringResource(id = R.string.cards_tags_title))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(id = R.string.cards_editor_back_content_description)
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
            if (uiState.tagsErrorMessage.isNotEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = uiState.tagsErrorMessage,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            }

            item {
                OutlinedTextField(
                    value = draftTagValue,
                    onValueChange = { nextValue ->
                        draftTagValue = nextValue
                    },
                    label = {
                        Text(stringResource(id = R.string.cards_add_tag_label))
                    },
                    supportingText = {
                        Text(stringResource(id = R.string.cards_add_tag_supporting_text))
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    OutlinedButton(
                        onClick = {
                            draftTagValue = ""
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(id = R.string.cards_clear))
                    }
                    Button(
                        onClick = {
                            if (draftTagValue.trim().isEmpty()) {
                                onAddTag(draftTagValue)
                                return@Button
                            }

                            onAddTag(draftTagValue)
                            draftTagValue = ""
                        },
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(stringResource(id = R.string.cards_add_tag))
                    }
                }
            }

            item {
                Text(
                    text = stringResource(id = R.string.cards_selected_tags),
                    style = MaterialTheme.typography.titleSmall
                )
            }

            if (uiState.selectedTags.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(id = R.string.cards_no_selected_tags_yet),
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            } else {
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
                    text = stringResource(id = R.string.cards_workspace_suggestions),
                    style = MaterialTheme.typography.titleSmall
                )
            }

            if (canAddCustomTag && filteredSuggestions.none { tagSummary ->
                    normalizeTagKey(tag = tagSummary.tag) == normalizedDraftKey
                }) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        ListItem(
                            headlineContent = {
                                Text(stringResource(id = R.string.cards_add_custom_tag))
                            },
                            supportingContent = {
                                Text(draftTagValue.trim())
                            },
                            leadingContent = {
                                Icon(
                                    imageVector = Icons.Outlined.Add,
                                    contentDescription = null
                                )
                            },
                            modifier = Modifier.clickable {
                                onAddTag(draftTagValue)
                                draftTagValue = ""
                            }
                        )
                    }
                }
            }

            if (filteredSuggestions.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(id = R.string.cards_no_workspace_tags_match_search),
                            modifier = Modifier.padding(16.dp)
                        )
                    }
                }
            } else {
                item {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        filteredSuggestions.forEach { tagSummary ->
                            FilterChip(
                                selected = uiState.selectedTags.any { tag ->
                                    normalizeTagKey(tag = tag) == normalizeTagKey(tag = tagSummary.tag)
                                },
                                onClick = {
                                    onToggleSuggestedTag(tagSummary.tag)
                                },
                                label = {
                                    Text("${tagSummary.tag} (${tagSummary.cardsCount})")
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}
