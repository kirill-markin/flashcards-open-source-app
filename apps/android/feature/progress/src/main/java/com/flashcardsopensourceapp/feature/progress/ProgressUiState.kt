package com.flashcardsopensourceapp.feature.progress

import java.time.LocalDate

data class ProgressHistoryDayUiState(
    val date: LocalDate,
    val dayOfMonthLabel: String,
    val chartLabel: String?,
    val reviewCount: Int,
    val isToday: Boolean
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
    val days: List<ProgressHistoryDayUiState>,
    val maxReviewCount: Int
)

sealed interface ProgressUiState {
    data object Loading : ProgressUiState

    data object SignInRequired : ProgressUiState

    data object Unavailable : ProgressUiState

    data class Error(
        val message: String
    ) : ProgressUiState

    data class Loaded(
        val streakSection: ProgressStreakSectionUiState,
        val reviewsSection: ProgressReviewsSectionUiState
    ) : ProgressUiState
}
