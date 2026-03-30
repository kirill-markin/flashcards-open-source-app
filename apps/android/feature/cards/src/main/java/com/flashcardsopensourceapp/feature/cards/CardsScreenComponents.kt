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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.buildCardFilter
import com.flashcardsopensourceapp.data.local.model.formatCardDueLabel
import com.flashcardsopensourceapp.data.local.model.formatCardEffortLabel
import com.flashcardsopensourceapp.data.local.model.formatCardTagsLabel

const val cardsCardRowTag: String = "cards_card_row"
const val cardsCardFrontTextTag: String = "cards_card_front_text"

@Composable
internal fun CardRow(
    card: CardSummary,
    onOpenCard: (String) -> Unit,
    onDeleteCard: (String) -> Unit
) {
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
                    text = buildCardMetadataSummary(card = card),
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
                            contentDescription = "Card actions"
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
                                Text("Edit")
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
                                Text("Delete")
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
                Text("Delete card?")
            },
            text = {
                Text("This removes the local card from the Android app.")
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        isDeleteDialogVisible = false
                        onDeleteCard(card.cardId)
                    }
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        isDeleteDialogVisible = false
                    }
                ) {
                    Text("Cancel")
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
                text = "Filters",
                style = MaterialTheme.typography.headlineSmall
            )

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "Effort",
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
                                Text(formatEffortLevelTitle(effortLevel = effortLevel))
                            }
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    text = "Tags",
                    style = MaterialTheme.typography.titleSmall
                )
                if (availableTags.isEmpty()) {
                    Text(
                        text = "No tags have been used yet.",
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
                                    Text("${tagSummary.tag} (${tagSummary.cardsCount})")
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
                    Text("Clear")
                }
                Button(
                    onClick = {
                        onApply(draftFilter)
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Apply")
                }
            }
        }
    }
}

@Composable
internal fun NavigationSummaryCard(
    title: String,
    summary: String,
    supportingText: String,
    icon: @Composable () -> Unit,
    onClick: () -> Unit
) {
    Card(
        modifier = Modifier
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

internal fun formatCardTextPreview(text: String): String {
    val trimmedText = text.trim()

    if (trimmedText.isEmpty()) {
        return "Tap to edit"
    }

    return trimmedText
        .split('\n')
        .joinToString(separator = " ")
}

internal fun formatTagSelectionSummary(tags: List<String>): String {
    if (tags.isEmpty()) {
        return "No tags selected"
    }

    return tags.joinToString(separator = ", ")
}

internal fun formatEffortLevelTitle(effortLevel: EffortLevel): String {
    return formatCardEffortLabel(effortLevel = effortLevel)
}

private fun buildCardMetadataSummary(card: CardSummary): String {
    return listOf(
        formatCardEffortLabel(effortLevel = card.effortLevel),
        formatCardTagsLabel(tags = card.tags),
        formatCardDueLabel(dueAtMillis = card.dueAtMillis)
    ).joinToString(separator = " | ")
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
