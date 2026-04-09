package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeckDetailRoute(
    uiState: DeckDetailUiState,
    onEditDeck: (String) -> Unit,
    onOpenCard: (String) -> Unit,
    onDeleteDeck: (String) -> Unit,
    onBack: () -> Unit
) {
    val detail = uiState.detail

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(detail?.title ?: stringResource(R.string.settings_deck_title))
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = stringResource(R.string.settings_back_content_description)
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        if (detail == null) {
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
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = stringResource(R.string.settings_deck_not_found),
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            }
            return@Scaffold
        }

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
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = detail.title,
                            style = MaterialTheme.typography.headlineSmall
                        )
                        Text(
                            text = detail.filterSummary,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        OverviewRow(title = stringResource(R.string.settings_cards_title), value = detail.totalCards)
                        OverviewRow(title = stringResource(R.string.settings_workspace_due_title), value = detail.dueCards)
                        OverviewRow(title = stringResource(R.string.settings_workspace_new_title), value = detail.newCards)
                        OverviewRow(title = stringResource(R.string.settings_workspace_reviewed_title), value = detail.reviewedCards)
                    }
                }
            }

            item {
                if (detail is DeckDetailInfoUiState.PersistedDeck) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        OutlinedButton(
                            onClick = {
                                onEditDeck(detail.deckId)
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(stringResource(R.string.settings_deck_detail_edit_button))
                        }
                        Button(
                            onClick = {
                                onDeleteDeck(detail.deckId)
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text(stringResource(R.string.settings_deck_detail_delete_button))
                        }
                    }
                }
            }

            item {
                Text(
                    text = stringResource(R.string.settings_deck_matching_cards_title),
                    style = MaterialTheme.typography.titleMedium
                )
            }

            if (uiState.cards.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Text(
                            text = if (detail is DeckDetailInfoUiState.AllCards) {
                                stringResource(R.string.settings_deck_empty_all_cards)
                            } else {
                                stringResource(R.string.settings_deck_empty_filtered)
                            },
                            modifier = Modifier.padding(20.dp)
                        )
                    }
                }
            } else {
                items(uiState.cards, key = { card -> card.cardId }) { card ->
                    DeckCardRow(
                        card = card,
                        onOpenCard = onOpenCard
                    )
                }
            }
        }
    }
}
