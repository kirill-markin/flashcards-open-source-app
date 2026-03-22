package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.components.DraftNoticeCard
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    onSelectFilter: (ReviewFilter) -> Unit,
    onOpenPreview: () -> Unit,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit,
    onDismissErrorMessage: () -> Unit
) {
    var isFilterSheetVisible by remember { mutableStateOf(value = false) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.errorMessage) {
        if (uiState.errorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = uiState.errorMessage)
        onDismissErrorMessage()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Review")
                        Text(
                            text = uiState.selectedFilterTitle,
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            isFilterSheetVisible = true
                        }
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.FilterList,
                            contentDescription = "Choose review filter"
                        )
                    }

                    if (uiState.isLoading) {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            modifier = Modifier.padding(end = 16.dp)
                        )
                    } else {
                        TextButton(
                            onClick = onOpenPreview,
                            enabled = uiState.totalCount > 0
                        ) {
                            Text("${uiState.remainingCount} / ${uiState.totalCount}")
                        }
                    }
                }
            )
        },
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState)
        }
    ) { innerPadding ->
        ReviewContent(
            uiState = uiState,
            onRevealAnswer = onRevealAnswer,
            onRateAgain = onRateAgain,
            onRateHard = onRateHard,
            onRateGood = onRateGood,
            onRateEasy = onRateEasy,
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 16.dp
            )
        )
    }

    if (isFilterSheetVisible) {
        ReviewFilterSheet(
            selectedFilter = uiState.selectedFilter,
            availableDeckFilters = uiState.availableDeckFilters,
            availableTagFilters = uiState.availableTagFilters,
            onDismiss = {
                isFilterSheetVisible = false
            },
            onSelectFilter = { nextFilter ->
                onSelectFilter(nextFilter)
                isFilterSheetVisible = false
            }
        )
    }
}

