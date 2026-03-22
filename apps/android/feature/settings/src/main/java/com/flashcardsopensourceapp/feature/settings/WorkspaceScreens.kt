package com.flashcardsopensourceapp.feature.settings

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
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.formatDeckFilterDefinition

@Composable
fun WorkspaceSettingsRoute(
    uiState: WorkspaceSettingsUiState,
    onOpenOverview: () -> Unit,
    onOpenDecks: () -> Unit,
    onOpenTags: () -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            DraftNoticeCard(
                title = "Workspace settings",
                body = "Decks now live as Android-native filtered collections. Review parity, scheduler settings, and export stay out of this wave on purpose.",
                modifier = Modifier
            )
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Overview")
                    },
                    supportingContent = {
                        Text("${uiState.workspaceName} | ${uiState.totalCards} cards")
                    },
                    modifier = Modifier.clickable(onClick = onOpenOverview)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Decks")
                    },
                    supportingContent = {
                        Text("${uiState.deckCount} filtered decks")
                    },
                    modifier = Modifier.clickable(onClick = onOpenDecks)
                )
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Tags")
                    },
                    supportingContent = {
                        Text("${uiState.tagCount} tags")
                    },
                    modifier = Modifier.clickable(onClick = onOpenTags)
                )
            }
        }
    }
}

@Composable
fun WorkspaceOverviewRoute(uiState: WorkspaceOverviewUiState) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = uiState.workspaceName,
                        style = MaterialTheme.typography.headlineSmall
                    )
                    OverviewRow(title = "Cards", value = uiState.totalCards)
                    OverviewRow(title = "Decks", value = uiState.deckCount)
                    OverviewRow(title = "Tags", value = uiState.tagCount)
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = "Today",
                        style = MaterialTheme.typography.titleMedium
                    )
                    OverviewRow(title = "Due", value = uiState.dueCount)
                    OverviewRow(title = "New", value = uiState.newCount)
                    OverviewRow(title = "Reviewed", value = uiState.reviewedCount)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DecksRoute(
    uiState: DecksUiState,
    onSearchQueryChange: (String) -> Unit,
    onOpenDeck: (String) -> Unit,
    onCreateDeck: () -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Decks")
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = onCreateDeck
            ) {
                androidx.compose.material3.Icon(
                    imageVector = Icons.Outlined.Add,
                    contentDescription = "Add deck"
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
                        Text("Search decks")
                    },
                    modifier = Modifier.fillMaxWidth()
                )
            }

            if (uiState.decks.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (uiState.searchQuery.isEmpty()) {
                                "No decks yet. Create the first filtered deck."
                            } else {
                                "No decks match this search."
                            },
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            } else {
                items(uiState.decks, key = { deck -> deck.deckId }) { deck ->
                    DeckRow(
                        deck = deck,
                        onOpenDeck = onOpenDeck
                    )
                }
            }
        }
    }
}

@Composable
fun DeckDetailRoute(
    uiState: DeckDetailUiState,
    onEditDeck: (String) -> Unit,
    onDeleteDeck: (String) -> Unit
) {
    val deck = uiState.deck

    if (deck == null) {
        LazyColumn(
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "Deck not found.",
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        }
        return
    }

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.padding(20.dp)
                ) {
                    Text(
                        text = deck.name,
                        style = MaterialTheme.typography.headlineSmall
                    )
                    Text(
                        text = formatDeckFilterDefinition(filterDefinition = deck.filterDefinition),
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    OverviewRow(title = "Cards", value = deck.totalCards)
                    OverviewRow(title = "Due", value = deck.dueCards)
                    OverviewRow(title = "New", value = deck.newCards)
                    OverviewRow(title = "Reviewed", value = deck.reviewedCards)
                }
            }
        }

        item {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                OutlinedButton(
                    onClick = {
                        onEditDeck(deck.deckId)
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Edit")
                }
                Button(
                    onClick = {
                        onDeleteDeck(deck.deckId)
                    },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Delete")
                }
            }
        }

        item {
            Text(
                text = "Matching cards",
                style = MaterialTheme.typography.titleMedium
            )
        }

        if (uiState.cards.isEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = "This filtered deck has no matching cards yet.",
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        } else {
            items(uiState.cards, key = { card -> card.cardId }) { card ->
                DeckCardRow(card = card)
            }
        }
    }
}

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

@Composable
fun WorkspaceTagsRoute(
    uiState: WorkspaceTagsUiState,
    onSearchQueryChange: (String) -> Unit
) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            OutlinedTextField(
                value = uiState.searchQuery,
                onValueChange = onSearchQueryChange,
                label = {
                    Text("Search tags")
                },
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (uiState.tags.isEmpty()) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Text(
                        text = if (uiState.searchQuery.isEmpty()) {
                            "No tags have been used yet."
                        } else {
                            "No tags match this search."
                        },
                        modifier = Modifier.padding(20.dp)
                    )
                }
            }
        } else {
            items(uiState.tags, key = { tag -> tag.tag }) { tagSummary ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = {
                            Text(tagSummary.tag)
                        },
                        supportingContent = {
                            Text("${tagSummary.cardsCount} cards")
                        }
                    )
                }
            }
        }

        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = {
                        Text("Total cards")
                    },
                    supportingContent = {
                        Text("${uiState.totalCards}")
                    }
                )
            }
        }
    }
}

@Composable
private fun DeckRow(
    deck: DeckSummary,
    onOpenDeck: (String) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                onOpenDeck(deck.deckId)
            }
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = deck.name,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = formatDeckFilterDefinition(filterDefinition = deck.filterDefinition),
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = "${deck.totalCards} cards | ${deck.newCards} new | ${deck.reviewedCards} reviewed",
                style = MaterialTheme.typography.labelMedium
            )
        }
    }
}

@Composable
private fun DeckCardRow(card: CardSummary) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = card.frontText,
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = "Effort: ${card.effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() }}",
                color = MaterialTheme.colorScheme.primary
            )
            if (card.tags.isNotEmpty()) {
                Text(
                    text = card.tags.joinToString(separator = " | "),
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun OverviewRow(title: String, value: Int) {
    Row(
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = title,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f)
        )
        Text(
            text = value.toString(),
            style = MaterialTheme.typography.titleSmall
        )
    }
}
