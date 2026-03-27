package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.CheckCircleOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.HourglassBottom
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.IconButtonDefaults
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption

const val reviewShowAnswerButtonTag: String = "review_show_answer_button"
const val reviewRateGoodButtonTag: String = "review_rate_good_button"
const val reviewFilterButtonTag: String = "review_filter_button"
const val reviewEditCardButtonTag: String = "review_edit_card_button"

private val reviewBottomOverlayBottomPadding = 12.dp
private val reviewBottomOverlayHorizontalPadding = 16.dp
private val reviewShowAnswerContentBottomPadding = 120.dp
private val reviewAnswerGridContentBottomPadding = 184.dp
private val reviewShowAnswerButtonMinHeight = 64.dp
private val reviewRatingButtonMinHeight = 68.dp
private val reviewMetadataIconSize = 18.dp
private val reviewEditButtonSize = 26.dp
private val reviewEditIconSize = 14.dp
private val reviewTopBarFilterMaxWidth = 160.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    onSelectFilter: (ReviewFilter) -> Unit,
    onOpenPreview: () -> Unit,
    onOpenCurrentCard: (String) -> Unit,
    onOpenDeckManagement: () -> Unit,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit,
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
            ReviewTopBar(
                selectedFilterTitle = uiState.selectedFilterTitle,
                isLoading = uiState.isLoading,
                remainingCount = uiState.remainingCount,
                totalCount = uiState.totalCount,
                onOpenFilter = {
                    isFilterSheetVisible = true
                },
                onOpenPreview = onOpenPreview
            )
        },
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState)
        }
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize()) {
            ReviewContent(
                uiState = uiState,
                onOpenCurrentCard = onOpenCurrentCard,
                onCreateCard = onCreateCard,
                onCreateCardWithAi = onCreateCardWithAi,
                onSwitchToAllCards = onSwitchToAllCards,
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + reviewContentBottomPadding(
                        hasCurrentCard = uiState.preparedCurrentCard != null,
                        isAnswerVisible = uiState.isAnswerVisible
                    )
                )
            )

            if (uiState.isLoading.not() && uiState.preparedCurrentCard != null) {
                ReviewBottomActionOverlay(
                    modifier = Modifier.align(Alignment.BottomCenter),
                    currentCard = uiState.preparedCurrentCard,
                    isAnswerVisible = uiState.isAnswerVisible,
                    bottomInsetPadding = innerPadding.calculateBottomPadding() + reviewBottomOverlayBottomPadding,
                    onRevealAnswer = onRevealAnswer,
                    onRateAgain = onRateAgain,
                    onRateHard = onRateHard,
                    onRateGood = onRateGood,
                    onRateEasy = onRateEasy
                )
            }
        }
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReviewTopBar(
    selectedFilterTitle: String,
    isLoading: Boolean,
    remainingCount: Int,
    totalCount: Int,
    onOpenFilter: () -> Unit,
    onOpenPreview: () -> Unit
) {
    TopAppBar(
        title = {
            Text("Review")
        },
        actions = {
            if (isLoading) {
                CircularProgressIndicator(
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(24.dp)
                )
            } else {
                TextButton(
                    onClick = onOpenPreview,
                    enabled = totalCount > 0
                ) {
                    Text("$remainingCount / $totalCount")
                }
            }

            FilterChip(
                selected = false,
                onClick = onOpenFilter,
                label = {
                    Text(
                        text = selectedFilterTitle,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Outlined.FilterList,
                        contentDescription = null
                    )
                },
                modifier = Modifier
                    .widthIn(max = reviewTopBarFilterMaxWidth)
                    .padding(end = 16.dp)
                    .testTag(reviewFilterButtonTag)
            )
        }
    )
}

private fun reviewContentBottomPadding(hasCurrentCard: Boolean, isAnswerVisible: Boolean): androidx.compose.ui.unit.Dp {
    if (hasCurrentCard.not()) {
        return 16.dp
    }

    return if (isAnswerVisible) {
        reviewAnswerGridContentBottomPadding
    } else {
        reviewShowAnswerContentBottomPadding
    }
}

