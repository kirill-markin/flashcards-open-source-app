package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.ReviewTimelinePage

internal const val reviewPreviewPageSize: Int = 20

internal fun shouldStartReviewPreview(state: ReviewDraftState): Boolean {
    return state.isPreviewLoading.not()
}

internal fun applyStartReviewPreview(state: ReviewDraftState): ReviewDraftState {
    return state.copy(
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = true,
        previewErrorMessage = ""
    )
}

internal fun shouldLoadNextReviewPreviewPage(
    state: ReviewDraftState,
    itemCardId: String
): Boolean {
    if (state.isPreviewLoading) {
        return false
    }
    if (state.hasMorePreviewCards.not()) {
        return false
    }
    return state.previewCards.lastOrNull()?.cardId == itemCardId
}

internal fun applyReviewPreviewPageLoading(state: ReviewDraftState): ReviewDraftState {
    return state.copy(
        isPreviewLoading = true,
        previewErrorMessage = ""
    )
}

internal fun applyLoadedReviewPreviewPage(
    state: ReviewDraftState,
    page: ReviewTimelinePage,
    replaceCards: Boolean
): ReviewDraftState {
    val mergedCards = if (replaceCards) {
        page.cards
    } else {
        (state.previewCards + page.cards).distinctBy { card ->
            card.cardId
        }
    }

    return state.copy(
        previewCards = mergedCards,
        nextPreviewOffset = mergedCards.size,
        hasMorePreviewCards = page.hasMoreCards,
        isPreviewLoading = false,
        previewErrorMessage = ""
    )
}

internal fun applyFailedReviewPreviewPage(
    state: ReviewDraftState,
    errorMessage: String
): ReviewDraftState {
    return state.copy(
        isPreviewLoading = false,
        previewErrorMessage = errorMessage
    )
}
