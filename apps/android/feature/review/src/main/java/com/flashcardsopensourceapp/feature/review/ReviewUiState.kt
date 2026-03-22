package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.ReviewCard

data class ReviewUiState(
    val isLoading: Boolean,
    val cards: List<ReviewCard>,
    val currentIndex: Int,
    val isAnswerVisible: Boolean,
    val reviewedCount: Int
) {
    val currentCard: ReviewCard?
        get() = cards.getOrNull(currentIndex)
}