@Composable
private fun ReviewContent(
    uiState: ReviewUiState,
    onOpenCurrentCard: (String) -> Unit,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit,
    contentPadding: PaddingValues
) {
    LazyColumn(
        contentPadding = contentPadding,
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxSize()
    ) {
        item {
            when {
                uiState.isLoading -> {
                    LoadingReviewState()
                }

                uiState.preparedCurrentCard != null -> {
                    ReviewCardContent(
                        currentCard = uiState.preparedCurrentCard,
                        isAnswerVisible = uiState.isAnswerVisible,
                        onOpenCurrentCard = {
                            uiState.currentCardIdForEditing?.let(onOpenCurrentCard)
                        }
                    )
                }

                uiState.emptyState != null -> {
                    ActionableEmptyReviewState(
                        emptyState = uiState.emptyState,
                        onCreateCard = onCreateCard,
                        onCreateCardWithAi = onCreateCardWithAi,
                        onSwitchToAllCards = onSwitchToAllCards
                    )
                }

                else -> Unit
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
private fun ActionableEmptyReviewState(
    emptyState: ReviewEmptyState,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit
) {
    val title = when (emptyState) {
        ReviewEmptyState.NO_CARDS_YET -> "No cards yet"
        ReviewEmptyState.FILTER_EMPTY -> "No cards in this filter"
        ReviewEmptyState.SESSION_COMPLETE -> "Session complete"
    }
    val body = when (emptyState) {
        ReviewEmptyState.NO_CARDS_YET -> "Create a card or use AI to start your first study session."
        ReviewEmptyState.FILTER_EMPTY -> "Nothing is due in this filter right now. Switch back to all cards or add more material."
        ReviewEmptyState.SESSION_COMPLETE -> "You are done for now. Add more material or come back when more cards are due."
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
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
            OutlinedButton(
                onClick = onCreateCard,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Create card")
            }
            Button(
                onClick = onCreateCardWithAi,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Create with AI")
            }
            if (emptyState == ReviewEmptyState.FILTER_EMPTY) {
                TextButton(
                    onClick = onSwitchToAllCards,
                    modifier = Modifier.align(Alignment.End)
                ) {
                    Text("Switch to all cards")
                }
            }
        }
    }
}

@Composable
private fun ReviewCardContent(
    currentCard: PreparedReviewCardPresentation,
    isAnswerVisible: Boolean,
    onOpenCurrentCard: () -> Unit
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.weight(1f)
            ) {
                ReviewMetadataItem(
                    icon = Icons.Outlined.Timer,
                    label = currentCard.effortLabel
                )
                ReviewMetadataItem(
                    icon = Icons.AutoMirrored.Outlined.Label,
                    label = currentCard.tagsLabel
                )
            }

            FilledIconButton(
                onClick = onOpenCurrentCard,
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                ),
                modifier = Modifier
                    .size(reviewEditButtonSize)
                    .testTag(reviewEditCardButtonTag)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Edit,
                    contentDescription = "Edit card",
                    modifier = Modifier.size(reviewEditIconSize)
                )
            }
        }

        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.padding(20.dp)
            ) {
                ReviewCardSideSection(
                    label = "Front",
                    content = currentCard.frontContent
                )
                if (isAnswerVisible) {
                    HorizontalDivider()
                    ReviewCardSideSection(
                        label = "Back",
                        content = currentCard.backContent
                    )
                }
            }
        }

        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            ReviewMetadataItem(
                icon = Icons.Outlined.AccessTime,
                label = "Due ${currentCard.dueLabel}"
            )
            ReviewMetadataItem(
                icon = Icons.Outlined.Autorenew,
                label = currentCard.repsLabel
            )
            ReviewMetadataItem(
                icon = Icons.Outlined.WarningAmber,
                label = currentCard.lapsesLabel
            )
        }
    }
}

