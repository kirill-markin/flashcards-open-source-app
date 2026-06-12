package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.review.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption

data class ReviewProgressBadgeState(
    val streakDays: Int,
    val hasReviewedToday: Boolean,
    val isInteractive: Boolean
)

data class ReviewLeaderboardBadgeState(
    val rank: Int?,
    val windowKey: ProgressLeaderboardWindowKey?,
    val isInteractive: Boolean
)

enum class ReviewEmptyState {
    NO_CARDS_YET,
    FILTER_EMPTY,
    SESSION_COMPLETE
}

data class ReviewUiState(
    val isLoading: Boolean,
    val selectedFilter: ReviewFilter,
    val selectedFilterTitle: String,
    val remainingCount: Int,
    val totalCount: Int,
    val reviewedInSessionCount: Int,
    val isAnswerVisible: Boolean,
    val currentCardIdForEditing: String?,
    val preparedCurrentCard: PreparedReviewCardPresentation?,
    val preparedNextCard: PreparedReviewCardPresentation?,
    val availableDeckFilters: List<ReviewDeckFilterOption>,
    val availableEffortFilters: List<ReviewEffortFilterOption>,
    val availableTagFilters: List<ReviewTagFilterOption>,
    val reviewLeaderboardBadge: ReviewLeaderboardBadgeState,
    val reviewProgressBadge: ReviewProgressBadgeState,
    val isPreviewLoading: Boolean,
    val previewItems: List<ReviewPreviewListItem>,
    val hasMorePreviewCards: Boolean,
    val emptyState: ReviewEmptyState?,
    val previewErrorMessage: String,
    val errorMessage: String,
    val isNotificationPermissionPromptVisible: Boolean,
    /** Shows the non-blocking reminder about choosing Again instead of Hard. */
    val isHardAnswerReminderVisible: Boolean
)
