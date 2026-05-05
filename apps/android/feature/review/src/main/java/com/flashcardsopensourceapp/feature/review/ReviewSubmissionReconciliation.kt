package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption
import kotlinx.coroutines.CancellationException

internal fun clearPendingReviewedCard(
    pendingReviewedCards: Set<PendingReviewedCard>,
    pendingReviewedCard: PendingReviewedCard
): Set<PendingReviewedCard> {
    return pendingReviewedCards - pendingReviewedCard
}

internal fun shouldAdvanceReviewSessionGeneration(
    previousSignature: ObservedReviewSessionSignature?,
    nextSignature: ObservedReviewSessionSignature,
    state: ReviewDraftState,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): Boolean {
    val previous = previousSignature ?: return false
    if (previous == nextSignature) {
        return false
    }
    return findOwnedReviewSessionObservationSuppression(
        previousSignature = previous,
        nextSignature = nextSignature,
        state = state,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) == null
}

internal fun findOwnedReviewSessionObservationSuppression(
    previousSignature: ObservedReviewSessionSignature?,
    nextSignature: ObservedReviewSessionSignature,
    state: ReviewDraftState,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewSessionObservationSuppression? {
    val previous = previousSignature ?: return null
    if (previous == nextSignature) {
        return null
    }
    if (
        hasSameReviewSessionIdentity(
            previousSignature = previous,
            nextSignature = nextSignature
        ).not()
    ) {
        return null
    }

    return findOwnedReviewQueueObservationSuppression(
        previousSignature = previous,
        nextSignature = nextSignature,
        state = state,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) ?: findOwnedReviewCommitObservationSuppression(
        previousSignature = previous,
        nextSignature = nextSignature,
        ownedReviewSubmissions = ownedReviewSubmissions
    )
}

private fun hasSameReviewSessionIdentity(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature
): Boolean {
    return previousSignature.requestedFilter == nextSignature.requestedFilter &&
        previousSignature.selectedFilter == nextSignature.selectedFilter &&
        previousSignature.selectedFilterTitle == nextSignature.selectedFilterTitle &&
        previousSignature.totalCount == nextSignature.totalCount
}

private fun findOwnedReviewQueueObservationSuppression(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    state: ReviewDraftState,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewSessionObservationSuppression? {
    if (nextSignature.presentedCard != state.presentedCard) {
        return null
    }
    val removedSubmissions = findOwnedReviewSubmissionsRemovedFromQueue(
        previousCards = previousSignature.reviewCards,
        nextCards = nextSignature.reviewCards,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) ?: return null
    if (removedSubmissions.isEmpty()) {
        return null
    }
    if (
        removedSubmissions.any { submission ->
            submission.presentedCard == nextSignature.presentedCard
        }.not()
    ) {
        return null
    }
    val committedSubmissions = removedSubmissions.filter { submission ->
        submission.observationState == OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
    }
    if (
        isOwnedReviewCountChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            queueSubmissionCount = removedSubmissions.size,
            committedSubmissionCount = committedSubmissions.size
        ).not()
    ) {
        return null
    }
    if (
        isOwnedReviewFilterOptionChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            committedReviewedCards = committedSubmissions.map(OwnedReviewSubmission::reviewedCard)
        ).not()
    ) {
        return null
    }

    return OwnedReviewSessionObservationSuppression(
        consumedPendingReviewedCards = committedSubmissions.map { submission ->
            submission.pendingReviewedCard
        }.toSet()
    )
}

