package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
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
private const val reviewUpdatedOnAnotherDeviceMessage: String = "This review updated on another device."

private data class ReviewDraftState(
    val requestedFilter: ReviewFilter,
    val revealedCardId: String?,
    val reviewedInSessionCount: Int,
    val pendingReviewedCardIds: Set<String>,
    val optimisticPreparedCurrentCard: PreparedReviewCardPresentation?,
    val previewCards: List<ReviewCard>,
    val nextPreviewOffset: Int,
    val hasMorePreviewCards: Boolean,
    val isPreviewLoading: Boolean,
    val previewErrorMessage: String,
    val errorMessage: String
)

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModel(
    private val reviewRepository: ReviewRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = ReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            revealedCardId = null,
            reviewedInSessionCount = 0,
            pendingReviewedCardIds = emptySet(),
            optimisticPreparedCurrentCard = null,
            previewCards = emptyList(),
            nextPreviewOffset = 0,
            hasMorePreviewCards = true,
            isPreviewLoading = false,
            previewErrorMessage = "",
            errorMessage = ""
        )
    )

    private val reviewSessionState = draftState.flatMapLatest { state ->
        reviewRepository.observeReviewSession(
            selectedFilter = state.requestedFilter,
            pendingReviewedCardIds = state.pendingReviewedCardIds
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = loadingReviewSessionSnapshot()
    )

    private val syncStatusState = syncRepository.observeSyncStatus().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )

    private var previousSyncStatus: SyncStatus = SyncStatus.Idle
    private var reviewCardIdsAtSyncStart: List<String>? = null
    private var lastHandledSuccessfulSyncAtMillis: Long? = null

    val uiState: StateFlow<ReviewUiState> = combine(
        reviewSessionState,
        draftState
    ) { sessionSnapshot, state ->
        val sessionCurrentCard = sessionSnapshot.cards.firstOrNull()
        val sessionPreparedCurrentCard = sessionCurrentCard?.let { card ->
            prepareReviewCardPresentation(
                card = card,
                answerOptions = sessionSnapshot.answerOptions
            )
        }
        val currentPreparedCard = if (
            state.optimisticPreparedCurrentCard != null
            && sessionPreparedCurrentCard?.card?.cardId != state.optimisticPreparedCurrentCard.card.cardId
        ) {
            state.optimisticPreparedCurrentCard
        } else {
            sessionPreparedCurrentCard
        }
        val preparedNextCard = if (currentPreparedCard?.card?.cardId == sessionPreparedCurrentCard?.card?.cardId) {
            sessionSnapshot.cards.getOrNull(index = 1)?.let { card ->
                prepareReviewCardPresentation(
                    card = card,
                    answerOptions = sessionSnapshot.nextAnswerOptions
                )
            }
        } else {
            null
        }

        ReviewUiState(
            isLoading = sessionSnapshot.isLoading,
            selectedFilter = sessionSnapshot.selectedFilter,
            selectedFilterTitle = sessionSnapshot.selectedFilterTitle,
            remainingCount = sessionSnapshot.remainingCount,
            totalCount = sessionSnapshot.totalCount,
            reviewedInSessionCount = state.reviewedInSessionCount,
            isAnswerVisible = state.revealedCardId == currentPreparedCard?.card?.cardId,
            currentCardIdForEditing = currentPreparedCard?.card?.cardId,
            preparedCurrentCard = currentPreparedCard,
            preparedNextCard = preparedNextCard,
            availableDeckFilters = sessionSnapshot.availableDeckFilters,
            availableTagFilters = sessionSnapshot.availableTagFilters,
            isPreviewLoading = state.isPreviewLoading,
            previewItems = buildReviewPreviewItems(
                cards = state.previewCards,
                currentCardId = currentPreparedCard?.card?.cardId
            ),
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
            currentCardIdForEditing = null,
            preparedCurrentCard = null,
            preparedNextCard = null,
            availableDeckFilters = emptyList(),
            availableTagFilters = emptyList(),
            isPreviewLoading = false,
            previewItems = emptyList(),
            hasMorePreviewCards = true,
            previewErrorMessage = "",
            errorMessage = ""
        )
    )

    init {
        observeSyncDrivenReviewChanges()
    }

    fun selectFilter(reviewFilter: ReviewFilter) {
        draftState.update { state ->
            state.copy(
                requestedFilter = reviewFilter,
                revealedCardId = null,
                optimisticPreparedCurrentCard = null,
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
        val currentCardId = uiState.value.preparedCurrentCard?.card?.cardId ?: return
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
        val currentCard = uiState.value.preparedCurrentCard?.card ?: return
        val cardId = currentCard.cardId
        val optimisticPreparedCurrentCard = uiState.value.preparedNextCard

        draftState.update { state ->
            state.copy(
                revealedCardId = null,
                pendingReviewedCardIds = state.pendingReviewedCardIds + cardId,
                optimisticPreparedCurrentCard = optimisticPreparedCurrentCard,
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
                        reviewedInSessionCount = state.reviewedInSessionCount + 1,
                        optimisticPreparedCurrentCard = null
                    )
                }
            } catch (error: Throwable) {
                draftState.update { state ->
                    state.copy(
                        pendingReviewedCardIds = state.pendingReviewedCardIds - cardId,
                        optimisticPreparedCurrentCard = null,
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

    private fun observeSyncDrivenReviewChanges() {
        viewModelScope.launch {
            combine(reviewSessionState, syncStatusState) { sessionSnapshot, syncStatusSnapshot ->
                sessionSnapshot to syncStatusSnapshot
            }.collect { (sessionSnapshot, syncStatusSnapshot) ->
                handleSyncStatusTransition(
                    sessionSnapshot = sessionSnapshot,
                    syncStatusSnapshot = syncStatusSnapshot
                )
            }
        }
    }

    private fun handleSyncStatusTransition(
        sessionSnapshot: ReviewSessionSnapshot,
        syncStatusSnapshot: SyncStatusSnapshot
    ) {
        val currentSyncStatus = syncStatusSnapshot.status

        if (currentSyncStatus is SyncStatus.Syncing && previousSyncStatus !is SyncStatus.Syncing) {
            reviewCardIdsAtSyncStart = sessionSnapshot.cards.map(ReviewCard::cardId)
        }

        val completedSuccessfulSync = currentSyncStatus is SyncStatus.Idle
            && previousSyncStatus is SyncStatus.Syncing
            && syncStatusSnapshot.lastSuccessfulSyncAtMillis != null
            && syncStatusSnapshot.lastSuccessfulSyncAtMillis != lastHandledSuccessfulSyncAtMillis

        if (completedSuccessfulSync) {
            reconcileReviewAfterSuccessfulSync(sessionSnapshot = sessionSnapshot)
            lastHandledSuccessfulSyncAtMillis = syncStatusSnapshot.lastSuccessfulSyncAtMillis
            reviewCardIdsAtSyncStart = null
        }

        if (currentSyncStatus is SyncStatus.Failed && previousSyncStatus is SyncStatus.Syncing) {
            reviewCardIdsAtSyncStart = null
        }

        previousSyncStatus = currentSyncStatus
    }

    private fun reconcileReviewAfterSuccessfulSync(sessionSnapshot: ReviewSessionSnapshot) {
        val reviewCardIdsBeforeSync = reviewCardIdsAtSyncStart ?: return
        val reviewCardIdsAfterSync = sessionSnapshot.cards.map(ReviewCard::cardId)

        if (reviewCardIdsBeforeSync == reviewCardIdsAfterSync) {
            return
        }

        val postSyncCurrentCardId = reviewCardIdsAfterSync.firstOrNull()
        draftState.update { state ->
            state.copy(
                revealedCardId = if (state.revealedCardId == postSyncCurrentCardId) {
                    state.revealedCardId
                } else {
                    null
                },
                optimisticPreparedCurrentCard = if (state.optimisticPreparedCurrentCard?.card?.cardId == postSyncCurrentCardId) {
                    state.optimisticPreparedCurrentCard
                } else {
                    null
                },
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = false,
                previewErrorMessage = ""
            )
        }
        messageController.showMessage(message = reviewUpdatedOnAnotherDeviceMessage)
    }
}

fun createReviewViewModelFactory(
    reviewRepository: ReviewRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ReviewViewModel(
                reviewRepository = reviewRepository,
                syncRepository = syncRepository,
                messageController = messageController
            )
        }
    }
}

private fun loadingReviewSessionSnapshot(): ReviewSessionSnapshot {
    return ReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        selectedFilterTitle = "All cards",
        cards = emptyList(),
        answerOptions = emptyList(),
        nextAnswerOptions = emptyList(),
        remainingCount = 0,
        totalCount = 0,
        availableDeckFilters = emptyList(),
        availableTagFilters = emptyList(),
        isLoading = true
    )
}
