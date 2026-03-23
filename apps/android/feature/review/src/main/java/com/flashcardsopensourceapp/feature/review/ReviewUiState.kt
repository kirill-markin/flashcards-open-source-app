package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption

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
    val availableTagFilters: List<ReviewTagFilterOption>,
    val isPreviewLoading: Boolean,
    val previewItems: List<ReviewPreviewListItem>,
    val hasMorePreviewCards: Boolean,
    val previewErrorMessage: String,
    val errorMessage: String
)
