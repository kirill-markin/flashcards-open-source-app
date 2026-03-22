package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private data class ReviewDraftState(
    val currentIndex: Int,
    val isAnswerVisible: Boolean,
    val reviewedCount: Int
)

class ReviewViewModel(
    private val reviewRepository: ReviewRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = ReviewDraftState(
            currentIndex = 0,
            isAnswerVisible = false,
            reviewedCount = 0
        )
    )

    val uiState: StateFlow<ReviewUiState> = combine(
        reviewRepository.observeReviewCards(),
        draftState
    ) { cards, state ->
        val resolvedIndex = resolveReviewIndex(
            cards = cards,
            requestedIndex = state.currentIndex
        )

        ReviewUiState(
            isLoading = false,
            cards = cards,
            currentIndex = resolvedIndex,
            isAnswerVisible = state.isAnswerVisible,
            reviewedCount = state.reviewedCount
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = ReviewUiState(
            isLoading = true,
            cards = emptyList(),
            currentIndex = 0,
            isAnswerVisible = false,
            reviewedCount = 0
        )
    )

    fun revealAnswer() {
        draftState.update { state ->
            state.copy(isAnswerVisible = true)
        }
    }

    fun rateCard(rating: ReviewRating) {
        val currentCard = uiState.value.currentCard ?: return

        viewModelScope.launch {
            // TODO: Port queue warming and next-card preparation from apps/ios/Flashcards/Flashcards/ReviewView.swift.
            // TODO: Port review filters by deck and tag from apps/ios/Flashcards/Flashcards/ReviewView.swift.
            // TODO: Port review queue preview timeline behavior from apps/ios/Flashcards/Flashcards/ReviewQueuePreviewScreen.swift.
            reviewRepository.recordReview(
                cardId = currentCard.cardId,
                rating = rating,
                reviewedAtMillis = System.currentTimeMillis()
            )

            draftState.update { state ->
                state.copy(
                    currentIndex = state.currentIndex + 1,
                    isAnswerVisible = false,
                    reviewedCount = state.reviewedCount + 1
                )
            }
        }
    }
}

fun createReviewViewModelFactory(reviewRepository: ReviewRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ReviewViewModel(reviewRepository = reviewRepository)
        }
    }
}

private fun resolveReviewIndex(cards: List<ReviewCard>, requestedIndex: Int): Int {
    if (cards.isEmpty()) {
        return 0
    }

    return minOf(requestedIndex, cards.lastIndex)
}
