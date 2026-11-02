package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
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
        state = state,
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
    val queueChange = matchOwnedSubmissionsIgnoringNewlyDueCards(
        previousCards = previousSignature.reviewCards,
        nextCards = nextSignature.reviewCards,
        nextHasMoreCards = nextSignature.hasMoreCards,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) ?: return null
    val removedSubmissions = queueChange.removedSubmissions
    if (removedSubmissions.isEmpty()) {
        return null
    }
    val showsOwnedNextCard = nextSignature.presentedCard == state.presentedCard &&
        removedSubmissions.any { submission ->
            submission.presentedCard == nextSignature.presentedCard
        }
    val showsNewlyDueCardAfterOwnedLastCard = isNewlyDueCardShownOnOwnedEmptyScreen(
        nextPresentedCard = nextSignature.presentedCard,
        state = state,
        newlyDueCards = queueChange.addedCards
    ) && removedSubmissions.any { submission ->
        submission.presentedCard == null
    }
    if (showsOwnedNextCard.not() && showsNewlyDueCardAfterOwnedLastCard.not()) {
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
            committedSubmissionCount = committedSubmissions.size,
            maxNewlyDueCardCount = queueChange.addedCards.size
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
    state: ReviewDraftState,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewSessionObservationSuppression? {
    val keepsPresentedCard = previousSignature.presentedCard == nextSignature.presentedCard
    if (keepsPresentedCard.not() && previousSignature.presentedCard != null) {
        return null
    }
    val queueChange = matchOwnedSubmissionsIgnoringNewlyDueCards(
        previousCards = previousSignature.reviewCards,
        nextCards = nextSignature.reviewCards,
        nextHasMoreCards = nextSignature.hasMoreCards,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) ?: return null
    if (queueChange.removedSubmissions.isNotEmpty()) {
        return null
    }
    // No reviewed card left the window, so nothing slid in behind one: every added card became due.
    val newlyDueCards = queueChange.addedCards
    if (
        keepsPresentedCard.not() &&
        isNewlyDueCardShownOnOwnedEmptyScreen(
            nextPresentedCard = nextSignature.presentedCard,
            state = state,
            newlyDueCards = newlyDueCards
        ).not()
    ) {
        return null
    }
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    val remainingCountDelta = previousSignature.remainingCount - nextSignature.remainingCount
    val observedReviewCount = maxOf(dueCountDelta, remainingCountDelta) + newlyDueCards.size
    if (observedReviewCount < 0 || (observedReviewCount == 0 && newlyDueCards.isEmpty())) {
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
        val explainsPresentedCard = keepsPresentedCard || submissions.any { submission ->
            submission.presentedCard == null
        }
        explainsPresentedCard && isOwnedReviewCountChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            queueSubmissionCount = submissions.size,
            committedSubmissionCount = submissions.size,
            maxNewlyDueCardCount = newlyDueCards.size
        )
    } ?: return null

    return OwnedReviewSessionObservationSuppression(
        consumedPendingReviewedCards = matchingSubmissions.map { submission ->
            submission.pendingReviewedCard
        }.toSet()
    )
}

/**
 * Rating the last queued card leaves no prepared next card, so the screen empties and the session shows
 * its first queued card, which can be a card that has just become due. That is the same session; a remote
 * change that replaces a card still on screen never matches. See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
private fun isNewlyDueCardShownOnOwnedEmptyScreen(
    nextPresentedCard: ReviewCard?,
    state: ReviewDraftState,
    newlyDueCards: List<ReviewCard>
): Boolean {
    return state.presentedCard == null &&
        nextPresentedCard != null &&
        newlyDueCards.contains(nextPresentedCard)
}

private data class OwnedReviewQueueChange(
    val removedSubmissions: List<OwnedReviewSubmission>,
    /** Cards that entered the window: newly due cards, or cards that slid in behind removed ones. */
    val addedCards: List<ReviewCard>
)

