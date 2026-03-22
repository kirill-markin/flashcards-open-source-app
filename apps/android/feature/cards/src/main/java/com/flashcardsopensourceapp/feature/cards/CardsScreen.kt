package com.flashcardsopensourceapp.feature.cards

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CardsRoute(
    uiState: CardsUiState,
    onSearchQueryChange: (String) -> Unit,
    onCreateCard: () -> Unit,
    onOpenCard: (String) -> Unit,
    onDeleteCard: (String) -> Unit
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Cards")
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
                    title = "Android draft cards flow",
                    body = "Cards already use Room-backed CRUD. Search is intentionally simple in this first Android-native pass.",
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

            if (uiState.cards.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (uiState.searchQuery.isEmpty()) {
                                "No cards yet. Tap the add button to create the first card."
                            } else {
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
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.weight(1f)
                ) {
                    Text(
                        text = card.frontText,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Text(
                        text = card.deckName,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
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
fun CardEditorRoute(
    uiState: CardEditorUiState,
    onFrontTextChange: (String) -> Unit,
    onBackTextChange: (String) -> Unit,
    onTagsTextChange: (String) -> Unit,
    onDeckChange: (String) -> Unit,
    onEffortLevelChange: (EffortLevel) -> Unit,
    onSave: () -> Unit,
    onDelete: (() -> Unit)?,
    onBack: () -> Unit
) {
    var isDeckMenuExpanded by remember { mutableStateOf(value = false) }

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
                ExposedDropdownMenuBox(
                    expanded = isDeckMenuExpanded,
                    onExpandedChange = { expanded ->
                        isDeckMenuExpanded = expanded
                    }
                ) {
                    val selectedDeckName = uiState.availableDecks.firstOrNull { deck ->
                        deck.deckId == uiState.selectedDeckId
                    }?.name ?: ""

                    OutlinedTextField(
                        value = selectedDeckName,
                        onValueChange = { },
                        readOnly = true,
                        label = {
                            Text("Deck")
                        },
                        trailingIcon = {
                            ExposedDropdownMenuDefaults.TrailingIcon(expanded = isDeckMenuExpanded)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor()
                    )
                    ExposedDropdownMenu(
                        expanded = isDeckMenuExpanded,
                        onDismissRequest = {
                            isDeckMenuExpanded = false
                        }
                    ) {
                        uiState.availableDecks.forEach { deck ->
                            DropdownMenuItem(
                                text = {
                                    Text(deck.name)
                                },
                                onClick = {
                                    isDeckMenuExpanded = false
                                    onDeckChange(deck.deckId)
                                }
                            )
                        }
                    }
                }
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
                    val options = listOf(EffortLevel.FAST, EffortLevel.DEEP)
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
