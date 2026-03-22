package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val reviewPreviewPageSize: Int = 20

private data class ReviewDraftState(
    val requestedFilter: ReviewFilter,
    val revealedCardId: String?,
    val reviewedInSessionCount: Int,
    val pendingReviewedCardIds: Set<String>,
    val previewCards: List<ReviewCard>,
    val nextPreviewOffset: Int,
    val hasMorePreviewCards: Boolean,
    val isPreviewLoading: Boolean,
    val previewErrorMessage: String,
    val errorMessage: String
)

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModel(
    private val reviewRepository: ReviewRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = ReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            revealedCardId = null,
            reviewedInSessionCount = 0,
            pendingReviewedCardIds = emptySet(),
            previewCards = emptyList(),
            nextPreviewOffset = 0,
            hasMorePreviewCards = true,
            isPreviewLoading = false,
            previewErrorMessage = "",
            errorMessage = ""
        )
    )

    private val reviewSession = draftState.flatMapLatest { state ->
        reviewRepository.observeReviewSession(
            selectedFilter = state.requestedFilter,
            pendingReviewedCardIds = state.pendingReviewedCardIds
        )
    }

    val uiState: StateFlow<ReviewUiState> = combine(
        reviewSession,
        draftState
    ) { sessionSnapshot, state ->
        val currentCard = sessionSnapshot.cards.firstOrNull()

        ReviewUiState(
            isLoading = sessionSnapshot.isLoading,
            selectedFilter = sessionSnapshot.selectedFilter,
            selectedFilterTitle = sessionSnapshot.selectedFilterTitle,
            remainingCount = sessionSnapshot.remainingCount,
            totalCount = sessionSnapshot.totalCount,
            reviewedInSessionCount = state.reviewedInSessionCount,
            isAnswerVisible = state.revealedCardId == currentCard?.cardId,
            cards = sessionSnapshot.cards,
            currentCard = currentCard,
            answerOptions = sessionSnapshot.answerOptions,
            availableDeckFilters = sessionSnapshot.availableDeckFilters,
            availableTagFilters = sessionSnapshot.availableTagFilters,
            isPreviewLoading = state.isPreviewLoading,
            previewCards = state.previewCards,
            hasMorePreviewCards = state.hasMorePreviewCards,
            previewErrorMessage = state.previewErrorMessage,
            errorMessage = state.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = ReviewUiState(
            isLoading = true,
            selectedFilter = ReviewFilter.AllCards,
            selectedFilterTitle = "All cards",
            remainingCount = 0,
            totalCount = 0,
            reviewedInSessionCount = 0,
            isAnswerVisible = false,
            cards = emptyList(),
            currentCard = null,
            answerOptions = emptyList(),
            availableDeckFilters = emptyList(),
            availableTagFilters = emptyList(),
            isPreviewLoading = false,
            previewCards = emptyList(),
            hasMorePreviewCards = true,
            previewErrorMessage = "",
            errorMessage = ""
        )
    )

    fun selectFilter(reviewFilter: ReviewFilter) {
        draftState.update { state ->
            state.copy(
                requestedFilter = reviewFilter,
                revealedCardId = null,
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = false,
                previewErrorMessage = "",
                errorMessage = ""
            )
        }
    }

    fun revealAnswer() {
        val currentCardId = uiState.value.currentCard?.cardId ?: return
        draftState.update { state ->
            state.copy(
                revealedCardId = currentCardId,
                errorMessage = ""
            )
        }
    }

    fun dismissErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }

    fun startPreview() {
        val currentState = draftState.value
        if (currentState.isPreviewLoading) {
            return
        }

        draftState.update { state ->
            state.copy(
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = true,
                previewErrorMessage = ""
            )
        }
        loadPreviewPage(offset = 0, replaceCards = true)
    }

    fun loadNextPreviewPageIfNeeded(itemCardId: String) {
        val currentState = draftState.value
        if (currentState.isPreviewLoading) {
            return
        }
        if (currentState.hasMorePreviewCards.not()) {
            return
        }
        if (currentState.previewCards.lastOrNull()?.cardId != itemCardId) {
            return
        }

        draftState.update { state ->
            state.copy(
                isPreviewLoading = true,
                previewErrorMessage = ""
            )
        }
        loadPreviewPage(
            offset = currentState.nextPreviewOffset,
            replaceCards = false
        )
    }

    fun retryPreview() {
        startPreview()
    }

    fun rateCard(rating: ReviewRating) {
        val currentCard = uiState.value.currentCard ?: return
        val cardId = currentCard.cardId

        draftState.update { state ->
            state.copy(
                revealedCardId = null,
                pendingReviewedCardIds = state.pendingReviewedCardIds + cardId,
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = false,
                previewErrorMessage = "",
                errorMessage = ""
            )
        }

        viewModelScope.launch {
            try {
                reviewRepository.recordReview(
                    cardId = cardId,
                    rating = rating,
                    reviewedAtMillis = System.currentTimeMillis()
                )
                draftState.update { state ->
                    state.copy(
                        reviewedInSessionCount = state.reviewedInSessionCount + 1
                    )
                }
            } catch (error: Throwable) {
                draftState.update { state ->
                    state.copy(
                        pendingReviewedCardIds = state.pendingReviewedCardIds - cardId,
                        errorMessage = error.message ?: "Review could not be saved."
                    )
                }
            }
        }
    }

    private fun loadPreviewPage(offset: Int, replaceCards: Boolean) {
        val requestedFilter = uiState.value.selectedFilter
        val pendingReviewedCardIds = draftState.value.pendingReviewedCardIds

        viewModelScope.launch {
            try {
                val page = reviewRepository.loadReviewTimelinePage(
                    selectedFilter = requestedFilter,
                    pendingReviewedCardIds = pendingReviewedCardIds,
                    offset = offset,
                    limit = reviewPreviewPageSize
                )

                draftState.update { state ->
                    val mergedCards = if (replaceCards) {
                        page.cards
                    } else {
                        (state.previewCards + page.cards).distinctBy { card ->
                            card.cardId
                        }
                    }

                    state.copy(
                        previewCards = mergedCards,
                        nextPreviewOffset = mergedCards.size,
                        hasMorePreviewCards = page.hasMoreCards,
                        isPreviewLoading = false,
                        previewErrorMessage = ""
                    )
                }
            } catch (error: Throwable) {
                draftState.update { state ->
                    state.copy(
                        isPreviewLoading = false,
                        previewErrorMessage = error.message ?: "Review queue could not be loaded."
                    )
                }
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
