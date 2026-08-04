package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewSubmissionRollbackTest {
    @Test
    fun currentFailedReviewPreservesRollbackAndErrorBehavior() {
        val submittedCard = makePinnedReviewCard(
            cardId = "submitted-current-filter-card",
            tags = listOf("current"),
            updatedAtMillis = 22L
        )
        val submittedPendingCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val currentFilter = ReviewFilter.Tags(tags = listOf("current"))
        val state = makePinnedReviewDraftState(
            requestedFilter = currentFilter,
            presentedCard = null,
            reviewedInSessionCount = 4,
            pendingReviewedCards = setOf(submittedPendingCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )
        val context = makeReviewSubmissionSessionContext(reviewFilter = currentFilter)

        val result = applyFailedReviewSubmission(
            state = state,
            submittedContext = context,
            currentContext = context,
            rollbackCard = submittedCard,
            pendingReviewedCard = submittedPendingCard,
            errorMessage = "Review save failed"
        )

        assertEquals(submittedCard, result.presentedCard)
        assertEquals("Review save failed", result.errorMessage)
        assertEquals(4, result.reviewedInSessionCount)
        assertEquals(emptySet<PendingReviewedCard>(), result.pendingReviewedCards)
    }

    @Test
    fun partiallyResolvedMissingTagFailureRestoresSubmittedCard(): Unit = runBlocking {
        val submittedCard = makePinnedReviewCard(
            cardId = "submitted-partial-tag-card",
            tags = listOf("Alpha"),
            updatedAtMillis = 221L
        )
        val optimisticNextCard = makePinnedReviewCard(
            cardId = "optimistic-partial-tag-next-card",
            tags = listOf("Alpha"),
            updatedAtMillis = 222L
        )
        val pendingReviewedCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val requestedFilter = ReviewFilter.Tags(tags = listOf("Alpha", "missing"))
        val executableFilter = ReviewFilter.Tags(tags = listOf("Alpha"))
        val context = ReviewSubmissionSessionContext(
            requestedFilter = requestedFilter,
            observedRequestedFilter = requestedFilter,
            selectedFilter = executableFilter,
            sessionGeneration = 2L,
            filterGeneration = 3L
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = requestedFilter,
            presentedCard = optimisticNextCard,
            reviewedInSessionCount = 1,
            pendingReviewedCards = setOf(pendingReviewedCard),
            optimisticPreparedCurrentCard = makePreparedReviewCardPresentation(card = optimisticNextCard),
            errorMessage = ""
        )

        val rollbackLookup = resolveFailedReviewSubmissionRollback(
            submittedContext = context,
            currentContextBeforeLookup = context,
            cardId = submittedCard.cardId,
            loadRollbackCard = { selectedFilter: ReviewFilter, cardId: String ->
                assertEquals(executableFilter, selectedFilter)
                assertEquals(submittedCard.cardId, cardId)
                submittedCard
            },
            captureCurrentContext = { context }
        )
        val result = applyFailedReviewSubmission(
            state = state,
            submittedContext = context,
            currentContext = rollbackLookup.currentContext,
            rollbackCard = rollbackLookup.rollbackCard,
            pendingReviewedCard = pendingReviewedCard,
            errorMessage = "Review save failed"
        )

        assertEquals(submittedCard, result.presentedCard)
        assertEquals(null, result.optimisticPreparedCurrentCard)
        assertEquals(emptySet<PendingReviewedCard>(), result.pendingReviewedCards)
        assertEquals("Review save failed", result.errorMessage)
    }

    @Test
    fun currentFailedReviewWithInvalidRollbackCardPreservesPresentationAndSetsError() {
        val submittedCard = makePinnedReviewCard(
            cardId = "submitted-invalid-rollback-card",
            tags = listOf("current"),
            updatedAtMillis = 23L
        )
        val submittedPendingCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val presentedCard = makePinnedReviewCard(
            cardId = "current-canonical-head-card",
            tags = listOf("current"),
            updatedAtMillis = 24L
        )
        val optimisticPreparedCurrentCard = makePreparedReviewCardPresentation(card = presentedCard)
        val currentFilter = ReviewFilter.Tags(tags = listOf("current"))
        val state = makePinnedReviewDraftState(
            requestedFilter = currentFilter,
            presentedCard = presentedCard,
            reviewedInSessionCount = 4,
            pendingReviewedCards = setOf(submittedPendingCard),
            optimisticPreparedCurrentCard = optimisticPreparedCurrentCard,
            errorMessage = ""
        )
        val context = makeReviewSubmissionSessionContext(reviewFilter = currentFilter)

        val result = applyFailedReviewSubmission(
            state = state,
            submittedContext = context,
            currentContext = context,
            rollbackCard = null,
            pendingReviewedCard = submittedPendingCard,
            errorMessage = "Review save failed"
        )

        assertEquals(presentedCard, result.presentedCard)
        assertEquals(optimisticPreparedCurrentCard, result.optimisticPreparedCurrentCard)
        assertEquals("Review save failed", result.errorMessage)
        assertEquals(4, result.reviewedInSessionCount)
        assertEquals(emptySet<PendingReviewedCard>(), result.pendingReviewedCards)
    }

    @Test
    fun failedReviewRollbackLookupRecapturesContextAfterAwaitBeforeApplyingFailure(): Unit = runBlocking {
        val submittedCard = makePinnedReviewCard(
            cardId = "submitted-awaiting-rollback-card",
            tags = listOf("old"),
            updatedAtMillis = 27L
        )
        val submittedPendingCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val retainedOtherCard = PendingReviewedCard(
            cardId = "other-pending-card",
            updatedAtMillis = 27L
        )
        val submittedContext = makeReviewSubmissionSessionContextWithGenerations(
            reviewFilter = ReviewFilter.AllCards,
            sessionGeneration = 8L,
            filterGeneration = 3L
        )
        val staleContext = makeReviewSubmissionSessionContextWithGenerations(
            reviewFilter = ReviewFilter.Tags(tags = listOf("new")),
            sessionGeneration = 8L,
            filterGeneration = 4L
        )
        var currentContext: ReviewSubmissionSessionContext = submittedContext

        val rollbackLookup = resolveFailedReviewSubmissionRollback(
            submittedContext = submittedContext,
            currentContextBeforeLookup = currentContext,
            cardId = submittedCard.cardId,
            loadRollbackCard = { selectedFilter: ReviewFilter, cardId: String ->
                assertEquals(ReviewFilter.AllCards, selectedFilter)
                assertEquals(submittedCard.cardId, cardId)
                currentContext = staleContext
                submittedCard
            },
            captureCurrentContext = { currentContext }
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.Tags(tags = listOf("new")),
            presentedCard = null,
            reviewedInSessionCount = 9,
            pendingReviewedCards = setOf(submittedPendingCard, retainedOtherCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        val result = applyFailedReviewSubmission(
            state = state,
            submittedContext = submittedContext,
            currentContext = rollbackLookup.currentContext,
            rollbackCard = rollbackLookup.rollbackCard,
            pendingReviewedCard = submittedPendingCard,
            errorMessage = "Review save failed"
        )

        assertEquals(staleContext, rollbackLookup.currentContext)
        assertEquals(submittedCard, rollbackLookup.rollbackCard)
        assertEquals(null, result.presentedCard)
        assertEquals("", result.errorMessage)
        assertEquals(9, result.reviewedInSessionCount)
        assertEquals(setOf(retainedOtherCard), result.pendingReviewedCards)
    }

    @Test
    fun failedReviewRollbackLookupErrorStillAllowsPendingCleanup(): Unit = runBlocking {
        val submittedCard = makePinnedReviewCard(
            cardId = "submitted-rollback-lookup-error-card",
            tags = listOf("current"),
            updatedAtMillis = 28L
        )
        val submittedPendingCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val context = makeReviewSubmissionSessionContext(reviewFilter = ReviewFilter.AllCards)
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = null,
            reviewedInSessionCount = 3,
            pendingReviewedCards = setOf(submittedPendingCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        val rollbackLookup = resolveFailedReviewSubmissionRollback(
            submittedContext = context,
            currentContextBeforeLookup = context,
            cardId = submittedCard.cardId,
            loadRollbackCard = { _: ReviewFilter, _: String ->
                throw IllegalStateException("Rollback lookup failed")
            },
            captureCurrentContext = { context }
        )
        val result = applyFailedReviewSubmission(
            state = state,
            submittedContext = context,
            currentContext = rollbackLookup.currentContext,
            rollbackCard = rollbackLookup.rollbackCard,
            pendingReviewedCard = submittedPendingCard,
            errorMessage = "Review save failed"
        )

        assertEquals(context, rollbackLookup.currentContext)
        assertEquals(null, rollbackLookup.rollbackCard)
        assertEquals(emptySet<PendingReviewedCard>(), result.pendingReviewedCards)
        assertEquals("Review save failed", result.errorMessage)
    }
}
