package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilterOptions
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataStorage
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.sync.AppMetadataSyncStatus

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
        sessionWorkspaceId = null,
        requestedFilter = ReviewFilter.AllCards,
        isRequestedFilterSessionPending = false,
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
        availableTagFilters = emptyList(),
        areFilterOptionsLoaded = false,
        reviewLeaderboardBadge = createEmptyReviewLeaderboardBadgeState(),
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
        preparedNextCard = null,
        answerOptions = emptyList(),
        nextAnswerOptions = emptyList(),
        answerOptionsByCardId = emptyMap(),
        dueCount = 0,
        remainingCount = 0,
        totalCount = 0,
        hasMoreCards = false,
        reviewTagNames = emptyList(),
        nextDueAtMillis = null,
        isLoading = true
    )
}

internal fun mapToReviewUiState(
    observedSession: ObservedReviewSessionState,
    state: ReviewDraftState,
    appMetadata: AppMetadataSummary,
    progressSummarySnapshot: ProgressSummarySnapshot?,
    progressLeaderboardSnapshot: ProgressLeaderboardSnapshot?,
    mediaAssets: List<MediaAsset>,
    filterOptions: ReviewFilterOptions?,
    textProvider: ReviewTextProvider
): ReviewUiState {
    val sessionSnapshot = observedSession.sessionSnapshot
    val mediaAssetsById = mediaAssets.associateBy { mediaAsset ->
        mediaAsset.mediaAssetId
    }
    val queryInputs = observedSession.result.queryInputs
    val unreflectedRatings = queryInputs?.let { inputs ->
        unreflectedReviewRatings(state = state, observedRevision = inputs.ratingRevision)
    }.orEmpty()
    val pendingReviewedCardIds = state.pendingReviewedCards.mapTo(mutableSetOf(), PendingReviewedCard::cardId)
    fun isAvailableForPresentation(card: ReviewCard): Boolean {
        return card.isAvailableForPresentation(
            excludedCardIds = pendingReviewedCardIds,
            excludedRatings = unreflectedRatings
        )
    }
    val sessionCards = if (pendingReviewedCardIds.isEmpty() && unreflectedRatings.isEmpty()) {
        sessionSnapshot.cards
    } else {
        sessionSnapshot.cards.filter(::isAvailableForPresentation)
    }
    val sessionPreparedNextCard = sessionSnapshot.preparedNextCard?.takeIf(::isAvailableForPresentation)
    val sessionPresentedCard = sessionSnapshot.presentedCard?.takeIf(::isAvailableForPresentation)
        ?: sessionCards.firstOrNull { card -> card.cardId == state.presentedCard?.cardId }
        ?: sessionPreparedNextCard?.takeIf { card -> card.cardId == state.presentedCard?.cardId }
    val displayedCurrentCard = state.optimisticPreparedCurrentCard?.card
        ?: resolveDisplayedCurrentCard(sessionCards = sessionCards, presentedCard = sessionPresentedCard)
    val optimisticPreparedCurrentCard = state.optimisticPreparedCurrentCard?.let { presentation ->
        refreshPreparedReviewCardPresentationMedia(
            presentation = presentation,
            mediaAssetsById = mediaAssetsById,
            textProvider = textProvider
        )
    }
    val sessionPreparedCurrentCard = if (optimisticPreparedCurrentCard == null) {
        prepareDisplayedSessionCardPresentation(
            displayedCard = displayedCurrentCard,
            answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId,
            mediaAssetsById = mediaAssetsById,
            textProvider = textProvider
        )
    } else {
        null
    }
    val currentPreparedCard = optimisticPreparedCurrentCard ?: sessionPreparedCurrentCard
    val displayedNextCard = resolveDisplayedNextCard(
        sessionCards = sessionCards,
        sessionPreparedNextCard = sessionPreparedNextCard,
        preparedNextCardId = state.preparedNextCardId,
        displayedCurrentCard = displayedCurrentCard
    )
    val preparedNextCard = prepareDisplayedSessionCardPresentation(
        displayedCard = displayedNextCard,
        answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId,
        mediaAssetsById = mediaAssetsById,
        textProvider = textProvider
    )
    val remainingCount = displayedReviewRemainingCount(observed = observedSession, draft = state)
    val emptyState = resolveReviewEmptyState(
        selectedFilter = sessionSnapshot.selectedFilter,
        remainingCount = remainingCount,
        totalCount = sessionSnapshot.totalCount,
        workspaceCardCount = appMetadata.cardCount
    )

    return ReviewUiState(
        isLoading = sessionSnapshot.isLoading,
        sessionWorkspaceId = observedSession.result.workspaceId,
        requestedFilter = state.requestedFilter,
        isRequestedFilterSessionPending = observedSession.requestedFilter != state.requestedFilter,
        selectedFilter = sessionSnapshot.selectedFilter,
        selectedFilterTitle = textProvider.filterTitle(
            selectedFilter = sessionSnapshot.selectedFilter,
            deckTitle = sessionSnapshot.selectedFilterTitle
        ),
        remainingCount = remainingCount,
        totalCount = sessionSnapshot.totalCount,
        reviewedInSessionCount = state.reviewedInSessionCount,
        isAnswerVisible = state.revealedCardId == currentPreparedCard?.card?.cardId,
        currentCardIdForEditing = currentPreparedCard?.card?.cardId,
        preparedCurrentCard = currentPreparedCard,
        preparedNextCard = preparedNextCard,
        availableDeckFilters = filterOptions?.deckFilters ?: emptyList(),
        availableTagFilters = filterOptions?.tagFilters ?: emptyList(),
        areFilterOptionsLoaded = filterOptions != null,
        reviewLeaderboardBadge = progressLeaderboardSnapshot?.toReviewLeaderboardBadgeState()
            ?: createEmptyReviewLeaderboardBadgeState(),
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

/**
 * The pinned prepared next card while it is still queued, so background refreshes queue newly due cards
 * behind it. A rating pins its choice before the session re-emits, so the draft pin wins over the
 * session's own choice. See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
internal fun resolveDisplayedNextCard(
    sessionCards: List<ReviewCard>,
    sessionPreparedNextCard: ReviewCard?,
    preparedNextCardId: String?,
    displayedCurrentCard: ReviewCard?
): ReviewCard? {
    fun isSuccessor(card: ReviewCard): Boolean {
        return card.cardId != displayedCurrentCard?.cardId
    }
    val pinnedNextCard = sessionCards.firstOrNull { card ->
        card.cardId == preparedNextCardId
    }
    return pinnedNextCard?.takeIf(::isSuccessor)
        ?: sessionPreparedNextCard?.takeIf(::isSuccessor)
        ?: sessionCards.firstOrNull(::isSuccessor)
}

internal fun chooseNextCardIdAfterRating(
    sessionCards: List<ReviewCard>,
    nextPresentedCard: ReviewCard?,
    excludedCardIds: Set<String>,
    excludedRatings: Set<PendingReviewedCard>
): String? {
    val shownCard = nextPresentedCard ?: return null
    return sessionCards.firstOrNull { card ->
        card.cardId != shownCard.cardId && card.isAvailableForPresentation(
            excludedCardIds = excludedCardIds,
            excludedRatings = excludedRatings
        )
    }?.cardId
}

private fun ReviewCard.isAvailableForPresentation(
    excludedCardIds: Set<String>,
    excludedRatings: Set<PendingReviewedCard>
): Boolean {
    return cardId !in excludedCardIds && (
        excludedRatings.isEmpty() || PendingReviewedCard(cardId = cardId, updatedAtMillis = updatedAtMillis) !in excludedRatings
    )
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
    mediaAssetsById: Map<String, MediaAsset>,
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
        mediaAssetsById = mediaAssetsById,
        textProvider = textProvider
    )
}
