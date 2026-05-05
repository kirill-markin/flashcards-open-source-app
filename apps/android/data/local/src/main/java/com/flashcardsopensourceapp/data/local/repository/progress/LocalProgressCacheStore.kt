package com.flashcardsopensourceapp.data.local.repository.progress

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.repository.TimeProvider
import java.time.Instant
import java.time.ZoneId

class LocalProgressCacheStore(
    private val database: AppDatabase,
    private val timeProvider: TimeProvider
) {
    suspend fun recordReviewInTransaction(
        reviewLog: ReviewLogEntity,
        updatedAtMillis: Long
    ) {
        val zoneId = timeProvider.currentZoneId()
        val timeZone = zoneId.id
        val previousHistoryState = database.progressLocalCacheDao().loadProgressReviewHistoryState(reviewLog.workspaceId)
        val previousHistoryVersion = previousHistoryState?.historyVersion ?: 0L
        val nextHistoryVersion = previousHistoryVersion + 1L

        incrementLocalDayCount(
            timeZone = timeZone,
            workspaceId = reviewLog.workspaceId,
            localDate = toLocalDate(
                reviewedAtMillis = reviewLog.reviewedAtMillis,
                zoneId = zoneId
            ),
            delta = 1
        )
        database.progressLocalCacheDao().insertProgressReviewHistoryState(
            entry = ProgressReviewHistoryStateEntity(
                workspaceId = reviewLog.workspaceId,
                historyVersion = nextHistoryVersion,
                reviewLogCount = (previousHistoryState?.reviewLogCount ?: 0) + 1,
                maxReviewedAtMillis = maxOf(
                    previousHistoryState?.maxReviewedAtMillis ?: 0L,
                    reviewLog.reviewedAtMillis
                )
            )
        )
        if (shouldAdvanceLocalCacheState(timeZone, reviewLog.workspaceId, previousHistoryVersion)) {
            database.progressLocalCacheDao().insertProgressLocalCacheState(
                entry = ProgressLocalCacheStateEntity(
                    timeZone = timeZone,
                    workspaceId = reviewLog.workspaceId,
                    historyVersion = nextHistoryVersion,
                    updatedAtMillis = updatedAtMillis
                )
            )
        }
    }

    suspend fun applyReviewHistoryInTransaction(
        reviewLogs: List<ReviewLogEntity>,
        existingReviewLogs: List<ReviewLogEntity>,
        updatedAtMillis: Long
    ) {
        if (reviewLogs.isEmpty()) {
            return
        }

        val existingReviewLogsById = existingReviewLogs.associateBy(ReviewLogEntity::reviewLogId)
        val replacementWorkspaceIds = linkedSetOf<String>()
        val newReviewLogs = mutableListOf<ReviewLogEntity>()

        reviewLogs.forEach { reviewLog ->
            val existingReviewLog = existingReviewLogsById[reviewLog.reviewLogId]
            if (existingReviewLog == null) {
                newReviewLogs.add(reviewLog)
                return@forEach
            }
            if (
                existingReviewLog.workspaceId != reviewLog.workspaceId ||
                existingReviewLog.reviewedAtMillis != reviewLog.reviewedAtMillis
            ) {
                replacementWorkspaceIds.add(existingReviewLog.workspaceId)
                replacementWorkspaceIds.add(reviewLog.workspaceId)
            }
        }

        if (replacementWorkspaceIds.isNotEmpty()) {
            replacementWorkspaceIds.forEach { workspaceId ->
                rebuildWorkspaceInTransaction(
                    workspaceId = workspaceId,
                    timeZone = timeProvider.currentZoneId().id,
                    updatedAtMillis = updatedAtMillis,
                    incrementHistoryVersion = true
                )
            }
            return
        }

        if (newReviewLogs.isEmpty()) {
            return
        }

        val timeZone = timeProvider.currentZoneId().id
        val zoneId = timeProvider.currentZoneId()
        newReviewLogs.groupBy(ReviewLogEntity::workspaceId).forEach { (workspaceId, workspaceReviewLogs) ->
            val previousHistoryState = database.progressLocalCacheDao().loadProgressReviewHistoryState(workspaceId)
            val previousHistoryVersion = previousHistoryState?.historyVersion ?: 0L
            val nextHistoryVersion = previousHistoryVersion + 1L

            workspaceReviewLogs.groupBy { reviewLog ->
                toLocalDate(
                    reviewedAtMillis = reviewLog.reviewedAtMillis,
                    zoneId = zoneId
                )
            }.forEach { (localDate, dateReviewLogs) ->
                incrementLocalDayCount(
                    timeZone = timeZone,
                    workspaceId = workspaceId,
                    localDate = localDate,
                    delta = dateReviewLogs.size
                )
            }

            database.progressLocalCacheDao().insertProgressReviewHistoryState(
                entry = ProgressReviewHistoryStateEntity(
                    workspaceId = workspaceId,
                    historyVersion = nextHistoryVersion,
                    reviewLogCount = (previousHistoryState?.reviewLogCount ?: 0) + workspaceReviewLogs.size,
                    maxReviewedAtMillis = maxOf(
                        previousHistoryState?.maxReviewedAtMillis ?: 0L,
                        workspaceReviewLogs.maxOf(ReviewLogEntity::reviewedAtMillis)
                    )
                )
            )
            if (shouldAdvanceLocalCacheState(timeZone, workspaceId, previousHistoryVersion)) {
                database.progressLocalCacheDao().insertProgressLocalCacheState(
                    entry = ProgressLocalCacheStateEntity(
                        timeZone = timeZone,
                        workspaceId = workspaceId,
                        historyVersion = nextHistoryVersion,
                        updatedAtMillis = updatedAtMillis
                    )
                )
            }
        }
    }

    suspend fun clearAllInTransaction() {
        database.progressLocalCacheDao().deleteAllProgressLocalDayCounts()
        database.progressLocalCacheDao().deleteAllProgressReviewHistoryStates()
        database.progressLocalCacheDao().deleteAllProgressLocalCacheStates()
    }

    suspend fun reassignWorkspaceInTransaction(
        oldWorkspaceId: String,
        newWorkspaceId: String
    ) {
        database.progressLocalCacheDao().reassignWorkspaceProgressLocalDayCounts(
            oldWorkspaceId = oldWorkspaceId,
            newWorkspaceId = newWorkspaceId
        )
        database.progressLocalCacheDao().reassignProgressReviewHistoryState(
            oldWorkspaceId = oldWorkspaceId,
            newWorkspaceId = newWorkspaceId
        )
        database.progressLocalCacheDao().reassignProgressLocalCacheStates(
            oldWorkspaceId = oldWorkspaceId,
            newWorkspaceId = newWorkspaceId
        )
    }

    suspend fun rebuildWorkspaceReviewHistoryInTransaction(
        workspaceId: String,
        updatedAtMillis: Long
    ) {
        rebuildWorkspaceInTransaction(
            workspaceId = workspaceId,
            timeZone = timeProvider.currentZoneId().id,
            updatedAtMillis = updatedAtMillis,
            incrementHistoryVersion = true
        )
    }

    suspend fun rebuildTimeZoneCache(
        timeZone: String,
        updatedAtMillis: Long
    ) {
        database.withTransaction {
            rebuildTimeZoneCacheInTransaction(
                timeZone = timeZone,
                updatedAtMillis = updatedAtMillis
            )
        }
    }

    private suspend fun rebuildTimeZoneCacheInTransaction(
        timeZone: String,
        updatedAtMillis: Long
    ) {
        val zoneId = ZoneId.of(timeZone)
        val reviewLogs = database.reviewLogDao().loadReviewLogs()
        val reviewLogsByWorkspace = reviewLogs.groupBy(ReviewLogEntity::workspaceId)
        val historyStates = database.progressLocalCacheDao().loadProgressReviewHistoryStates()
        database.progressLocalCacheDao().deleteProgressLocalDayCounts(timeZone = timeZone)
        database.progressLocalCacheDao().deleteProgressLocalCacheStates(timeZone = timeZone)

        historyStates.forEach { historyState ->
            if (reviewLogsByWorkspace.containsKey(historyState.workspaceId).not()) {
                database.progressLocalCacheDao().deleteProgressReviewHistoryState(historyState.workspaceId)
            }
        }

        reviewLogsByWorkspace.forEach { (workspaceId, workspaceReviewLogs) ->
            rebuildWorkspaceStateFromLogsInTransaction(
                workspaceId = workspaceId,
                reviewLogs = workspaceReviewLogs,
                zoneId = zoneId,
                timeZone = timeZone,
                updatedAtMillis = updatedAtMillis,
                nextHistoryVersion = database.progressLocalCacheDao().loadProgressReviewHistoryState(
                    workspaceId = workspaceId
                )?.historyVersion ?: workspaceReviewLogs.size.toLong(),
                rewriteHistoryState = false
            )
        }
    }

    private suspend fun rebuildWorkspaceInTransaction(
        workspaceId: String,
        timeZone: String,
        updatedAtMillis: Long,
        incrementHistoryVersion: Boolean
    ) {
        val reviewLogs = database.reviewLogDao().loadReviewLogs(workspaceId = workspaceId)
        val previousHistoryState = database.progressLocalCacheDao().loadProgressReviewHistoryState(workspaceId)
        val nextHistoryVersion = when {
            reviewLogs.isEmpty() -> 0L
            incrementHistoryVersion -> (previousHistoryState?.historyVersion ?: 0L) + 1L
            previousHistoryState != null -> previousHistoryState.historyVersion
            else -> reviewLogs.size.toLong()
        }
        rebuildWorkspaceStateFromLogsInTransaction(
            workspaceId = workspaceId,
            reviewLogs = reviewLogs,
            zoneId = ZoneId.of(timeZone),
            timeZone = timeZone,
            updatedAtMillis = updatedAtMillis,
            nextHistoryVersion = nextHistoryVersion,
            rewriteHistoryState = true
        )
    }

    private suspend fun rebuildWorkspaceStateFromLogsInTransaction(
        workspaceId: String,
        reviewLogs: List<ReviewLogEntity>,
        zoneId: ZoneId,
        timeZone: String,
        updatedAtMillis: Long,
        nextHistoryVersion: Long,
        rewriteHistoryState: Boolean
    ) {
        database.progressLocalCacheDao().deleteProgressLocalDayCounts(
            timeZone = timeZone,
            workspaceId = workspaceId
        )
        database.progressLocalCacheDao().deleteProgressLocalCacheState(
            timeZone = timeZone,
            workspaceId = workspaceId
        )

        if (reviewLogs.isEmpty()) {
            if (rewriteHistoryState) {
                database.progressLocalCacheDao().deleteProgressReviewHistoryState(workspaceId = workspaceId)
            }
            return
        }

        val dayCounts = reviewLogs.groupBy { reviewLog ->
            toLocalDate(
                reviewedAtMillis = reviewLog.reviewedAtMillis,
                zoneId = zoneId
            )
        }.map { (localDate, dateReviewLogs) ->
            ProgressLocalDayCountEntity(
                timeZone = timeZone,
                workspaceId = workspaceId,
                localDate = localDate,
                reviewCount = dateReviewLogs.size
            )
        }
        database.progressLocalCacheDao().insertProgressLocalDayCounts(entries = dayCounts)
        if (rewriteHistoryState) {
            database.progressLocalCacheDao().insertProgressReviewHistoryState(
                entry = ProgressReviewHistoryStateEntity(
                    workspaceId = workspaceId,
                    historyVersion = nextHistoryVersion,
                    reviewLogCount = reviewLogs.size,
                    maxReviewedAtMillis = reviewLogs.maxOf(ReviewLogEntity::reviewedAtMillis)
                )
            )
        }
        database.progressLocalCacheDao().insertProgressLocalCacheState(
            entry = ProgressLocalCacheStateEntity(
                timeZone = timeZone,
                workspaceId = workspaceId,
                historyVersion = nextHistoryVersion,
                updatedAtMillis = updatedAtMillis
            )
        )
    }

    private suspend fun incrementLocalDayCount(
        timeZone: String,
        workspaceId: String,
        localDate: String,
        delta: Int
    ) {
        val existingEntry = database.progressLocalCacheDao().loadProgressLocalDayCount(
            timeZone = timeZone,
            workspaceId = workspaceId,
            localDate = localDate
        )
        val nextReviewCount = (existingEntry?.reviewCount ?: 0) + delta
        database.progressLocalCacheDao().insertProgressLocalDayCount(
            entry = ProgressLocalDayCountEntity(
                timeZone = timeZone,
                workspaceId = workspaceId,
                localDate = localDate,
                reviewCount = nextReviewCount
            )
        )
    }

    private suspend fun shouldAdvanceLocalCacheState(
        timeZone: String,
        workspaceId: String,
        previousHistoryVersion: Long
    ): Boolean {
        if (previousHistoryVersion == 0L) {
            return true
        }
        val cacheState = database.progressLocalCacheDao().loadProgressLocalCacheState(
            timeZone = timeZone,
            workspaceId = workspaceId
        )
        return cacheState?.historyVersion == previousHistoryVersion
    }
}

private fun toLocalDate(
    reviewedAtMillis: Long,
    zoneId: ZoneId
): String {
    return Instant.ofEpochMilli(reviewedAtMillis)
        .atZone(zoneId)
        .toLocalDate()
        .toString()
}
