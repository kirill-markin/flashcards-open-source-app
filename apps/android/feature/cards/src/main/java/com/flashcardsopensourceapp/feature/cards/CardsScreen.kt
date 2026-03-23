package com.flashcardsopensourceapp.feature.cards

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Label
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.InputChip
import androidx.compose.material3.ListItem
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.buildCardFilter
import com.flashcardsopensourceapp.data.local.model.cardFilterActiveDimensionCount
import com.flashcardsopensourceapp.data.local.model.formatCardFilterSummary
import com.flashcardsopensourceapp.data.local.model.normalizeTagKey

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardsRoute(
    uiState: CardsUiState,
    onSearchQueryChange: (String) -> Unit,
    onApplyFilter: (CardFilter) -> Unit,
    onClearFilter: () -> Unit,
    onCreateCard: () -> Unit,
    onOpenCard: (String) -> Unit,
    onOpenDecks: () -> Unit,
    onOpenTags: () -> Unit,
    onDeleteCard: (String) -> Unit
) {
    var isFilterSheetVisible by remember { mutableStateOf(value = false) }
    var isLibraryMenuVisible by remember { mutableStateOf(value = false) }
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
                    IconButton(
                        onClick = {
                            isLibraryMenuVisible = true
                        }
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.MoreVert,
                            contentDescription = "Library actions"
                        )
                    }
                    DropdownMenu(
                        expanded = isLibraryMenuVisible,
                        onDismissRequest = {
                            isLibraryMenuVisible = false
                        }
                    ) {
                        DropdownMenuItem(
                            text = {
                                Text("Open decks")
                            },
                            onClick = {
                                isLibraryMenuVisible = false
                                onOpenDecks()
                            }
                        )
                        DropdownMenuItem(
                            text = {
                                Text("Open tags")
                            },
                            onClick = {
                                isLibraryMenuVisible = false
                                onOpenTags()
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
    var isActionsMenuVisible by remember { mutableStateOf(value = false) }

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
            Text(
                text = card.backText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "Effort: ${formatEffortLevelTitle(effortLevel = card.effortLevel)}",
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
        androidx.compose.material3.AlertDialog(
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardEditorRoute(
    uiState: CardEditorUiState,
    onOpenFrontTextEditor: () -> Unit,
    onOpenBackTextEditor: () -> Unit,
    onOpenTagsEditor: () -> Unit,
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

            item {
                Text(
                    text = "Text",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            item {
                NavigationSummaryCard(
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardTextEditorRoute(
    title: String,
    supportingText: String,
    text: String,
    onTextChange: (String) -> Unit,
    onBack: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(title)
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
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier
                .fillMaxSize()
                .padding(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + 16.dp
                )
        ) {
            Text(
                text = supportingText,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            OutlinedTextField(
                value = text,
                onValueChange = onTextChange,
                label = {
                    Text(title)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                minLines = 14
            )
        }
    }
}

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
                    Text("Tags")
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
                        Text("Add a tag")
                    },
                    supportingText = {
                        Text("Pick an existing workspace tag or add a custom one.")
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
                        Text("Clear")
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
                        Text("Add tag")
                    }
                }
            }

            item {
                Text(
                    text = "Selected tags",
                    style = MaterialTheme.typography.titleSmall
                )
            }

            if (uiState.selectedTags.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = "No tags selected yet.",
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
                    text = "Workspace suggestions",
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
                                Text("Add custom tag")
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
                            text = "No workspace tags match the current search.",
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

@Composable
private fun NavigationSummaryCard(
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

private fun formatCardTextPreview(text: String): String {
    val trimmedText = text.trim()

    if (trimmedText.isEmpty()) {
        return "Tap to edit"
    }

    return trimmedText
        .split('\n')
        .joinToString(separator = " ")
}

private fun formatTagSelectionSummary(tags: List<String>): String {
    if (tags.isEmpty()) {
        return "No tags selected"
    }

    return tags.joinToString(separator = ", ")
}

private fun formatEffortLevelTitle(effortLevel: EffortLevel): String {
    return effortLevel.name.lowercase().replaceFirstChar { character ->
        character.uppercase()
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
