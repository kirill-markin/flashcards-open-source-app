package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot

internal data class ReviewDraftState(
    val requestedFilter: ReviewFilter,
    val presentedCard: ReviewCard?,
    /** The prepared next card, pinned across background refreshes; see docs/fsrs-scheduling-logic.md#non-blocking-review. */
    val preparedNextCardId: String?,
    val revealedCardId: String?,
    val reviewedInSessionCount: Int,
    val pendingReviewedCards: Set<PendingReviewedCard>,
    val optimisticPreparedCurrentCard: PreparedReviewCardPresentation?,
    val previewCards: List<ReviewCard>,
    val nextPreviewOffset: Int,
    val hasMorePreviewCards: Boolean,
    val isPreviewLoading: Boolean,
    val previewErrorMessage: String,
    val errorMessage: String,
    val isNotificationPermissionPromptVisible: Boolean,
    val isHardAnswerReminderVisible: Boolean
)

internal data class ReviewSubmissionSessionContext(
    val requestedFilter: ReviewFilter,
    val observedRequestedFilter: ReviewFilter,
    val selectedFilter: ReviewFilter,
    val sessionGeneration: Long,
    val filterGeneration: Long
)

internal enum class OwnedReviewSubmissionObservationState {
    LOCAL_WRITE_PENDING,
    COMMIT_PENDING_OBSERVATION
}

internal data class OwnedReviewSubmission(
    val pendingReviewedCard: PendingReviewedCard,
    val reviewedCard: ReviewCard,
    val presentedCard: ReviewCard?,
    val observationState: OwnedReviewSubmissionObservationState
)

internal data class OwnedReviewSessionObservationSuppression(
    val consumedPendingReviewedCards: Set<PendingReviewedCard>
)

internal data class FailedReviewSubmissionRollbackLookup(
    val currentContext: ReviewSubmissionSessionContext,
    val rollbackCard: ReviewCard?
)

internal data class ObservedReviewSessionState(
    val requestedFilter: ReviewFilter,
    val sessionSnapshot: ReviewSessionSnapshot
)

internal data class ObservedReviewSessionSignature(
    val requestedFilter: ReviewFilter,
    val selectedFilter: ReviewFilter,
    val selectedFilterTitle: String,
    val reviewCards: List<ReviewCard>,
    val presentedCard: ReviewCard?,
    val dueCount: Int,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean
)

internal fun makeWorkspaceScopedDraftState(reviewFilter: ReviewFilter): ReviewDraftState {
    return ReviewDraftState(
        requestedFilter = reviewFilter,
        presentedCard = null,
        preparedNextCardId = null,
        revealedCardId = null,
        reviewedInSessionCount = 0,
        pendingReviewedCards = emptySet(),
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

internal fun applyReviewFilterChange(
    state: ReviewDraftState,
    reviewFilter: ReviewFilter
): ReviewDraftState {
    return state.copy(
        requestedFilter = reviewFilter,
        presentedCard = null,
        preparedNextCardId = null,
        revealedCardId = null,
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

internal fun applyResolvedReviewFilter(
    state: ReviewDraftState,
    reviewFilter: ReviewFilter
): ReviewDraftState {
    return state.copy(
        requestedFilter = reviewFilter,
        presentedCard = null,
        preparedNextCardId = null,
        revealedCardId = null,
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

internal fun reviewFilterResolutionToApply(
    requestedFilter: ReviewFilter,
    resolvedFilter: ReviewFilter,
    availableTagNames: List<String>
): ReviewFilter? {
    if (requestedFilter == resolvedFilter) {
        return null
    }
    if (requestedFilter is ReviewFilter.Tags) {
        val availableTagKeys: Set<String> = availableTagNames.map { tagName ->
            normalizeTagKey(tag = tagName)
        }.toSet()
        val hasMissingRequestedTag: Boolean = requestedFilter.tags.any { tagName ->
            availableTagKeys.contains(normalizeTagKey(tag = tagName)).not()
        }
        if (hasMissingRequestedTag) {
            return null
        }
    }

    return resolvedFilter
}

internal fun nextReviewFilterGenerationAfterSelection(
    requestedFilter: ReviewFilter,
    selectedFilter: ReviewFilter,
    currentFilterGeneration: Long
): Long {
    if (requestedFilter == selectedFilter) {
        return currentFilterGeneration
    }

    return currentFilterGeneration + 1L
}

internal fun makeObservedReviewSessionSignature(
    observedState: ObservedReviewSessionState
): ObservedReviewSessionSignature {
    val sessionSnapshot = observedState.sessionSnapshot
    return ObservedReviewSessionSignature(
        requestedFilter = observedState.requestedFilter,
        selectedFilter = sessionSnapshot.selectedFilter,
        selectedFilterTitle = sessionSnapshot.selectedFilterTitle,
        reviewCards = sessionSnapshot.cards,
        presentedCard = sessionSnapshot.presentedCard,
        dueCount = sessionSnapshot.dueCount,
        remainingCount = sessionSnapshot.remainingCount,
        totalCount = sessionSnapshot.totalCount,
        hasMoreCards = sessionSnapshot.hasMoreCards
    )
}
