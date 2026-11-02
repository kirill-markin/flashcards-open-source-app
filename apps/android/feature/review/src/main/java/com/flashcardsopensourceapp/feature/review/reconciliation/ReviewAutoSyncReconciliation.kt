package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot

internal data class VisibleAutoSyncChangeSignature(
    val selectedFilterTitle: String,
    val reviewCardIds: List<String>,
    val preparedCurrentCard: PreparedReviewCardPresentation?,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean
)

internal fun makeVisibleAutoSyncChangeSignature(
    sessionSnapshot: ReviewSessionSnapshot,
    preparedCurrentCard: PreparedReviewCardPresentation?
): VisibleAutoSyncChangeSignature {
    return VisibleAutoSyncChangeSignature(
        selectedFilterTitle = sessionSnapshot.selectedFilterTitle,
        reviewCardIds = sessionSnapshot.cards.map(ReviewCard::cardId),
        preparedCurrentCard = preparedCurrentCard,
        remainingCount = sessionSnapshot.remainingCount,
        totalCount = sessionSnapshot.totalCount,
        hasMoreCards = sessionSnapshot.hasMoreCards
    )
}

internal fun hasNewVisibleAutoSyncChange(
    visibleSignatureBeforeSync: VisibleAutoSyncChangeSignature?,
    nextVisibleChangeSignature: VisibleAutoSyncChangeSignature,
    lastVisibleAutoSyncChangeSignature: VisibleAutoSyncChangeSignature?
): Boolean {
    if (visibleSignatureBeforeSync == null) {
        return false
    }
    if (visibleSignatureBeforeSync == nextVisibleChangeSignature) {
        return false
    }
    return nextVisibleChangeSignature != lastVisibleAutoSyncChangeSignature
}

/**
 * Only a change to the card on screen is news from another device. Cards added behind it, such as
 * returning "Again" cards, are not. See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
internal fun shouldShowReviewUpdatedOnAnotherDeviceMessage(
    visibleSignatureBeforeSync: VisibleAutoSyncChangeSignature,
    nextVisibleChangeSignature: VisibleAutoSyncChangeSignature
): Boolean {
    return visibleSignatureBeforeSync.preparedCurrentCard != nextVisibleChangeSignature.preparedCurrentCard
}

internal fun applySuccessfulAutoSyncReviewState(
    state: ReviewDraftState,
    sessionSnapshot: ReviewSessionSnapshot
): ReviewDraftState {
    val nextPresentedCard = sessionSnapshot.presentedCard
    return state.copy(
        presentedCard = nextPresentedCard,
        preparedNextCardId = sessionSnapshot.preparedNextCard?.cardId,
        revealedCardId = if (state.revealedCardId == nextPresentedCard?.cardId) {
            state.revealedCardId
        } else {
            null
        },
        // Same-card content changes must render from the fresh review snapshot.
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = ""
    )
}
