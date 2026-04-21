package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.Lifecycle
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import org.junit.Assert.assertEquals
import org.junit.Test

class ReviewProgressBadgeStateTest {
    @Test
    fun reviewProgressBadgeStateUsesRenderedSummaryFields() {
        val badgeState = createProgressSummarySnapshot(
            currentStreakDays = 14,
            hasReviewedToday = true
        ).toReviewProgressBadgeState()

        assertEquals(
            ReviewProgressBadgeState(
                streakDays = 14,
                hasReviewedToday = true,
                isInteractive = true
            ),
            badgeState
        )
    }

    @Test
    fun reviewProgressBadgeValueUsesOverflowLabelForLargeStreaks() {
        assertEquals("99+", formatReviewProgressBadgeValue(streakDays = 140))
        assertEquals("12", formatReviewProgressBadgeValue(streakDays = 12))
    }

    @Test
    fun initialReviewProgressLoadTriggersOnlyWhenLifecycleIsResumed() {
        assertEquals(
            true,
            shouldTriggerInitialReviewProgressLoad(lifecycleState = Lifecycle.State.RESUMED)
        )
        assertEquals(
            false,
            shouldTriggerInitialReviewProgressLoad(lifecycleState = Lifecycle.State.CREATED)
        )
        assertEquals(
            false,
            shouldTriggerInitialReviewProgressLoad(lifecycleState = Lifecycle.State.STARTED)
        )
    }
}

private fun createProgressSummarySnapshot(
    currentStreakDays: Int,
    hasReviewedToday: Boolean
): ProgressSummarySnapshot {
    val renderedSummary = CloudProgressSummary(
        currentStreakDays = currentStreakDays,
        hasReviewedToday = hasReviewedToday,
        lastReviewedOn = "2026-04-18",
        activeReviewDays = 32
    )

    return ProgressSummarySnapshot(
        scopeKey = ProgressSummaryScopeKey(
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            referenceLocalDate = "2026-04-18"
        ),
        renderedSummary = renderedSummary,
        localFallback = renderedSummary,
        serverBase = renderedSummary,
        source = ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY,
        isApproximate = false
    )
}
