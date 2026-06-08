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
    val currentStreakDays = computeCurrentStreakDays(
        activeReviewDateSet = activeReviewDateSet,
        today = today
    )
    return CloudProgressSummary(
        currentStreakDays = currentStreakDays,
        hasReviewedToday = activeReviewDateSet.contains(today.toString()),
        lastReviewedOn = lastReviewedOn,
        activeReviewDays = activeReviewDates.size,
        reviewHistoryWatermarks = emptyList()
    )
}

internal fun createLocalFallbackActiveDates(
    scopeKey: ProgressSummaryScopeKey,
    localDayCounts: List<ProgressLocalDayCountEntity>,
    workspaceIds: List<String>
): Set<String> {
    val workspaceIdSet = workspaceIds.toSet()
    return localDayCounts.filter { dayCount ->
        dayCount.timeZone == scopeKey.timeZone &&
            workspaceIdSet.contains(dayCount.workspaceId) &&
            dayCount.reviewCount > 0
    }.map(ProgressLocalDayCountEntity::localDate)
        .toSet()
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
    val reviewCountsByDate = linkedMapOf<String, Int>()
    dateRange.forEach { date ->
        reviewCountsByDate[date] = 0
    }
    localDayCounts.forEach { dayCount ->
        if (dayCount.timeZone != scopeKey.timeZone) {
            return@forEach
        }
        if (workspaceIdSet.contains(dayCount.workspaceId).not()) {
            return@forEach
        }
        if (reviewCountsByDate.containsKey(dayCount.localDate).not()) {
            return@forEach
        }
        reviewCountsByDate[dayCount.localDate] = (reviewCountsByDate[dayCount.localDate] ?: 0) + dayCount.reviewCount
    }

    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = reviewCountsByDate.map { (date, reviewCount) ->
            CloudDailyReviewPoint(
                date = date,
                reviewCount = reviewCount
            )
        },
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
    val reviewCountsByDate = createInclusiveLocalDateRange(
        from = scopeKey.from,
        to = scopeKey.to
    ).associateWith { 0 }.toMutableMap()

    pendingReviewLocalDates.forEach { pendingReview ->
        if (workspaceIdSet.contains(pendingReview.workspaceId).not()) {
            return@forEach
        }
        if (reviewCountsByDate.containsKey(pendingReview.localDate).not()) {
            return@forEach
        }

        reviewCountsByDate[pendingReview.localDate] = (reviewCountsByDate[pendingReview.localDate] ?: 0) + 1
    }

    return CloudProgressSeries(
        timeZone = scopeKey.timeZone,
        from = scopeKey.from,
        to = scopeKey.to,
        dailyReviews = reviewCountsByDate.map { (date, reviewCount) ->
            CloudDailyReviewPoint(
                date = date,
                reviewCount = reviewCount
            )
        },
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        summary = null
    )
}

internal fun createEmptyProgressSummary(): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = 0,
        hasReviewedToday = false,
        lastReviewedOn = null,
        activeReviewDays = 0,
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
            CloudDailyReviewPoint(
                date = date,
                reviewCount = 0
            )
        },
        generatedAt = null,
        reviewHistoryWatermarks = emptyList(),
        summary = null
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
