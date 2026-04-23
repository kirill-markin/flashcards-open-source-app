package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeParseException

const val progressHistoryDayCount: Long = 140L

internal fun createProgressSummaryScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId
): ProgressSummaryScopeKey {
    return ProgressSummaryScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        referenceLocalDate = today.toString()
    )
}

internal fun createProgressSeriesScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId
): ProgressSeriesScopeKey {
    val from = today.minusDays(progressHistoryDayCount - 1L)
    return ProgressSeriesScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        from = from.toString(),
        to = today.toString()
    )
}

internal fun createProgressScopeId(
    cloudSettings: CloudSettings
): String {
    return when (cloudSettings.cloudState) {
        CloudAccountState.LINKED -> "linked:${cloudSettings.linkedUserId ?: cloudSettings.installationId}"
        CloudAccountState.GUEST -> "guest:${cloudSettings.activeWorkspaceId ?: cloudSettings.installationId}"
        CloudAccountState.DISCONNECTED -> "local:${cloudSettings.installationId}"
        CloudAccountState.LINKING_READY -> "linking:${cloudSettings.installationId}"
    }
}

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
    val workspaceIdSet = workspaceIds.toSet()
    val activeReviewDates = localDayCounts.filter { dayCount ->
        dayCount.timeZone == scopeKey.timeZone &&
            workspaceIdSet.contains(dayCount.workspaceId) &&
            dayCount.reviewCount > 0
    }.map(ProgressLocalDayCountEntity::localDate)
        .distinct()
        .sorted()
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
        activeReviewDays = activeReviewDates.size
    )
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
        summary = null
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
        summary = null
    )
}

internal fun createProgressSummarySnapshot(
    scopeKey: ProgressSummaryScopeKey,
    localFallback: CloudProgressSummary,
    serverBase: CloudProgressSummary?,
    cloudState: CloudAccountState
): ProgressSummarySnapshot {
    val hasPendingLocalOverlay = serverBase?.let { base ->
        hasProgressSummaryOverlay(
            localFallback = localFallback,
            serverBase = base
        )
    } ?: false
    val renderedSummary = when {
        serverBase == null -> localFallback
        hasPendingLocalOverlay -> mergeProgressSummary(
            base = serverBase,
            localFallback = localFallback
        )
        else -> serverBase
    }
    val source = when {
        serverBase == null -> ProgressSnapshotSource.LOCAL_ONLY
        hasPendingLocalOverlay -> ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY
        else -> ProgressSnapshotSource.SERVER_BASE
    }
    return ProgressSummarySnapshot(
        scopeKey = scopeKey,
        renderedSummary = renderedSummary,
        localFallback = localFallback,
        serverBase = serverBase,
        source = source,
        isApproximate = source == ProgressSnapshotSource.LOCAL_ONLY ||
            hasPendingLocalOverlay ||
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
    val hasPendingLocalOverlay = pendingLocalOverlay.dailyReviews.any { point ->
        point.reviewCount > 0
    }
    val renderedSeries = if (serverBase == null) {
        localFallback
    } else {
        mergeProgressSeries(
            base = serverBase,
            overlay = pendingLocalOverlay
        )
    }
    val source = when {
        serverBase == null -> ProgressSnapshotSource.LOCAL_ONLY
        hasPendingLocalOverlay -> ProgressSnapshotSource.SERVER_BASE_WITH_LOCAL_OVERLAY
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
            hasPendingLocalOverlay ||
            cloudState == CloudAccountState.DISCONNECTED ||
            cloudState == CloudAccountState.LINKING_READY
    )
}

internal fun mergeProgressSummary(
    base: CloudProgressSummary,
    localFallback: CloudProgressSummary
): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = maxOf(base.currentStreakDays, localFallback.currentStreakDays),
        hasReviewedToday = base.hasReviewedToday || localFallback.hasReviewedToday,
        lastReviewedOn = maxLocalDate(
            first = base.lastReviewedOn,
            second = localFallback.lastReviewedOn
        ),
        activeReviewDays = maxOf(base.activeReviewDays, localFallback.activeReviewDays)
    )
}

internal fun mergeProgressSeries(
    base: CloudProgressSeries,
    overlay: CloudProgressSeries
): CloudProgressSeries {
    val overlayCountsByDate = overlay.dailyReviews.associate { point ->
        point.date to point.reviewCount
    }
    val mergedDailyReviews = base.dailyReviews.map { point ->
        CloudDailyReviewPoint(
            date = point.date,
            reviewCount = point.reviewCount + (overlayCountsByDate[point.date] ?: 0)
        )
    }
    return CloudProgressSeries(
        timeZone = base.timeZone,
        from = base.from,
        to = base.to,
        dailyReviews = mergedDailyReviews,
        generatedAt = base.generatedAt,
        summary = null
    )
}

