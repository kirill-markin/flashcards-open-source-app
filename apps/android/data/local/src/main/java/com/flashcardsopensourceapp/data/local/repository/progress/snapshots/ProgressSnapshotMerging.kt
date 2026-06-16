package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDay
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakDayState
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot

internal data class ProgressRenderedSeriesSummaryContext(
    val activeDates: Set<String>
)

internal fun createProgressSummarySnapshot(
    scopeKey: ProgressSummaryScopeKey,
    localFallback: CloudProgressSummary,
    localFallbackActiveDates: Set<String>,
    serverBase: CloudProgressSummary?,
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?,
    cloudState: CloudAccountState
): ProgressSummarySnapshot {
    val renderedSummary = when {
        serverBase == null -> localFallback
        else -> mergeProgressSummary(
            base = serverBase,
            localFallbackActiveDates = localFallbackActiveDates,
            renderedSeriesContext = renderedSeriesContext,
            referenceLocalDate = scopeKey.referenceLocalDate
        )
    }
    val hasLocalOverlay = serverBase?.let { base ->
        renderedSummary != base
    } ?: false
    val source = when {
        serverBase == null -> ProgressSnapshotSource.LOCAL_ONLY
        hasLocalOverlay -> ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY
        else -> ProgressSnapshotSource.SERVER_BASE
    }
    return ProgressSummarySnapshot(
        scopeKey = scopeKey,
        renderedSummary = renderedSummary,
        localFallback = localFallback,
        serverBase = serverBase,
        source = source,
        isApproximate = source == ProgressSnapshotSource.LOCAL_ONLY ||
            hasLocalOverlay ||
            cloudState == CloudAccountState.DISCONNECTED ||
            cloudState == CloudAccountState.LINKING_READY
    )
}

internal fun createProgressSeriesSnapshot(
    scopeKey: ProgressSeriesScopeKey,
    localFallback: CloudProgressSeries,
    serverBase: CloudProgressSeries?,
    pendingLocalOverlay: CloudProgressSeries,
    activeReviewDateSet: Set<String>,
    cloudState: CloudAccountState
): ProgressSeriesSnapshot {
    val renderedSeries = if (serverBase == null) {
        localFallback
    } else {
        mergeProgressSeries(
            base = serverBase,
            pendingLocalOverlay = pendingLocalOverlay,
            localFallback = localFallback,
            activeReviewDateSet = activeReviewDateSet
        )
    }
    val hasLocalOverlay = serverBase?.let { base ->
        hasProgressSeriesOverlay(
            base = base,
            renderedSeries = renderedSeries
        )
    } ?: false
    val source = when {
        serverBase == null -> ProgressSnapshotSource.LOCAL_ONLY
        hasLocalOverlay -> ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY
        else -> ProgressSnapshotSource.SERVER_BASE
    }
    return ProgressSeriesSnapshot(
        scopeKey = scopeKey,
        renderedSeries = renderedSeries,
        localFallback = localFallback,
        serverBase = serverBase,
        pendingLocalOverlay = pendingLocalOverlay,
        source = source,
        isApproximate = source == ProgressSnapshotSource.LOCAL_ONLY ||
            hasLocalOverlay ||
            cloudState == CloudAccountState.DISCONNECTED ||
            cloudState == CloudAccountState.LINKING_READY
    )
}

