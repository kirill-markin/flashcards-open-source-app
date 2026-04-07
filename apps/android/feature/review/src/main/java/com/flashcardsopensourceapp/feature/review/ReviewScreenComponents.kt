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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
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
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
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
const val reviewAiCardButtonTag: String = "review_ai_card_button"
const val reviewEmptyStateTag: String = "review_empty_state"
const val reviewEmptyStateContentTag: String = "review_empty_state_content"
const val reviewEmptyStateTitleTag: String = "review_empty_state_title"
const val reviewCurrentCardTag: String = "review_current_card"
const val reviewCurrentCardFrontContentTag: String = "review_current_card_front_content"

internal val reviewBottomOverlayBottomPadding = 12.dp
private val reviewBottomOverlayHorizontalPadding = 16.dp
private val reviewShowAnswerContentBottomPadding = 120.dp
private val reviewAnswerGridContentBottomPadding = 184.dp
private val reviewShowAnswerButtonMinHeight = 64.dp
private val reviewRatingButtonMinHeight = 68.dp
private val reviewMetadataIconSize = 18.dp
private val reviewEditButtonSize = 26.dp
private val reviewEditIconSize = 14.dp
private val reviewTopBarFilterMaxWidth = 160.dp
private val reviewEmptyStateMaxWidth = 420.dp
private val reviewSpeechButtonSize = 32.dp
private val reviewSpeechIconSize = 18.dp

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ReviewTopBar(
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

internal fun reviewContentBottomPadding(hasCurrentCard: Boolean, isAnswerVisible: Boolean): androidx.compose.ui.unit.Dp {
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
internal fun ReviewContent(
    uiState: ReviewUiState,
    activeSpeechSide: ReviewSpeechSide?,
    onOpenCurrentCard: (String) -> Unit,
    onOpenCurrentCardWithAi: (
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>,
        effortLevel: com.flashcardsopensourceapp.data.local.model.EffortLevel
    ) -> Unit,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit,
    onToggleFrontSpeech: () -> Unit,
    onToggleBackSpeech: () -> Unit,
    contentPadding: PaddingValues
) {
    if (uiState.isLoading.not() && uiState.preparedCurrentCard == null && uiState.emptyState != null) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding)
                .testTag(reviewEmptyStateTag)
        ) {
            ActionableEmptyReviewState(
                emptyState = uiState.emptyState,
                onCreateCard = onCreateCard,
                onCreateCardWithAi = onCreateCardWithAi,
                onSwitchToAllCards = onSwitchToAllCards
            )
        }

        return
    }

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
                        activeSpeechSide = activeSpeechSide,
                        onOpenCurrentCard = {
                            uiState.currentCardIdForEditing?.let(onOpenCurrentCard)
                        },
                        onOpenCurrentCardWithAi = {
                            val card = uiState.preparedCurrentCard.card
                            onOpenCurrentCardWithAi(
                                card.cardId,
                                card.frontText,
                                card.backText,
                                card.tags,
                                card.effortLevel
                            )
                        },
                        onToggleFrontSpeech = onToggleFrontSpeech,
                        onToggleBackSpeech = onToggleBackSpeech
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
internal fun LoadingReviewState() {
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

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier
            .widthIn(max = reviewEmptyStateMaxWidth)
            .testTag(reviewEmptyStateContentTag)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.headlineSmall,
                textAlign = TextAlign.Center,
                modifier = Modifier.testTag(reviewEmptyStateTitleTag)
            )
            Text(
                text = body,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center
            )
        }

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
                onClick = onSwitchToAllCards
            ) {
                Text("Switch to all cards")
            }
        }
    }
}

