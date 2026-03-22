package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard
import com.flashcardsopensourceapp.data.local.model.ReviewRating

@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit
) {
    val currentCard = uiState.currentCard

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            DraftNoticeCard(
                title = "Android draft review flow",
                body = "This screen is already wired to local Room data, but scheduling and queue behavior still use a simplified draft flow.",
                modifier = Modifier
            )
        }

        item {
            if (currentCard == null) {
                EmptyReviewState(reviewedCount = uiState.reviewedCount)
            } else {
                ReviewCardContent(
                    uiState = uiState,
                    onRevealAnswer = onRevealAnswer,
                    onRateAgain = onRateAgain,
                    onRateHard = onRateHard,
                    onRateGood = onRateGood,
                    onRateEasy = onRateEasy
                )
            }
        }
    }
}

@Composable
private fun EmptyReviewState(reviewedCount: Int) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = "No more draft cards in this review session.",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "Reviewed in this session: $reviewedCount",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ReviewCardContent(
    uiState: ReviewUiState,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit
) {
    val currentCard = requireNotNull(uiState.currentCard)

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = currentCard.deckName,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
            Text(
                text = currentCard.frontText,
                style = MaterialTheme.typography.headlineSmall
            )
            if (currentCard.tags.isNotEmpty()) {
                Text(
                    text = currentCard.tags.joinToString(separator = " | "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (uiState.isAnswerVisible) {
                Text(
                    text = currentCard.backText,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
            Text(
                text = "Session reviewed: ${uiState.reviewedCount}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    if (uiState.isAnswerVisible) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            RatingButton(label = "Again", onClick = onRateAgain)
            RatingButton(label = "Hard", onClick = onRateHard)
            RatingButton(label = "Good", onClick = onRateGood)
            RatingButton(label = "Easy", onClick = onRateEasy)
        }
    } else {
        Button(
            onClick = onRevealAnswer,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Show answer")
        }
    }
}

@Composable
private fun RatingButton(label: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick) {
        Text(label)
    }
}