private fun findOwnedReviewCommitObservationSuppression(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewSessionObservationSuppression? {
    if (previousSignature.reviewCards != nextSignature.reviewCards) {
        return null
    }
    if (previousSignature.presentedCard != nextSignature.presentedCard) {
        return null
    }
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    val remainingCountDelta = previousSignature.remainingCount - nextSignature.remainingCount
    val observedReviewCount = maxOf(dueCountDelta, remainingCountDelta)
    if (observedReviewCount <= 0) {
        return null
    }
    val observableOwnedSubmissions = ownedReviewSubmissions.values.filter { submission ->
        submission.observationState == OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
    }
    if (observedReviewCount > observableOwnedSubmissions.size) {
        return null
    }

    val submissionCombinations = makeOwnedReviewSubmissionCombinations(
        ownedReviewSubmissions = observableOwnedSubmissions,
        size = observedReviewCount
    )
    val matchingSubmissions = submissionCombinations.firstOrNull { submissions ->
        isOwnedReviewCountChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            queueSubmissionCount = submissions.size,
            committedSubmissionCount = submissions.size
        ) && isOwnedReviewFilterOptionChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            committedReviewedCards = submissions.map(OwnedReviewSubmission::reviewedCard)
        )
    } ?: return null

    return OwnedReviewSessionObservationSuppression(
        consumedPendingReviewedCards = matchingSubmissions.map { submission ->
            submission.pendingReviewedCard
        }.toSet()
    )
}

private fun findOwnedReviewSubmissionsRemovedFromQueue(
    previousCards: List<ReviewCard>,
    nextCards: List<ReviewCard>,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): List<OwnedReviewSubmission>? {
    // Return null when nextCards introduces a card that was not present in previousCards,
    // because the canonical queue can only shrink between observations during owned reviews.
    val ownedReviewSubmissionsByCardId = ownedReviewSubmissions.values.associateBy { submission ->
        submission.reviewedCard.cardId
    }
    val removedSubmissions = mutableListOf<OwnedReviewSubmission>()
    var nextCardIndex: Int = 0
    previousCards.forEach { previousCard ->
        val nextCard = nextCards.getOrNull(index = nextCardIndex)
        if (nextCard == previousCard) {
            nextCardIndex += 1
        } else {
            val ownedSubmission = ownedReviewSubmissionsByCardId[previousCard.cardId] ?: return null
            removedSubmissions.add(ownedSubmission)
        }
    }

    return removedSubmissions
}

private const val maxOwnedReviewSubmissionCombinationInputSize: Int = 8

private fun makeOwnedReviewSubmissionCombinations(
    ownedReviewSubmissions: List<OwnedReviewSubmission>,
    size: Int
): List<List<OwnedReviewSubmission>> {
    // Avoid combinatorial work on the UI thread when many submissions queue up.
    if (ownedReviewSubmissions.size > maxOwnedReviewSubmissionCombinationInputSize) {
        return emptyList()
    }
    if (size == 0) {
        return listOf(emptyList())
    }
    if (ownedReviewSubmissions.size < size) {
        return emptyList()
    }

    val firstSubmission = ownedReviewSubmissions.first()
    val remainingSubmissions = ownedReviewSubmissions.drop(n = 1)
    val combinationsWithFirst = makeOwnedReviewSubmissionCombinations(
        ownedReviewSubmissions = remainingSubmissions,
        size = size - 1
    ).map { combination ->
        listOf(firstSubmission) + combination
    }
    val combinationsWithoutFirst = makeOwnedReviewSubmissionCombinations(
        ownedReviewSubmissions = remainingSubmissions,
        size = size
    )

    return combinationsWithFirst + combinationsWithoutFirst
}

private fun isOwnedReviewCountChange(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    queueSubmissionCount: Int,
    committedSubmissionCount: Int
): Boolean {
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    val remainingCountDelta = previousSignature.remainingCount - nextSignature.remainingCount
    if (dueCountDelta < 0 || dueCountDelta > committedSubmissionCount) {
        return false
    }
    if (remainingCountDelta < 0 || remainingCountDelta > queueSubmissionCount) {
        return false
    }

    return dueCountDelta > 0 || remainingCountDelta > 0
}

