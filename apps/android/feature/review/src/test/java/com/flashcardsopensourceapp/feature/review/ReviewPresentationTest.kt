package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

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
    fun prepareReviewCardPresentationBuildsMetadataLabels() {
        val previousLocale = Locale.getDefault()
        Locale.setDefault(Locale.US)

        try {
            val presentation = prepareReviewCardPresentation(
                card = sampleCard(
                    queueStatus = ReviewCardQueueStatus.ACTIVE,
                    dueAtMillis = 1_700_000_000_000L,
                    reps = 3,
                    lapses = 1
                ),
                answerOptions = emptyList()
            )

            assertEquals("Fast", presentation.effortLabel)
            assertEquals("android", presentation.tagsLabel)
            assertEquals("Reps 3", presentation.repsLabel)
            assertEquals("Lapses 1", presentation.lapsesLabel)
            assertTrue(presentation.dueLabel.isNotBlank())
        } finally {
            Locale.setDefault(previousLocale)
        }
    }

    @Test
    fun prepareReviewPreviewCardPresentationKeepsBlankBackTextAndBuildsMetadataLabels() {
        val previousLocale = Locale.getDefault()
        Locale.setDefault(Locale.US)

        try {
            val presentation = prepareReviewPreviewCardPresentation(
                card = sampleCard(
                    backText = "   ",
                    queueStatus = ReviewCardQueueStatus.ACTIVE,
                    dueAtMillis = 1_700_000_000_000L
                )
            )

            assertEquals("   ", presentation.backText)
            assertEquals("Fast", presentation.effortLabel)
            assertEquals("android", presentation.tagsLabel)
            assertTrue(presentation.dueLabel.isNotBlank())
        } finally {
            Locale.setDefault(previousLocale)
        }
    }

    @Test
    fun buildReviewPreviewItemsHidesRatedCardsAndAddsLaterSeparator() {
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
                "card-2"
            ),
            items.map { item -> item.itemId }
        )
        assertTrue((items.first() as ReviewPreviewListItem.CardEntry).isCurrent)
        assertEquals("Later", (items[1] as ReviewPreviewListItem.SectionHeader).title)
        assertEquals("card-2", (items[2] as ReviewPreviewListItem.CardEntry).presentation.card.cardId)
        assertFalse(
            items.filterIsInstance<ReviewPreviewListItem.CardEntry>().any { item ->
                item.presentation.card.cardId == "card-3"
            }
        )
    }

    private fun sampleCard(
        cardId: String = "card-1",
        backText: String = "Back",
        dueAtMillis: Long? = null,
        reps: Int = 0,
        lapses: Int = 0,
        queueStatus: ReviewCardQueueStatus
    ): ReviewCard {
        return ReviewCard(
            cardId = cardId,
            frontText = "Front",
            backText = backText,
            tags = listOf("android"),
            effortLevel = EffortLevel.FAST,
            dueAtMillis = dueAtMillis,
            createdAtMillis = 1L,
            reps = reps,
            lapses = lapses,
            queueStatus = queueStatus
        )
    }
}
