package com.flashcardsopensourceapp.feature.cards

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.cardFilterActiveDimensionCount

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
    val resources = LocalContext.current.resources
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
                    Text(stringResource(id = R.string.cards_title))
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
                                stringResource(id = R.string.cards_filter_content_description)
                            } else {
                                pluralStringResource(
                                    id = R.plurals.cards_filter_content_description_active,
                                    count = activeFilterCount,
                                    activeFilterCount
                                )
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
                            contentDescription = stringResource(id = R.string.cards_library_actions_content_description)
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
                                Text(stringResource(id = R.string.cards_open_decks))
                            },
                            onClick = {
                                isLibraryMenuVisible = false
                                onOpenDecks()
                            }
                        )
                        DropdownMenuItem(
                            text = {
                                Text(stringResource(id = R.string.cards_open_tags))
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
                    contentDescription = resources.getString(R.string.cards_add_card_content_description)
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
                        Text(stringResource(id = R.string.cards_search_label))
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
                                text = stringResource(id = R.string.cards_active_filters),
                                style = MaterialTheme.typography.titleSmall
                            )
                            Text(
                                text = formatCardsFilterSummary(resources = resources, filter = uiState.activeFilter),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            TextButton(
                                onClick = onClearFilter,
                                modifier = Modifier.align(Alignment.End)
                            ) {
                                Text(stringResource(id = R.string.cards_clear))
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
                                    stringResource(id = R.string.cards_empty_no_cards)
                                activeFilterCount > 0 ->
                                    stringResource(id = R.string.cards_empty_no_filter_matches)
                                else ->
                                    stringResource(id = R.string.cards_empty_no_search_matches)
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
