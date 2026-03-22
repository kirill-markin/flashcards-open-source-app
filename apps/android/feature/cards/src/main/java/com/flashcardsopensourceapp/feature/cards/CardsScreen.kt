package com.flashcardsopensourceapp.feature.cards

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.buildCardFilter
import com.flashcardsopensourceapp.data.local.model.cardFilterActiveDimensionCount
import com.flashcardsopensourceapp.data.local.model.formatCardFilterSummary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardsRoute(
    uiState: CardsUiState,
    onSearchQueryChange: (String) -> Unit,
    onApplyFilter: (CardFilter) -> Unit,
    onClearFilter: () -> Unit,
    onCreateCard: () -> Unit,
    onOpenCard: (String) -> Unit,
    onDeleteCard: (String) -> Unit
) {
    var isFilterSheetVisible by remember { mutableStateOf(value = false) }
    var draftFilter by remember(uiState.activeFilter) {
        mutableStateOf(uiState.activeFilter)
    }
    val activeFilterCount = cardFilterActiveDimensionCount(filter = uiState.activeFilter)

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Cards")
                },
                actions = {
                    IconButton(
                        onClick = {
                            draftFilter = uiState.activeFilter
                            isFilterSheetVisible = true
                        }
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Tune,
                            contentDescription = if (activeFilterCount == 0) {
                                "Filter cards"
                            } else {
                                "Filter cards ($activeFilterCount active)"
                            }
                        )
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCreateCard,
                modifier = Modifier.semantics {
                    contentDescription = "Add card"
                }
            ) {
                Icon(
                    imageVector = Icons.Outlined.Add,
                    contentDescription = null
                )
            }
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 96.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                DraftNoticeCard(
                    title = "Android cards aligned to filtered decks",
                    body = "Cards now match the iOS domain model: card content stays independent, while deck rules live separately in workspace settings.",
                    modifier = Modifier
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.searchQuery,
                    onValueChange = onSearchQueryChange,
                    label = {
                        Text("Search cards")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (activeFilterCount > 0) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.padding(16.dp)
                        ) {
                            Text(
                                text = "Active filters",
                                style = MaterialTheme.typography.titleSmall
                            )
                            Text(
                                text = formatCardFilterSummary(filter = uiState.activeFilter),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            TextButton(
                                onClick = onClearFilter,
                                modifier = Modifier.align(Alignment.End)
                            ) {
                                Text("Clear")
                            }
                        }
                    }
                }
            }

            if (uiState.cards.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = when {
                                uiState.searchQuery.isEmpty() && activeFilterCount == 0 ->
                                    "No cards yet. Tap the add button to create the first card."
                                activeFilterCount > 0 ->
                                    "No cards match the current filters."
                                else ->
                                    "No cards match this search."
                            },
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            } else {
                items(uiState.cards, key = { card -> card.cardId }) { card ->
                    CardRow(
                        card = card,
                        onOpenCard = onOpenCard,
                        onDeleteCard = onDeleteCard
                    )
                }
            }
        }
    }

    if (isFilterSheetVisible) {
        CardsFilterSheet(
            draftFilter = draftFilter,
            availableTags = uiState.availableTagSuggestions,
            onDismiss = {
                isFilterSheetVisible = false
            },
            onApply = { nextFilter ->
                onApplyFilter(nextFilter)
                isFilterSheetVisible = false
            },
            onClear = {
                draftFilter = CardFilter(
                    tags = emptyList(),
                    effort = emptyList()
                )
            },
            onDraftFilterChange = { nextFilter ->
                draftFilter = nextFilter
            }
        )
    }
}

@Composable
private fun CardRow(
    card: CardSummary,
    onOpenCard: (String) -> Unit,
    onDeleteCard: (String) -> Unit
) {
    var isDeleteDialogVisible by remember { mutableStateOf(value = false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                onOpenCard(card.cardId)
            }
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = card.frontText,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                IconButton(
                    onClick = {
                        isDeleteDialogVisible = true
                    }
                ) {
                    Icon(
                        imageVector = Icons.Outlined.Delete,
                        contentDescription = "Delete card"
                    )
                }
            }
            Text(
                text = card.backText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "Effort: ${card.effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() }}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
            if (card.tags.isNotEmpty()) {
                Text(
                    text = card.tags.joinToString(separator = " | "),
                    style = MaterialTheme.typography.labelMedium
                )
            }
        }
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
                Text("This removes the local draft card from the Android prototype.")
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
private fun CardsFilterSheet(
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
                                Text(effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() })
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardEditorRoute(
    uiState: CardEditorUiState,
    onFrontTextChange: (String) -> Unit,
    onBackTextChange: (String) -> Unit,
    onTagsTextChange: (String) -> Unit,
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
                    value = uiState.frontText,
                    onValueChange = onFrontTextChange,
                    label = {
                        Text("Front text")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.backText,
                    onValueChange = onBackTextChange,
                    label = {
                        Text("Back text")
                    },
                    minLines = 4,
                    modifier = Modifier.fillMaxWidth()
                )
            }

            item {
                OutlinedTextField(
                    value = uiState.tagsText,
                    onValueChange = onTagsTextChange,
                    label = {
                        Text("Tags")
                    },
                    supportingText = {
                        Text("Comma-separated, for example: basics, ui")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
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
                            Text(option.name.lowercase().replaceFirstChar { character -> character.uppercase() })
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
