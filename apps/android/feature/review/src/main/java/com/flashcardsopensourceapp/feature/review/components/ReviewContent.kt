package com.flashcardsopensourceapp.feature.review

import android.content.ClipData
import android.content.ClipboardManager
import android.os.Build
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.automirrored.outlined.VolumeUp
import androidx.compose.material.icons.outlined.Autorenew
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LocalMinimumInteractiveComponentSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import java.text.NumberFormat

private val reviewShowAnswerContentBottomPadding = 120.dp
private val reviewAnswerGridContentBottomPadding = 184.dp
private val reviewEmptyStateMaxWidth = 420.dp
// Every card, tagged or not, gets the standard Material chip height so the card never shifts between them.
private val reviewMetadataLineMinHeight = AssistChipDefaults.Height
private val reviewTagChipSpacing = 6.dp
private val reviewRepetitionIconSize = 16.dp
private val reviewSpeechButtonSize = 32.dp
private val reviewSpeechIconSize = 18.dp
private val reviewCurrentCardCornerRadius = 12.dp

private enum class ReviewTextSelectionSide {
    FRONT,
    BACK
}

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
        tags: List<String>
    ) -> Unit,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit,
    reviewImagePreparer: ReviewImagePreparer,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl,
    onConsumeRelocationTarget: (String?, Boolean) -> ReviewRelocationTarget?,
    onToggleFrontSpeech: () -> Unit,
    onToggleBackSpeech: () -> Unit,
    onRequestTagFilter: (String) -> Unit,
    onOpenTags: () -> Unit,
    modifier: Modifier,
    contentPadding: PaddingValues
) {
    val currentCard = uiState.preparedCurrentCard?.card
    val contentEndPadding = contentPadding.calculateEndPadding(layoutDirection = LocalLayoutDirection.current)
    val presentedCardId: String? = if (uiState.isLoading) {
        null
    } else {
        uiState.preparedCurrentCard?.card?.cardId
    }
    val frontBringIntoViewRequester = remember { BringIntoViewRequester() }
    val backBringIntoViewRequester = remember { BringIntoViewRequester() }
    var textSelectionSide by remember(
        presentedCardId,
        currentCard?.frontText,
        currentCard?.backText,
        uiState.isAnswerVisible
    ) {
        mutableStateOf<ReviewTextSelectionSide?>(value = null)
    }

    LaunchedEffect(presentedCardId, uiState.isAnswerVisible) {
        when (
            onConsumeRelocationTarget(
                presentedCardId,
                uiState.isAnswerVisible
            )
        ) {
            ReviewRelocationTarget.FRONT -> frontBringIntoViewRequester.bringIntoView()
            ReviewRelocationTarget.BACK -> backBringIntoViewRequester.bringIntoView()
            null -> Unit
        }
    }

    if (uiState.isLoading.not() && uiState.preparedCurrentCard == null && uiState.emptyState != null) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = modifier
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
        modifier = modifier.fillMaxSize()
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
                                card.tags
                            )
                        },
                        reviewImagePreparer = reviewImagePreparer,
                        onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl,
                        onToggleFrontSpeech = onToggleFrontSpeech,
                        onToggleBackSpeech = onToggleBackSpeech,
                        onRequestTagFilter = onRequestTagFilter,
                        onOpenTags = onOpenTags,
                        tagsEndBleed = contentEndPadding,
                        onSelectFrontText = {
                            textSelectionSide = ReviewTextSelectionSide.FRONT
                        },
                        onSelectBackText = {
                            textSelectionSide = ReviewTextSelectionSide.BACK
                        },
                        frontBringIntoViewRequester = frontBringIntoViewRequester,
                        backBringIntoViewRequester = backBringIntoViewRequester
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

    val selectedSide = textSelectionSide
    if (currentCard != null && selectedSide != null) {
        ReviewTextSelectionSheet(
            title = stringResource(
                id = when (selectedSide) {
                    ReviewTextSelectionSide.FRONT -> R.string.review_front_label
                    ReviewTextSelectionSide.BACK -> R.string.review_back_label
                }
            ),
            sourceText = when (selectedSide) {
                ReviewTextSelectionSide.FRONT -> currentCard.frontText
                ReviewTextSelectionSide.BACK -> currentCard.backText
            },
            onDismiss = { textSelectionSide = null }
        )
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
    reviewImagePreparer: ReviewImagePreparer,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl,
    onToggleFrontSpeech: () -> Unit,
    onToggleBackSpeech: () -> Unit,
    onRequestTagFilter: (String) -> Unit,
    onOpenTags: () -> Unit,
    tagsEndBleed: Dp,
    onSelectFrontText: () -> Unit,
    onSelectBackText: () -> Unit,
    frontBringIntoViewRequester: BringIntoViewRequester,
    backBringIntoViewRequester: BringIntoViewRequester
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        key(currentCard.card.cardId) {
            ReviewCardTags(
                tags = currentCard.card.tags,
                noTagsLabel = currentCard.tagsLabel,
                endBleed = tagsEndBleed,
                onOpenTags = onOpenTags,
                onRequestTagFilter = onRequestTagFilter
            )
        }

        Card(
            shape = RoundedCornerShape(reviewCurrentCardCornerRadius),
            modifier = Modifier
                .fillMaxWidth()
                .testTag(reviewCurrentCardTag)
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(20.dp),
                modifier = Modifier.padding(20.dp)
            ) {
                ReviewCardSideSection(
                    cardId = currentCard.card.cardId,
                    label = stringResource(id = R.string.review_front_label),
                    content = currentCard.frontContent,
                    sourceText = currentCard.card.frontText,
                    copyButtonTag = reviewCopyFrontTextButtonTag,
                    sectionModifier = Modifier,
                    labelModifier = Modifier
                        .bringIntoViewRequester(frontBringIntoViewRequester)
                        .testTag(reviewSelectFrontTextButtonTag),
                    onSelectText = onSelectFrontText,
                    contentModifier = Modifier.testTag(reviewCurrentCardFrontContentTag),
                    reviewImagePreparer = reviewImagePreparer,
                    onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl,
                    isSpeechPlaying = activeSpeechSide == ReviewSpeechSide.FRONT,
                    onToggleSpeech = onToggleFrontSpeech,
                    showSpeechButton = currentCard.frontSpeakableText.isNotEmpty(),
                    repetitionCount = currentCard.card.reps,
                    onEditCard = onOpenCurrentCard,
                    editButtonTag = reviewEditCardButtonTag,
                    showAiButton = false,
                    onOpenAi = null
                )
                if (isAnswerVisible) {
                    HorizontalDivider()
                    ReviewCardSideSection(
                        cardId = currentCard.card.cardId,
                        label = stringResource(id = R.string.review_back_label),
                        content = currentCard.backContent,
                        sourceText = currentCard.card.backText,
                        copyButtonTag = reviewCopyBackTextButtonTag,
                        sectionModifier = Modifier.bringIntoViewRequester(
                            backBringIntoViewRequester
                        ),
                        labelModifier = Modifier.testTag(reviewSelectBackTextButtonTag),
                        onSelectText = onSelectBackText,
                        contentModifier = Modifier,
                        reviewImagePreparer = reviewImagePreparer,
                        onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl,
                        isSpeechPlaying = activeSpeechSide == ReviewSpeechSide.BACK,
                        onToggleSpeech = onToggleBackSpeech,
                        showSpeechButton = currentCard.backSpeakableText.isNotEmpty(),
                        repetitionCount = null,
                        onEditCard = onOpenCurrentCard,
                        editButtonTag = reviewEditBackCardButtonTag,
                        showAiButton = true,
                        onOpenAi = onOpenCurrentCardWithAi
                    )
                }
            }
        }
    }
}

