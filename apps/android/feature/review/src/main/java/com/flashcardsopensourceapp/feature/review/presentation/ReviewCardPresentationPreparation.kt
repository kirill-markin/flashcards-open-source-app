package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.review.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCardQueueStatus

fun prepareReviewCardPresentation(
    card: ReviewCard,
    answerOptions: List<ReviewAnswerOption>,
    mediaAssetsById: Map<String, MediaAsset>,
    textProvider: ReviewTextProvider
): PreparedReviewCardPresentation {
    val normalizedBackText: String = if (card.backText.trim().isEmpty()) {
        textProvider.emptyBackTextPlaceholder()
    } else {
        card.backText
    }
    val preparedFrontContent: PreparedReviewContent = prepareReviewContent(
        text = card.frontText,
        mediaAssetsById = mediaAssetsById
    )
    val preparedBackContent: PreparedReviewContent = prepareReviewContent(
        text = normalizedBackText,
        mediaAssetsById = mediaAssetsById
    )

    return PreparedReviewCardPresentation(
        card = card,
        tagsLabel = textProvider.tagsLabel(tags = card.tags),
        dueLabel = textProvider.dueLabel(dueAtMillis = card.dueAtMillis),
        repsLabel = textProvider.repsLabel(reps = card.reps),
        lapsesLabel = textProvider.lapsesLabel(lapses = card.lapses),
        frontContent = preparedFrontContent.renderedContent,
        backContent = preparedBackContent.renderedContent,
        frontSpeakableText = preparedFrontContent.speakableText,
        backSpeakableText = if (card.backText.trim().isEmpty()) {
            ""
        } else {
            preparedBackContent.speakableText
        },
        answerOptions = answerOptions.map { option ->
            PreparedReviewAnswerOption(
                rating = option.rating,
                intervalDescription = textProvider.intervalDescription(
                    intervalDescription = option.intervalDescription
                )
            )
        }
    )
}

fun refreshPreparedReviewCardPresentationMedia(
    presentation: PreparedReviewCardPresentation,
    mediaAssetsById: Map<String, MediaAsset>,
    textProvider: ReviewTextProvider
): PreparedReviewCardPresentation {
    val card: ReviewCard = presentation.card
    val normalizedBackText: String = if (card.backText.trim().isEmpty()) {
        textProvider.emptyBackTextPlaceholder()
    } else {
        card.backText
    }
    val preparedFrontContent: PreparedReviewContent = prepareReviewContent(
        text = card.frontText,
        mediaAssetsById = mediaAssetsById
    )
    val preparedBackContent: PreparedReviewContent = prepareReviewContent(
        text = normalizedBackText,
        mediaAssetsById = mediaAssetsById
    )

    return presentation.copy(
        frontContent = preparedFrontContent.renderedContent,
        backContent = preparedBackContent.renderedContent,
        frontSpeakableText = preparedFrontContent.speakableText,
        backSpeakableText = if (card.backText.trim().isEmpty()) {
            ""
        } else {
            preparedBackContent.speakableText
        }
    )
}

fun prepareReviewPreviewCardPresentation(
    card: ReviewCard,
    textProvider: ReviewTextProvider
): PreparedReviewPreviewCardPresentation {
    return PreparedReviewPreviewCardPresentation(
        card = card,
        tagsLabel = textProvider.tagsLabel(tags = card.tags),
        dueLabel = textProvider.dueLabel(dueAtMillis = card.dueAtMillis),
        backText = card.backText
    )
}

fun buildReviewPreviewItems(
    cards: List<ReviewCard>,
    currentCardId: String?,
    textProvider: ReviewTextProvider
): List<ReviewPreviewListItem> {
    val visibleCards: List<ReviewCard> = cards.filter { card ->
        card.queueStatus != ReviewCardQueueStatus.RATED
    }
    val firstFutureCardId: String? = visibleCards.firstOrNull { card ->
        card.queueStatus == ReviewCardQueueStatus.FUTURE
    }?.cardId

    return buildList {
        visibleCards.forEach { card ->
            if (card.cardId == firstFutureCardId) {
                add(
                    ReviewPreviewListItem.SectionHeader(
                        itemId = "section-future",
                        title = textProvider.laterSectionTitle()
                    )
                )
            }

            add(
                ReviewPreviewListItem.CardEntry(
                    presentation = prepareReviewPreviewCardPresentation(
                        card = card,
                        textProvider = textProvider
                    ),
                    isCurrent = currentCardId == card.cardId
                )
            )
        }
    }
}
