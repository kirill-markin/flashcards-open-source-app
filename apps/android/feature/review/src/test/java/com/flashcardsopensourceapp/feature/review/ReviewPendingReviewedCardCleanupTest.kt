package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewPendingReviewedCardCleanupTest {
    @Test
    fun pendingCleanupRemovesOnlyMatchingCardVersionAndDoesNotGrowAcrossSuccessfulReviews() {
        val staleReviewedCard = PendingReviewedCard(
            cardId = "reviewed-card",
            updatedAtMillis = 1L
        )
        val matchingReviewedCard = PendingReviewedCard(
            cardId = "reviewed-card",
            updatedAtMillis = 2L
        )
        val otherReviewedCard = PendingReviewedCard(
            cardId = "other-card",
            updatedAtMillis = 2L
        )
        val retainedPendingCards = setOf(staleReviewedCard, otherReviewedCard)

        assertEquals(
            retainedPendingCards,
            clearPendingReviewedCard(
                pendingReviewedCards = retainedPendingCards + matchingReviewedCard,
                pendingReviewedCard = matchingReviewedCard
            )
        )

        var pendingReviewedCards = retainedPendingCards
        repeat(times = 32) { index ->
            val reviewedCard = PendingReviewedCard(
                cardId = "session-card-$index",
                updatedAtMillis = index.toLong()
            )
            pendingReviewedCards = clearPendingReviewedCard(
                pendingReviewedCards = pendingReviewedCards + reviewedCard,
                pendingReviewedCard = reviewedCard
            )

            assertEquals(retainedPendingCards, pendingReviewedCards)
        }
    }
}
