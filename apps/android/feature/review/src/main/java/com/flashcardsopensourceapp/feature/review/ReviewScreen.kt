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
import androidx.compose.material3.Surface
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
import com.flashcardsopensourceapp.data.local.model.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    onSelectFilter: (ReviewFilter) -> Unit,
    onOpenPreview: () -> Unit,
    onOpenCurrentCard: (String) -> Unit,
    onOpenDeckManagement: () -> Unit,
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
            onOpenCurrentCard = onOpenCurrentCard,
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
            },
            onManageDecks = {
                isFilterSheetVisible = false
                onOpenDeckManagement()
            }
        )
    }
}

@Composable
private fun ReviewContent(
    uiState: ReviewUiState,
    onOpenCurrentCard: (String) -> Unit,
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
                body = "This review flow now keeps local scheduler state, preview, optimistic session progress, and foreground cloud reconciliation aligned with the Android app shell.",
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

                uiState.preparedCurrentCard != null -> {
                    ReviewCardContent(
                        currentCard = uiState.preparedCurrentCard,
                        preparedNextCard = uiState.preparedNextCard,
                        isAnswerVisible = uiState.isAnswerVisible,
                        reviewedInSessionCount = uiState.reviewedInSessionCount,
                        onOpenCurrentCard = {
                            uiState.currentCardIdForEditing?.let(onOpenCurrentCard)
                        },
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
    currentCard: PreparedReviewCardPresentation,
    preparedNextCard: PreparedReviewCardPresentation?,
    isAnswerVisible: Boolean,
    reviewedInSessionCount: Int,
    onOpenCurrentCard: () -> Unit,
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
                text = "Effort: ${currentCard.card.effortLevel.name.lowercase().replaceFirstChar { character -> character.uppercase() }}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary
            )
            ReviewCardSideSurface(
                label = "Front",
                content = currentCard.frontContent,
                containerColor = MaterialTheme.colorScheme.surfaceContainerLow
            )
            if (isAnswerVisible) {
                ReviewCardSideSurface(
                    label = "Back",
                    content = currentCard.backContent,
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHighest
                )
            }
            if (currentCard.card.tags.isNotEmpty()) {
                Text(
                    text = currentCard.card.tags.joinToString(separator = " | "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            Text(
                text = "Session reviewed: $reviewedInSessionCount",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            if (preparedNextCard != null && preparedNextCard.card.cardId != currentCard.card.cardId) {
                Text(
                    text = "Next card prepared: ${reviewRenderedContentDebugText(preparedNextCard.frontContent)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }

    if (isAnswerVisible) {
        OutlinedButton(
            onClick = onOpenCurrentCard,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Edit card")
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            currentCard.answerOptions.forEach { answerOption ->
                RatingButton(
                    option = answerOption,
                    onClick = when (answerOption.rating) {
                        com.flashcardsopensourceapp.data.local.model.ReviewRating.AGAIN -> onRateAgain
                        com.flashcardsopensourceapp.data.local.model.ReviewRating.HARD -> onRateHard
                        com.flashcardsopensourceapp.data.local.model.ReviewRating.GOOD -> onRateGood
                        com.flashcardsopensourceapp.data.local.model.ReviewRating.EASY -> onRateEasy
                    }
                )
            }
        }
    } else {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            OutlinedButton(
                onClick = onOpenCurrentCard,
                modifier = Modifier.weight(1f)
            ) {
                Text("Edit card")
            }
            Button(
                onClick = onRevealAnswer,
                modifier = Modifier.weight(1f)
            ) {
                Text("Show answer")
            }
        }
    }
}

@Composable
private fun ReviewCardSideSurface(
    label: String,
    content: ReviewRenderedContent,
    containerColor: androidx.compose.ui.graphics.Color
) {
    Surface(
        color = containerColor,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.padding(20.dp)
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            ReviewRenderedContentView(content = content)
        }
    }
}

@Composable
private fun RatingButton(option: ReviewAnswerOption, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick) {
        Column(
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(
                text = option.rating.name.lowercase().replaceFirstChar { character ->
                    character.uppercase()
                }
            )
            Text(
                text = option.intervalDescription,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReviewFilterSheet(
    selectedFilter: ReviewFilter,
    availableDeckFilters: List<ReviewDeckFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>,
    onDismiss: () -> Unit,
    onSelectFilter: (ReviewFilter) -> Unit,
    onManageDecks: () -> Unit
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

            item {
                HorizontalDivider(modifier = Modifier.padding(top = 8.dp))
            }

            item {
                TextButton(
                    onClick = onManageDecks,
                    modifier = Modifier.padding(horizontal = 24.dp)
                ) {
                    Text("Manage filtered decks")
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
    onOpenCard: (String) -> Unit,
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

            if (uiState.isPreviewLoading && uiState.previewItems.isEmpty()) {
                item {
                    LoadingReviewState()
                }
            } else if (uiState.previewItems.isEmpty() && uiState.previewErrorMessage.isNotEmpty()) {
                item {
                    PreviewErrorCard(
                        message = uiState.previewErrorMessage,
                        onRetry = onRetryPreview
                    )
                }
            } else if (uiState.previewItems.isEmpty()) {
                item {
                    EmptyReviewState(
                        title = "No cards in preview",
                        body = "This review filter does not have any cards to show right now."
                    )
                }
            } else {
                itemsIndexed(
                    items = uiState.previewItems,
                    key = { _, item ->
                        item.itemId
                    }
                ) { _, item ->
                    when (item) {
                        is ReviewPreviewListItem.SectionHeader -> {
                            PreviewSectionSeparator(title = item.title)
                        }

                        is ReviewPreviewListItem.CardEntry -> {
                            PreviewCardRow(
                                item = item,
                                onOpenCard = onOpenCard
                            )

                            LaunchedEffect(
                                key1 = item.card.cardId,
                                key2 = uiState.previewItems.size
                            ) {
                                onLoadNextPreviewPageIfNeeded(item.card.cardId)
                            }
                        }
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
private fun PreviewSectionSeparator(title: String) {
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        HorizontalDivider()
        Text(
            text = title,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun PreviewCardRow(
    item: ReviewPreviewListItem.CardEntry,
    onOpenCard: (String) -> Unit
) {
    val card = item.card
    val containerColor = when {
        item.isCurrent -> MaterialTheme.colorScheme.secondaryContainer
        item.isAlreadyRated -> MaterialTheme.colorScheme.surfaceVariant
        item.isFuture -> MaterialTheme.colorScheme.surfaceContainerLow
        else -> MaterialTheme.colorScheme.surface
    }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                onOpenCard(card.cardId)
            }
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
                if (item.isCurrent) {
                    Text(
                        text = "Current",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary
                    )
                } else if (item.isAlreadyRated) {
                    Text(
                        text = "Rated",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                } else if (item.isFuture) {
                    Text(
                        text = "Later",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Text(
                text = card.backText,
                style = MaterialTheme.typography.bodyMedium,
                color = if (item.isAlreadyRated) {
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
