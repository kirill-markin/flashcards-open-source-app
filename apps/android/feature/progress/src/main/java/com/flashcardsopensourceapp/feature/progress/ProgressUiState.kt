package com.flashcardsopensourceapp.feature.progress

import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardProfileStatus
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import java.time.LocalDate

data class ProgressHistoryDayUiState(
    val date: LocalDate,
    val dayOfMonthLabel: String,
    val reviewCount: Int,
    val againCount: Int,
    val hardCount: Int,
    val goodCount: Int,
    val easyCount: Int,
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
    val state: CloudProgressStreakDayState?,
    val isToday: Boolean,
    val isPlaceholder: Boolean
)

data class ProgressStreakWeekUiState(
    val days: List<ProgressStreakDayUiState>
)

data class ProgressFreezeBankUiState(
    val availableCredits: Int,
    val capacity: Int,
    val nextCreditProgressUnits: Int,
    val nextCreditRequiredUnits: Int
)

data class ProgressStreakSectionUiState(
    val weekdayLabels: List<String>,
    val weeks: List<ProgressStreakWeekUiState>,
    val freezeBankSummary: ProgressFreezeBankUiState?
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

data class ProgressLeaderboardProfileIdentityUiState(
    val publicProfileId: String,
    val displayName: String,
    val anonymousDisplayName: String,
    val friendDisplayName: String?,
    val isViewer: Boolean
)

sealed interface ProgressLeaderboardRowUiState {
    data class Participant(
        val rank: Int,
        val displayName: String,
        val publicProfileId: String,
        val anonymousDisplayName: String,
        val friendDisplayName: String?,
        val qualifiedReviewCount: Int,
        val isViewer: Boolean
    ) : ProgressLeaderboardRowUiState {
        val profileIdentity: ProgressLeaderboardProfileIdentityUiState
            get() = ProgressLeaderboardProfileIdentityUiState(
                publicProfileId = publicProfileId,
                displayName = displayName,
                anonymousDisplayName = anonymousDisplayName,
                friendDisplayName = friendDisplayName,
                isViewer = isViewer
            )
    }

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
        val windows: List<ProgressLeaderboardWindowUiState>,
        val reservedRowCount: Int
    ) : ProgressLeaderboardSectionUiState {
        val selectedWindow: ProgressLeaderboardWindowUiState?
            get() = windows.firstOrNull { window -> window.windowKey == selectedWindowKey }
    }
}

sealed interface ProgressStreakLeaderboardRowUiState {
    data class Participant(
        val rank: Int,
        val displayName: String,
        val publicProfileId: String,
        val anonymousDisplayName: String,
        val friendDisplayName: String?,
        val streakDays: Int,
        val isViewer: Boolean
    ) : ProgressStreakLeaderboardRowUiState {
        val profileIdentity: ProgressLeaderboardProfileIdentityUiState
            get() = ProgressLeaderboardProfileIdentityUiState(
                publicProfileId = publicProfileId,
                displayName = displayName,
                anonymousDisplayName = anonymousDisplayName,
                friendDisplayName = friendDisplayName,
                isViewer = isViewer
            )
    }

    data object Gap : ProgressStreakLeaderboardRowUiState
}

sealed interface ProgressStreakLeaderboardSectionUiState {
    data object Loading : ProgressStreakLeaderboardSectionUiState

    data object SignInRequired : ProgressStreakLeaderboardSectionUiState

    data object ParticipationDisabled : ProgressStreakLeaderboardSectionUiState

    data object Offline : ProgressStreakLeaderboardSectionUiState

    data object SnapshotUnavailable : ProgressStreakLeaderboardSectionUiState

    data class Ready(
        // Server-localized explanation that public streak rankings may trail live local streaks;
        // null falls back to the client string resource.
        val metricDescription: String?,
        val participantCount: Int,
        val rows: List<ProgressStreakLeaderboardRowUiState>,
        val snapshotGeneratedAtMillis: Long?
    ) : ProgressStreakLeaderboardSectionUiState
}

sealed interface ProgressSummaryUiState {
    data object Loading : ProgressSummaryUiState

    data class Loaded(
        val summary: CloudProgressSummary,
        val freezeBankSummary: ProgressFreezeBankUiState
    ) : ProgressSummaryUiState
}

data class ProgressLeaderboardProfileBestRatingPlacementUiState(
    val windowKey: ProgressLeaderboardWindowKey,
    val rank: Int
)

data class ProgressLeaderboardProfileReviewActivityDayUiState(
    val date: LocalDate,
    val reviewCount: Int
)

data class ProgressLeaderboardProfileReadyUiState(
    val publicProfileId: String,
    val anonymousDisplayName: String,
    val friendDisplayName: String?,
    val isFriend: Boolean,
    val currentStreakDays: Int,
    val bestRatingPlacement: ProgressLeaderboardProfileBestRatingPlacementUiState?,
    val reviewActivityDays: List<ProgressLeaderboardProfileReviewActivityDayUiState>,
    val joinedDate: LocalDate,
    val totalCards: Int
)

sealed interface ProgressLeaderboardProfileSheetUiState {
    val selectedProfile: ProgressLeaderboardProfileIdentityUiState

    data class Loading(
        override val selectedProfile: ProgressLeaderboardProfileIdentityUiState
    ) : ProgressLeaderboardProfileSheetUiState

    data class Ready(
        override val selectedProfile: ProgressLeaderboardProfileIdentityUiState,
        val profile: ProgressLeaderboardProfileReadyUiState
    ) : ProgressLeaderboardProfileSheetUiState

    data class Unavailable(
        override val selectedProfile: ProgressLeaderboardProfileIdentityUiState,
        val status: ProgressLeaderboardProfileStatus
    ) : ProgressLeaderboardProfileSheetUiState

    data class Error(
        override val selectedProfile: ProgressLeaderboardProfileIdentityUiState
    ) : ProgressLeaderboardProfileSheetUiState
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
        val leaderboardSection: ProgressLeaderboardSectionUiState,
        val streakLeaderboardSection: ProgressStreakLeaderboardSectionUiState,
        val leaderboardProfileSheet: ProgressLeaderboardProfileSheetUiState?
    ) : ProgressUiState
}
