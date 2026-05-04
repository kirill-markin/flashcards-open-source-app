package com.flashcardsopensourceapp.feature.progress

import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import java.time.LocalDate

data class ProgressHistoryDayUiState(
    val date: LocalDate,
    val dayOfMonthLabel: String,
    val reviewCount: Int,
    val isToday: Boolean
)

data class ProgressReviewPageUiState(
    val startDate: LocalDate,
    val endDate: LocalDate,
    val startDateKey: String,
    val days: List<ProgressHistoryDayUiState>,
    val hasReviewActivity: Boolean,
    val upperBound: Int
)

data class ProgressStreakDayUiState(
    val date: LocalDate?,
    val dayOfMonthLabel: String?,
    val reviewCount: Int,
    val isToday: Boolean,
    val isPlaceholder: Boolean
)

data class ProgressStreakWeekUiState(
    val days: List<ProgressStreakDayUiState>
)

data class ProgressStreakSectionUiState(
    val weekdayLabels: List<String>,
    val weeks: List<ProgressStreakWeekUiState>
)

data class ProgressReviewsSectionUiState(
    val pages: List<ProgressReviewPageUiState>
)

data class ProgressReviewScheduleBucketUiState(
    val key: ProgressReviewScheduleBucketKey,
    val count: Int,
    val percentage: Float
)

data class ProgressReviewScheduleSectionUiState(
    val totalCards: Int,
    val buckets: List<ProgressReviewScheduleBucketUiState>,
    val hasCards: Boolean
)

sealed interface ProgressSummaryUiState {
    data object Loading : ProgressSummaryUiState

    data class Loaded(
        val summary: CloudProgressSummary
    ) : ProgressSummaryUiState
}

sealed interface ProgressUiState {
    data object Loading : ProgressUiState

    data object SignInRequired : ProgressUiState

    data object Unavailable : ProgressUiState

    data class Error(
        val message: String?
    ) : ProgressUiState

    data class Loaded(
        val summary: ProgressSummaryUiState,
        val streakSection: ProgressStreakSectionUiState,
        val reviewsSection: ProgressReviewsSectionUiState,
        val reviewScheduleSection: ProgressReviewScheduleSectionUiState?
    ) : ProgressUiState
}