@Composable
private fun ReviewCardContent(
    currentCard: PreparedReviewCardPresentation,
    isAnswerVisible: Boolean,
    activeSpeechSide: ReviewSpeechSide?,
    onOpenCurrentCard: () -> Unit,
    onOpenCurrentCardWithAi: () -> Unit,
    onToggleFrontSpeech: () -> Unit,
    onToggleBackSpeech: () -> Unit
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

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
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
        }

        Card(
            modifier = Modifier
                .fillMaxWidth()
                .testTag(reviewCurrentCardTag)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.padding(20.dp)
            ) {
                ReviewCardSideSection(
                    label = "Front",
                    content = currentCard.frontContent,
                    contentModifier = Modifier.testTag(reviewCurrentCardFrontContentTag),
                    isSpeechPlaying = activeSpeechSide == ReviewSpeechSide.FRONT,
                    onToggleSpeech = onToggleFrontSpeech,
                    showSpeechButton = currentCard.frontSpeakableText.isNotEmpty(),
                    showAiButton = false,
                    onOpenAi = null
                )
                if (isAnswerVisible) {
                    HorizontalDivider()
                    ReviewCardSideSection(
                        label = "Back",
                        content = currentCard.backContent,
                        contentModifier = Modifier,
                        isSpeechPlaying = activeSpeechSide == ReviewSpeechSide.BACK,
                        onToggleSpeech = onToggleBackSpeech,
                        showSpeechButton = currentCard.backSpeakableText.isNotEmpty(),
                        showAiButton = true,
                        onOpenAi = onOpenCurrentCardWithAi
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
    content: ReviewRenderedContent,
    contentModifier: Modifier,
    isSpeechPlaying: Boolean,
    onToggleSpeech: () -> Unit,
    showSpeechButton: Boolean,
    showAiButton: Boolean,
    onOpenAi: (() -> Unit)?
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
        ReviewRenderedContentView(
            content = content,
            modifier = contentModifier
        )
        if (showSpeechButton || showAiButton) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth()
            ) {
                Spacer(modifier = Modifier.weight(1f))

                if (showSpeechButton) {
                    FilledIconButton(
                        onClick = onToggleSpeech,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = if (isSpeechPlaying) {
                                MaterialTheme.colorScheme.surfaceContainerHighest
                            } else {
                                MaterialTheme.colorScheme.surfaceContainer
                            },
                            contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                        ),
                        modifier = Modifier.size(reviewSpeechButtonSize)
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.VolumeUp,
                            contentDescription = if (isSpeechPlaying) {
                                "Stop $label speech"
                            } else {
                                "Speak $label"
                            },
                            modifier = Modifier.size(reviewSpeechIconSize)
                        )
                    }
                }

                if (showAiButton) {
                    val openAi = checkNotNull(onOpenAi)
                    FilledIconButton(
                        onClick = openAi,
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        ),
                        modifier = Modifier
                            .size(reviewSpeechButtonSize)
                            .testTag(reviewAiCardButtonTag)
                    ) {
                        Text(
                            text = "AI",
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            maxLines = 1
                        )
                    }
                }
            }
        }
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
internal fun ReviewBottomActionOverlay(
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
internal fun ReviewFilterSheet(
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
internal fun StaticEmptyReviewState(title: String, body: String) {
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
internal fun PreviewSectionSeparator(title: String) {
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
internal fun PreviewCardRow(
    item: ReviewPreviewListItem.CardEntry,
    onOpenCard: (String) -> Unit
) {
    val previewCard = item.presentation

    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (item.isCurrent) {
                MaterialTheme.colorScheme.secondaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            }
        ),
        modifier = Modifier
            .fillMaxWidth()
            .clickable {
                onOpenCard(previewCard.card.cardId)
            }
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Row(
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = previewCard.card.frontText,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.weight(1f)
                )
                if (item.isCurrent) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary.copy(alpha = 0.12f),
                        contentColor = MaterialTheme.colorScheme.primary,
                        shape = MaterialTheme.shapes.large
                    ) {
                        Text(
                            text = "Current",
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        )
                    }
                }
            }

            Text(
                text = previewCard.backText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis
            )

            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                PreviewMetadataItem(
                    icon = Icons.Outlined.AccessTime,
                    label = previewCard.dueLabel
                )
                PreviewMetadataItem(
                    icon = Icons.Outlined.Timer,
                    label = previewCard.effortLabel
                )
                PreviewMetadataItem(
                    icon = Icons.AutoMirrored.Outlined.Label,
                    label = previewCard.tagsLabel
                )
            }
        }
    }
}

@Composable
private fun PreviewMetadataItem(
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
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
internal fun PreviewErrorCard(
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
