package com.flashcardsopensourceapp.feature.settings.deck

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.feature.settings.R

fun deckRowTag(deckTargetId: String): String {
    return "settings_deck_row:$deckTargetId"
}

fun deckCardRowTag(cardId: String): String {
    return "settings_deck_card_row:$cardId"
}

@Composable
internal fun DeckRow(
    deckEntry: DeckListEntryUiState,
    onOpenDeck: (DeckListTargetUiState) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag = deckRowTag(deckTargetId = deckEntry.target.id))
            .clickable {
                onOpenDeck(deckEntry.target)
            }
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = deckEntry.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold
            )
            Text(
                text = deckEntry.filterSummary,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Text(
                text = listOf(
                    pluralStringResource(
                        R.plurals.settings_workspace_deck_card_summary,
                        deckEntry.totalCards,
                        deckEntry.totalCards
                    ),
                    pluralStringResource(
                        R.plurals.settings_workspace_deck_new_summary,
                        deckEntry.newCards,
                        deckEntry.newCards
                    ),
                    pluralStringResource(
                        R.plurals.settings_workspace_deck_reviewed_summary,
                        deckEntry.reviewedCards,
                        deckEntry.reviewedCards
                    ),
                    pluralStringResource(
                        R.plurals.settings_workspace_deck_due_summary,
                        deckEntry.dueCards,
                        deckEntry.dueCards
                    )
                ).joinToString(separator = " | "),
                style = MaterialTheme.typography.labelMedium
            )
        }
    }
}

@Composable
internal fun DeckCardRow(
    card: CardSummary,
    onOpenCard: (String) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .testTag(tag = deckCardRowTag(cardId = card.cardId))
            .clickable {
                onOpenCard(card.cardId)
            }
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = card.frontText,
                style = MaterialTheme.typography.titleSmall
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
