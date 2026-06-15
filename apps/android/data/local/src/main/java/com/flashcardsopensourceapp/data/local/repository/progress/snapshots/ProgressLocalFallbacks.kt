package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.repository.progress.inputs.ProgressPendingReviewLocalDate
import java.time.LocalDate
import java.time.ZoneId

internal fun isProgressLocalCacheReady(
    reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    localCacheStates: List<ProgressLocalCacheStateEntity>,
    workspaceIds: List<String>,
    timeZone: String
): Boolean {
    val historyStatesByWorkspaceId = reviewHistoryStates.associateBy(ProgressReviewHistoryStateEntity::workspaceId)
    val cacheStatesByWorkspaceId = localCacheStates.filter { cacheState ->
        cacheState.timeZone == timeZone
    }.associateBy(ProgressLocalCacheStateEntity::workspaceId)

    return workspaceIds.all { workspaceId ->
        val historyVersion = historyStatesByWorkspaceId[workspaceId]?.historyVersion ?: 0L
        if (historyVersion == 0L) {
            return@all true
        }

        cacheStatesByWorkspaceId[workspaceId]?.historyVersion == historyVersion
    }
}

internal fun createLocalFallbackSummary(
    scopeKey: ProgressSummaryScopeKey,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    workspaceIds: List<String>,
    today: LocalDate
): CloudProgressSummary {
    val activeReviewDates = createLocalFallbackActiveDates(
        scopeKey = scopeKey,
        localDayCounts = localDayCounts,
        workspaceIds = workspaceIds
    ).sorted()
    val activeReviewDateSet = activeReviewDates.toSet()
    val lastReviewedOn = activeReviewDates.lastOrNull()
    val streakEvaluation = evaluateProgressStreakFreeze(
        sortedActiveReviewLocalDates = activeReviewDates,
        today = today
    )
    return CloudProgressSummary(
        currentStreakDays = streakEvaluation.currentStreakDays,
        longestStreakDays = streakEvaluation.longestStreakDays,
        hasReviewedToday = activeReviewDateSet.contains(today.toString()),
        lastReviewedOn = lastReviewedOn,
        activeReviewDays = activeReviewDates.size,
        streakFreeze = streakEvaluation.streakFreeze,
        reviewHistoryWatermarks = emptyList()
    )
}

internal fun createLocalFallbackActiveDates(
    scopeKey: ProgressSummaryScopeKey,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    workspaceIds: List<String>
): Set<String> {
    return createActiveReviewDatesForLocalDayCounts(
        timeZone = scopeKey.timeZone,
        localDayCounts = localDayCounts,
        workspaceIds = workspaceIds
    )
}

internal fun createProgressActiveReviewDateSet(
    timeZone: String,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    pendingReviewLocalDates: List<ProgressPendingReviewLocalDate>,
    workspaceIds: List<String>
): Set<String> {
    val workspaceIdSet = workspaceIds.toSet()
    val localActiveDates = createActiveReviewDatesForLocalDayCounts(
        timeZone = timeZone,
        localDayCounts = localDayCounts,
        workspaceIds = workspaceIds
    )
    val pendingActiveDates = pendingReviewLocalDates.filter { pendingReview ->
        workspaceIdSet.contains(pendingReview.workspaceId)
    }.map(ProgressPendingReviewLocalDate::localDate)
        .toSet()

    return localActiveDates + pendingActiveDates
}

internal fun createLocalFallbackSeries(
    scopeKey: ProgressSeriesScopeKey,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    workspaceIds: List<String>
): CloudProgressSeries {
    val workspaceIdSet = workspaceIds.toSet()
    val dateRange = createInclusiveLocalDateRange(
        from = scopeKey.from,
        to = scopeKey.to
    )
    val reviewPointsByDate = linkedMapOf<String, CloudDailyReviewPoint>()
    dateRange.forEach { date ->
        reviewPointsByDate[date] = createEmptyDailyReviewPoint(date = date)
    }
    localDayCounts.forEach { dayCount ->
        if (dayCount.timeZone != scopeKey.timeZone) {
            return@forEach
        }
        if (workspaceIdSet.contains(dayCount.workspaceId).not()) {
            return@forEach
        }
        val existingPoint = reviewPointsByDate[dayCount.localDate] ?: return@forEach
        reviewPointsByDate[dayCount.localDate] = existingPoint.copy(
            reviewCount = existingPoint.reviewCount + dayCount.reviewCount,
            againCount = existingPoint.againCount + dayCount.againCount,
            hardCount = existingPoint.hardCount + dayCount.hardCount,
            goodCount = existingPoint.goodCount + dayCount.goodCount,
            easyCount = existingPoint.easyCount + dayCount.easyCount
        )
    }
    val activeReviewDates = createActiveReviewDatesForLocalDayCounts(
        timeZone = scopeKey.timeZone,
        localDayCounts = localDayCounts,
        workspaceIds = workspaceIds
    )

    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = reviewPointsByDate.values.toList(),
        streakDays = createProgressStreakDaysForRange(
            activeReviewDateSet = activeReviewDates,
            from = scopeKey.from,
            to = scopeKey.to,
            today = parseLocalDate(rawDate = scopeKey.to)
        ),
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        summary = null
    )
}

