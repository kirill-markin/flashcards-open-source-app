package com.flashcardsopensourceapp.feature.review

import java.time.Instant
import java.time.ZoneId
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

/**
 * Why the whole review session is read again. A rating is never a reason: it changes only the query
 * inputs, so it re-runs the bounded queue window and counts. A rebuild runs in the background and keeps
 * the shown card and the prepared next card through their pins. See docs/fsrs-scheduling-logic.md#non-blocking-review.
 *
 * Local card writes and applied syncs need no request here: Room re-runs the observed queries for them.
 */
internal enum class ReviewDataRebuildReason {
    INITIAL_LOAD,
    FILTER_CHANGED,
    WORKSPACE_CHANGED,
    RETURNED_AFTER_LONG_ABSENCE,
    DATE_CHANGED,
    SAFETY_INTERVAL
}

internal data class ReviewDataRebuild(
    val reason: ReviewDataRebuildReason,
    val generation: Long
)

internal val reviewSafetyRebuildInterval: Duration = 10.minutes
internal val reviewLongAbsenceThreshold: Duration = 30.minutes

internal fun reviewResumeRebuildReason(
    stoppedAtMillis: Long?,
    sessionNowMillis: Long,
    nowMillis: Long,
    zoneId: ZoneId
): ReviewDataRebuildReason? {
    if (stoppedAtMillis != null && nowMillis - stoppedAtMillis >= reviewLongAbsenceThreshold.inWholeMilliseconds) {
        return ReviewDataRebuildReason.RETURNED_AFTER_LONG_ABSENCE
    }
    if (isSameReviewDay(firstMillis = sessionNowMillis, secondMillis = nowMillis, zoneId = zoneId).not()) {
        return ReviewDataRebuildReason.DATE_CHANGED
    }
    return null
}

internal fun reviewSafetyIntervalRebuildReason(
    sessionNowMillis: Long,
    nowMillis: Long,
    zoneId: ZoneId
): ReviewDataRebuildReason {
    return if (isSameReviewDay(firstMillis = sessionNowMillis, secondMillis = nowMillis, zoneId = zoneId)) {
        ReviewDataRebuildReason.SAFETY_INTERVAL
    } else {
        ReviewDataRebuildReason.DATE_CHANGED
    }
}

private fun isSameReviewDay(firstMillis: Long, secondMillis: Long, zoneId: ZoneId): Boolean {
    return Instant.ofEpochMilli(firstMillis).atZone(zoneId).toLocalDate() ==
        Instant.ofEpochMilli(secondMillis).atZone(zoneId).toLocalDate()
}
