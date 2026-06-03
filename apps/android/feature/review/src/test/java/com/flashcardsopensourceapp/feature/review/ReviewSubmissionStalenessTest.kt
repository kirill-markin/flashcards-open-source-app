package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ReviewSubmissionStalenessTest {
    @Test
    fun staleFailedReviewAfterFilterChangeClearsPendingMarkerWithoutPresentingOldCard() {
        val submittedCard = makePinnedReviewCard(
            cardId = "submitted-old-filter-card",
            tags = listOf("old"),
            updatedAtMillis = 20L
        )
        val submittedPendingCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val retainedStaleVersion = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = 19L
        )
        val retainedOtherCard = PendingReviewedCard(
            cardId = "other-pending-card",
            updatedAtMillis = 20L
        )
        val newFilter = ReviewFilter.Tag(tag = "new")
        val state = makePinnedReviewDraftState(
            requestedFilter = newFilter,
            presentedCard = null,
            reviewedInSessionCount = 3,
            pendingReviewedCards = setOf(
                retainedStaleVersion,
                submittedPendingCard,
                retainedOtherCard
            ),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        val result = applyFailedReviewSubmission(
            state = state,
            submittedContext = makeReviewSubmissionSessionContext(
                reviewFilter = ReviewFilter.Tag(tag = "old")
            ),
            currentContext = makeReviewSubmissionSessionContext(
                reviewFilter = newFilter
            ),
            rollbackCard = submittedCard,
            pendingReviewedCard = submittedPendingCard,
            errorMessage = "Review save failed"
        )

        assertEquals(null, result.presentedCard)
        assertEquals("", result.errorMessage)
        assertEquals(3, result.reviewedInSessionCount)
        assertEquals(
            setOf(retainedStaleVersion, retainedOtherCard),
            result.pendingReviewedCards
        )
    }

    @Test
    fun staleFailedReviewAfterSameFilterSessionChangeOnlyClearsPendingMarker() {
        val submittedCard = makePinnedReviewCard(
            cardId = "submitted-same-filter-stale-session-card",
            tags = listOf("shared"),
            updatedAtMillis = 25L
        )
        val submittedPendingCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val retainedOtherCard = PendingReviewedCard(
            cardId = "other-pending-card",
            updatedAtMillis = 25L
        )
        val filter = ReviewFilter.Deck(deckId = "same-deck-filter")
        val presentedCard = makePinnedReviewCard(
            cardId = "current-session-card",
            tags = listOf("shared"),
            updatedAtMillis = 26L
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = filter,
            presentedCard = presentedCard,
            reviewedInSessionCount = 6,
            pendingReviewedCards = setOf(submittedPendingCard, retainedOtherCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        val result = applyFailedReviewSubmission(
            state = state,
            submittedContext = makeReviewSubmissionSessionContextWithGeneration(
                reviewFilter = filter,
                sessionGeneration = 10L
            ),
            currentContext = makeReviewSubmissionSessionContextWithGeneration(
                reviewFilter = filter,
                sessionGeneration = 11L
            ),
            rollbackCard = submittedCard,
            pendingReviewedCard = submittedPendingCard,
            errorMessage = "Review save failed"
        )

        assertEquals(presentedCard, result.presentedCard)
        assertEquals("", result.errorMessage)
        assertEquals(6, result.reviewedInSessionCount)
        assertEquals(setOf(retainedOtherCard), result.pendingReviewedCards)
    }

    @Test
    fun staleSuccessfulReviewAfterFilterChangeOnlyClearsPendingMarker() {
        val submittedPendingCard = PendingReviewedCard(
            cardId = "successful-old-filter-card",
            updatedAtMillis = 24L
        )
        val retainedOtherCard = PendingReviewedCard(
            cardId = "other-pending-card",
            updatedAtMillis = 24L
        )
        val newFilter = ReviewFilter.Tag(tag = "new")
        val state = makePinnedReviewDraftState(
            requestedFilter = newFilter,
            presentedCard = null,
            reviewedInSessionCount = 5,
            pendingReviewedCards = setOf(submittedPendingCard, retainedOtherCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        val result = applySuccessfulReviewSubmission(
            state = state,
            submittedContext = makeReviewSubmissionSessionContext(
                reviewFilter = ReviewFilter.Tag(tag = "old")
            ),
            currentContext = makeReviewSubmissionSessionContext(
                reviewFilter = newFilter
            ),
            pendingReviewedCard = submittedPendingCard
        )

        assertEquals(null, result.presentedCard)
        assertEquals("", result.errorMessage)
        assertEquals(5, result.reviewedInSessionCount)
        assertEquals(setOf(retainedOtherCard), result.pendingReviewedCards)
    }

    @Test
    fun staleSuccessfulReviewAfterSameFilterSessionChangeOnlyClearsPendingMarker() {
        val submittedPendingCard = PendingReviewedCard(
            cardId = "successful-same-filter-stale-session-card",
            updatedAtMillis = 25L
        )
        val retainedOtherCard = PendingReviewedCard(
            cardId = "other-pending-card",
            updatedAtMillis = 25L
        )
        val filter = ReviewFilter.AllCards
        val state = makePinnedReviewDraftState(
            requestedFilter = filter,
            presentedCard = null,
            reviewedInSessionCount = 7,
            pendingReviewedCards = setOf(submittedPendingCard, retainedOtherCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        val result = applySuccessfulReviewSubmission(
            state = state,
            submittedContext = makeReviewSubmissionSessionContextWithGeneration(
                reviewFilter = filter,
                sessionGeneration = 20L
            ),
            currentContext = makeReviewSubmissionSessionContextWithGeneration(
                reviewFilter = filter,
                sessionGeneration = 21L
            ),
            pendingReviewedCard = submittedPendingCard
        )

        assertEquals(null, result.presentedCard)
        assertEquals("", result.errorMessage)
        assertEquals(7, result.reviewedInSessionCount)
        assertEquals(setOf(retainedOtherCard), result.pendingReviewedCards)
    }

    @Test
    fun allCardsTagAllCardsFilterGenerationCollisionMakesOldSubmissionStale() {
        val submittedPendingCard = PendingReviewedCard(
            cardId = "successful-all-cards-generation-card",
            updatedAtMillis = 29L
        )
        val retainedOtherCard = PendingReviewedCard(
            cardId = "other-pending-card",
            updatedAtMillis = 29L
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = null,
            reviewedInSessionCount = 2,
            pendingReviewedCards = setOf(submittedPendingCard, retainedOtherCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        val result = applySuccessfulReviewSubmission(
            state = state,
            submittedContext = makeReviewSubmissionSessionContextWithGenerations(
                reviewFilter = ReviewFilter.AllCards,
                sessionGeneration = 12L,
                filterGeneration = 1L
            ),
            currentContext = makeReviewSubmissionSessionContextWithGenerations(
                reviewFilter = ReviewFilter.AllCards,
                sessionGeneration = 12L,
                filterGeneration = 3L
            ),
            pendingReviewedCard = submittedPendingCard
        )

        assertFalse(
            isCurrentReviewSubmissionContext(
                submittedContext = makeReviewSubmissionSessionContextWithGenerations(
                    reviewFilter = ReviewFilter.AllCards,
                    sessionGeneration = 12L,
                    filterGeneration = 1L
                ),
                currentContext = makeReviewSubmissionSessionContextWithGenerations(
                    reviewFilter = ReviewFilter.AllCards,
                    sessionGeneration = 12L,
                    filterGeneration = 3L
                )
            )
        )
        assertEquals(null, result.presentedCard)
        assertEquals("", result.errorMessage)
        assertEquals(2, result.reviewedInSessionCount)
        assertEquals(setOf(retainedOtherCard), result.pendingReviewedCards)
    }
}
