package com.flashcardsopensourceapp.feature.progress

import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
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

sealed interface ProgressLeaderboardRowUiState {
    data class Participant(
        val rank: Int,
        val displayName: String,
        val qualifiedReviewCount: Int,
        val isViewer: Boolean
    ) : ProgressLeaderboardRowUiState

    data object Gap : ProgressLeaderboardRowUiState
}

data class ProgressLeaderboardWindowUiState(
    val windowKey: ProgressLeaderboardWindowKey,
    val participantCount: Int,
    val rows: List<ProgressLeaderboardRowUiState>,
    val snapshotGeneratedAtMillis: Long?
)

sealed interface ProgressLeaderboardSectionUiState {
    data object Loading : ProgressLeaderboardSectionUiState

    data object SignInRequired : ProgressLeaderboardSectionUiState

    data object ParticipationDisabled : ProgressLeaderboardSectionUiState

    data object Offline : ProgressLeaderboardSectionUiState

    data object SnapshotUnavailable : ProgressLeaderboardSectionUiState

    data class Ready(
        // Server-localized explanation that Hard/Good/Easy count and Again does not;
        // null falls back to the client string resource.
        val metricDescription: String?,
        val selectedWindowKey: ProgressLeaderboardWindowKey,
        val windows: List<ProgressLeaderboardWindowUiState>
    ) : ProgressLeaderboardSectionUiState {
        val selectedWindow: ProgressLeaderboardWindowUiState?
            get() = windows.firstOrNull { window -> window.windowKey == selectedWindowKey }
    }
}

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
        val reviewScheduleSection: ProgressReviewScheduleSectionUiState?,
        val leaderboardSection: ProgressLeaderboardSectionUiState
    ) : ProgressUiState
}
