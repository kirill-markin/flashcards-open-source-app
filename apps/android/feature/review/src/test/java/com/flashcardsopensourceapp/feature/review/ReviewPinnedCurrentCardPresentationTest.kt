package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.buildBoundedReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private const val pinnedReviewWorkspaceId: String = "workspace-review-pinned-current"
private const val pinnedReviewNowMillis: Long = 3_600_000L
private const val pinnedReviewOneHourMillis: Long = 60L * 60L * 1_000L
private const val pinnedReviewOneDayMillis: Long = 24L * 60L * 60L * 1_000L

class ReviewPinnedCurrentCardPresentationTest {
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
        val currentFilter = ReviewFilter.Tag(tag = "current")
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
        val currentFilter = ReviewFilter.Tag(tag = "current")
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
            reviewFilter = ReviewFilter.Tag(tag = "new"),
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
            requestedFilter = ReviewFilter.Tag(tag = "new"),
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

    @Test
    fun sameFilterForegroundSessionChangeAdvancesGenerationWithoutPresentedCardChange() {
        val currentCard = makePinnedReviewCard(
            cardId = "same-presented-card",
            tags = listOf("shared"),
            updatedAtMillis = 30L
        )
        val previousSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(currentCard),
            presentedCard = currentCard,
            dueCount = 1,
            remainingCount = 1,
            totalCount = 1,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "shared",
                    totalCount = 1
                )
            )
        )
        val nextSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(currentCard),
            presentedCard = currentCard,
            dueCount = 2,
            remainingCount = 2,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "shared",
                    totalCount = 2
                )
            )
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = currentCard,
            reviewedInSessionCount = 0,
            pendingReviewedCards = emptySet(),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )

        assertTrue(
            shouldAdvanceReviewSessionGeneration(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = emptyMap()
            )
        )
    }

    @Test
    fun ownedOptimisticAdvanceDoesNotAdvanceGeneration() {
        val submittedCard = makePinnedReviewCard(
            cardId = "owned-submitted-card",
            tags = listOf("owned"),
            updatedAtMillis = 40L
        )
        val nextCard = makePinnedReviewCard(
            cardId = "owned-next-card",
            tags = listOf("owned"),
            updatedAtMillis = 41L
        )
        val pendingReviewedCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val previousSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(submittedCard, nextCard),
            presentedCard = submittedCard,
            dueCount = 2,
            remainingCount = 2,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "owned",
                    totalCount = 2
                )
            )
        )
        val nextSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(nextCard),
            presentedCard = nextCard,
            dueCount = 2,
            remainingCount = 1,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "owned",
                    totalCount = 2
                )
            )
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = nextCard,
            reviewedInSessionCount = 0,
            pendingReviewedCards = setOf(pendingReviewedCard),
            optimisticPreparedCurrentCard = makePreparedReviewCardPresentation(card = nextCard),
            errorMessage = ""
        )

        val ownedReviewSubmissions = mapOf(
            pendingReviewedCard to makeOwnedReviewSubmission(
                pendingReviewedCard = pendingReviewedCard,
                reviewedCard = submittedCard,
                presentedCard = nextCard,
                observationState = OwnedReviewSubmissionObservationState.LOCAL_WRITE_PENDING
            )
        )
        val suppression = requireNotNull(
            findOwnedReviewSessionObservationSuppression(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )

        assertFalse(
            shouldAdvanceReviewSessionGeneration(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )
        assertEquals(emptySet<PendingReviewedCard>(), suppression.consumedPendingReviewedCards)
    }

    @Test
    fun ownedLocalReviewWriteDoesNotAdvanceGenerationAfterSuccessCleanup() {
        val submittedCard = makePinnedReviewCard(
            cardId = "owned-written-card",
            tags = listOf("owned"),
            updatedAtMillis = 42L
        )
        val nextCard = makePinnedReviewCard(
            cardId = "owned-written-next-card",
            tags = listOf("owned"),
            updatedAtMillis = 43L
        )
        val pendingReviewedCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val previousSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(nextCard),
            presentedCard = nextCard,
            dueCount = 2,
            remainingCount = 1,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "owned",
                    totalCount = 2
                )
            )
        )
        val nextSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(nextCard),
            presentedCard = nextCard,
            dueCount = 1,
            remainingCount = 1,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "owned",
                    totalCount = 1
                )
            )
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = nextCard,
            reviewedInSessionCount = 0,
            pendingReviewedCards = emptySet(),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )
        val ownedReviewSubmissions = mapOf(
            pendingReviewedCard to makeOwnedReviewSubmission(
                pendingReviewedCard = pendingReviewedCard,
                reviewedCard = submittedCard,
                presentedCard = nextCard,
                observationState = OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
            )
        )
        val suppression = requireNotNull(
            findOwnedReviewSessionObservationSuppression(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )

        assertFalse(
            shouldAdvanceReviewSessionGeneration(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )
        assertEquals(setOf(pendingReviewedCard), suppression.consumedPendingReviewedCards)
    }

    @Test
    fun localWritePendingMarkerDoesNotSuppressExternalDueDropWithUnchangedQueue() {
        val submittedCard = makePinnedReviewCard(
            cardId = "local-write-pending-card",
            tags = listOf("owned"),
            updatedAtMillis = 47L
        )
        val currentCard = makePinnedReviewCard(
            cardId = "unchanged-current-card",
            tags = listOf("current"),
            updatedAtMillis = 48L
        )
        val pendingReviewedCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val previousSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(currentCard),
            presentedCard = currentCard,
            dueCount = 2,
            remainingCount = 1,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "owned",
                    totalCount = 1
                )
            )
        )
        val nextSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(currentCard),
            presentedCard = currentCard,
            dueCount = 1,
            remainingCount = 1,
            totalCount = 2,
            availableTagFilters = emptyList()
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = currentCard,
            reviewedInSessionCount = 0,
            pendingReviewedCards = setOf(pendingReviewedCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )
        val ownedReviewSubmissions = mapOf(
            pendingReviewedCard to makeOwnedReviewSubmission(
                pendingReviewedCard = pendingReviewedCard,
                reviewedCard = submittedCard,
                presentedCard = currentCard,
                observationState = OwnedReviewSubmissionObservationState.LOCAL_WRITE_PENDING
            )
        )

        assertEquals(
            null,
            findOwnedReviewSessionObservationSuppression(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )
        assertTrue(
            shouldAdvanceReviewSessionGeneration(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )
    }

    @Test
    fun rapidOwnedReviewMatchesLaterOwnedSubmissionWhenFirstMarkerDoesNotExplainTransition() {
        val firstSubmittedCard = makePinnedReviewCard(
            cardId = "rapid-first-card",
            tags = listOf("rapid"),
            updatedAtMillis = 44L
        )
        val secondSubmittedCard = makePinnedReviewCard(
            cardId = "rapid-second-card",
            tags = listOf("rapid"),
            updatedAtMillis = 45L
        )
        val nextCard = makePinnedReviewCard(
            cardId = "rapid-next-card",
            tags = listOf("rapid"),
            updatedAtMillis = 46L
        )
        val firstPendingCard = PendingReviewedCard(
            cardId = firstSubmittedCard.cardId,
            updatedAtMillis = firstSubmittedCard.updatedAtMillis
        )
        val secondPendingCard = PendingReviewedCard(
            cardId = secondSubmittedCard.cardId,
            updatedAtMillis = secondSubmittedCard.updatedAtMillis
        )
        val previousSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(secondSubmittedCard, nextCard),
            presentedCard = secondSubmittedCard,
            dueCount = 3,
            remainingCount = 2,
            totalCount = 3,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "rapid",
                    totalCount = 3
                )
            )
        )
        val nextSignature = makeObservedReviewSessionSignature(
            reviewCards = listOf(nextCard),
            presentedCard = nextCard,
            dueCount = 3,
            remainingCount = 1,
            totalCount = 3,
            availableTagFilters = listOf(
                ReviewTagFilterOption(
                    tag = "rapid",
                    totalCount = 3
                )
            )
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = nextCard,
            reviewedInSessionCount = 0,
            pendingReviewedCards = setOf(firstPendingCard, secondPendingCard),
            optimisticPreparedCurrentCard = makePreparedReviewCardPresentation(card = nextCard),
            errorMessage = ""
        )
        val ownedReviewSubmissions = mapOf(
            firstPendingCard to makeOwnedReviewSubmission(
                pendingReviewedCard = firstPendingCard,
                reviewedCard = firstSubmittedCard,
                presentedCard = secondSubmittedCard,
                observationState = OwnedReviewSubmissionObservationState.LOCAL_WRITE_PENDING
            ),
            secondPendingCard to makeOwnedReviewSubmission(
                pendingReviewedCard = secondPendingCard,
                reviewedCard = secondSubmittedCard,
                presentedCard = nextCard,
                observationState = OwnedReviewSubmissionObservationState.LOCAL_WRITE_PENDING
            )
        )
        val suppression = requireNotNull(
            findOwnedReviewSessionObservationSuppression(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )

        assertFalse(
            shouldAdvanceReviewSessionGeneration(
                previousSignature = previousSignature,
                nextSignature = nextSignature,
                state = state,
                ownedReviewSubmissions = ownedReviewSubmissions
            )
        )
        assertEquals(emptySet<PendingReviewedCard>(), suppression.consumedPendingReviewedCards)
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

    @Test
    fun sameFilterSelectionDoesNotAdvanceFilterGeneration() {
        val currentGeneration = 7L
        val activeFilter = ReviewFilter.Tag(tag = "active")

        assertEquals(
            currentGeneration,
            nextReviewFilterGenerationAfterSelection(
                requestedFilter = activeFilter,
                selectedFilter = activeFilter,
                currentFilterGeneration = currentGeneration
            )
        )
        assertEquals(
            currentGeneration + 1L,
            nextReviewFilterGenerationAfterSelection(
                requestedFilter = activeFilter,
                selectedFilter = ReviewFilter.AllCards,
                currentFilterGeneration = currentGeneration
            )
        )
    }

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

    @Test
    fun pinnedCurrentCardStaysOptionBearingWhenCanonicalQueueMovesItBehindRecentDueCards() {
        val pinnedCard = makePinnedReviewCardSummary(
            cardId = "pinned-old-card",
            dueAtMillis = pinnedReviewNowMillis - pinnedReviewOneHourMillis - 1L,
            createdAtMillis = 400L,
            updatedAtMillis = 400L
        )
        val canonicalCards = listOf(
            makePinnedReviewCardSummary(
                cardId = "recent-due-1115-card",
                dueAtMillis = pinnedReviewNowMillis - (45L * 60L * 1_000L),
                createdAtMillis = 100L,
                updatedAtMillis = 100L
            ),
            makePinnedReviewCardSummary(
                cardId = "recent-due-1155-card",
                dueAtMillis = pinnedReviewNowMillis - (5L * 60L * 1_000L),
                createdAtMillis = 200L,
                updatedAtMillis = 200L
            ),
            makePinnedReviewCardSummary(
                cardId = "null-due-card",
                dueAtMillis = null,
                createdAtMillis = 300L,
                updatedAtMillis = 300L
            )
        )
        val sessionSnapshot = makePinnedReviewSessionSnapshot(
            canonicalCards = canonicalCards,
            presentedCard = pinnedCard,
            dueCount = 4,
            remainingCount = 4,
            totalCount = 4
        )

        assertEquals(
            listOf("recent-due-1115-card", "recent-due-1155-card", "null-due-card"),
            sessionSnapshot.cards.map { card -> card.cardId }
        )
        assertEquals("pinned-old-card", sessionSnapshot.presentedCard?.cardId)
        assertEquals(
            setOf("recent-due-1115-card", "recent-due-1155-card", "pinned-old-card"),
            sessionSnapshot.answerOptionsByCardId.keys
        )

        val displayedCurrentCard = requireNotNull(
            resolveDisplayedCurrentCard(
                sessionCards = sessionSnapshot.cards,
                presentedCard = sessionSnapshot.presentedCard
            )
        )
        val displayedQueue = buildDisplayedReviewQueue(
            sessionCards = sessionSnapshot.cards,
            displayedCurrentCard = displayedCurrentCard
        )
        assertEquals(
            listOf("pinned-old-card", "recent-due-1115-card", "recent-due-1155-card", "null-due-card"),
            displayedQueue.map { card -> card.cardId }
        )

        val pinnedAnswerOptions = requireNotNull(
            resolveDisplayedSessionAnswerOptions(
                displayedCard = displayedCurrentCard,
                answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId
            )
        )
        assertEquals(
            listOf(ReviewRating.AGAIN, ReviewRating.HARD, ReviewRating.GOOD, ReviewRating.EASY),
            pinnedAnswerOptions.map { option -> option.rating }
        )

        val preparedNextAnswerOptions = requireNotNull(
            resolveDisplayedSessionAnswerOptions(
                displayedCard = displayedQueue[1],
                answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId
            )
        )
        assertEquals(sessionSnapshot.answerOptions, preparedNextAnswerOptions)

        val afterAnswerSnapshot = makePinnedReviewSessionSnapshot(
            canonicalCards = canonicalCards,
            presentedCard = canonicalCards.first(),
            dueCount = 4,
            remainingCount = 3,
            totalCount = 4
        )
        val displayedCardAfterAnswer = requireNotNull(
            resolveDisplayedCurrentCard(
                sessionCards = afterAnswerSnapshot.cards,
                presentedCard = afterAnswerSnapshot.presentedCard
            )
        )
        val answerOptionsAfterAnswer = requireNotNull(
            resolveDisplayedSessionAnswerOptions(
                displayedCard = displayedCardAfterAnswer,
                answerOptionsByCardId = afterAnswerSnapshot.answerOptionsByCardId
            )
        )

        assertEquals("recent-due-1115-card", displayedCardAfterAnswer.cardId)
        assertEquals(
            setOf("recent-due-1115-card", "recent-due-1155-card"),
            afterAnswerSnapshot.answerOptionsByCardId.keys
        )
        assertEquals(afterAnswerSnapshot.answerOptions, answerOptionsAfterAnswer)
    }
}

