package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption

internal data class VisibleAutoSyncChangeSignature(
    val selectedFilterTitle: String,
    val reviewCardIds: List<String>,
    val preparedCurrentCard: PreparedReviewCardPresentation?,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean,
    val availableDeckFilters: List<ReviewDeckFilterOption>,
    val availableEffortFilters: List<ReviewEffortFilterOption>,
    val availableTagFilters: List<ReviewTagFilterOption>
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
        hasMoreCards = sessionSnapshot.hasMoreCards,
        availableDeckFilters = sessionSnapshot.availableDeckFilters,
        availableEffortFilters = sessionSnapshot.availableEffortFilters,
        availableTagFilters = sessionSnapshot.availableTagFilters
    )
}

internal fun shouldShowVisibleAutoSyncChangeMessage(
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

internal fun applySuccessfulAutoSyncReviewState(
    state: ReviewDraftState,
    sessionSnapshot: ReviewSessionSnapshot
): ReviewDraftState {
    val nextPresentedCard = sessionSnapshot.presentedCard
    return state.copy(
        presentedCard = nextPresentedCard,
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
