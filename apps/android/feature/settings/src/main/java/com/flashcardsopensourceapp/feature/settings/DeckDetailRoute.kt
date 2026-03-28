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
                    Text(detail?.title ?: "Deck")
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
                            text = "Deck not found.",
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
                        OverviewRow(title = "Cards", value = detail.totalCards)
                        OverviewRow(title = "Due", value = detail.dueCards)
                        OverviewRow(title = "New", value = detail.newCards)
                        OverviewRow(title = "Reviewed", value = detail.reviewedCards)
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
                            Text("Edit")
                        }
                        Button(
                            onClick = {
                                onDeleteDeck(detail.deckId)
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Text("Delete")
                        }
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
                            text = if (detail is DeckDetailInfoUiState.AllCards) {
                                "This workspace does not have any cards yet."
                            } else {
                                "This filtered deck has no matching cards yet."
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
