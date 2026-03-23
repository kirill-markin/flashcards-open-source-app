package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewPresentationTest {
    @Test
    fun classifyReviewContentPresentationReturnsShortPlainForShortOneLineText() {
        assertEquals(
            ReviewContentPresentationMode.SHORT_PLAIN,
            classifyReviewContentPresentation(text = "Hola")
        )
    }

    @Test
    fun classifyReviewContentPresentationReturnsParagraphPlainForMultilinePlainText() {
        assertEquals(
            ReviewContentPresentationMode.PARAGRAPH_PLAIN,
            classifyReviewContentPresentation(text = "First line\nSecond line")
        )
    }

    @Test
    fun classifyReviewContentPresentationReturnsRichForInlineCode() {
        assertEquals(
            ReviewContentPresentationMode.RICH,
            classifyReviewContentPresentation(text = "Use `map` here")
        )
    }

    @Test
    fun classifyReviewContentPresentationReturnsRichForFencedCodeBlock() {
        assertEquals(
            ReviewContentPresentationMode.RICH,
            classifyReviewContentPresentation(text = "```kotlin\nval value = 1\n```")
        )
    }

    @Test
    fun classifyReviewContentPresentationKeepsHeadingInRichPath() {
        assertEquals(
            ReviewContentPresentationMode.RICH,
            classifyReviewContentPresentation(text = "# Heading")
        )
    }

    @Test
    fun prepareReviewCardPresentationUsesPlaceholderForBlankBackText() {
        val presentation = prepareReviewCardPresentation(
            card = sampleCard(backText = "   ", queueStatus = ReviewCardQueueStatus.ACTIVE),
            answerOptions = listOf(
                ReviewAnswerOption(
                    rating = ReviewRating.GOOD,
                    intervalDescription = "in 3 days"
                )
            )
        )

        assertEquals(emptyReviewBackTextPlaceholder, reviewRenderedContentDebugText(presentation.backContent))
        assertEquals(1, presentation.answerOptions.size)
    }

    @Test
    fun buildReviewPreviewItemsGroupsFutureAndRatedSections() {
        val items = buildReviewPreviewItems(
            cards = listOf(
                sampleCard(cardId = "card-1", queueStatus = ReviewCardQueueStatus.ACTIVE),
                sampleCard(cardId = "card-2", queueStatus = ReviewCardQueueStatus.FUTURE),
                sampleCard(cardId = "card-3", queueStatus = ReviewCardQueueStatus.RATED)
            ),
            currentCardId = "card-1"
        )

        assertEquals(
            listOf(
                "card-1",
                "section-future",
                "card-2",
                "section-rated",
                "card-3"
            ),
            items.map { item -> item.itemId }
        )
        assertTrue((items.first() as ReviewPreviewListItem.CardEntry).isCurrent)
        assertTrue((items[2] as ReviewPreviewListItem.CardEntry).isFuture)
        assertTrue((items.last() as ReviewPreviewListItem.CardEntry).isAlreadyRated)
    }

    private fun sampleCard(
        cardId: String = "card-1",
        backText: String = "Back",
        queueStatus: ReviewCardQueueStatus
    ): ReviewCard {
        return ReviewCard(
            cardId = cardId,
            frontText = "Front",
            backText = backText,
            tags = listOf("android"),
            effortLevel = EffortLevel.FAST,
            createdAtMillis = 1L,
            queueStatus = queueStatus
        )
    }
}