@Composable
private fun ReviewCardSideSection(
    label: String,
    content: ReviewRenderedContent
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        ReviewRenderedContentView(content = content)
    }
}

@Composable
private fun ReviewMetadataItem(
    icon: ImageVector,
    label: String
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(reviewMetadataIconSize)
        )
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun ReviewBottomActionOverlay(
    modifier: Modifier,
    currentCard: PreparedReviewCardPresentation,
    isAnswerVisible: Boolean,
    bottomInsetPadding: androidx.compose.ui.unit.Dp,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(
                brush = Brush.verticalGradient(
                    colors = listOf(
                        Color.Transparent,
                        MaterialTheme.colorScheme.surface.copy(alpha = 0.92f)
                    )
                )
            )
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(
                    start = reviewBottomOverlayHorizontalPadding,
                    top = 40.dp,
                    end = reviewBottomOverlayHorizontalPadding,
                    bottom = bottomInsetPadding
                )
        ) {
            if (isAnswerVisible) {
                ReviewAnswerButtonGrid(
                    answerOptions = currentCard.answerOptions,
                    onRateAgain = onRateAgain,
                    onRateHard = onRateHard,
                    onRateGood = onRateGood,
                    onRateEasy = onRateEasy
                )
            } else {
                Button(
                    onClick = onRevealAnswer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = reviewShowAnswerButtonMinHeight)
                        .testTag(reviewShowAnswerButtonTag)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Outlined.Visibility,
                            contentDescription = null
                        )
                        Text("Show answer")
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewAnswerButtonGrid(
    answerOptions: List<ReviewAnswerOption>,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        answerOptions.chunked(size = 2).forEach { rowOptions ->
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                rowOptions.forEach { option ->
                    RatingButton(
                        option = option,
                        onClick = when (option.rating) {
                            ReviewRating.AGAIN -> onRateAgain
                            ReviewRating.HARD -> onRateHard
                            ReviewRating.GOOD -> onRateGood
                            ReviewRating.EASY -> onRateEasy
                        },
                        modifier = Modifier.weight(1f)
                    )
                }

                if (rowOptions.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

private data class ReviewRatingPresentation(
    val title: String,
    val icon: ImageVector
)

private fun reviewRatingPresentation(rating: ReviewRating): ReviewRatingPresentation {
    return when (rating) {
        ReviewRating.AGAIN -> ReviewRatingPresentation(
            title = "Again",
            icon = Icons.Outlined.Autorenew
        )

        ReviewRating.HARD -> ReviewRatingPresentation(
            title = "Hard",
            icon = Icons.Outlined.HourglassBottom
        )

        ReviewRating.GOOD -> ReviewRatingPresentation(
            title = "Good",
            icon = Icons.Outlined.CheckCircleOutline
        )

        ReviewRating.EASY -> ReviewRatingPresentation(
            title = "Easy",
            icon = Icons.Outlined.AutoAwesome
        )
    }
}

@Composable
private fun RatingButton(
    option: ReviewAnswerOption,
    onClick: () -> Unit,
    modifier: Modifier
) {
    val presentation = reviewRatingPresentation(rating = option.rating)

    Button(
        onClick = onClick,
        modifier = if (option.rating == ReviewRating.GOOD) {
            modifier.testTag(reviewRateGoodButtonTag)
        } else {
            modifier
        }
            .heightIn(min = reviewRatingButtonMinHeight)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Icon(
                    imageVector = presentation.icon,
                    contentDescription = null
                )
                Text(
                    text = presentation.title,
                    style = MaterialTheme.typography.titleMedium
                )
            }
            Text(
                text = option.intervalDescription,
                style = MaterialTheme.typography.labelSmall
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

@Composable
private fun StaticEmptyReviewState(title: String, body: String) {
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
                    StaticEmptyReviewState(
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