internal fun createProgressReviewScheduleSnapshot(
    scopeKey: ProgressReviewScheduleScopeKey,
    localFallback: CloudProgressReviewSchedule,
    serverBase: CloudProgressReviewSchedule?,
    hasPendingScheduleImpactingCardChanges: Boolean,
    pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    isLocalReviewScheduleScopeHydrated: Boolean,
    workspaceIds: List<String>,
    cloudState: CloudAccountState
): ProgressReviewScheduleSnapshot {
    validateProgressReviewScheduleBuckets(
        buckets = localFallback.buckets,
        totalCards = localFallback.totalCards
    )
    serverBase?.let { base ->
        validateProgressReviewScheduleBuckets(
            buckets = base.buckets,
            totalCards = base.totalCards
        )
    }

    val canUseLocalScheduleOverlay = serverBase?.let { base ->
        hasPendingScheduleImpactingCardChanges &&
            canReplaceReviewScheduleWithLocalOverlay(
                localFallback = localFallback,
                serverBase = base,
                pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
                isLocalReviewScheduleScopeHydrated = isLocalReviewScheduleScopeHydrated,
                workspaceIds = workspaceIds
            )
    } ?: false
    val renderedSchedule = when {
        serverBase == null -> localFallback
        canUseLocalScheduleOverlay -> localFallback
        else -> serverBase
    }
    val source = when {
        serverBase == null -> ProgressSnapshotSource.LOCAL_ONLY
        canUseLocalScheduleOverlay -> ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY
        else -> ProgressSnapshotSource.SERVER_BASE
    }
    return ProgressReviewScheduleSnapshot(
        scopeKey = scopeKey,
        renderedSchedule = renderedSchedule,
        localFallback = localFallback,
        serverBase = serverBase,
        source = source,
        isApproximate = source == ProgressSnapshotSource.LOCAL_ONLY ||
            hasPendingScheduleImpactingCardChanges ||
            cloudState == CloudAccountState.DISCONNECTED ||
            cloudState == CloudAccountState.LINKING_READY
    )
}

internal fun mergeProgressSummary(
    base: CloudProgressSummary,
    localFallbackActiveDates: Set<String>,
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?,
    referenceLocalDate: String
): CloudProgressSummary {
    val hasReferenceDateReviewOverlay = progressHasReferenceDateReviewOverlay(
        serverBase = base,
        localFallbackActiveDates = localFallbackActiveDates,
        renderedSeriesActiveDates = renderedSeriesContext?.activeDates,
        referenceLocalDate = referenceLocalDate
    )
    val referenceDateReviewDelta = if (hasReferenceDateReviewOverlay) 1 else 0
    val renderedCurrentStreakDays = base.currentStreakDays + referenceDateReviewDelta

    return CloudProgressSummary(
        currentStreakDays = renderedCurrentStreakDays,
        longestStreakDays = maxOf(
            base.longestStreakDays,
            renderedCurrentStreakDays
        ),
        hasReviewedToday = base.hasReviewedToday || hasReferenceDateReviewOverlay,
        lastReviewedOn = if (hasReferenceDateReviewOverlay) {
            referenceLocalDate
        } else {
            base.lastReviewedOn
        },
        activeReviewDays = base.activeReviewDays + referenceDateReviewDelta,
        streakFreeze = progressStreakFreezeWithReferenceDateOverlay(
            base = base,
            hasReferenceDateReviewOverlay = hasReferenceDateReviewOverlay
        ),
        reviewHistoryWatermarks = base.reviewHistoryWatermarks
    )
}

internal fun mergeProgressSeries(
    base: CloudProgressSeries,
    pendingLocalOverlay: CloudProgressSeries,
    localFallback: CloudProgressSeries,
    activeReviewDateSet: Set<String>
): CloudProgressSeries {
    validateProgressSeriesMergeInputs(
        base = base,
        pendingLocalOverlay = pendingLocalOverlay,
        localFallback = localFallback
    )
    val pendingCountsByDate = buildProgressSeriesCountVectorsByDate(series = pendingLocalOverlay)
    val localFallbackCountsByDate = buildProgressSeriesCountVectorsByDate(series = localFallback)
    val mergedDailyReviews = base.dailyReviews.map { point ->
        val serverPlusPending = point.toProgressSeriesCountVector()
            .plus(pendingCountsByDate[point.date] ?: createEmptyProgressSeriesCountVector())
        val localFallbackPoint = localFallbackCountsByDate[point.date] ?: createEmptyProgressSeriesCountVector()
        val mergedPoint = if (localFallbackPoint.reviewCount > serverPlusPending.reviewCount) {
            localFallbackPoint
        } else {
            serverPlusPending
        }

        mergedPoint.toCloudDailyReviewPoint(date = point.date)
    }
    val visibleMergedActiveDateSet = mergedDailyReviews.filter { point ->
        point.reviewCount > 0
    }.map(CloudDailyReviewPoint::date).toSet()
    val mergedStreakDays = patchProgressSeriesTodayStreakDay(
        base = base,
        mergedActiveDateSet = activeReviewDateSet + visibleMergedActiveDateSet
    )
    return CloudProgressSeries(
        timeZone = base.timeZone,
        from = base.from,
        to = base.to,
        dailyReviews = mergedDailyReviews,
        streakDays = mergedStreakDays,
        generatedAt = base.generatedAt,
        reviewHistoryWatermarks = base.reviewHistoryWatermarks,
        summary = null
    )
}

