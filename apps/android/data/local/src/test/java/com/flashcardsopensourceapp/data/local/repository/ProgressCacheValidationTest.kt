package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.database.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.ProgressSummaryCacheEntity
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class ProgressCacheValidationTest {
    @Test
    fun invalidSummaryCacheLastReviewedOnIsIgnored() {
        val cacheEntity = ProgressSummaryCacheEntity(
            scopeKey = "scope-1",
            scopeId = "local:installation-1",
            timeZone = "Europe/Madrid",
            generatedAt = "2026-04-18T10:00:00Z",
            currentStreakDays = 2,
            hasReviewedToday = true,
            lastReviewedOn = "not-a-date",
            activeReviewDays = 4,
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
            dailyReviewsJson = "{not-json}",
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
            totalCards = 1,
            bucketsJson = """[{"key":"today","count":1},{"key":"new","count":0}]""",
            updatedAtMillis = 1L
        )

        assertEquals(null, cacheEntity.toCloudProgressReviewScheduleOrNull())
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
}
