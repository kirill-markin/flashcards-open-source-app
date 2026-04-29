package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.AccessTime
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.EffortLevel

private val reviewShowAnswerContentBottomPadding = 120.dp
private val reviewAnswerGridContentBottomPadding = 184.dp
private val reviewEmptyStateMaxWidth = 420.dp
private val reviewEditButtonSize = 26.dp
private val reviewEditIconSize = 14.dp
private val reviewSpeechButtonSize = 32.dp
private val reviewSpeechIconSize = 18.dp

internal fun reviewContentBottomPadding(hasCurrentCard: Boolean, isAnswerVisible: Boolean): Dp {
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
        effortLevel: EffortLevel
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
