package com.flashcardsopensourceapp.feature.progress.sections

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

internal val progressSectionShape = RoundedCornerShape(28.dp)

const val progressStreakSectionTag: String = "progress_streak_section"
const val progressReviewsSectionTag: String = "progress_reviews_section"
const val progressReviewsActivityChartTag: String = "progress_reviews_activity_chart"
const val progressReviewScheduleSectionTag: String = "progress_review_schedule_section"
const val progressReviewScheduleDonutChartTag: String = "progress_review_schedule_donut_chart"
const val progressLeaderboardSectionTag: String = "progress_leaderboard_section"
const val progressLeaderboardResolvedContentTag: String = "progress_leaderboard_resolved_content"
const val progressLeaderboardPeriodSelectorTag: String = "progress_leaderboard_period_selector"
const val progressLeaderboardInfoButtonTag: String = "progress_leaderboard_info_button"
const val progressLeaderboardInviteButtonTag: String = "progress_leaderboard_invite_button"
const val progressLeaderboardInviteDisplayNameFieldTag: String = "progress_leaderboard_invite_display_name_field"
const val progressLeaderboardProfileSheetTag: String = "progress_leaderboard_profile_sheet"
const val progressLeaderboardProfileActivityChartTag: String = "progress_leaderboard_profile_activity_chart"
const val progressLeaderboardProfileRetryButtonTag: String = "progress_leaderboard_profile_retry_button"
const val progressStreakLeaderboardSectionTag: String = "progress_streak_leaderboard_section"
const val progressStreakLeaderboardResolvedContentTag: String =
    "progress_streak_leaderboard_resolved_content"
const val progressStreakLeaderboardInfoButtonTag: String = "progress_streak_leaderboard_info_button"

fun progressLeaderboardParticipantRowTag(rank: Int): String {
    return "progress_leaderboard_row_$rank"
}

fun progressLeaderboardGapRowTag(index: Int): String {
    return "progress_leaderboard_gap_row_$index"
}

fun progressStreakLeaderboardParticipantRowTag(rank: Int): String {
    return "progress_streak_leaderboard_row_$rank"
}

fun progressStreakLeaderboardGapRowTag(index: Int): String {
    return "progress_streak_leaderboard_gap_row_$index"
}