@Composable
private fun ReviewContent(
    uiState: ReviewUiState,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit,
    contentPadding: PaddingValues
) {
    LazyColumn(
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            DraftNoticeCard(
                title = "Android draft review flow",
                body = "This review flow now supports filters, remaining counts, preview, and optimistic session progress, while FSRS and cloud sync remain out of this wave.",
                modifier = Modifier
            )
        }

        item {
            ReviewSessionSummary(
                remainingCount = uiState.remainingCount,
                totalCount = uiState.totalCount,
                reviewedInSessionCount = uiState.reviewedInSessionCount
            )
        }

        item {
            when {
                uiState.isLoading -> {
                    LoadingReviewState()
                }

                uiState.currentCard != null -> {
                    ReviewCardContent(
                        currentCard = uiState.currentCard,
                        isAnswerVisible = uiState.isAnswerVisible,
                        reviewedInSessionCount = uiState.reviewedInSessionCount,
                        onRevealAnswer = onRevealAnswer,
                        onRateAgain = onRateAgain,
                        onRateHard = onRateHard,
                        onRateGood = onRateGood,
                        onRateEasy = onRateEasy
                    )
                }

                uiState.totalCount == 0 && uiState.selectedFilter == ReviewFilter.AllCards -> {
                    EmptyReviewState(
                        title = "No cards yet",
                        body = "Create cards in the Cards tab to start reviewing on Android."
                    )
                }

                uiState.totalCount == 0 -> {
                    EmptyReviewState(
                        title = "No cards in this filter",
                        body = "This review filter does not include any cards yet."
                    )
                }

                else -> {
                    EmptyReviewState(
                        title = "Session complete",
                        body = "No more cards are left in this study pass."
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingReviewState() {
    Card(modifier = Modifier.fillMaxWidth()) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .fillMaxWidth()
                .padding(32.dp)
        ) {
            CircularProgressIndicator()
        }
    }
}

@Composable
private fun ReviewSessionSummary(
    remainingCount: Int,
    totalCount: Int,
    reviewedInSessionCount: Int
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = "Session progress",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = "Remaining: $remainingCount / $totalCount",
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                text = "Reviewed in this session: $reviewedInSessionCount",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun EmptyReviewState(title: String, body: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun ReviewCardContent(
    currentCard: ReviewCard,
    isAnswerVisible: Boolean,
    reviewedInSessionCount: Int,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = "Effort: ${currentCard.effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() }}",
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
            if (isAnswerVisible) {
                Text(
                    text = currentCard.backText,
                    style = MaterialTheme.typography.bodyLarge
                )
            }
            Text(
                text = "Session reviewed: $reviewedInSessionCount",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    if (isAnswerVisible) {
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReviewFilterSheet(
    selectedFilter: ReviewFilter,
    availableDeckFilters: List<ReviewDeckFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>,
    onDismiss: () -> Unit,
    onSelectFilter: (ReviewFilter) -> Unit
) {
    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            item {
                Text(
                    text = "Review scope",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(horizontal = 24.dp)
                )
            }

            item {
                ReviewFilterOptionRow(
                    title = "All cards",
                    subtitle = "Review the full local queue",
                    selected = selectedFilter == ReviewFilter.AllCards,
                    onClick = {
                        onSelectFilter(ReviewFilter.AllCards)
                    }
                )
            }

            if (availableDeckFilters.isNotEmpty()) {
                item {
                    Text(
                        text = "Decks",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }

                items(availableDeckFilters.size) { index ->
                    val deck = availableDeckFilters[index]
                    ReviewFilterOptionRow(
                        title = "${deck.title} (${deck.totalCount})",
                        subtitle = "Filtered deck",
                        selected = selectedFilter == ReviewFilter.Deck(deckId = deck.deckId),
                        onClick = {
                            onSelectFilter(ReviewFilter.Deck(deckId = deck.deckId))
                        }
                    )
                }
            }

            if (availableTagFilters.isNotEmpty()) {
                item {
                    Text(
                        text = "Tags",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }

                items(availableTagFilters.size) { index ->
                    val tag = availableTagFilters[index]
                    ReviewFilterOptionRow(
                        title = "${tag.tag} (${tag.totalCount})",
                        subtitle = "Workspace tag",
                        selected = selectedFilter == ReviewFilter.Tag(tag = tag.tag),
                        onClick = {
                            onSelectFilter(ReviewFilter.Tag(tag = tag.tag))
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun ReviewFilterOptionRow(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit
) {
    ListItem(
        headlineContent = {
            Text(title)
        },
        supportingContent = {
            Text(subtitle)
        },
        leadingContent = {
            RadioButton(
                selected = selected,
                onClick = null
            )
        },
        modifier = Modifier.clickable(onClick = onClick)
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewPreviewRoute(
    uiState: ReviewUiState,
    onStartPreview: () -> Unit,
    onLoadNextPreviewPageIfNeeded: (String) -> Unit,
    onRetryPreview: () -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(Unit) {
        onStartPreview()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text("Review queue")
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
                bottom = innerPadding.calculateBottomPadding() + 16.dp
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                ReviewSessionSummary(
                    remainingCount = uiState.remainingCount,
                    totalCount = uiState.totalCount,
                    reviewedInSessionCount = uiState.reviewedInSessionCount
                )
            }

            if (uiState.isPreviewLoading && uiState.previewCards.isEmpty()) {
                item {
                    LoadingReviewState()
                }
            } else if (uiState.previewCards.isEmpty() && uiState.previewErrorMessage.isNotEmpty()) {
                item {
                    PreviewErrorCard(
                        message = uiState.previewErrorMessage,
                        onRetry = onRetryPreview
                    )
                }
            } else if (uiState.previewCards.isEmpty()) {
                item {
                    EmptyReviewState(
                        title = "No cards in preview",
                        body = "This review filter does not have any cards to show right now."
                    )
                }
            } else {
                itemsIndexed(
                    items = uiState.previewCards,
                    key = { _, card ->
                        card.cardId
                    }
                ) { index, card ->
                    if (index == uiState.remainingCount && uiState.remainingCount < uiState.previewCards.size) {
                        PreviewSectionSeparator()
                    }

                    PreviewCardRow(
                        card = card,
                        isCurrent = card.cardId == uiState.currentCard?.cardId,
                        isAlreadyRated = index >= uiState.remainingCount
                    )

                    LaunchedEffect(
                        key1 = card.cardId,
                        key2 = uiState.previewCards.size
                    ) {
                        onLoadNextPreviewPageIfNeeded(card.cardId)
                    }
                }

                if (uiState.previewErrorMessage.isNotEmpty()) {
                    item {
                        PreviewErrorCard(
                            message = uiState.previewErrorMessage,
                            onRetry = onRetryPreview
                        )
                    }
                } else if (uiState.isPreviewLoading) {
                    item {
                        Box(
                            contentAlignment = Alignment.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(16.dp)
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PreviewSectionSeparator() {
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        HorizontalDivider()
        Text(
            text = "Already rated in this session",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun PreviewCardRow(
    card: ReviewCard,
    isCurrent: Boolean,
    isAlreadyRated: Boolean
) {
    val containerColor = when {
        isCurrent -> MaterialTheme.colorScheme.secondaryContainer
        isAlreadyRated -> MaterialTheme.colorScheme.surfaceVariant
        else -> MaterialTheme.colorScheme.surface
    }

    Card(
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .background(color = containerColor)
                .padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = card.frontText,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                if (isCurrent) {
                    Text(
                        text = "Current",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                } else if (isAlreadyRated) {
                    Text(
                        text = "Rated",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Text(
                text = card.backText,
                style = MaterialTheme.typography.bodyMedium,
                color = if (isAlreadyRated) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                }
            )

            if (card.tags.isNotEmpty()) {
                Text(
                    text = card.tags.joinToString(separator = " | "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@Composable
private fun PreviewErrorCard(
    message: String,
    onRetry: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = "Queue couldn't be loaded",
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            TextButton(onClick = onRetry) {
                Text("Retry")
            }
        }
    }
}
