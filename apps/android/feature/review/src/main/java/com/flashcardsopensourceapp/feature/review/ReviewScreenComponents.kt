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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.EffortLevel

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
            Text(stringResource(id = R.string.review_title))
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
                    Text(
                        text = stringResource(
                            id = R.string.review_progress_fraction,
                            remainingCount,
                            totalCount
                        )
                    )
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
        ReviewEmptyState.NO_CARDS_YET -> stringResource(id = R.string.review_empty_no_cards_title)
        ReviewEmptyState.FILTER_EMPTY -> stringResource(id = R.string.review_empty_filter_title)
        ReviewEmptyState.SESSION_COMPLETE -> stringResource(id = R.string.review_empty_complete_title)
    }
    val body = when (emptyState) {
        ReviewEmptyState.NO_CARDS_YET -> stringResource(id = R.string.review_empty_no_cards_body)
        ReviewEmptyState.FILTER_EMPTY -> stringResource(id = R.string.review_empty_filter_body)
        ReviewEmptyState.SESSION_COMPLETE -> stringResource(id = R.string.review_empty_complete_body)
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
            Text(stringResource(id = R.string.review_create_card))
        }
        Button(
            onClick = onCreateCardWithAi,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(stringResource(id = R.string.review_create_with_ai))
        }
        if (emptyState == ReviewEmptyState.FILTER_EMPTY) {
            TextButton(
                onClick = onSwitchToAllCards
            ) {
                Text(stringResource(id = R.string.review_switch_to_all_cards))
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
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

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
                        contentDescription = stringResource(id = R.string.review_edit_card_content_description),
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
                    label = stringResource(id = R.string.review_front_label),
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
                        label = stringResource(id = R.string.review_back_label),
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
                label = stringResource(
                    id = R.string.review_due_label,
                    bidiWrap(
                        text = currentCard.dueLabel,
                        locale = locale
                    )
                )
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
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

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
                                stringResource(
                                    id = R.string.review_stop_speech,
                                    bidiWrap(
                                        text = label,
                                        locale = locale
                                    )
                                )
                            } else {
                                stringResource(
                                    id = R.string.review_speak,
                                    bidiWrap(
                                        text = label,
                                        locale = locale
                                    )
                                )
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
                        Text(stringResource(id = R.string.review_show_answer))
                    }
                }
            }
        }
    }
}

@Composable
private fun ReviewAnswerButtonGrid(
    answerOptions: List<PreparedReviewAnswerOption>,
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
    val icon: ImageVector
)

private fun reviewRatingPresentation(rating: ReviewRating): ReviewRatingPresentation {
    return when (rating) {
        ReviewRating.AGAIN -> ReviewRatingPresentation(
            icon = Icons.Outlined.Autorenew
        )

        ReviewRating.HARD -> ReviewRatingPresentation(
            icon = Icons.Outlined.HourglassBottom
        )

        ReviewRating.GOOD -> ReviewRatingPresentation(
            icon = Icons.Outlined.CheckCircleOutline
        )

        ReviewRating.EASY -> ReviewRatingPresentation(
            icon = Icons.Outlined.AutoAwesome
        )
    }
}

@Composable
private fun RatingButton(
    option: PreparedReviewAnswerOption,
    onClick: () -> Unit,
    modifier: Modifier
) {
    val presentation = reviewRatingPresentation(rating = option.rating)
    val title = when (option.rating) {
        ReviewRating.AGAIN -> stringResource(id = R.string.review_again)
        ReviewRating.HARD -> stringResource(id = R.string.review_hard)
        ReviewRating.GOOD -> stringResource(id = R.string.review_good)
        ReviewRating.EASY -> stringResource(id = R.string.review_easy)
    }

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
                    text = title,
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
    availableEffortFilters: List<ReviewEffortFilterOption>,
    availableTagFilters: List<ReviewTagFilterOption>,
    onDismiss: () -> Unit,
    onSelectFilter: (ReviewFilter) -> Unit,
    onManageDecks: () -> Unit
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)

    ModalBottomSheet(onDismissRequest = onDismiss) {
        LazyColumn(
            contentPadding = PaddingValues(bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            item {
                Text(
                    text = stringResource(id = R.string.review_scope_title),
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.padding(horizontal = 24.dp)
                )
            }

            item {
                ReviewFilterOptionRow(
                    title = stringResource(id = R.string.review_all_cards),
                    subtitle = stringResource(id = R.string.review_scope_subtitle_all_cards),
                    selected = selectedFilter == ReviewFilter.AllCards,
                    onClick = {
                        onSelectFilter(ReviewFilter.AllCards)
                    }
                )
            }

            if (availableDeckFilters.isNotEmpty()) {
                item {
                    Text(
                        text = stringResource(id = R.string.review_decks_title),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }

                items(availableDeckFilters.size) { index ->
                    val deck = availableDeckFilters[index]
                    ReviewFilterOptionRow(
                        title = stringResource(
                            id = R.string.review_filter_title_with_count,
                            bidiWrap(
                                text = deck.title,
                                locale = locale
                            ),
                            deck.totalCount
                        ),
                        subtitle = stringResource(id = R.string.review_filtered_deck_subtitle),
                        selected = selectedFilter == ReviewFilter.Deck(deckId = deck.deckId),
                        onClick = {
                            onSelectFilter(ReviewFilter.Deck(deckId = deck.deckId))
                        }
                    )
                }
            }

            item {
                Text(
                    text = stringResource(id = R.string.review_effort_title),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                )
            }

            items(availableEffortFilters.size) { index ->
                val effortFilter = availableEffortFilters[index]
                ReviewFilterOptionRow(
                    title = stringResource(
                        id = R.string.review_filter_title_with_count,
                        bidiWrap(
                            text = reviewEffortLabel(effortLevel = effortFilter.effortLevel),
                            locale = locale
                        ),
                        effortFilter.totalCount
                    ),
                    subtitle = stringResource(id = R.string.review_virtual_effort_filter_subtitle),
                    selected = selectedFilter == ReviewFilter.Effort(effortLevel = effortFilter.effortLevel),
                    onClick = {
                        onSelectFilter(ReviewFilter.Effort(effortLevel = effortFilter.effortLevel))
                    }
                )
            }

            if (availableTagFilters.isNotEmpty()) {
                item {
                    Text(
                        text = stringResource(id = R.string.review_tags_title),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp)
                    )
                }

                items(availableTagFilters.size) { index ->
                    val tag = availableTagFilters[index]
                    ReviewFilterOptionRow(
                        title = stringResource(
                            id = R.string.review_filter_title_with_count,
                            bidiWrap(
                                text = tag.tag,
                                locale = locale
                            ),
                            tag.totalCount
                        ),
                        subtitle = stringResource(id = R.string.review_workspace_tag_subtitle),
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
                    Text(stringResource(id = R.string.review_manage_filtered_decks))
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
                            text = stringResource(id = R.string.review_current_chip),
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
                text = stringResource(id = R.string.review_queue_load_failed_title),
                style = MaterialTheme.typography.titleMedium
            )
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            TextButton(onClick = onRetry) {
                Text(stringResource(id = R.string.review_retry))
            }
        }
    }
}

@Composable
private fun reviewEffortLabel(effortLevel: EffortLevel): String {
    return when (effortLevel) {
        EffortLevel.FAST -> stringResource(id = R.string.review_fast)
        EffortLevel.MEDIUM -> stringResource(id = R.string.review_medium)
        EffortLevel.LONG -> stringResource(id = R.string.review_long)
    }
}
