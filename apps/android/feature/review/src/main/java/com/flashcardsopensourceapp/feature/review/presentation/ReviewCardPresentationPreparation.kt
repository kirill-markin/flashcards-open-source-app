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

    return PreparedReviewCardPresentation(
        card = card,
        tagsLabel = textProvider.tagsLabel(tags = card.tags),
        dueLabel = textProvider.dueLabel(dueAtMillis = card.dueAtMillis),
        repsLabel = textProvider.repsLabel(reps = card.reps),
        lapsesLabel = textProvider.lapsesLabel(lapses = card.lapses),
        frontContent = makeReviewRenderedContent(
            text = card.frontText,
            mediaAssetsById = mediaAssetsById
        ),
        backContent = makeReviewRenderedContent(
            text = normalizedBackText,
            mediaAssetsById = mediaAssetsById
        ),
        frontSpeakableText = makeReviewSpeakableText(text = card.frontText),
        backSpeakableText = makeReviewSpeakableText(text = card.backText),
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

    return presentation.copy(
        frontContent = makeReviewRenderedContent(
            text = card.frontText,
            mediaAssetsById = mediaAssetsById
        ),
        backContent = makeReviewRenderedContent(
            text = normalizedBackText,
            mediaAssetsById = mediaAssetsById
        ),
        frontSpeakableText = makeReviewSpeakableText(text = card.frontText),
        backSpeakableText = makeReviewSpeakableText(text = card.backText)
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