private fun makeObservedReviewSessionSignature(
    reviewCards: List<ReviewCard>,
    presentedCard: ReviewCard?,
    dueCount: Int,
    remainingCount: Int,
    totalCount: Int,
    availableTagFilters: List<ReviewTagFilterOption>
): ObservedReviewSessionSignature {
    return ObservedReviewSessionSignature(
        requestedFilter = ReviewFilter.AllCards,
        selectedFilter = ReviewFilter.AllCards,
        selectedFilterTitle = "All cards",
        reviewCards = reviewCards,
        presentedCard = presentedCard,
        dueCount = dueCount,
        remainingCount = remainingCount,
        totalCount = totalCount,
        hasMoreCards = false,
        availableDeckFilters = listOf(
            ReviewDeckFilterOption(
                deckId = "all-fast",
                title = "All fast",
                totalCount = dueCount
            )
        ),
        availableEffortFilters = listOf(
            ReviewEffortFilterOption(
                effortLevel = EffortLevel.FAST,
                title = "Fast",
                totalCount = dueCount
            ),
            ReviewEffortFilterOption(
                effortLevel = EffortLevel.MEDIUM,
                title = "Medium",
                totalCount = 0
            ),
            ReviewEffortFilterOption(
                effortLevel = EffortLevel.LONG,
                title = "Long",
                totalCount = 0
            )
        ),
        availableTagFilters = availableTagFilters
    )
}

