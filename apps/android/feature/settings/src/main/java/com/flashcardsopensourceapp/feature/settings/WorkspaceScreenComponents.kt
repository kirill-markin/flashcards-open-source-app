package com.flashcardsopensourceapp.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.CardSummary

@Composable
internal fun DeckRow(
    deckEntry: DeckListEntryUiState,
    onOpenDeck: (DeckListTargetUiState) -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
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
                text = "${deckEntry.totalCards} cards | ${deckEntry.newCards} new | ${deckEntry.reviewedCards} reviewed | ${deckEntry.dueCards} due",
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
internal fun OverviewRow(title: String, value: Int) {
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
