package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import com.flashcardsopensourceapp.data.local.model.progress.resolveBestLeaderboardPlacement

private const val reviewProgressBadgeOverflowThreshold: Int = 99

internal fun createEmptyReviewProgressBadgeState(): ReviewProgressBadgeState {
    return ReviewProgressBadgeState(
        streakDays = 0,
        hasReviewedToday = false,
        isInteractive = true
    )
}

internal fun createEmptyReviewLeaderboardBadgeState(): ReviewLeaderboardBadgeState {
    return ReviewLeaderboardBadgeState(
        rank = null,
        windowKey = null,
        isInteractive = true
    )
}

internal fun ProgressSummarySnapshot.toReviewProgressBadgeState(): ReviewProgressBadgeState {
    return ReviewProgressBadgeState(
        streakDays = renderedSummary.currentStreakDays,
        hasReviewedToday = renderedSummary.hasReviewedToday,
        isInteractive = true
    )
}

internal fun ProgressLeaderboardSnapshot.toReviewLeaderboardBadgeState(): ReviewLeaderboardBadgeState {
    val bestPlacement = resolveBestLeaderboardPlacement(snapshot = this)
        ?: return createEmptyReviewLeaderboardBadgeState()

    return ReviewLeaderboardBadgeState(
        rank = bestPlacement.rank,
        windowKey = bestPlacement.windowKey,
        isInteractive = true
    )
}

internal fun formatReviewProgressBadgeValue(streakDays: Int): String {
    if (streakDays > reviewProgressBadgeOverflowThreshold) {
        return "${reviewProgressBadgeOverflowThreshold}+"
    }

    return streakDays.toString()
}

internal fun shouldTriggerInitialReviewProgressLoad(
    lifecycleState: Lifecycle.State
): Boolean {
    return lifecycleState == Lifecycle.State.RESUMED
}