private fun makePreparedReviewCardPresentation(card: ReviewCard): PreparedReviewCardPresentation {
    return PreparedReviewCardPresentation(
        card = card,
        effortLabel = "Fast",
        tagsLabel = card.tags.joinToString(),
        dueLabel = "Due",
        repsLabel = "2 reps",
        lapsesLabel = "0 lapses",
        frontContent = ReviewRenderedContent.ShortPlain(text = card.frontText),
        backContent = ReviewRenderedContent.ShortPlain(text = card.backText),
        frontSpeakableText = card.frontText,
        backSpeakableText = card.backText,
        answerOptions = emptyList()
    )
}

private fun makeReviewSubmissionSessionContext(reviewFilter: ReviewFilter): ReviewSubmissionSessionContext {
    return makeReviewSubmissionSessionContextWithGenerations(
        reviewFilter = reviewFilter,
        sessionGeneration = 0L,
        filterGeneration = 0L
    )
}

private fun makeReviewSubmissionSessionContextWithGeneration(
    reviewFilter: ReviewFilter,
    sessionGeneration: Long
): ReviewSubmissionSessionContext {
    return makeReviewSubmissionSessionContextWithGenerations(
        reviewFilter = reviewFilter,
        sessionGeneration = sessionGeneration,
        filterGeneration = 0L
    )
}