private fun isOwnedReviewFilterOptionChange(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    if (dueCountDelta == 0) {
        return previousSignature.availableDeckFilters == nextSignature.availableDeckFilters &&
            previousSignature.availableEffortFilters == nextSignature.availableEffortFilters &&
            previousSignature.availableTagFilters == nextSignature.availableTagFilters
    }

    return hasOwnedDeckFilterOptionChange(
        previousOptions = previousSignature.availableDeckFilters,
        nextOptions = nextSignature.availableDeckFilters,
        committedReviewedCards = committedReviewedCards
    ) && hasOwnedEffortFilterOptionChange(
        previousOptions = previousSignature.availableEffortFilters,
        nextOptions = nextSignature.availableEffortFilters,
        committedReviewedCards = committedReviewedCards
    ) && hasOwnedTagFilterOptionChange(
        previousOptions = previousSignature.availableTagFilters,
        nextOptions = nextSignature.availableTagFilters,
        committedReviewedCards = committedReviewedCards
    )
}

private fun hasOwnedDeckFilterOptionChange(
    previousOptions: List<ReviewDeckFilterOption>,
    nextOptions: List<ReviewDeckFilterOption>,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    if (previousOptions.size != nextOptions.size) {
        return false
    }

    val nextOptionsByDeckId = nextOptions.associateBy { option ->
        option.deckId
    }
    return previousOptions.all { previousOption ->
        val nextOption = nextOptionsByDeckId[previousOption.deckId] ?: return false
        val countDelta = previousOption.totalCount - nextOption.totalCount
        nextOption.title == previousOption.title &&
            countDelta >= 0 &&
            countDelta <= committedReviewedCards.size
    }
}

private fun hasOwnedEffortFilterOptionChange(
    previousOptions: List<ReviewEffortFilterOption>,
    nextOptions: List<ReviewEffortFilterOption>,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    if (previousOptions.size != nextOptions.size) {
        return false
    }

    val nextOptionsByEffort = nextOptions.associateBy { option ->
        option.effortLevel
    }
    return previousOptions.all { previousOption ->
        val nextOption = nextOptionsByEffort[previousOption.effortLevel] ?: return false
        val expectedDelta = committedReviewedCards.count { reviewedCard ->
            previousOption.effortLevel == reviewedCard.effortLevel
        }
        nextOption.title == previousOption.title &&
            previousOption.totalCount - nextOption.totalCount == expectedDelta
    }
}

private fun hasOwnedTagFilterOptionChange(
    previousOptions: List<ReviewTagFilterOption>,
    nextOptions: List<ReviewTagFilterOption>,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    val previousOptionsByTag = previousOptions.associateBy { option ->
        option.tag
    }
    val nextOptionsByTag = nextOptions.associateBy { option ->
        option.tag
    }
    if (
        nextOptionsByTag.keys.any { tag ->
            previousOptionsByTag.containsKey(tag).not()
        }
    ) {
        return false
    }
    val committedReviewTags = committedReviewedCards.flatMap { reviewedCard ->
        reviewedCard.tags
    }

    return previousOptions.all { previousOption ->
        val expectedDelta = committedReviewTags.count { tag ->
            tag == previousOption.tag
        }
        val expectedCount = previousOption.totalCount - expectedDelta
        val nextOption = nextOptionsByTag[previousOption.tag]
        if (expectedCount <= 0) {
            nextOption == null
        } else {
            nextOption?.totalCount == expectedCount
        }
    }
}

internal fun markOwnedReviewSubmissionCommitPendingObservation(
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>,
    pendingReviewedCard: PendingReviewedCard
): Map<PendingReviewedCard, OwnedReviewSubmission> {
    val ownedReviewSubmission = ownedReviewSubmissions[pendingReviewedCard] ?: return ownedReviewSubmissions
    return ownedReviewSubmissions + (
        pendingReviewedCard to ownedReviewSubmission.copy(
            observationState = OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
        )
    )
}