internal fun createReviewHistoryFingerprint(
    reviewHistoryStates: List<ProgressReviewHistoryStateEntity>,
    pendingReviewEntries: List<ProgressPendingReviewFingerprintEntry>,
    syncStates: List<SyncStateEntity>,
    workspaceIds: List<String>
): String {
    val workspaceIdSet = workspaceIds.toSet()
    val relevantHistoryStates = reviewHistoryStates.filter { historyState ->
        workspaceIdSet.contains(historyState.workspaceId)
    }.sortedBy(ProgressReviewHistoryStateEntity::workspaceId)
    val relevantPendingReviewEntries = pendingReviewEntries.filter { entry ->
        workspaceIdSet.contains(entry.workspaceId)
    }
    val relevantSyncStates = syncStates.filter { syncState ->
        workspaceIdSet.contains(syncState.workspaceId)
    }.sortedBy(SyncStateEntity::workspaceId)

    val historyFingerprint = relevantHistoryStates.joinToString(separator = "|") { historyState ->
        "${historyState.workspaceId}:${historyState.historyVersion}"
    }
    val pendingReviewIds = relevantPendingReviewEntries.map(ProgressPendingReviewFingerprintEntry::outboxEntryId).sorted()
    val reviewSequenceFingerprint = relevantSyncStates.joinToString(separator = "|") { syncState ->
        "${syncState.workspaceId}:${syncState.lastReviewSequenceId}"
    }
    return "$historyFingerprint:${pendingReviewIds.joinToString(separator = ",")}:$reviewSequenceFingerprint"
}

internal fun didSyncCompleteWithReviewHistoryChange(
    previousSuccessfulSyncAtMillis: Long?,
    currentSuccessfulSyncAtMillis: Long?,
    previousReviewHistoryFingerprint: String?,
    currentReviewHistoryFingerprint: String
): Boolean {
    if (previousReviewHistoryFingerprint == null) {
        return false
    }
    if (currentSuccessfulSyncAtMillis == null || currentSuccessfulSyncAtMillis == previousSuccessfulSyncAtMillis) {
        return false
    }

    return previousReviewHistoryFingerprint != currentReviewHistoryFingerprint
}

internal fun serializeProgressSummaryScopeKey(
    scopeKey: ProgressSummaryScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.referenceLocalDate}"
}

internal fun serializeProgressSeriesScopeKey(
    scopeKey: ProgressSeriesScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.from}::${scopeKey.to}"
}

internal fun parseLocalDate(
    rawDate: String
): LocalDate {
    return try {
        LocalDate.parse(rawDate)
    } catch (error: DateTimeParseException) {
        throw IllegalArgumentException("Invalid local date '$rawDate'.", error)
    }
}

internal fun createEmptyProgressSummary(): CloudProgressSummary {
    return CloudProgressSummary(
        currentStreakDays = 0,
        hasReviewedToday = false,
        lastReviewedOn = null,
        activeReviewDays = 0
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
        summary = null
    )
}

private fun createInclusiveLocalDateRange(
    from: String,
    to: String
): List<String> {
    val startDate = parseLocalDate(rawDate = from)
    val endDate = parseLocalDate(rawDate = to)
    val dates = mutableListOf<String>()
    var currentDate = startDate

    while (currentDate <= endDate) {
        dates.add(currentDate.toString())
        currentDate = currentDate.plusDays(1L)
    }

    return dates
}

private fun computeCurrentStreakDays(
    activeReviewDateSet: Set<String>,
    today: LocalDate
): Int {
    val anchorDate: LocalDate = when {
        activeReviewDateSet.contains(today.toString()) -> today
        activeReviewDateSet.contains(today.minusDays(1L).toString()) -> today.minusDays(1L)
        else -> return 0
    }

    var streakDays = 0
    var currentDate = anchorDate
    while (activeReviewDateSet.contains(currentDate.toString())) {
        streakDays += 1
        currentDate = currentDate.minusDays(1L)
    }
    return streakDays
}

private fun hasProgressSummaryOverlay(
    localFallback: CloudProgressSummary,
    serverBase: CloudProgressSummary
): Boolean {
    return localFallback.currentStreakDays > serverBase.currentStreakDays ||
        (localFallback.hasReviewedToday && serverBase.hasReviewedToday.not()) ||
        isLocalDateAfter(
            first = localFallback.lastReviewedOn,
            second = serverBase.lastReviewedOn
        ) ||
        localFallback.activeReviewDays > serverBase.activeReviewDays
}

private fun isLocalDateAfter(
    first: String?,
    second: String?
): Boolean {
    return when {
        first == null -> false
        second == null -> true
        else -> parseLocalDate(rawDate = first).isAfter(parseLocalDate(rawDate = second))
    }
}

private fun maxLocalDate(
    first: String?,
    second: String?
): String? {
    return when {
        first == null -> second
        second == null -> first
        parseLocalDate(rawDate = first).isAfter(parseLocalDate(rawDate = second)) -> first
        else -> second
    }
}