private fun makeReviewSubmissionSessionContextWithGenerations(
    reviewFilter: ReviewFilter,
    sessionGeneration: Long,
    filterGeneration: Long
): ReviewSubmissionSessionContext {
    return ReviewSubmissionSessionContext(
        requestedFilter = reviewFilter,
        observedRequestedFilter = reviewFilter,
        selectedFilter = reviewFilter,
        sessionGeneration = sessionGeneration,
        filterGeneration = filterGeneration
    )
}

private fun makeOwnedReviewSubmission(
    pendingReviewedCard: PendingReviewedCard,
    reviewedCard: ReviewCard,
    presentedCard: ReviewCard?,
    observationState: OwnedReviewSubmissionObservationState
): OwnedReviewSubmission {
    return OwnedReviewSubmission(
        pendingReviewedCard = pendingReviewedCard,
        reviewedCard = reviewedCard,
        presentedCard = presentedCard,
        observationState = observationState
    )
}

private fun makePinnedReviewDraftState(
    requestedFilter: ReviewFilter,
    presentedCard: ReviewCard?,
    reviewedInSessionCount: Int,
    pendingReviewedCards: Set<PendingReviewedCard>,
    optimisticPreparedCurrentCard: PreparedReviewCardPresentation?,
    errorMessage: String
): ReviewDraftState {
    return ReviewDraftState(
        requestedFilter = requestedFilter,
        presentedCard = presentedCard,
        revealedCardId = null,
        reviewedInSessionCount = reviewedInSessionCount,
        pendingReviewedCards = pendingReviewedCards,
        optimisticPreparedCurrentCard = optimisticPreparedCurrentCard,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = errorMessage,
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

private fun makePinnedReviewCard(
    cardId: String,
    tags: List<String>,
    updatedAtMillis: Long
): ReviewCard {
    return ReviewCard(
        cardId = cardId,
        frontText = "Front $cardId",
        backText = "Back $cardId",
        tags = tags,
        effortLevel = EffortLevel.FAST,
        dueAtMillis = pinnedReviewNowMillis - pinnedReviewOneHourMillis,
        updatedAtMillis = updatedAtMillis,
        createdAtMillis = updatedAtMillis,
        reps = 2,
        lapses = 0,
        queueStatus = ReviewCardQueueStatus.ACTIVE
    )
}

private fun makePinnedReviewSessionSnapshot(
    canonicalCards: List<CardSummary>,
    presentedCard: CardSummary?,
    dueCount: Int,
    remainingCount: Int,
    totalCount: Int
): ReviewSessionSnapshot {
    return buildBoundedReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        decks = emptyList(),
        canonicalCards = canonicalCards,
        presentedCard = presentedCard,
        dueCount = dueCount,
        remainingCount = remainingCount,
        totalCount = totalCount,
        hasMoreCards = false,
        availableDeckFilters = emptyList(),
        availableEffortFilters = emptyList(),
        availableTagFilters = emptyList(),
        settings = makeDefaultWorkspaceSchedulerSettings(
            workspaceId = pinnedReviewWorkspaceId,
            updatedAtMillis = pinnedReviewNowMillis
        ),
        reviewedAtMillis = pinnedReviewNowMillis
    )
}

private fun makePinnedReviewCardSummary(
    cardId: String,
    dueAtMillis: Long?,
    createdAtMillis: Long,
    updatedAtMillis: Long
): CardSummary {
    return CardSummary(
        cardId = cardId,
        workspaceId = pinnedReviewWorkspaceId,
        frontText = "Front $cardId",
        backText = "Back $cardId",
        tags = emptyList(),
        effortLevel = EffortLevel.FAST,
        dueAtMillis = dueAtMillis,
        createdAtMillis = createdAtMillis,
        updatedAtMillis = updatedAtMillis,
        reps = 2,
        lapses = 0,
        fsrsCardState = FsrsCardState.REVIEW,
        fsrsStepIndex = null,
        fsrsStability = 2.5,
        fsrsDifficulty = 5.0,
        fsrsLastReviewedAtMillis = pinnedReviewNowMillis - pinnedReviewOneDayMillis,
        fsrsScheduledDays = 1,
        deletedAtMillis = null
    )
}