/** Card metadata set in the side label's style, so it sits on the label line without making it taller. */
@Composable
private fun ReviewRepetitionCount(
    reps: Int,
    formattedReps: String
) {
    val isNew = reps == 0
    val displayedReps = if (isNew) {
        stringResource(id = R.string.review_due_new)
    } else {
        formattedReps
    }
    val repetitionContentDescription = stringResource(
        id = R.string.review_repetition_content_description,
        displayedReps
    )
    Row(
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.clearAndSetSemantics {
            contentDescription = repetitionContentDescription
        }
    ) {
        Icon(
            imageVector = Icons.Outlined.Autorenew,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(reviewRepetitionIconSize)
        )
        Text(
            text = displayedReps,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun ReviewCardSideSection(
    cardId: String,
    label: String,
    content: ReviewRenderedContent,
    sourceText: String,
    copyButtonTag: String,
    sectionModifier: Modifier,
    labelModifier: Modifier,
    onSelectText: () -> Unit,
    contentModifier: Modifier,
    reviewImagePreparer: ReviewImagePreparer,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl,
    isSpeechPlaying: Boolean,
    onToggleSpeech: () -> Unit,
    showSpeechButton: Boolean,
    repetitionCount: Int?,
    onEditCard: () -> Unit,
    editButtonTag: String,
    showAiButton: Boolean,
    onOpenAi: (() -> Unit)?
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)
    val selectTextContentDescription = stringResource(
        id = R.string.review_select_text_content_description,
        bidiWrap(text = label, locale = locale)
    )

    val copyContentDescription = stringResource(
        id = R.string.review_copy_markdown_content_description,
        bidiWrap(text = label, locale = locale)
    )
    val copiedMessage = stringResource(id = R.string.review_markdown_copied)
    val clipboardManager = remember(context) {
        checkNotNull(context.getSystemService(ClipboardManager::class.java)) {
            "ClipboardManager is not available."
        }
    }

    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = sectionModifier.fillMaxWidth()
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = labelModifier
                    .clickable(role = Role.Button, onClick = onSelectText)
                    .semantics {
                        contentDescription = selectTextContentDescription
                    }
            )
            if (repetitionCount != null) {
                Spacer(modifier = Modifier.weight(1f))
                ReviewRepetitionCount(
                    reps = repetitionCount,
                    formattedReps = NumberFormat.getIntegerInstance(locale).format(repetitionCount)
                )
            }
        }
        key(cardId) {
            SelectionContainer {
                ReviewRenderedContentView(
                    content = content,
                    reviewImagePreparer = reviewImagePreparer,
                    onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl,
                    modifier = contentModifier
                )
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.fillMaxWidth()
        ) {
            Spacer(modifier = Modifier.weight(1f))

            FilledIconButton(
                onClick = {
                    val markdown: String = reviewSideMarkdownForClipboard(sourceText = sourceText)
                    clipboardManager.setPrimaryClip(ClipData.newPlainText(label, markdown))
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                        Toast.makeText(context, copiedMessage, Toast.LENGTH_SHORT).show()
                    }
                },
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainer,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                ),
                modifier = Modifier
                    .size(reviewSpeechButtonSize)
                    .testTag(copyButtonTag)
            ) {
                Icon(
                    painter = painterResource(id = R.drawable.review_content_copy_rounded),
                    contentDescription = copyContentDescription,
                    modifier = Modifier.size(reviewSpeechIconSize)
                )
            }

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

            FilledIconButton(
                onClick = onEditCard,
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainer,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                ),
                modifier = Modifier
                    .size(reviewSpeechButtonSize)
                    .testTag(editButtonTag)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Edit,
                    contentDescription = stringResource(id = R.string.review_edit_card_content_description),
                    modifier = Modifier.size(reviewSpeechIconSize)
                )
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

