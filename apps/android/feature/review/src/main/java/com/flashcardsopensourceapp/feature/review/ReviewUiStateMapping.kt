package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.AppMetadataStorage
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.AppMetadataSyncStatus
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot

internal fun initialReviewAppMetadataSummary(textProvider: ReviewTextProvider): AppMetadataSummary {
    return AppMetadataSummary(
        currentWorkspaceName = textProvider.loadingLabel,
        workspaceName = textProvider.loadingLabel,
        deckCount = 0,
        cardCount = 0,
        localStorage = AppMetadataStorage.ROOM_SQLITE,
        syncStatus = AppMetadataSyncStatus.Message(text = textProvider.loadingLabel)
    )
}

internal fun initialReviewUiState(textProvider: ReviewTextProvider): ReviewUiState {
    return ReviewUiState(
        isLoading = true,
        selectedFilter = ReviewFilter.AllCards,
        selectedFilterTitle = textProvider.allCardsTitle(),
        remainingCount = 0,
        totalCount = 0,
        reviewedInSessionCount = 0,
        isAnswerVisible = false,
        currentCardIdForEditing = null,
        preparedCurrentCard = null,
        preparedNextCard = null,
        availableDeckFilters = emptyList(),
        availableEffortFilters = emptyList(),
        availableTagFilters = emptyList(),
        reviewProgressBadge = createEmptyReviewProgressBadgeState(),
        isPreviewLoading = false,
        previewItems = emptyList(),
        hasMorePreviewCards = true,
        emptyState = null,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

internal fun loadingReviewSessionSnapshot(textProvider: ReviewTextProvider): ReviewSessionSnapshot {
    return ReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        selectedFilterTitle = textProvider.allCardsTitle(),
        cards = emptyList(),
        presentedCard = null,
        answerOptions = emptyList(),
        nextAnswerOptions = emptyList(),
        answerOptionsByCardId = emptyMap(),
        dueCount = 0,
        remainingCount = 0,
        totalCount = 0,
        hasMoreCards = false,
        availableDeckFilters = emptyList(),
        availableEffortFilters = emptyList(),
        availableTagFilters = emptyList(),
        isLoading = true
    )
}

internal fun mapToReviewUiState(
    sessionSnapshot: ReviewSessionSnapshot,
    state: ReviewDraftState,
    appMetadata: AppMetadataSummary,
    progressSummarySnapshot: ProgressSummarySnapshot?,
    textProvider: ReviewTextProvider
): ReviewUiState {
    val displayedCurrentCard = state.optimisticPreparedCurrentCard?.card
        ?: resolveDisplayedCurrentCard(
            sessionCards = sessionSnapshot.cards,
            presentedCard = sessionSnapshot.presentedCard
        )
    val displayedQueue = buildDisplayedReviewQueue(
        sessionCards = sessionSnapshot.cards,
        displayedCurrentCard = displayedCurrentCard
    )
    val sessionPreparedCurrentCard = if (state.optimisticPreparedCurrentCard == null) {
        prepareDisplayedSessionCardPresentation(
            displayedCard = displayedCurrentCard,
            answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId,
            textProvider = textProvider
        )
    } else {
        null
    }
    val currentPreparedCard = state.optimisticPreparedCurrentCard ?: sessionPreparedCurrentCard
    val displayedNextCard = displayedQueue.getOrNull(index = 1)
    val preparedNextCard = prepareDisplayedSessionCardPresentation(
        displayedCard = displayedNextCard,
        answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId,
        textProvider = textProvider
    )
    val emptyState = resolveReviewEmptyState(
        selectedFilter = sessionSnapshot.selectedFilter,
        remainingCount = sessionSnapshot.remainingCount,
        totalCount = sessionSnapshot.totalCount,
        workspaceCardCount = appMetadata.cardCount
    )

    return ReviewUiState(
        isLoading = sessionSnapshot.isLoading,
        selectedFilter = sessionSnapshot.selectedFilter,
        selectedFilterTitle = textProvider.filterTitle(
            selectedFilter = sessionSnapshot.selectedFilter,
            availableDeckFilters = sessionSnapshot.availableDeckFilters
        ),
        remainingCount = sessionSnapshot.remainingCount,
        totalCount = sessionSnapshot.totalCount,
        reviewedInSessionCount = state.reviewedInSessionCount,
        isAnswerVisible = state.revealedCardId == currentPreparedCard?.card?.cardId,
        currentCardIdForEditing = currentPreparedCard?.card?.cardId,
        preparedCurrentCard = currentPreparedCard,
        preparedNextCard = preparedNextCard,
        availableDeckFilters = sessionSnapshot.availableDeckFilters,
        availableEffortFilters = sessionSnapshot.availableEffortFilters,
        availableTagFilters = sessionSnapshot.availableTagFilters,
        reviewProgressBadge = progressSummarySnapshot?.toReviewProgressBadgeState()
            ?: createEmptyReviewProgressBadgeState(),
        isPreviewLoading = state.isPreviewLoading,
        previewItems = buildReviewPreviewItems(
            cards = state.previewCards,
            currentCardId = currentPreparedCard?.card?.cardId,
            textProvider = textProvider
        ),
        hasMorePreviewCards = state.hasMorePreviewCards,
        emptyState = emptyState,
        previewErrorMessage = state.previewErrorMessage,
        errorMessage = state.errorMessage,
        isNotificationPermissionPromptVisible = state.isNotificationPermissionPromptVisible,
        isHardAnswerReminderVisible = state.isHardAnswerReminderVisible
    )
}

private fun resolveReviewEmptyState(
    selectedFilter: ReviewFilter,
    remainingCount: Int,
    totalCount: Int,
    workspaceCardCount: Int
): ReviewEmptyState? {
    if (remainingCount > 0) {
        return null
    }

    if (totalCount > 0) {
        return ReviewEmptyState.SESSION_COMPLETE
    }

    if (workspaceCardCount == 0) {
        return ReviewEmptyState.NO_CARDS_YET
    }

    return if (selectedFilter == ReviewFilter.AllCards) {
        ReviewEmptyState.SESSION_COMPLETE
    } else {
        ReviewEmptyState.FILTER_EMPTY
    }
}

internal fun resolveDisplayedCurrentCard(
    sessionCards: List<ReviewCard>,
    presentedCard: ReviewCard?
): ReviewCard? {
    val presentedCardId = presentedCard?.cardId
    return sessionCards.firstOrNull { card ->
        card.cardId == presentedCardId
    } ?: presentedCard ?: sessionCards.firstOrNull()
}

internal fun buildDisplayedReviewQueue(
    sessionCards: List<ReviewCard>,
    displayedCurrentCard: ReviewCard?
): List<ReviewCard> {
    if (displayedCurrentCard == null) {
        return sessionCards
    }

    return buildList {
        add(displayedCurrentCard)
        sessionCards.forEach { card ->
            if (card.cardId != displayedCurrentCard.cardId) {
                add(card)
            }
        }
    }
}

internal fun resolveDisplayedSessionAnswerOptions(
    displayedCard: ReviewCard?,
    answerOptionsByCardId: Map<String, List<ReviewAnswerOption>>
): List<ReviewAnswerOption>? {
    val card = displayedCard ?: return null
    return answerOptionsByCardId[card.cardId]
}

internal fun prepareDisplayedSessionCardPresentation(
    displayedCard: ReviewCard?,
    answerOptionsByCardId: Map<String, List<ReviewAnswerOption>>,
    textProvider: ReviewTextProvider
): PreparedReviewCardPresentation? {
    val card = displayedCard ?: return null
    val answerOptions = requireNotNull(
        resolveDisplayedSessionAnswerOptions(
            displayedCard = card,
            answerOptionsByCardId = answerOptionsByCardId
        )
    ) {
        "Review answer options are missing for displayed card: ${card.cardId}"
    }
    require(answerOptions.isNotEmpty()) {
        "Review answer options are empty for displayed card: ${card.cardId}"
    }

    return prepareReviewCardPresentation(
        card = card,
        answerOptions = answerOptions,
        textProvider = textProvider
    )
}
