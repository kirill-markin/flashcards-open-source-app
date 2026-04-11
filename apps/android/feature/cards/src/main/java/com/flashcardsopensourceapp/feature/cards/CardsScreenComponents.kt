package com.flashcardsopensourceapp.feature.cards

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.buildCardFilter

const val cardsCardRowTag: String = "cards_card_row"
const val cardsCardFrontTextTag: String = "cards_card_front_text"
const val cardsSearchFieldTag: String = "cards_search_field"
const val cardsEmptyStateTag: String = "cards_empty_state"
const val cardsAddCardButtonTag: String = "cards_add_card_button"
const val cardEditorFrontSummaryCardTag: String = "card_editor_front_summary_card"
const val cardEditorBackSummaryCardTag: String = "card_editor_back_summary_card"
const val cardEditorTagsSummaryCardTag: String = "card_editor_tags_summary_card"
const val cardEditorSaveButtonTag: String = "card_editor_save_button"
const val cardEditorFrontTextFieldTag: String = "card_editor_front_text_field"
const val cardEditorBackTextFieldTag: String = "card_editor_back_text_field"
const val cardTagsInputFieldTag: String = "card_tags_input_field"
const val cardTagsAddButtonTag: String = "card_tags_add_button"

fun cardEditorEffortLevelTag(effortLevel: EffortLevel): String {
    return "card_editor_effort_${effortLevel.name.lowercase()}"
}

@Composable
internal fun CardRow(
    card: CardSummary,
    onOpenCard: (String) -> Unit,
    onDeleteCard: (String) -> Unit
) {
    val resources = LocalContext.current.resources
    var isDeleteDialogVisible by remember { mutableStateOf(value = false) }
    var isActionsMenuVisible by remember { mutableStateOf(value = false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(cardsCardRowTag)
            .clickable {
                onOpenCard(card.cardId)
            }
    ) {
        ListItem(
            headlineContent = {
                Text(
                    text = card.frontText,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.testTag(cardsCardFrontTextTag)
                )
            },
            supportingContent = {
                Text(
                    text = formatCardsMetadataSummary(resources = resources, card = card),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            },
            trailingContent = {
                Box {
                    IconButton(
                        onClick = {
                            isActionsMenuVisible = true
                        }
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.MoreVert,
                            contentDescription = stringResource(id = R.string.cards_card_actions_content_description)
                        )
                    }

                    DropdownMenu(
                        expanded = isActionsMenuVisible,
                        onDismissRequest = {
                            isActionsMenuVisible = false
                        }
                    ) {
                        DropdownMenuItem(
                            text = {
                                Text(stringResource(id = R.string.cards_edit))
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Outlined.Edit,
                                    contentDescription = null
                                )
                            },
                            onClick = {
                                isActionsMenuVisible = false
                                onOpenCard(card.cardId)
                            }
                        )
                        DropdownMenuItem(
                            text = {
                                Text(stringResource(id = R.string.cards_delete))
                            },
                            leadingIcon = {
                                Icon(
                                    imageVector = Icons.Outlined.Close,
                                    contentDescription = null
                                )
                            },
                            onClick = {
                                isActionsMenuVisible = false
                                isDeleteDialogVisible = true
                            }
                        )
                    }
                }
            }
        )
    }

    if (isDeleteDialogVisible) {
        AlertDialog(
            onDismissRequest = {
                isDeleteDialogVisible = false
            },
            title = {
                Text(stringResource(id = R.string.cards_delete_dialog_title))
            },
            text = {
                Text(stringResource(id = R.string.cards_delete_dialog_message))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        isDeleteDialogVisible = false
                        onDeleteCard(card.cardId)
                    }
                ) {
                    Text(stringResource(id = R.string.cards_delete))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        isDeleteDialogVisible = false
                    }
                ) {
                    Text(stringResource(id = R.string.cards_cancel))
                }
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CardsFilterSheet(
    draftFilter: CardFilter,
    availableTags: List<WorkspaceTagSummary>,
    onDismiss: () -> Unit,
    onApply: (CardFilter) -> Unit,
    onClear: () -> Unit,
    onDraftFilterChange: (CardFilter) -> Unit
) {
    val resources = LocalContext.current.resources
    ModalBottomSheet(
        onDismissRequest = onDismiss
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, bottom = 32.dp)
        ) {
            Text(
                text = stringResource(id = R.string.cards_filters_title),
                style = MaterialTheme.typography.headlineSmall
            )

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = stringResource(id = R.string.cards_effort_title),
                    style = MaterialTheme.typography.titleSmall
                )
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    EffortLevel.entries.forEach { effortLevel ->
                        FilterChip(
                            selected = draftFilter.effort.contains(effortLevel),
                            onClick = {
                                onDraftFilterChange(
                                    draftFilter.copy(
                                        effort = toggleEffortSelection(
                                            selectedEffort = draftFilter.effort,
                                            effortLevel = effortLevel
                                        )
                                    )
                                )
                            },
                            label = {
                                Text(formatCardsEffortLevelTitle(resources = resources, effortLevel = effortLevel))
                            }
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = stringResource(id = R.string.cards_tags_title),
                    style = MaterialTheme.typography.titleSmall
                )
                if (availableTags.isEmpty()) {
                    Text(
                        text = stringResource(id = R.string.cards_no_tags_used_yet),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        availableTags.forEach { tagSummary ->
                            FilterChip(
                                selected = draftFilter.tags.contains(tagSummary.tag),
                                onClick = {
                                    onDraftFilterChange(
                                        buildCardFilter(
                                            tags = toggleTagSelection(
                                                selectedTags = draftFilter.tags,
                                                tag = tagSummary.tag
                                            ),
                                            effort = draftFilter.effort,
                                            referenceTags = availableTags.map { tag -> tag.tag }
                                        )
                                    )
                                },
                                label = {
                                    Text(
                                        text = stringResource(
                                            id = R.string.cards_tag_with_count,
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

            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                OutlinedButton(
                    onClick = onClear,
                    modifier = Modifier.weight(1f)
                ) {
                    Text(stringResource(id = R.string.cards_clear))
                }
                Button(
                    onClick = {
                        onApply(draftFilter)
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text(stringResource(id = R.string.cards_apply))
                }
            }
        }
    }
}

@Composable
internal fun NavigationSummaryCard(
    modifier: Modifier,
    title: String,
    summary: String,
    supportingText: String,
    icon: @Composable () -> Unit,
    onClick: () -> Unit
) {
    Card(
        modifier = modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        ListItem(
            headlineContent = {
                Text(title)
            },
            supportingContent = {
                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(summary)
                    Text(
                        text = supportingText,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            },
            leadingContent = icon
        )
    }
}

private fun toggleEffortSelection(selectedEffort: List<EffortLevel>, effortLevel: EffortLevel): List<EffortLevel> {
    if (selectedEffort.contains(effortLevel)) {
        return selectedEffort.filter { value ->
            value != effortLevel
        }
    }

    return selectedEffort + effortLevel
}

private fun toggleTagSelection(selectedTags: List<String>, tag: String): List<String> {
    if (selectedTags.contains(tag)) {
        return selectedTags.filter { value ->
            value != tag
        }
    }

    return selectedTags + tag
}