/** The tags button stays put while the card's tag chips scroll beside it. */
@Composable
private fun ReviewCardTags(
    tags: List<String>,
    noTagsLabel: String,
    endBleed: Dp,
    onOpenTags: () -> Unit,
    onRequestTagFilter: (String) -> Unit
) {
    // Without this the 48dp minimum would grow the line past the 32dp chip; hit testing still expands taps to 48dp.
    CompositionLocalProvider(LocalMinimumInteractiveComponentSize provides Dp.Unspecified) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(reviewTagChipSpacing),
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = reviewMetadataLineMinHeight)
        ) {
            IconButton(
                onClick = onOpenTags,
                colors = IconButtonDefaults.iconButtonColors(
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant
                ),
                // The line keeps only the glyph's width, so the glyph sits on the content edge as the card's text does;
                // the chip-high button overflows it evenly.
                modifier = Modifier
                    .width(reviewMetadataIconSize)
                    .requiredSize(reviewMetadataLineMinHeight)
                    .testTag(reviewTagsButtonTag)
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.Label,
                    contentDescription = stringResource(id = R.string.review_tags_title),
                    modifier = Modifier.size(reviewMetadataIconSize)
                )
            }
            if (tags.isEmpty()) {
                Text(
                    text = noTagsLabel,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f)
                )
            } else {
                ReviewCardTagChipRow(
                    tags = tags,
                    spacing = reviewTagChipSpacing,
                    endBleed = endBleed,
                    onRequestTagFilter = onRequestTagFilter,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}
