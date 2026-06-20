package com.flashcardsopensourceapp.data.local.repository.progress.snapshots

import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.progress.CloudDailyReviewPoint
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSeries
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakFreeze
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressSummary
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewHistoryWatermark
import com.flashcardsopensourceapp.data.local.model.progress.ProgressStreakLeaderboardScopeKey
import com.flashcardsopensourceapp.data.local.repository.progress.cache.findProgressReviewScheduleServerBase
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCacheEntity
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCloudProgressLeaderboardOrNull
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCloudProgressStreakLeaderboardOrNull
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCloudProgressReviewScheduleOrNull
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCloudProgressSeriesOrNull
import com.flashcardsopensourceapp.data.local.repository.progress.cache.toCloudProgressSummaryOrNull
import com.flashcardsopensourceapp.data.local.repository.progress.createCloudSettings
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressLeaderboardForTest
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressLeaderboardRankingRowForTest
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressStreakLeaderboardForTest
import com.flashcardsopensourceapp.data.local.repository.progress.createProgressStreakLeaderboardRankingRowForTest
import com.flashcardsopensourceapp.data.local.repository.progress.createReviewSchedule
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressCacheValidationTest {
    @Test
    fun invalidSummaryCacheLastReviewedOnIsIgnored() {
        val cacheEntity = ProgressSummaryCacheEntity(
            scopeKey = "scope-1",
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            generatedAt = "2026-04-18T10:00:00Z",
            reviewHistoryWatermarksJson = """[]""",
            currentStreakDays = 2,
            longestStreakDays = 2,
            hasReviewedToday = true,
            lastReviewedOn = "not-a-date",
            activeReviewDays = 4,
            streakFreezeAvailableCredits = 2,
            streakFreezeCapacity = 2,
            streakFreezeBalanceUnits = 20,
            streakFreezeUnitsPerCredit = 10,
            streakFreezeEarnedUnitsPerStreakDay = 1,
            streakFreezeNextCreditProgressUnits = 0,
            streakFreezeNextCreditRequiredUnits = 10,
            updatedAtMillis = 1L
        )

        assertEquals(null, cacheEntity.toCloudProgressSummaryOrNull())
    }

    @Test
    fun invalidSeriesCacheJsonIsIgnored() {
        val cacheEntity = ProgressSeriesCacheEntity(
            scopeKey = "scope-1",
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            fromLocalDate = "2026-04-01",
            toLocalDate = "2026-04-18",
            generatedAt = "2026-04-18T10:00:00Z",
            reviewHistoryWatermarksJson = """[]""",
            dailyReviewsJson = "{not-json}",
            streakDaysJson = """[]""",
            updatedAtMillis = 1L
        )

        assertEquals(null, cacheEntity.toCloudProgressSeriesOrNull())
    }

    @Test
    fun invalidReviewScheduleCacheBucketOrderIsIgnored() {
        val cacheEntity = ProgressReviewScheduleCacheEntity(
            scopeKey = "scope-1",
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            referenceLocalDate = "2026-05-03",
            generatedAt = "2026-05-03T10:00:00Z",
            reviewHistoryWatermarksJson = """[]""",
            totalCards = 1,
            bucketsJson = """[{"key":"today","count":1},{"key":"new","count":0}]""",
            updatedAtMillis = 1L
        )

        assertEquals(null, cacheEntity.toCloudProgressReviewScheduleOrNull())
    }

    @Test
    fun progressSummaryCachePreservesServerStreakFreezePolicy(): Unit {
        val scopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val summary = CloudProgressSummary(
            currentStreakDays = 4,
            longestStreakDays = 4,
            hasReviewedToday = false,
            lastReviewedOn = "2026-04-17",
            activeReviewDays = 9,
            streakFreeze = CloudProgressStreakFreeze(
                availableCredits = 2,
                capacity = 3,
                balanceUnits = 25,
                unitsPerCredit = 10,
                earnedUnitsPerStreakDay = 2,
                nextCreditProgressUnits = 5,
                nextCreditRequiredUnits = 10
            ),
            reviewHistoryWatermarks = emptyList()
        )

        val restoredSummary = summary.toCacheEntity(
            scopeKey = scopeKey,
            updatedAtMillis = 1L
        ).toCloudProgressSummaryOrNull()

        assertEquals(3, restoredSummary?.streakFreeze?.capacity)
        assertEquals(25, restoredSummary?.streakFreeze?.balanceUnits)
        assertEquals(2, restoredSummary?.streakFreeze?.earnedUnitsPerStreakDay)
        assertEquals(5, restoredSummary?.streakFreeze?.nextCreditProgressUnits)
    }

    @Test
    fun mismatchedReviewScheduleResponseTimeZoneIsRejected() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )

        val error = assertThrows(IllegalArgumentException::class.java) {
            validateProgressReviewScheduleResponseTimeZone(
                schedule = createReviewSchedule(
                    timeZone = "UTC",
                    newCount = 0,
                    todayCount = 0
                ),
                scopeKey = scopeKey
            )
        }

        assertTrue(error.message.orEmpty().contains("UTC"))
        assertTrue(error.message.orEmpty().contains("Europe/Madrid"))
    }

    @Test
    fun mismatchedReviewScheduleCacheTimeZoneIsIgnoredForScope() {
        val scopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-05-03"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1")
        )
        val cacheEntity = ProgressReviewScheduleCacheEntity(
            scopeKey = serializeProgressReviewScheduleScopeKey(scopeKey = scopeKey),
            scopeId = scopeKey.scopeId,
            timeZone = "UTC",
            referenceLocalDate = scopeKey.referenceLocalDate,
            generatedAt = "2026-05-03T10:00:00Z",
            reviewHistoryWatermarksJson = """[]""",
            totalCards = 0,
            bucketsJson = """[]""",
            updatedAtMillis = 1L
        )

        assertEquals(
            null,
            findProgressReviewScheduleServerBase(
                reviewScheduleCaches = listOf(cacheEntity),
                scopeKey = scopeKey
            )
        )
    }

    @Test
    fun progressServerCachesPreserveReviewHistoryWatermarks(): Unit {
        val watermarks = listOf(
            ProgressReviewHistoryWatermark(
                workspaceId = "workspace-1",
                reviewSequenceId = 42L
            ),
            ProgressReviewHistoryWatermark(
                workspaceId = "workspace-2",
                reviewSequenceId = 7L
            )
        )
        val summaryScopeKey = createProgressSummaryScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val seriesScopeKey = createProgressSeriesScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid")
        )
        val scheduleScopeKey = createProgressReviewScheduleScopeKey(
            cloudSettings = createCloudSettings(cloudState = CloudAccountState.LINKED),
            today = LocalDate.parse("2026-04-18"),
            zoneId = ZoneId.of("Europe/Madrid"),
            workspaceIds = listOf("workspace-1", "workspace-2")
        )
        val summary = CloudProgressSummary(
            currentStreakDays = 3,
            longestStreakDays = 3,
            hasReviewedToday = true,
            lastReviewedOn = "2026-04-18",
            activeReviewDays = 9,
            streakFreeze = createInitialProgressStreakFreeze(),
            reviewHistoryWatermarks = watermarks
        )
        val series = CloudProgressSeries(
            timeZone = seriesScopeKey.timeZone,
            from = seriesScopeKey.from,
            to = seriesScopeKey.to,
            dailyReviews = listOf(
                CloudDailyReviewPoint(
                    date = seriesScopeKey.to,
                    reviewCount = 2,
                    againCount = 1,
                    hardCount = 0,
                    goodCount = 1,
                    easyCount = 0
                )
            ),
            streakDays = createProgressStreakDaysForRange(
                activeReviewDateSet = setOf(seriesScopeKey.to),
                from = seriesScopeKey.from,
                to = seriesScopeKey.to,
                today = LocalDate.parse(seriesScopeKey.to)
            ),
            generatedAt = "2026-04-18T10:00:00Z",
            reviewHistoryWatermarks = watermarks,
            summary = null
        )
        val schedule = createReviewSchedule(
            timeZone = scheduleScopeKey.timeZone,
            newCount = 1,
            todayCount = 2
        ).copy(reviewHistoryWatermarks = watermarks)
        val cachedSeries = series.toCacheEntity(
            scopeKey = seriesScopeKey,
            updatedAtMillis = 1L
        ).toCloudProgressSeriesOrNull()

        assertEquals(
            watermarks,
            summary.toCacheEntity(
                scopeKey = summaryScopeKey,
                updatedAtMillis = 1L
            ).toCloudProgressSummaryOrNull()?.reviewHistoryWatermarks
        )
        assertEquals(
            watermarks,
            cachedSeries?.reviewHistoryWatermarks
        )
        assertEquals(
            1,
            cachedSeries?.dailyReviews?.single()?.againCount
        )
        assertEquals(
            series.streakDays,
            series.toCacheEntity(
                scopeKey = seriesScopeKey,
                updatedAtMillis = 1L
            ).toCloudProgressSeriesOrNull()?.streakDays
        )
        assertEquals(
            watermarks,
            schedule.toCacheEntity(
                scopeKey = scheduleScopeKey,
                updatedAtMillis = 1L
            ).toCloudProgressReviewScheduleOrNull()?.reviewHistoryWatermarks
        )
    }

    @Test
    fun progressLeaderboardCachePreservesRankingRows(): Unit {
        val leaderboard = createProgressLeaderboardForTest(
            windowKey = ProgressLeaderboardWindowKey.LAST_24_HOURS,
            rankingRows = listOf(
                createProgressLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
                    publicProfileId = "participant-1",
                    anonymousDisplayName = "Silver Bright Harbor",
                    qualifiedReviewCount = 9,
                    rank = 1
                ).copy(friendDisplayName = "Kai"),
                createProgressLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.VIEWER,
                    publicProfileId = "viewer-profile",
                    anonymousDisplayName = "Misty Quiet Grove",
                    qualifiedReviewCount = 7,
                    rank = 2
                )
            )
        )

        val restoredLeaderboard = leaderboard.toCacheEntity(
            scopeKey = ProgressLeaderboardScopeKey(scopeId = "linked:user-1"),
            updatedAtMillis = 1L
        ).toCloudProgressLeaderboardOrNull()

        val restoredRows = checkNotNull(restoredLeaderboard).windows.single().rankingRows
        assertEquals(
            listOf(
                CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
                CloudProgressLeaderboardRankingRowKind.VIEWER
            ),
            restoredRows.map { row -> row.kind }
        )
        assertEquals(listOf(1, 2), restoredRows.map { row -> row.rank })
        assertEquals(listOf("Kai", null), restoredRows.map { row -> row.friendDisplayName })
    }

    @Test
    fun progressStreakLeaderboardCachePreservesRankingRows(): Unit {
        val leaderboard = createProgressStreakLeaderboardForTest(
            rankingRows = listOf(
                createProgressStreakLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
                    publicProfileId = "participant-1",
                    anonymousDisplayName = "Silver Bright Harbor",
                    streakDays = 9,
                    rank = 1
                ).copy(friendDisplayName = "Kai"),
                createProgressStreakLeaderboardRankingRowForTest(
                    kind = CloudProgressLeaderboardRankingRowKind.VIEWER,
                    publicProfileId = "viewer-profile",
                    anonymousDisplayName = "Misty Quiet Grove",
                    streakDays = 7,
                    rank = 2
                )
            )
        )

        val restoredLeaderboard = leaderboard.toCacheEntity(
            scopeKey = ProgressStreakLeaderboardScopeKey(scopeId = "linked:user-1"),
            updatedAtMillis = 1L
        ).toCloudProgressStreakLeaderboardOrNull()

        val restoredReadyLeaderboard = checkNotNull(restoredLeaderboard)
        assertTrue(restoredReadyLeaderboard is CloudProgressStreakLeaderboard.Ready)
        val readyLeaderboard = restoredReadyLeaderboard as CloudProgressStreakLeaderboard.Ready
        val restoredRows = readyLeaderboard.rankingRows
        assertEquals(
            listOf(
                CloudProgressLeaderboardRankingRowKind.PARTICIPANT,
                CloudProgressLeaderboardRankingRowKind.VIEWER
            ),
            restoredRows.map { row -> row.kind }
        )
        assertEquals(listOf(1, 2), restoredRows.map { row -> row.rank })
        assertEquals(listOf(9, 7), restoredRows.map { row -> row.streakDays })
        assertEquals(listOf("Kai", null), restoredRows.map { row -> row.friendDisplayName })
    }
}
