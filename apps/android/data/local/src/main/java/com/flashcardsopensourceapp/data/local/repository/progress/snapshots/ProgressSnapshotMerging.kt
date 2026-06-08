package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewHistoryWatermark
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressSummarySnapshot
import java.time.LocalDate

internal data class ProgressRenderedSeriesSummaryContext(
    val lowerBoundSummary: CloudProgressSummary,
    val activeDates: Set<String>,
    val activeDatesMissingFromServerBase: Set<String>,
    val serverBaseReviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>?
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
            localFallback = localFallback,
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
    cloudState: CloudAccountState
): ProgressSeriesSnapshot {
    val renderedSeries = if (serverBase == null) {
        localFallback
    } else {
        mergeProgressSeries(
            base = serverBase,
            pendingLocalOverlay = pendingLocalOverlay,
            localFallback = localFallback
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
    localFallback: CloudProgressSummary,
    localFallbackActiveDates: Set<String>,
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?,
    referenceLocalDate: String
): CloudProgressSummary {
    val renderedSeriesLowerBound = renderedSeriesContext?.lowerBoundSummary
    val serverAndSeriesShareReviewHistoryBase = progressServerAndSeriesShareReviewHistoryBase(
        serverBaseReviewHistoryWatermarks = base.reviewHistoryWatermarks,
        renderedSeriesContext = renderedSeriesContext
    )
    val serverActiveReviewDaysWithRenderedDelta = base.activeReviewDays +
        progressActiveReviewDayDelta(
            activeReviewDayDeltaCandidates = progressActiveReviewDayDeltaCandidates(
                renderedSeriesContext = renderedSeriesContext,
                localFallbackActiveDates = localFallbackActiveDates,
                serverBase = base,
                serverAndSeriesShareReviewHistoryBase = serverAndSeriesShareReviewHistoryBase
            ),
            serverBase = base,
            serverAndSeriesShareReviewHistoryBase = serverAndSeriesShareReviewHistoryBase,
            referenceLocalDate = referenceLocalDate
        )
    val serverCurrentStreakDaysWithRenderedDelta = progressCurrentStreakDaysWithRenderedDelta(
        serverBase = base,
        localFallbackActiveDates = localFallbackActiveDates,
        renderedSeriesActiveDates = renderedSeriesContext?.activeDates,
        referenceLocalDate = referenceLocalDate
    )

    return CloudProgressSummary(
        currentStreakDays = maxOf(
            serverCurrentStreakDaysWithRenderedDelta,
            localFallback.currentStreakDays,
            renderedSeriesLowerBound?.currentStreakDays ?: 0
        ),
        hasReviewedToday = base.hasReviewedToday ||
            localFallback.hasReviewedToday ||
            (renderedSeriesLowerBound?.hasReviewedToday == true),
        lastReviewedOn = maxLocalDate(
            first = maxLocalDate(
                first = base.lastReviewedOn,
                second = localFallback.lastReviewedOn
            ),
            second = renderedSeriesLowerBound?.lastReviewedOn
        ),
        activeReviewDays = maxOf(
            serverActiveReviewDaysWithRenderedDelta,
            localFallback.activeReviewDays,
            renderedSeriesLowerBound?.activeReviewDays ?: 0
        ),
        reviewHistoryWatermarks = base.reviewHistoryWatermarks
    )
}

internal fun mergeProgressSeries(
    base: CloudProgressSeries,
    pendingLocalOverlay: CloudProgressSeries,
    localFallback: CloudProgressSeries
): CloudProgressSeries {
    validateProgressSeriesMergeInputs(
        base = base,
        pendingLocalOverlay = pendingLocalOverlay,
        localFallback = localFallback
    )
    val pendingCountsByDate = buildProgressSeriesReviewCountsByDate(series = pendingLocalOverlay)
    val localFallbackCountsByDate = buildProgressSeriesReviewCountsByDate(series = localFallback)
    val mergedDailyReviews = base.dailyReviews.map { point ->
        val serverPlusPending = point.reviewCount + (pendingCountsByDate[point.date] ?: 0)
        CloudDailyReviewPoint(
            date = point.date,
            reviewCount = maxOf(
                serverPlusPending,
                localFallbackCountsByDate[point.date] ?: 0
            )
        )
    }
    return CloudProgressSeries(
        timeZone = base.timeZone,
        from = base.from,
        to = base.to,
        dailyReviews = mergedDailyReviews,
        generatedAt = base.generatedAt,
        reviewHistoryWatermarks = base.reviewHistoryWatermarks,
        summary = null
    )
}

internal fun createProgressRenderedSeriesSummaryContext(
    serverBase: CloudProgressSeries?,
    scopeKey: ProgressSeriesScopeKey,
    renderedSeries: CloudProgressSeries
): ProgressRenderedSeriesSummaryContext {
    val activeDates = progressActiveDatesFromSeries(series = renderedSeries)
    val activeDatesMissingFromServerBase: Set<String>
    val serverBaseReviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>?
    if (serverBase != null && isProgressSeriesInScope(series = serverBase, scopeKey = scopeKey)) {
        activeDatesMissingFromServerBase = progressActiveDatesMissingFromServerBase(
            serverBase = serverBase,
            renderedSeries = renderedSeries
        )
        serverBaseReviewHistoryWatermarks = serverBase.reviewHistoryWatermarks
    } else {
        activeDatesMissingFromServerBase = emptySet()
        serverBaseReviewHistoryWatermarks = null
    }

    return ProgressRenderedSeriesSummaryContext(
        lowerBoundSummary = createProgressSummaryLowerBoundFromSeries(
            series = renderedSeries,
            activeDates = activeDates
        ),
        activeDates = activeDates,
        activeDatesMissingFromServerBase = activeDatesMissingFromServerBase,
        serverBaseReviewHistoryWatermarks = serverBaseReviewHistoryWatermarks
    )
}

private fun createProgressSummaryLowerBoundFromSeries(
    series: CloudProgressSeries,
    activeDates: Set<String>
): CloudProgressSummary {
    val today = parseLocalDate(rawDate = series.to)
    val sortedActiveDates = activeDates.sorted()
    return CloudProgressSummary(
        currentStreakDays = computeCurrentStreakDays(
            activeReviewDateSet = activeDates,
            today = today
        ),
        hasReviewedToday = activeDates.contains(series.to),
        lastReviewedOn = sortedActiveDates.lastOrNull(),
        activeReviewDays = activeDates.size,
        reviewHistoryWatermarks = emptyList()
    )
}

private fun progressActiveDatesFromSeries(
    series: CloudProgressSeries
): Set<String> {
    val reviewCountsByDate = buildProgressSeriesReviewCountsByDate(series = series)
    return reviewCountsByDate.filter { entry ->
        entry.value > 0
    }.keys.toSet()
}

private fun progressActiveDatesMissingFromServerBase(
    serverBase: CloudProgressSeries,
    renderedSeries: CloudProgressSeries
): Set<String> {
    validateProgressSeriesPairInputs(
        base = serverBase,
        renderedSeries = renderedSeries
    )

    val serverCountsByDate = buildProgressSeriesReviewCountsByDate(series = serverBase)
    val renderedCountsByDate = buildProgressSeriesReviewCountsByDate(series = renderedSeries)
    return createInclusiveLocalDateRange(
        from = serverBase.from,
        to = serverBase.to
    ).filter { date ->
        (renderedCountsByDate[date] ?: 0) > 0 &&
            (serverCountsByDate[date] ?: 0) == 0
    }.toSet()
}

private fun validateProgressSeriesPairInputs(
    base: CloudProgressSeries,
    renderedSeries: CloudProgressSeries
) {
    validateProgressSeriesMergeInput(
        base = base,
        candidate = renderedSeries,
        candidateName = "renderedSeries"
    )
}

private fun isProgressSeriesInScope(
    series: CloudProgressSeries,
    scopeKey: ProgressSeriesScopeKey
): Boolean {
    return series.timeZone == scopeKey.timeZone &&
        series.from == scopeKey.from &&
        series.to == scopeKey.to
}

private fun progressServerAndSeriesShareReviewHistoryBase(
    serverBaseReviewHistoryWatermarks: List<ProgressReviewHistoryWatermark>,
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?
): Boolean {
    val seriesBaseReviewHistoryWatermarks = renderedSeriesContext?.serverBaseReviewHistoryWatermarks ?: return false
    if (serverBaseReviewHistoryWatermarks.isEmpty() || seriesBaseReviewHistoryWatermarks.isEmpty()) {
        return false
    }
    return seriesBaseReviewHistoryWatermarks == serverBaseReviewHistoryWatermarks
}

private fun progressActiveReviewDayDeltaCandidates(
    renderedSeriesContext: ProgressRenderedSeriesSummaryContext?,
    localFallbackActiveDates: Set<String>,
    serverBase: CloudProgressSummary,
    serverAndSeriesShareReviewHistoryBase: Boolean
): Set<String> {
    val renderedSeriesCandidates: Set<String> = if (renderedSeriesContext != null) {
        if (serverAndSeriesShareReviewHistoryBase) {
            renderedSeriesContext.activeDatesMissingFromServerBase
        } else {
            renderedSeriesContext.activeDates
        }
    } else {
        emptySet()
    }

    return renderedSeriesCandidates + progressLocalFallbackActiveReviewDayDeltaCandidates(
        localFallbackActiveDates = localFallbackActiveDates,
        serverBase = serverBase
    )
}

private fun progressLocalFallbackActiveReviewDayDeltaCandidates(
    localFallbackActiveDates: Set<String>,
    serverBase: CloudProgressSummary
): Set<String> {
    val lastReviewedOn = serverBase.lastReviewedOn ?: return localFallbackActiveDates
    return localFallbackActiveDates.filter { localDate ->
        isLocalDateAfter(
            first = localDate,
            second = lastReviewedOn
        )
    }.toSet()
}

private fun progressActiveReviewDayDelta(
    activeReviewDayDeltaCandidates: Set<String>,
    serverBase: CloudProgressSummary,
    serverAndSeriesShareReviewHistoryBase: Boolean,
    referenceLocalDate: String
): Int {
    return activeReviewDayDeltaCandidates.count { localDate ->
        progressShouldApplyActiveReviewDayDelta(
            localDate = localDate,
            serverBase = serverBase,
            serverAndSeriesShareReviewHistoryBase = serverAndSeriesShareReviewHistoryBase,
            referenceLocalDate = referenceLocalDate
        )
    }
}

private fun progressShouldApplyActiveReviewDayDelta(
    localDate: String,
    serverBase: CloudProgressSummary,
    serverAndSeriesShareReviewHistoryBase: Boolean,
    referenceLocalDate: String
): Boolean {
    if (localDate == referenceLocalDate && serverBase.hasReviewedToday) {
        return false
    }
    if (serverAndSeriesShareReviewHistoryBase) {
        return true
    }

    val lastReviewedOn = serverBase.lastReviewedOn ?: return true
    return isLocalDateAfter(
        first = localDate,
        second = lastReviewedOn
    )
}

private fun progressCurrentStreakDaysWithRenderedDelta(
    serverBase: CloudProgressSummary,
    localFallbackActiveDates: Set<String>,
    renderedSeriesActiveDates: Set<String>?,
    referenceLocalDate: String
): Int {
    if (serverBase.hasReviewedToday) {
        return serverBase.currentStreakDays
    }
    if (serverBase.currentStreakDays <= 0) {
        return serverBase.currentStreakDays
    }
    val lastReviewedOn = serverBase.lastReviewedOn ?: return serverBase.currentStreakDays
    val referenceDate: LocalDate = parseLocalDate(rawDate = referenceLocalDate)
    val activeDates: Set<String> = localFallbackActiveDates + (renderedSeriesActiveDates ?: emptySet())
    var currentDate: LocalDate = parseLocalDate(rawDate = lastReviewedOn).plusDays(1L)
    var localDelta: Int = 0

    while (currentDate <= referenceDate && activeDates.contains(currentDate.toString())) {
        localDelta += 1
        currentDate = currentDate.plusDays(1L)
    }

    return serverBase.currentStreakDays + localDelta
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

private fun hasProgressSeriesOverlay(
    base: CloudProgressSeries,
    renderedSeries: CloudProgressSeries
): Boolean {
    if (base.dailyReviews.size != renderedSeries.dailyReviews.size) {
        return true
    }

    return base.dailyReviews.zip(renderedSeries.dailyReviews).any { pair ->
        pair.first.date != pair.second.date ||
            pair.first.reviewCount != pair.second.reviewCount
    }
}