internal suspend fun resolveFailedReviewSubmissionRollback(
    submittedContext: ReviewSubmissionSessionContext,
    currentContextBeforeLookup: ReviewSubmissionSessionContext,
    cardId: String,
    loadRollbackCard: suspend (ReviewFilter, String) -> ReviewCard?,
    captureCurrentContext: () -> ReviewSubmissionSessionContext
): FailedReviewSubmissionRollbackLookup {
    if (
        isCurrentReviewSubmissionContext(
            submittedContext = submittedContext,
            currentContext = currentContextBeforeLookup
        ).not()
    ) {
        return FailedReviewSubmissionRollbackLookup(
            currentContext = currentContextBeforeLookup,
            rollbackCard = null
        )
    }

    val rollbackCard = try {
        loadRollbackCard(
            currentContextBeforeLookup.selectedFilter,
            cardId
        )
    } catch (error: Throwable) {
        if (error is CancellationException) {
            throw error
        }
        null
    }

    return FailedReviewSubmissionRollbackLookup(
        currentContext = captureCurrentContext(),
        rollbackCard = rollbackCard
    )
}

internal fun isCurrentReviewSubmissionContext(
    submittedContext: ReviewSubmissionSessionContext,
    currentContext: ReviewSubmissionSessionContext
): Boolean {
    return submittedContext == currentContext
}

internal fun applyOptimisticReviewSubmission(
    state: ReviewDraftState,
    nextPresentedCard: ReviewCard?,
    pendingReviewedCard: PendingReviewedCard,
    optimisticPreparedCurrentCard: PreparedReviewCardPresentation?
): ReviewDraftState {
    return state.copy(
        presentedCard = nextPresentedCard,
        revealedCardId = null,
        pendingReviewedCards = state.pendingReviewedCards + pendingReviewedCard,
        optimisticPreparedCurrentCard = optimisticPreparedCurrentCard,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = ""
    )
}

internal fun applySuccessfulReviewSubmission(
    state: ReviewDraftState,
    submittedContext: ReviewSubmissionSessionContext,
    currentContext: ReviewSubmissionSessionContext,
    pendingReviewedCard: PendingReviewedCard
): ReviewDraftState {
    val pendingReviewedCards = clearPendingReviewedCard(
        pendingReviewedCards = state.pendingReviewedCards,
        pendingReviewedCard = pendingReviewedCard
    )
    if (
        isCurrentReviewSubmissionContext(
            submittedContext = submittedContext,
            currentContext = currentContext
        ).not()
    ) {
        return state.copy(pendingReviewedCards = pendingReviewedCards)
    }

    return state.copy(
        reviewedInSessionCount = state.reviewedInSessionCount + 1,
        pendingReviewedCards = pendingReviewedCards,
        optimisticPreparedCurrentCard = null
    )
}

internal fun applyFailedReviewSubmission(
    state: ReviewDraftState,
    submittedContext: ReviewSubmissionSessionContext,
    currentContext: ReviewSubmissionSessionContext,
    rollbackCard: ReviewCard?,
    pendingReviewedCard: PendingReviewedCard,
    errorMessage: String
): ReviewDraftState {
    val pendingReviewedCards = clearPendingReviewedCard(
        pendingReviewedCards = state.pendingReviewedCards,
        pendingReviewedCard = pendingReviewedCard
    )
    if (
        isCurrentReviewSubmissionContext(
            submittedContext = submittedContext,
            currentContext = currentContext
        ).not()
    ) {
        return state.copy(pendingReviewedCards = pendingReviewedCards)
    }
    val validRollbackCard = rollbackCard ?: return state.copy(
        pendingReviewedCards = pendingReviewedCards,
        errorMessage = errorMessage
    )

    return state.copy(
        presentedCard = validRollbackCard,
        pendingReviewedCards = pendingReviewedCards,
        optimisticPreparedCurrentCard = null,
        errorMessage = errorMessage
    )
}