internal fun createLocalFallbackReviewSchedule(
    scopeKey: ProgressReviewScheduleScopeKey,
    reviewScheduleCards: List<ProgressReviewScheduleCardDueEntity>,
    workspaceIds: List<String>,
    today: LocalDate,
    zoneId: ZoneId
): CloudProgressReviewSchedule {
    val workspaceIdSet = workspaceIds.toSet()
    val bucketStarts = createProgressReviewScheduleBucketStarts(
        today = today,
        zoneId = zoneId
    )
    val bucketCounts = ProgressReviewScheduleBucketKey.orderedEntries.associateWith { 0 }.toMutableMap()

    reviewScheduleCards.forEach { card ->
        if (workspaceIdSet.contains(card.workspaceId).not()) {
            return@forEach
        }

        val bucketKey = bucketReviewDueAtMillis(
            dueAtMillis = card.dueAtMillis,
            bucketStarts = bucketStarts
        )
        bucketCounts[bucketKey] = (bucketCounts[bucketKey] ?: 0) + 1
    }

    return CloudProgressReviewSchedule(
        timeZone = scopeKey.timeZone,
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        totalCards = bucketCounts.values.sum(),
        buckets = ProgressReviewScheduleBucketKey.orderedEntries.map { key ->
            CloudProgressReviewScheduleBucket(
                key = key,
                count = bucketCounts[key] ?: 0
            )
        }
    )
}

internal fun createPendingLocalOverlaySeries(
    scopeKey: ProgressSeriesScopeKey,
    pendingReviewLocalDates: List<ProgressPendingReviewLocalDate>,
    workspaceIds: List<String>
): CloudProgressSeries {
    val workspaceIdSet = workspaceIds.toSet()
    val reviewPointsByDate = createInclusiveLocalDateRange(
        from = scopeKey.from,
        to = scopeKey.to
    ).associateWith { date -> createEmptyDailyReviewPoint(date = date) }.toMutableMap()

    pendingReviewLocalDates.forEach { pendingReview ->
        if (workspaceIdSet.contains(pendingReview.workspaceId).not()) {
            return@forEach
        }
        val existingPoint = reviewPointsByDate[pendingReview.localDate] ?: return@forEach
        reviewPointsByDate[pendingReview.localDate] = existingPoint.incrementDailyReviewPoint(
            rating = pendingReview.rating
        )
    }
    val activeReviewDates = reviewPointsByDate.filter { entry ->
        entry.value.reviewCount > 0
    }.keys.toSet()

    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = reviewPointsByDate.values.toList(),
        streakDays = createProgressStreakDaysForRange(
            activeReviewDateSet = activeReviewDates,
            from = scopeKey.from,
            to = scopeKey.to,
            today = parseLocalDate(rawDate = scopeKey.to)
        ),
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        summary = null
    )
}

internal fun createEmptyProgressSummary(): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = 0,
        longestStreakDays = 0,
        hasReviewedToday = false,
        lastReviewedOn = null,
        activeReviewDays = 0,
        streakFreeze = createInitialProgressStreakFreeze(),
        reviewHistoryWatermarks = emptyList()
    )
}

internal fun createEmptyProgressSeries(
    scopeKey: ProgressSeriesScopeKey
): CloudProgressSeries {
    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = createInclusiveLocalDateRange(
            from = scopeKey.from,
            to = scopeKey.to
        ).map { date ->
            createEmptyDailyReviewPoint(date = date)
        },
        streakDays = createProgressStreakDaysForRange(
            activeReviewDateSet = emptySet(),
            from = scopeKey.from,
            to = scopeKey.to,
            today = parseLocalDate(rawDate = scopeKey.to)
        ),
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        summary = null
    )
}

private fun createEmptyDailyReviewPoint(
    date: String
): CloudDailyReviewPoint {
    return CloudDailyReviewPoint(
        date = date,
        reviewCount = 0,
        againCount = 0,
        hardCount = 0,
        goodCount = 0,
        easyCount = 0
    )
}

private fun CloudDailyReviewPoint.incrementDailyReviewPoint(
    rating: ReviewRating
): CloudDailyReviewPoint {
    return copy(
        reviewCount = reviewCount + 1,
        againCount = againCount + if (rating == ReviewRating.AGAIN) 1 else 0,
        hardCount = hardCount + if (rating == ReviewRating.HARD) 1 else 0,
        goodCount = goodCount + if (rating == ReviewRating.GOOD) 1 else 0,
        easyCount = easyCount + if (rating == ReviewRating.EASY) 1 else 0
    )
}

internal fun createEmptyProgressReviewSchedule(
    scopeKey: ProgressReviewScheduleScopeKey
): CloudProgressReviewSchedule {
    return CloudProgressReviewSchedule(
        timeZone = scopeKey.timeZone,
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        totalCards = 0,
        buckets = ProgressReviewScheduleBucketKey.orderedEntries.map { key ->
            CloudProgressReviewScheduleBucket(
                key = key,
                count = 0
            )
        }
    )
}

private fun createActiveReviewDatesForLocalDayCounts(
    timeZone: String,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    workspaceIds: List<String>
): Set<String> {
    val workspaceIdSet = workspaceIds.toSet()
    return localDayCounts.filter { dayCount ->
        dayCount.timeZone == timeZone &&
            workspaceIdSet.contains(dayCount.workspaceId) &&
            dayCount.reviewCount > 0
    }.map(ProgressLocalDayCountEntity::localDate)
        .toSet()
}