internal fun createProgressRenderedSeriesSummaryContext(
    renderedSeries: CloudProgressSeries
): ProgressRenderedSeriesSummaryContext {
    return ProgressRenderedSeriesSummaryContext(
        activeDates = progressActiveDatesFromSeries(series = renderedSeries)
    )
}

private fun progressStreakFreezeWithReferenceDateOverlay(
    base: CloudProgressSummary,
    hasReferenceDateReviewOverlay: Boolean
): CloudProgressStreakFreeze {
    if (hasReferenceDateReviewOverlay.not()) {
        return base.streakFreeze
    }

    return addProgressStreakFreezeEarnedUnits(streakFreeze = base.streakFreeze)
}

private fun progressActiveDatesFromSeries(
    series: CloudProgressSeries
): Set<String> {
    val reviewCountsByDate = buildProgressSeriesReviewCountsByDate(series = series)
    return reviewCountsByDate.filter { entry ->
        entry.value > 0
    }.keys.toSet()
}

private fun progressHasReferenceDateReviewOverlay(
    serverBase: CloudProgressSummary,
    localFallbackActiveDates: Set<String>,
    renderedSeriesActiveDates: Set<String>?,
    referenceLocalDate: String
): Boolean {
    if (serverBase.hasReviewedToday) {
        return false
    }

    val activeDates: Set<String> = localFallbackActiveDates + (renderedSeriesActiveDates ?: emptySet())
    return activeDates.contains(referenceLocalDate)
}

private fun addProgressStreakFreezeEarnedUnits(
    streakFreeze: CloudProgressStreakFreeze
): CloudProgressStreakFreeze {
    val balanceUnits = minOf(
        streakFreeze.balanceUnits.toLong() + streakFreeze.earnedUnitsPerStreakDay.toLong(),
        streakFreeze.capacity.toLong() * streakFreeze.unitsPerCredit.toLong(),
        Int.MAX_VALUE.toLong()
    ).toInt()
    val availableCredits = minOf(
        streakFreeze.capacity,
        balanceUnits / streakFreeze.unitsPerCredit
    )

    return streakFreeze.copy(
        availableCredits = availableCredits,
        balanceUnits = balanceUnits,
        nextCreditProgressUnits = if (availableCredits >= streakFreeze.capacity) {
            0
        } else {
            balanceUnits % streakFreeze.unitsPerCredit
        },
        nextCreditRequiredUnits = streakFreeze.unitsPerCredit
    )
}

private fun patchProgressSeriesTodayStreakDay(
    base: CloudProgressSeries,
    mergedActiveDateSet: Set<String>
): List<CloudProgressStreakDay> {
    if (mergedActiveDateSet.contains(base.to).not()) {
        return base.streakDays
    }
    val serverTodayReviewCount = buildProgressSeriesReviewCountsByDate(series = base)[base.to] ?: 0
    if (serverTodayReviewCount > 0) {
        return base.streakDays
    }

    return base.streakDays.map { day ->
        if (day.date == base.to) {
            day.copy(state = CloudProgressStreakDayState.REVIEWED)
        } else {
            day
        }
    }
}

private fun validateProgressSeriesMergeInputs(
    base: CloudProgressSeries,
    pendingLocalOverlay: CloudProgressSeries,
    localFallback: CloudProgressSeries
) {
    validateProgressSeriesMergeInput(
        base = base,
        candidate = pendingLocalOverlay,
        candidateName = "pendingLocalOverlay"
    )
    validateProgressSeriesMergeInput(
        base = base,
        candidate = localFallback,
        candidateName = "localFallback"
    )
}

