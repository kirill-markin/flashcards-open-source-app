package com.flashcardsopensourceapp.feature.settings.deck

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import com.flashcardsopensourceapp.core.ui.content.MarkdownPreviewText
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.feature.settings.R

fun deckRowTag(deckTargetId: String): String {
    return "settings_deck_row:$deckTargetId"
}

fun deckCardRowTag(cardId: String): String {
    return "settings_deck_card_row:$cardId"
}

// Narrower than this, the counts move below the title instead of squeezing it.
private val deckRowTitleMinWidth = 96.dp

@Composable
internal fun DeckExplainerCard(body: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                text = stringResource(R.string.settings_deck_editor_explainer_title),
                style = MaterialTheme.typography.titleSmall
            )
            Text(
                text = body,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
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
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.padding(16.dp)
        ) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = deckEntry.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    // FlowRow breaks lines at a weighted item's min intrinsic width; width() sets it, weight() still fills the line.
                    modifier = Modifier
                        .weight(1f)
                        .width(deckRowTitleMinWidth)
                        .alignByBaseline()
                )
                Text(
                    text = stringResource(
                        R.string.settings_workspace_deck_counts_summary,
                        pluralStringResource(
                            R.plurals.settings_workspace_deck_card_summary,
                            deckEntry.totalCards,
                            deckEntry.totalCards
                        ),
                        pluralStringResource(
                            R.plurals.settings_workspace_deck_to_study_summary,
                            deckEntry.dueCards,
                            deckEntry.dueCards
                        )
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.alignByBaseline()
                )
            }
            if (deckEntry.filterSummary != null) {
                Text(
                    text = deckEntry.filterSummary,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
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
            MarkdownPreviewText(
                markdown = card.frontText,
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