/**
 * Cards that become due while the user reviews, such as returning "Again" cards, may enter the queue
 * window at any position and push tail cards out of it; that is not a session change. Returns null only
 * when a card left the queue without an owned submission explaining it, or the kept cards changed order.
 * See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
private fun matchOwnedSubmissionsIgnoringNewlyDueCards(
    previousCards: List<ReviewCard>,
    nextCards: List<ReviewCard>,
    nextHasMoreCards: Boolean,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewQueueChange? {
    val ownedReviewSubmissionsByCardId = ownedReviewSubmissions.values.associateBy { submission ->
        submission.reviewedCard.cardId
    }
    val previousCardSet: Set<ReviewCard> = previousCards.toSet()
    val nextCardSet: Set<ReviewCard> = nextCards.toSet()
    val nextCardIds: Set<String> = nextCards.map(ReviewCard::cardId).toSet()
    val keptCards = previousCards.filter(nextCardSet::contains)
    if (nextCards.filter(previousCardSet::contains) != keptCards) {
        return null
    }
    val lastKeptCardIndex = previousCards.indexOfLast(nextCardSet::contains)
    val removedSubmissions = mutableListOf<OwnedReviewSubmission>()
    var pushedOutCardCount: Int = 0
    previousCards.forEachIndexed { index, previousCard ->
        if (nextCardSet.contains(previousCard)) {
            return@forEachIndexed
        }
        val ownedSubmission = ownedReviewSubmissionsByCardId[previousCard.cardId]
        if (ownedSubmission != null) {
            removedSubmissions.add(ownedSubmission)
            return@forEachIndexed
        }
        if (index < lastKeptCardIndex || nextCardIds.contains(previousCard.cardId)) {
            return null
        }
        pushedOutCardCount += 1
    }
    val addedCards = nextCards.filterNot(previousCardSet::contains)
    if (pushedOutCardCount > 0 && (nextHasMoreCards.not() || pushedOutCardCount > addedCards.size)) {
        return null
    }

    return OwnedReviewQueueChange(
        removedSubmissions = removedSubmissions,
        addedCards = addedCards
    )
}

private const val maxOwnedReviewSubmissionCombinationInputSize: Int = 8

private fun makeOwnedReviewSubmissionCombinations(
    ownedReviewSubmissions: List<OwnedReviewSubmission>,
    size: Int
): List<List<OwnedReviewSubmission>> {
    if (size == 0) {
        return listOf(emptyList())
    }
    // Avoid combinatorial work on the UI thread when many submissions queue up.
    if (ownedReviewSubmissions.size > maxOwnedReviewSubmissionCombinationInputSize) {
        return emptyList()
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

/** Newly due cards raise both counts, so each may drop by less than the owned reviews explain. */
private fun isOwnedReviewCountChange(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    queueSubmissionCount: Int,
    committedSubmissionCount: Int,
    maxNewlyDueCardCount: Int
): Boolean {
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    val remainingCountDelta = previousSignature.remainingCount - nextSignature.remainingCount
    if (dueCountDelta < -maxNewlyDueCardCount || dueCountDelta > committedSubmissionCount) {
        return false
    }
    if (remainingCountDelta < -maxNewlyDueCardCount || remainingCountDelta > queueSubmissionCount) {
        return false
    }

    return dueCountDelta > 0 || remainingCountDelta > 0 || maxNewlyDueCardCount > 0
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
    nextPreparedNextCardId: String?,
    pendingReviewedCard: PendingReviewedCard,
    optimisticPreparedCurrentCard: PreparedReviewCardPresentation?
): ReviewDraftState {
    return state.copy(
        presentedCard = nextPresentedCard,
        preparedNextCardId = nextPreparedNextCardId,
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
        // The card shown after the failed rating is prepared next again.
        preparedNextCardId = state.presentedCard?.cardId?.takeIf { cardId -> cardId != validRollbackCard.cardId },
        pendingReviewedCards = pendingReviewedCards,
        optimisticPreparedCurrentCard = null,
        errorMessage = errorMessage
    )
}
