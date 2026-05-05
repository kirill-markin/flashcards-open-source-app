package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.OutboxEntryEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCardDueEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.SyncStateEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewSchedule
import com.flashcardsopensourceapp.data.local.model.CloudProgressReviewScheduleBucket
import com.flashcardsopensourceapp.data.local.model.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.CloudSettings
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSeriesSnapshot
import com.flashcardsopensourceapp.data.local.model.ProgressSnapshotSource
import com.flashcardsopensourceapp.data.local.model.ProgressSummaryScopeKey
import com.flashcardsopensourceapp.data.local.model.ProgressSummarySnapshot
import org.json.JSONObject
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

internal fun createProgressReviewScheduleScopeKey(
    cloudSettings: CloudSettings,
    today: LocalDate,
    zoneId: ZoneId,
    workspaceIds: List<String>
): ProgressReviewScheduleScopeKey {
    return ProgressReviewScheduleScopeKey(
        scopeId = createProgressScopeId(cloudSettings = cloudSettings),
        timeZone = zoneId.id,
        workspaceMembershipKey = createProgressWorkspaceMembershipKey(workspaceIds = workspaceIds),
        referenceLocalDate = today.toString()
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

internal fun createProgressWorkspaceMembershipKey(
    workspaceIds: List<String>
): String {
    return workspaceIds.distinct().sorted().joinToString(separator = "|")
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

internal fun createReviewScheduleFingerprint(
    reviewScheduleCards: List<ProgressReviewScheduleCardDueEntity>,
    pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    workspaceIds: List<String>
): String {
    val workspaceIdSet = workspaceIds.toSet()
    val cardFingerprint = reviewScheduleCards.filter { card ->
        workspaceIdSet.contains(card.workspaceId)
    }.sortedWith(
        compareBy<ProgressReviewScheduleCardDueEntity> { card -> card.workspaceId }
            .thenBy { card -> card.cardId }
    ).joinToString(separator = "|") { card ->
        "${card.workspaceId}:${card.cardId}:${card.dueAtMillis ?: "new"}"
    }
    val pendingCardFingerprint = pendingCardUpsertOutboxEntries.filter { entry ->
        workspaceIdSet.contains(entry.workspaceId) &&
            entry.entityType == "card" &&
            entry.operationType == "upsert" &&
            entry.affectsReviewSchedule
    }.sortedWith(
        compareBy<OutboxEntryEntity> { entry -> entry.workspaceId }
            .thenBy { entry -> entry.outboxEntryId }
    ).joinToString(separator = "|") { entry ->
        "${entry.workspaceId}:${entry.outboxEntryId}:${entry.entityId}"
    }

    return "$cardFingerprint::$pendingCardFingerprint"
}

internal fun isProgressReviewScheduleLocalScopeHydrated(
    syncStates: List<SyncStateEntity>,
    workspaceIds: List<String>
): Boolean {
    val syncStatesByWorkspaceId = syncStates.associateBy(SyncStateEntity::workspaceId)
    return workspaceIds.all { workspaceId ->
        syncStatesByWorkspaceId[workspaceId]?.hasHydratedHotState == true
    }
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

internal fun didSyncCompleteWithReviewScheduleChange(
    previousSuccessfulSyncAtMillis: Long?,
    currentSuccessfulSyncAtMillis: Long?,
    previousReviewScheduleFingerprint: String?,
    currentReviewScheduleFingerprint: String
): Boolean {
    if (previousReviewScheduleFingerprint == null) {
        return false
    }
    if (currentSuccessfulSyncAtMillis == null || currentSuccessfulSyncAtMillis == previousSuccessfulSyncAtMillis) {
        return false
    }

    return previousReviewScheduleFingerprint != currentReviewScheduleFingerprint
}

internal data class ProgressReviewScheduleSyncRefreshTrackerState(
    val serializedScopeKey: String,
    val reviewScheduleFingerprint: String,
    val hasUnacknowledgedReviewScheduleChange: Boolean,
    val sawSyncSuccessAfterReviewScheduleChange: Boolean,
    val lastSuccessfulSyncAtMillis: Long?
)

internal data class ProgressReviewScheduleSyncRefreshTrackerResult(
    val state: ProgressReviewScheduleSyncRefreshTrackerState,
    val shouldRefresh: Boolean
)

internal fun updateProgressReviewScheduleSyncRefreshTrackerState(
    previousState: ProgressReviewScheduleSyncRefreshTrackerState?,
    serializedScopeKey: String,
    reviewScheduleFingerprint: String,
    hasPendingScheduleImpactingCardChanges: Boolean,
    currentSuccessfulSyncAtMillis: Long?
): ProgressReviewScheduleSyncRefreshTrackerResult {
    val scopedPreviousState = previousState?.takeIf { state ->
        state.serializedScopeKey == serializedScopeKey
    }
    val previousSuccessfulSyncAtMillis = scopedPreviousState?.lastSuccessfulSyncAtMillis
    val didSyncSuccessAdvance = scopedPreviousState != null &&
        currentSuccessfulSyncAtMillis != null &&
        currentSuccessfulSyncAtMillis != previousSuccessfulSyncAtMillis
    val didReviewScheduleFingerprintChange = scopedPreviousState != null &&
        scopedPreviousState.reviewScheduleFingerprint != reviewScheduleFingerprint
    val hasUnacknowledgedReviewScheduleChange = scopedPreviousState
        ?.hasUnacknowledgedReviewScheduleChange == true ||
        hasPendingScheduleImpactingCardChanges ||
        didReviewScheduleFingerprintChange
    val sawSyncSuccessAfterReviewScheduleChange = scopedPreviousState
        ?.sawSyncSuccessAfterReviewScheduleChange == true ||
        (hasUnacknowledgedReviewScheduleChange && didSyncSuccessAdvance)
    val shouldRefresh = hasUnacknowledgedReviewScheduleChange &&
        sawSyncSuccessAfterReviewScheduleChange &&
        hasPendingScheduleImpactingCardChanges.not()

    return ProgressReviewScheduleSyncRefreshTrackerResult(
        state = ProgressReviewScheduleSyncRefreshTrackerState(
            serializedScopeKey = serializedScopeKey,
            reviewScheduleFingerprint = reviewScheduleFingerprint,
            hasUnacknowledgedReviewScheduleChange = if (shouldRefresh) {
                false
            } else {
                hasUnacknowledgedReviewScheduleChange
            },
            sawSyncSuccessAfterReviewScheduleChange = if (shouldRefresh) {
                false
            } else {
                sawSyncSuccessAfterReviewScheduleChange
            },
            lastSuccessfulSyncAtMillis = currentSuccessfulSyncAtMillis
        ),
        shouldRefresh = shouldRefresh
    )
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

internal fun serializeProgressReviewScheduleScopeKey(
    scopeKey: ProgressReviewScheduleScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::" +
        "${scopeKey.workspaceMembershipKey}::${scopeKey.referenceLocalDate}"
}

internal fun serializeProgressReviewScheduleServerCacheKey(
    scopeKey: ProgressReviewScheduleScopeKey
): String {
    return "${scopeKey.scopeId}::${scopeKey.timeZone}::${scopeKey.referenceLocalDate}"
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

internal fun createEmptyProgressReviewSchedule(
    scopeKey: ProgressReviewScheduleScopeKey
): CloudProgressReviewSchedule {
    return CloudProgressReviewSchedule(
        timeZone = scopeKey.timeZone,
        generatedAt = null,
        totalCards = 0,
        buckets = ProgressReviewScheduleBucketKey.orderedEntries.map { key ->
            CloudProgressReviewScheduleBucket(
                key = key,
                count = 0
            )
        }
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

internal fun validateProgressReviewScheduleBuckets(
    buckets: List<CloudProgressReviewScheduleBucket>,
    totalCards: Int
) {
    val expectedKeys = ProgressReviewScheduleBucketKey.orderedEntries
    val actualKeys = buckets.map(CloudProgressReviewScheduleBucket::key)
    if (actualKeys != expectedKeys) {
        throw IllegalArgumentException(
            "Review schedule buckets must use the stable key order '${expectedKeys.joinToString { key -> key.wireKey }}'."
        )
    }
    val countedCards = buckets.sumOf { bucket ->
        if (bucket.count < 0) {
            throw IllegalArgumentException("Review schedule bucket '${bucket.key.wireKey}' has a negative count.")
        }
        bucket.count
    }
    if (totalCards < 0) {
        throw IllegalArgumentException("Review schedule totalCards must not be negative.")
    }
    if (countedCards != totalCards) {
        throw IllegalArgumentException(
            "Review schedule bucket counts ($countedCards) must match totalCards ($totalCards)."
        )
    }
}

internal fun validateProgressReviewScheduleResponseTimeZone(
    schedule: CloudProgressReviewSchedule,
    scopeKey: ProgressReviewScheduleScopeKey
) {
    if (schedule.timeZone == scopeKey.timeZone) {
        return
    }

    throw IllegalArgumentException(
        "Progress review schedule response timeZone '${schedule.timeZone}' did not match requested timeZone " +
            "'${scopeKey.timeZone}' for scope '${serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey)}'. " +
            "Check the progress API response before caching this schedule."
    )
}

internal fun validateProgressReviewScheduleCacheTimeZone(
    cacheTimeZone: String,
    scopeKey: ProgressReviewScheduleScopeKey
) {
    if (cacheTimeZone == scopeKey.timeZone) {
        return
    }

    throw IllegalArgumentException(
        "Cached progress review schedule timeZone '$cacheTimeZone' did not match requested timeZone " +
            "'${scopeKey.timeZone}' for scope '${serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey)}'. " +
            "Refresh the progress review schedule before rendering this cache."
    )
}

// Decide whether the local review-schedule fallback can replace the server-base schedule.
//
// Gating contract (must match iOS FlashcardsStore+ProgressSnapshot.swift:155-184 and
// web apps/web/src/appData/progress/progressSnapshots.ts:175-185):
//   1. The local cache must be fully hydrated for the scope (isLocalReviewScheduleScopeHydrated).
//      Without full hydration the local cards table cannot represent the user-wide schedule.
//   2. localFallback.totalCards - pendingCardTotalDelta must equal serverBase.totalCards.
//      pendingCardTotalDelta only accounts for net card creates and deletes, not for
//      due-date/FSRS edits or text edits on already-server-synced cards.
//
// Why totals-equality is sufficient (the bucket-equality invariant):
//   Every outbox entry whose card mutation can shift the review schedule is enqueued with
//   affectsReviewSchedule = true (see LocalCardsRepository.createCard/deleteCard,
//   LocalReviewRepository.recordReview, and the iOS/web equivalents). Specifically:
//     - card creates set the flag to true,
//     - card deletes set the flag to true,
//     - card reviews set the flag to true (these update due-date and FSRS state in the
//       local cards row),
//     - text-only updates set the flag to false because they cannot move a card between
//       buckets.
//   The caller already checks hasPendingScheduleImpactingCardChanges before invoking this
//   function, so we are inside the gated branch only when at least one schedule-impacting
//   mutation is pending. If, in addition, totals match after subtracting net creates/deletes,
//   then the local-only divergence from the server is necessarily in the bucket distribution
//   driven by un-pushed reviews on already-server-synced cards. Those reviews already wrote
//   the new due-date and FSRS state into the local cards table, so localFallback already
//   reflects the post-review buckets that the user expects to see. Therefore replacing the
//   stale server bucketing with localFallback is the correct rendering, not a stale overlay.
//
// If a future code path enqueues a schedule-shifting mutation with affectsReviewSchedule = false
// (i.e. breaks invariant #2), this gating becomes unsafe and the cross-platform contract must
// be revisited together with iOS and web.
private fun canReplaceReviewScheduleWithLocalOverlay(
    localFallback: CloudProgressReviewSchedule,
    serverBase: CloudProgressReviewSchedule,
    pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    isLocalReviewScheduleScopeHydrated: Boolean,
    workspaceIds: List<String>
): Boolean {
    if (isLocalReviewScheduleScopeHydrated.not()) {
        return false
    }

    val pendingCardTotalDelta = try {
        calculatePendingReviewScheduleCardTotalDelta(
            pendingCardUpsertOutboxEntries = pendingCardUpsertOutboxEntries,
            workspaceIds = workspaceIds
        )
    } catch (error: IllegalArgumentException) {
        logProgressRepositoryWarning(
            event = "progress_review_schedule_pending_total_delta_skipped",
            fields = listOf(
                "timeZone" to localFallback.timeZone,
                "workspaceIds" to workspaceIds.joinToString(separator = ",")
            ),
            error = error
        )
        return false
    }

    return localFallback.totalCards - pendingCardTotalDelta == serverBase.totalCards
}

internal fun calculatePendingReviewScheduleCardTotalDelta(
    pendingCardUpsertOutboxEntries: List<OutboxEntryEntity>,
    workspaceIds: List<String>
): Int {
    val workspaceIdSet = workspaceIds.toSet()
    val changesByCardId = linkedMapOf<String, PendingReviewScheduleCardTotalChange>()
    pendingCardUpsertOutboxEntries.forEach { entry ->
        if (
            workspaceIdSet.contains(entry.workspaceId).not() ||
            entry.entityType != "card" ||
            entry.operationType != "upsert" ||
            entry.affectsReviewSchedule.not()
        ) {
            return@forEach
        }

        val parsedChange = parsePendingReviewScheduleCardTotalChange(entry = entry)
        val existingChange = changesByCardId[entry.entityId]
        changesByCardId[entry.entityId] = PendingReviewScheduleCardTotalChange(
            hasLocalCreate = existingChange?.hasLocalCreate == true || parsedChange.hasLocalCreate,
            finalIsDeleted = parsedChange.finalIsDeleted
        )
    }

    return changesByCardId.values.sumOf { change ->
        when {
            change.hasLocalCreate && change.finalIsDeleted -> 0
            change.hasLocalCreate -> 1
            change.finalIsDeleted -> -1
            else -> 0
        }
    }
}

private data class PendingReviewScheduleCardTotalChange(
    val hasLocalCreate: Boolean,
    val finalIsDeleted: Boolean
)

private fun parsePendingReviewScheduleCardTotalChange(
    entry: OutboxEntryEntity
): PendingReviewScheduleCardTotalChange {
    val payloadJsonObject = try {
        JSONObject(entry.payloadJson)
    } catch (error: Exception) {
        throw IllegalArgumentException(
            "Invalid pending card upsert payload JSON for outbox entry '${entry.outboxEntryId}'.",
            error
        )
    }
    val payloadCardId = payloadJsonObject.optString("cardId", entry.entityId)
    if (payloadCardId != entry.entityId) {
        throw IllegalArgumentException(
            "Pending card upsert outbox entry '${entry.outboxEntryId}' entityId '${entry.entityId}' " +
                "does not match payload cardId '$payloadCardId'."
        )
    }

    val createdAt = if (payloadJsonObject.has("createdAt") && payloadJsonObject.isNull("createdAt").not()) {
        try {
            payloadJsonObject.getString("createdAt")
        } catch (error: Exception) {
            throw IllegalArgumentException(
                "Invalid createdAt in pending card upsert payload for outbox entry '${entry.outboxEntryId}'.",
                error
            )
        }
    } else {
        null
    }

    return PendingReviewScheduleCardTotalChange(
        hasLocalCreate = createdAt == entry.clientUpdatedAtIso,
        finalIsDeleted = payloadJsonObject.has("deletedAt") && payloadJsonObject.isNull("deletedAt").not()
    )
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

private data class ProgressReviewScheduleBucketStarts(
    val startOfTomorrowMillis: Long,
    val startOfDay8Millis: Long,
    val startOfDay31Millis: Long,
    val startOfDay91Millis: Long,
    val startOfDay361Millis: Long,
    val startOfDay721Millis: Long
)

private fun createProgressReviewScheduleBucketStarts(
    today: LocalDate,
    zoneId: ZoneId
): ProgressReviewScheduleBucketStarts {
    return ProgressReviewScheduleBucketStarts(
        startOfTomorrowMillis = startOfLocalDateMillis(
            date = today.plusDays(1L),
            zoneId = zoneId
        ),
        startOfDay8Millis = startOfLocalDateMillis(
            date = today.plusDays(8L),
            zoneId = zoneId
        ),
        startOfDay31Millis = startOfLocalDateMillis(
            date = today.plusDays(31L),
            zoneId = zoneId
        ),
        startOfDay91Millis = startOfLocalDateMillis(
            date = today.plusDays(91L),
            zoneId = zoneId
        ),
        startOfDay361Millis = startOfLocalDateMillis(
            date = today.plusDays(361L),
            zoneId = zoneId
        ),
        startOfDay721Millis = startOfLocalDateMillis(
            date = today.plusDays(721L),
            zoneId = zoneId
        )
    )
}

private fun startOfLocalDateMillis(
    date: LocalDate,
    zoneId: ZoneId
): Long {
    return date.atStartOfDay(zoneId).toInstant().toEpochMilli()
}

private fun bucketReviewDueAtMillis(
    dueAtMillis: Long?,
    bucketStarts: ProgressReviewScheduleBucketStarts
): ProgressReviewScheduleBucketKey {
    if (dueAtMillis == null) {
        return ProgressReviewScheduleBucketKey.NEW
    }

    return when {
        dueAtMillis < bucketStarts.startOfTomorrowMillis -> ProgressReviewScheduleBucketKey.TODAY
        dueAtMillis < bucketStarts.startOfDay8Millis -> ProgressReviewScheduleBucketKey.DAYS_1_TO_7
        dueAtMillis < bucketStarts.startOfDay31Millis -> ProgressReviewScheduleBucketKey.DAYS_8_TO_30
        dueAtMillis < bucketStarts.startOfDay91Millis -> ProgressReviewScheduleBucketKey.DAYS_31_TO_90
        dueAtMillis < bucketStarts.startOfDay361Millis -> ProgressReviewScheduleBucketKey.DAYS_91_TO_360
        dueAtMillis < bucketStarts.startOfDay721Millis -> ProgressReviewScheduleBucketKey.YEARS_1_TO_2
        else -> ProgressReviewScheduleBucketKey.LATER
    }
}
