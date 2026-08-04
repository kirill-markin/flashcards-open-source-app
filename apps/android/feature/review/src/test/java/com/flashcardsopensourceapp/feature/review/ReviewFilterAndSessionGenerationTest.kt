package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewFilterAndSessionGenerationTest {
    @Test
    fun sameFilterForegroundSessionChangeAdvancesGenerationWithoutPresentedCardChange() {
        val currentCard = makePinnedReviewCard(
            cardId = "same-presented-card",
            tags = listOf("shared"),
            updatedAtMillis = 30L
        )
        val previousSignature = createObservedReviewSessionSignature(
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
        val nextSignature = createObservedReviewSessionSignature(
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
        val previousSignature = createObservedReviewSessionSignature(
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
        val nextSignature = createObservedReviewSessionSignature(
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
        val previousSignature = createObservedReviewSessionSignature(
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
        val nextSignature = createObservedReviewSessionSignature(
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
    fun ownedLocalReviewMatchesCommittedTagsByNormalizedKey() {
        val decomposedTag = "E\u0301clair"
        val submittedCard = makePinnedReviewCard(
            cardId = "normalized-tag-card",
            tags = listOf("Éclair", decomposedTag),
            updatedAtMillis = 46L
        )
        val pendingReviewedCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val previousSignature = createObservedReviewSessionSignature(
            reviewCards = emptyList(),
            presentedCard = null,
            dueCount = 1,
            remainingCount = 1,
            totalCount = 1,
            availableTagFilters = listOf(
                ReviewTagFilterOption(tag = "Éclair", totalCount = 1)
            )
        )
        val nextSignature = createObservedReviewSessionSignature(
            reviewCards = emptyList(),
            presentedCard = null,
            dueCount = 0,
            remainingCount = 0,
            totalCount = 1,
            availableTagFilters = listOf(
                ReviewTagFilterOption(tag = decomposedTag, totalCount = 0)
            )
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = null,
            reviewedInSessionCount = 0,
            pendingReviewedCards = setOf(pendingReviewedCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )
        val ownedReviewSubmissions = mapOf(
            pendingReviewedCard to makeOwnedReviewSubmission(
                pendingReviewedCard = pendingReviewedCard,
                reviewedCard = submittedCard,
                presentedCard = null,
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
        val previousSignature = createObservedReviewSessionSignature(
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
        val nextSignature = createObservedReviewSessionSignature(
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
        val previousSignature = createObservedReviewSessionSignature(
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
        val nextSignature = createObservedReviewSessionSignature(
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
    fun rapidOwnedReviewConsumesMatchingMarkerWhenTagRowsReachZero() {
        val firstSubmittedCard = makePinnedReviewCard(
            cardId = "rapid-zero-first-card",
            tags = listOf("other"),
            updatedAtMillis = 50L
        )
        val secondSubmittedCard = makePinnedReviewCard(
            cardId = "rapid-zero-second-card",
            tags = listOf("exhausted", "fast"),
            updatedAtMillis = 51L
        )
        val nextCard = makePinnedReviewCard(
            cardId = "rapid-zero-next-card",
            tags = emptyList(),
            updatedAtMillis = 52L
        )
        val firstPendingCard = PendingReviewedCard(
            cardId = firstSubmittedCard.cardId,
            updatedAtMillis = firstSubmittedCard.updatedAtMillis
        )
        val secondPendingCard = PendingReviewedCard(
            cardId = secondSubmittedCard.cardId,
            updatedAtMillis = secondSubmittedCard.updatedAtMillis
        )
        val previousSignature = createObservedReviewSessionSignature(
            reviewCards = listOf(nextCard),
            presentedCard = nextCard,
            dueCount = 1,
            remainingCount = 1,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(tag = "exhausted", totalCount = 1),
                ReviewTagFilterOption(tag = "fast", totalCount = 1),
                ReviewTagFilterOption(tag = "other", totalCount = 0)
            )
        )
        val nextSignature = createObservedReviewSessionSignature(
            reviewCards = listOf(nextCard),
            presentedCard = nextCard,
            dueCount = 0,
            remainingCount = 0,
            totalCount = 2,
            availableTagFilters = listOf(
                ReviewTagFilterOption(tag = "exhausted", totalCount = 0),
                ReviewTagFilterOption(tag = "fast", totalCount = 0),
                ReviewTagFilterOption(tag = "other", totalCount = 0)
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
                presentedCard = nextCard,
                observationState = OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
            ),
            secondPendingCard to makeOwnedReviewSubmission(
                pendingReviewedCard = secondPendingCard,
                reviewedCard = secondSubmittedCard,
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
        assertEquals(setOf(secondPendingCard), suppression.consumedPendingReviewedCards)
    }

    @Test
    fun concurrentDeckTagChangeAdvancesGenerationDuringOwnedReview() {
        val submittedCard = makePinnedReviewCard(
            cardId = "deck-definition-change-card",
            tags = listOf("fast"),
            updatedAtMillis = 53L
        )
        val pendingReviewedCard = PendingReviewedCard(
            cardId = submittedCard.cardId,
            updatedAtMillis = submittedCard.updatedAtMillis
        )
        val previousSignature = createObservedReviewSessionSignature(
            reviewCards = emptyList(),
            presentedCard = null,
            dueCount = 1,
            remainingCount = 1,
            totalCount = 1,
            availableTagFilters = listOf(ReviewTagFilterOption(tag = "fast", totalCount = 1))
        )
        val nextSignature = createObservedReviewSessionSignature(
            reviewCards = emptyList(),
            presentedCard = null,
            dueCount = 0,
            remainingCount = 0,
            totalCount = 1,
            availableTagFilters = listOf(ReviewTagFilterOption(tag = "fast", totalCount = 0))
        ).copy(
            availableDeckFilters = listOf(
                ReviewDeckFilterOption(
                    deckId = "all-fast",
                    title = "All fast",
                    totalCount = 0,
                    tags = listOf("changed")
                )
            )
        )
        val state = makePinnedReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = null,
            reviewedInSessionCount = 0,
            pendingReviewedCards = setOf(pendingReviewedCard),
            optimisticPreparedCurrentCard = null,
            errorMessage = ""
        )
        val ownedReviewSubmissions = mapOf(
            pendingReviewedCard to makeOwnedReviewSubmission(
                pendingReviewedCard = pendingReviewedCard,
                reviewedCard = submittedCard,
                presentedCard = null,
                observationState = OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
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
    fun sameFilterSelectionDoesNotAdvanceFilterGeneration() {
        val currentGeneration = 7L
        val activeFilter = ReviewFilter.Tags(tags = listOf("active"))

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
    fun missingRequestedTagsStayUnchangedAcrossRepeatedFilterResolutions() {
        val requestedFilter = ReviewFilter.Tags(tags = listOf("Alpha", "missing"))
        val resolvedQueryFilter = ReviewFilter.Tags(tags = listOf("Alpha"))
        val availableTagFilters = listOf(
            ReviewTagFilterOption(tag = "Alpha", totalCount = 1)
        )

        repeat(times = 2) {
            assertEquals(
                null,
                reviewFilterResolutionToApply(
                    requestedFilter = requestedFilter,
                    resolvedFilter = resolvedQueryFilter,
                    availableTagFilters = availableTagFilters
                )
            )
        }
        assertEquals(
            ReviewFilter.AllCards,
            reviewFilterResolutionToApply(
                requestedFilter = ReviewFilter.Tags(tags = listOf("Alpha")),
                resolvedFilter = ReviewFilter.AllCards,
                availableTagFilters = availableTagFilters
            )
        )
    }

    @Test
    fun checklistMaterializesDeckPresetSupportsEmptySelectionAndCanonicalizesAllTags() {
        val deckFilters = listOf(
            ReviewDeckFilterOption(
                deckId = "deck-1",
                title = "Deck 1",
                totalCount = 2,
                tags = listOf("Alpha", "Beta")
            ),
            ReviewDeckFilterOption(
                deckId = "all-cards-deck",
                title = "All cards deck",
                totalCount = 3,
                tags = emptyList()
            )
        )
        val tagFilters = listOf("Alpha", "Beta", "Gamma").map { tagName ->
            ReviewTagFilterOption(tag = tagName, totalCount = 1)
        }

        assertEquals(
            listOf("Alpha", "Beta", "Gamma"),
            selectedReviewTagNames(
                selectedFilter = ReviewFilter.AllCards,
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        )
        assertEquals(
            ReviewFilter.Tags(tags = listOf("Alpha")),
            toggleReviewTagFilter(
                selectedFilter = ReviewFilter.Deck(deckId = "deck-1"),
                toggledTagName = "Beta",
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        )
        assertEquals(
            listOf("Alpha", "Beta", "Gamma"),
            selectedReviewTagNames(
                selectedFilter = ReviewFilter.Deck(deckId = "all-cards-deck"),
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        )
        assertEquals(
            ReviewFilter.Tags(tags = listOf("Beta", "Gamma")),
            toggleReviewTagFilter(
                selectedFilter = ReviewFilter.Deck(deckId = "all-cards-deck"),
                toggledTagName = "Alpha",
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        )
        val allCardsMinusAlpha = toggleReviewTagFilter(
            selectedFilter = ReviewFilter.AllCards,
            toggledTagName = "Alpha",
            availableDeckFilters = deckFilters,
            availableTagFilters = tagFilters
        )
        assertEquals(ReviewFilter.Tags(tags = listOf("Beta", "Gamma")), allCardsMinusAlpha)
        assertEquals(
            ReviewFilter.AllCards,
            toggleReviewTagFilter(
                selectedFilter = allCardsMinusAlpha,
                toggledTagName = "Alpha",
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        )
        assertEquals(
            ReviewFilter.Tags(tags = emptyList()),
            toggleReviewTagFilter(
                selectedFilter = ReviewFilter.AllCards,
                toggledTagName = "Alpha",
                availableDeckFilters = emptyList(),
                availableTagFilters = listOf(ReviewTagFilterOption(tag = "Alpha", totalCount = 1))
            )
        )
        assertEquals(
            ReviewFilter.Tags(tags = listOf("Alpha", "Beta", "missing")),
            toggleReviewTagFilter(
                selectedFilter = ReviewFilter.Tags(tags = listOf("Alpha", "missing")),
                toggledTagName = "Beta",
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        )
        assertEquals(
            ReviewFilter.Tags(tags = listOf("missing")),
            toggleReviewTagFilter(
                selectedFilter = ReviewFilter.Tags(tags = listOf("Alpha", "missing")),
                toggledTagName = "Alpha",
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        )
        var immediateSelection: ReviewFilter = ReviewFilter.AllCards
        listOf("Alpha", "Beta").forEach { tagName ->
            immediateSelection = toggleReviewTagFilter(
                selectedFilter = immediateSelection,
                toggledTagName = tagName,
                availableDeckFilters = deckFilters,
                availableTagFilters = tagFilters
            )
        }
        assertEquals(
            ReviewFilter.Tags(tags = listOf("Gamma")),
            immediateSelection
        )
    }
}

private fun createObservedReviewSessionSignature(
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
                totalCount = dueCount,
                tags = listOf("fast")
            )
        ),
        availableTagFilters = availableTagFilters
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