private fun validateProgressSeriesMergeInput(
    base: CloudProgressSeries,
    candidate: CloudProgressSeries,
    candidateName: String
) {
    val mismatches: List<String> = buildList {
        if (base.timeZone != candidate.timeZone) {
            add("timeZone base='${base.timeZone}' $candidateName='${candidate.timeZone}'")
        }
        if (base.from != candidate.from) {
            add("from base='${base.from}' $candidateName='${candidate.from}'")
        }
        if (base.to != candidate.to) {
            add("to base='${base.to}' $candidateName='${candidate.to}'")
        }
    }
    if (mismatches.isEmpty()) {
        return
    }

    throw IllegalArgumentException(
        "Progress series merge inputs must share the same scope. " +
            "Mismatches: ${mismatches.joinToString(separator = "; ")}."
    )
}

private fun buildProgressSeriesReviewCountsByDate(
    series: CloudProgressSeries
): Map<String, Int> {
    val reviewCountsByDate = linkedMapOf<String, Int>()
    series.dailyReviews.forEach { point ->
        reviewCountsByDate[point.date] = (reviewCountsByDate[point.date] ?: 0) + point.reviewCount
    }
    return reviewCountsByDate
}

private data class ProgressSeriesCountVector(
    val reviewCount: Int,
    val againCount: Int,
    val hardCount: Int,
    val goodCount: Int,
    val easyCount: Int
) {
    fun plus(other: ProgressSeriesCountVector): ProgressSeriesCountVector {
        return ProgressSeriesCountVector(
            reviewCount = reviewCount + other.reviewCount,
            againCount = againCount + other.againCount,
            hardCount = hardCount + other.hardCount,
            goodCount = goodCount + other.goodCount,
            easyCount = easyCount + other.easyCount
        )
    }
}

private fun createEmptyProgressSeriesCountVector(): ProgressSeriesCountVector {
    return ProgressSeriesCountVector(
        reviewCount = 0,
        againCount = 0,
        hardCount = 0,
        goodCount = 0,
        easyCount = 0
    )
}

private fun buildProgressSeriesCountVectorsByDate(
    series: CloudProgressSeries
): Map<String, ProgressSeriesCountVector> {
    val countVectorsByDate = linkedMapOf<String, ProgressSeriesCountVector>()
    series.dailyReviews.forEach { point ->
        countVectorsByDate[point.date] = (countVectorsByDate[point.date] ?: createEmptyProgressSeriesCountVector())
            .plus(point.toProgressSeriesCountVector())
    }
    return countVectorsByDate
}

private fun CloudDailyReviewPoint.toProgressSeriesCountVector(): ProgressSeriesCountVector {
    return ProgressSeriesCountVector(
        reviewCount = reviewCount,
        againCount = againCount,
        hardCount = hardCount,
        goodCount = goodCount,
        easyCount = easyCount
    )
}

private fun ProgressSeriesCountVector.toCloudDailyReviewPoint(
    date: String
): CloudDailyReviewPoint {
    return CloudDailyReviewPoint(
        date = date,
        reviewCount = reviewCount,
        againCount = againCount,
        hardCount = hardCount,
        goodCount = goodCount,
        easyCount = easyCount
    )
}

private fun hasProgressSeriesOverlay(
    base: CloudProgressSeries,
    renderedSeries: CloudProgressSeries
): Boolean {
    if (base.dailyReviews.size != renderedSeries.dailyReviews.size) {
        return true
    }
    if (base.streakDays != renderedSeries.streakDays) {
        return true
    }

    return base.dailyReviews.zip(renderedSeries.dailyReviews).any { pair ->
        pair.first.date != pair.second.date ||
            pair.first.reviewCount != pair.second.reviewCount ||
            pair.first.againCount != pair.second.againCount ||
            pair.first.hardCount != pair.second.hardCount ||
            pair.first.goodCount != pair.second.goodCount ||
            pair.first.easyCount != pair.second.easyCount
    }
}
