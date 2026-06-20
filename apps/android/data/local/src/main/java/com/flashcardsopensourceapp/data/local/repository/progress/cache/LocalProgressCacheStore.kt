package com.flashcardsopensourceapp.data.local.repository.progress.cache

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewHistoryStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
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
        val timeZone = timeProvider.currentZoneId().id
        val previousHistoryState = database.progressLocalCacheDao().loadProgressReviewHistoryState(reviewLog.workspaceId)
        val previousHistoryVersion = previousHistoryState?.historyVersion ?: 0L
        val nextHistoryVersion = previousHistoryVersion + 1L

        incrementLocalDayCount(
            timeZone = timeZone,
            workspaceId = reviewLog.workspaceId,
            localDate = toLocalDate(
                reviewLog = reviewLog,
                fallbackTimeZone = timeZone
            ),
            countDelta = createProgressRatingCountDelta(rating = reviewLog.rating)
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
                existingReviewLog.reviewedAtMillis != reviewLog.reviewedAtMillis ||
                existingReviewLog.rating != reviewLog.rating ||
                existingReviewLog.reviewedTimeZone != reviewLog.reviewedTimeZone
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
        newReviewLogs.groupBy(ReviewLogEntity::workspaceId).forEach { (workspaceId, workspaceReviewLogs) ->
            val previousHistoryState = database.progressLocalCacheDao().loadProgressReviewHistoryState(workspaceId)
            val previousHistoryVersion = previousHistoryState?.historyVersion ?: 0L
            val nextHistoryVersion = previousHistoryVersion + 1L

            workspaceReviewLogs.groupBy { reviewLog ->
                toLocalDate(
                    reviewLog = reviewLog,
                    fallbackTimeZone = timeZone
                )
            }.forEach { (localDate, dateReviewLogs) ->
                incrementLocalDayCount(
                    timeZone = timeZone,
                    workspaceId = workspaceId,
                    localDate = localDate,
                    countDelta = createProgressRatingCountDelta(reviewLogs = dateReviewLogs)
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
            timeZone = timeZone,
            updatedAtMillis = updatedAtMillis,
            nextHistoryVersion = nextHistoryVersion,
            rewriteHistoryState = true
        )
    }

    private suspend fun rebuildWorkspaceStateFromLogsInTransaction(
        workspaceId: String,
        reviewLogs: List<ReviewLogEntity>,
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
                reviewLog = reviewLog,
                fallbackTimeZone = timeZone
            )
        }.map { (localDate, dateReviewLogs) ->
            val countDelta = createProgressRatingCountDelta(reviewLogs = dateReviewLogs)
            ProgressLocalDayCountEntity(
                timeZone = timeZone,
                workspaceId = workspaceId,
                localDate = localDate,
                reviewCount = countDelta.reviewCount,
                againCount = countDelta.againCount,
                hardCount = countDelta.hardCount,
                goodCount = countDelta.goodCount,
                easyCount = countDelta.easyCount
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
        countDelta: ProgressRatingCountDelta
    ) {
        val existingEntry = database.progressLocalCacheDao().loadProgressLocalDayCount(
            timeZone = timeZone,
            workspaceId = workspaceId,
            localDate = localDate
        )
        val nextReviewCount = (existingEntry?.reviewCount ?: 0) + countDelta.reviewCount
        database.progressLocalCacheDao().insertProgressLocalDayCount(
            entry = ProgressLocalDayCountEntity(
                timeZone = timeZone,
                workspaceId = workspaceId,
                localDate = localDate,
                reviewCount = nextReviewCount,
                againCount = (existingEntry?.againCount ?: 0) + countDelta.againCount,
                hardCount = (existingEntry?.hardCount ?: 0) + countDelta.hardCount,
                goodCount = (existingEntry?.goodCount ?: 0) + countDelta.goodCount,
                easyCount = (existingEntry?.easyCount ?: 0) + countDelta.easyCount
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

private data class ProgressRatingCountDelta(
    val reviewCount: Int,
    val againCount: Int,
    val hardCount: Int,
    val goodCount: Int,
    val easyCount: Int
)

private fun createProgressRatingCountDelta(
    reviewLogs: List<ReviewLogEntity>
): ProgressRatingCountDelta {
    val ratingCounts = reviewLogs.groupingBy(ReviewLogEntity::rating).eachCount()
    return ProgressRatingCountDelta(
        reviewCount = reviewLogs.size,
        againCount = ratingCounts[ReviewRating.AGAIN] ?: 0,
        hardCount = ratingCounts[ReviewRating.HARD] ?: 0,
        goodCount = ratingCounts[ReviewRating.GOOD] ?: 0,
        easyCount = ratingCounts[ReviewRating.EASY] ?: 0
    )
}

private fun createProgressRatingCountDelta(
    rating: ReviewRating
): ProgressRatingCountDelta {
    return ProgressRatingCountDelta(
        reviewCount = 1,
        againCount = if (rating == ReviewRating.AGAIN) 1 else 0,
        hardCount = if (rating == ReviewRating.HARD) 1 else 0,
        goodCount = if (rating == ReviewRating.GOOD) 1 else 0,
        easyCount = if (rating == ReviewRating.EASY) 1 else 0
    )
}

private fun toLocalDate(
    reviewLog: ReviewLogEntity,
    fallbackTimeZone: String
): String {
    return toLocalDate(
        reviewedAtMillis = reviewLog.reviewedAtMillis,
        zoneId = ZoneId.of(reviewLog.reviewedTimeZone ?: fallbackTimeZone)
    )
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
