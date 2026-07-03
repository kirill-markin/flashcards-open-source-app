package com.flashcardsopensourceapp.data.local.cloud.remote.progress

import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudProgressRemoteApiTest {
    @Test
    fun parseCloudProgressSummaryResponseReadsNestedSummaryObject() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "summary": {
                "currentStreakDays": 8,
                "longestStreakDays": 10,
                "hasReviewedToday": true,
                "lastReviewedOn": "2026-04-18",
                "activeReviewDays": 21,
                "streakFreeze": {
                  "availableCredits": 2,
                  "capacity": 3,
                  "balanceUnits": 25,
                  "unitsPerCredit": 10,
                  "earnedUnitsPerStreakDay": 2,
                  "nextCreditProgressUnits": 5,
                  "nextCreditRequiredUnits": 10
                }
              },
              "reviewHistoryWatermarks": [
                { "workspaceId": "workspace-1", "reviewSequenceId": 42 }
              ],
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val summary = parseCloudProgressSummaryResponse(
            response = response,
            fieldPath = "progressSummary"
        )

        assertEquals(8, summary.currentStreakDays)
        assertEquals(10, summary.longestStreakDays)
        assertEquals(true, summary.hasReviewedToday)
        assertEquals("2026-04-18", summary.lastReviewedOn)
        assertEquals(21, summary.activeReviewDays)
        assertEquals(2, summary.streakFreeze.availableCredits)
        assertEquals(3, summary.streakFreeze.capacity)
        assertEquals(2, summary.streakFreeze.earnedUnitsPerStreakDay)
        assertEquals(5, summary.streakFreeze.nextCreditProgressUnits)
        assertEquals(42L, summary.reviewHistoryWatermarks.single().reviewSequenceId)
    }

    @Test
    fun parseCloudProgressSummaryResponseAcceptsMissingReviewHistoryWatermarks() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "summary": {
                "currentStreakDays": 8,
                "longestStreakDays": 10,
                "hasReviewedToday": true,
                "lastReviewedOn": "2026-04-18",
                "activeReviewDays": 21,
                "streakFreeze": {
                  "availableCredits": 2,
                  "capacity": 2,
                  "balanceUnits": 20,
                  "unitsPerCredit": 10,
                  "earnedUnitsPerStreakDay": 1,
                  "nextCreditProgressUnits": 0,
                  "nextCreditRequiredUnits": 10
                }
              },
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val summary = parseCloudProgressSummaryResponse(
            response = response,
            fieldPath = "progressSummary"
        )

        assertTrue(summary.reviewHistoryWatermarks.isEmpty())
    }

    @Test
    fun parseCloudProgressSummaryResponseRejectsIncoherentStreakFreezePayload() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "summary": {
                "currentStreakDays": 8,
                "longestStreakDays": 10,
                "hasReviewedToday": true,
                "lastReviewedOn": "2026-04-18",
                "activeReviewDays": 21,
                "streakFreeze": {
                  "availableCredits": 1,
                  "capacity": 3,
                  "balanceUnits": 25,
                  "unitsPerCredit": 10,
                  "earnedUnitsPerStreakDay": 2,
                  "nextCreditProgressUnits": 5,
                  "nextCreditRequiredUnits": 10
                }
              },
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val error = assertThrows(CloudContractMismatchException::class.java) {
            parseCloudProgressSummaryResponse(
                response = response,
                fieldPath = "progressSummary"
            )
        }

        assertTrue(error.message.orEmpty().contains("progressSummary.summary.streakFreeze"))
        assertTrue(error.message.orEmpty().contains("availableCredits"))
    }

    @Test(expected = CloudContractMismatchException::class)
    fun parseCloudProgressSummaryResponseRequiresNestedSummaryObject() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "currentStreakDays": 8,
              "longestStreakDays": 10,
              "hasReviewedToday": true,
              "lastReviewedOn": "2026-04-18",
              "activeReviewDays": 21,
              "reviewHistoryWatermarks": [
                { "workspaceId": "workspace-1", "reviewSequenceId": 42 }
              ],
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        parseCloudProgressSummaryResponse(
            response = response,
            fieldPath = "progressSummary"
        )
    }

    @Test
    fun parseCloudProgressSeriesResponseReadsWatermarks() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "from": "2026-04-01",
              "to": "2026-04-03",
              "dailyReviews": [
                { "date": "2026-04-01", "reviewCount": 3, "againCount": 1, "hardCount": 1, "goodCount": 1, "easyCount": 0 }
              ],
              "streakDays": [
                { "date": "2026-04-01", "state": "reviewed" },
                { "date": "2026-04-02", "state": "frozen" },
                { "date": "2026-04-03", "state": "pending" }
              ],
              "reviewHistoryWatermarks": [
                { "workspaceId": "workspace-1", "reviewSequenceId": 42 }
              ],
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val series = parseCloudProgressSeriesResponse(
            response = response,
            fieldPath = "progress"
        )

        assertEquals("Europe/Madrid", series.timeZone)
        assertEquals("2026-04-01", series.from)
        assertEquals("2026-04-03", series.to)
        assertEquals(3, series.dailyReviews.single().reviewCount)
        assertEquals(1, series.dailyReviews.single().againCount)
        assertEquals("frozen", series.streakDays[1].state.wireKey)
        assertEquals(42L, series.reviewHistoryWatermarks.single().reviewSequenceId)
    }

    @Test
    fun parseCloudProgressSeriesResponseAcceptsMissingReviewHistoryWatermarks() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "from": "2026-04-01",
              "to": "2026-04-03",
              "dailyReviews": [
                { "date": "2026-04-01", "reviewCount": 3, "againCount": 0, "hardCount": 1, "goodCount": 2, "easyCount": 0 }
              ],
              "streakDays": [
                { "date": "2026-04-01", "state": "reviewed" },
                { "date": "2026-04-02", "state": "frozen" },
                { "date": "2026-04-03", "state": "pending" }
              ],
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val series = parseCloudProgressSeriesResponse(
            response = response,
            fieldPath = "progress"
        )

        assertTrue(series.reviewHistoryWatermarks.isEmpty())
    }

    @Test
    fun parseCloudProgressReviewScheduleResponseReadsStableBuckets() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "generatedAt": "2026-05-03T12:00:00Z",
              "reviewHistoryWatermarks": [
                { "workspaceId": "workspace-1", "reviewSequenceId": 42 }
              ],
              "totalCards": 8,
              "buckets": [
                { "key": "new", "count": 1 },
                { "key": "today", "count": 1 },
                { "key": "days1To7", "count": 1 },
                { "key": "days8To30", "count": 1 },
                { "key": "days31To90", "count": 1 },
                { "key": "days91To360", "count": 1 },
                { "key": "years1To2", "count": 1 },
                { "key": "later", "count": 1 }
              ]
            }
            """.trimIndent()
        )

        val schedule = parseCloudProgressReviewScheduleResponse(
            response = response,
            fieldPath = "progress.reviewSchedule"
        )

        assertEquals("Europe/Madrid", schedule.timeZone)
        assertEquals("2026-05-03T12:00:00Z", schedule.generatedAt)
        assertEquals(42L, schedule.reviewHistoryWatermarks.single().reviewSequenceId)
        assertEquals(8, schedule.totalCards)
        assertEquals(ProgressReviewScheduleBucketKey.orderedEntries, schedule.buckets.map { bucket -> bucket.key })
    }

    @Test
    fun parseCloudProgressReviewScheduleResponseAcceptsMissingReviewHistoryWatermarks() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "generatedAt": "2026-05-03T12:00:00Z",
              "totalCards": 8,
              "buckets": [
                { "key": "new", "count": 1 },
                { "key": "today", "count": 1 },
                { "key": "days1To7", "count": 1 },
                { "key": "days8To30", "count": 1 },
                { "key": "days31To90", "count": 1 },
                { "key": "days91To360", "count": 1 },
                { "key": "years1To2", "count": 1 },
                { "key": "later", "count": 1 }
              ]
            }
            """.trimIndent()
        )

        val schedule = parseCloudProgressReviewScheduleResponse(
            response = response,
            fieldPath = "progress.reviewSchedule"
        )

        assertTrue(schedule.reviewHistoryWatermarks.isEmpty())
    }

    @Test
    fun parseCloudProgressLeaderboardReadsRankingRows() {
        val response = JSONObject(
            """
            {
              "status": "ready",
              "metric": {
                "metricVersion": "qualified_reviews_v1",
                "title": "Qualified reviews",
                "description": "Hard, Good, and Easy reviews count toward your rank. Again does not."
              },
              "defaultWindowKey": "last_24_hours",
              "windows": [
                {
                  "windowKey": "last_24_hours",
                  "snapshotId": "snapshot-1",
                  "snapshotGeneratedAt": "2026-04-18T14:00:05.000Z",
                  "asOfServerHour": "2026-04-18T14:00:00.000Z",
                  "nextRefreshAfter": "2026-04-18T15:00:00.000Z",
                  "participantCount": 2,
                  "viewer": {
                    "publicProfileId": "viewer-profile",
                    "rank": 2,
                    "qualifiedReviewCount": 7
                  },
                  "rows": [
                    {
                      "kind": "top",
                      "publicProfileId": "participant-1",
                      "anonymousDisplayName": "Silver Bright Harbor",
                      "friendDisplayName": "Kai",
                      "qualifiedReviewCount": 9,
                      "rank": 1
                    },
                    {
                      "kind": "viewer",
                      "publicProfileId": "viewer-profile",
                      "anonymousDisplayName": "Misty Quiet Grove",
                      "qualifiedReviewCount": 7,
                      "rank": 2
                    }
                  ],
                  "rankingRows": [
                    {
                      "kind": "participant",
                      "publicProfileId": "participant-1",
                      "anonymousDisplayName": "Silver Bright Harbor",
                      "friendDisplayName": "Kai",
                      "qualifiedReviewCount": 9,
                      "rank": 1
                    },
                    {
                      "kind": "viewer",
                      "publicProfileId": "viewer-profile",
                      "anonymousDisplayName": "Misty Quiet Grove",
                      "qualifiedReviewCount": 7,
                      "rank": 2
                    }
                  ]
                }
              ]
            }
            """.trimIndent()
        )

        val leaderboard = parseCloudProgressLeaderboard(
            payload = response,
            fieldPath = "progress.leaderboard"
        )

        val window = leaderboard.windows.single()
        assertEquals(ProgressLeaderboardWindowKey.LAST_24_HOURS, window.windowKey)
        assertEquals(2, window.rankingRows.size)
        assertEquals(CloudProgressLeaderboardRankingRowKind.VIEWER, window.rankingRows[1].kind)
        assertEquals("viewer-profile", window.rankingRows[1].publicProfileId)
        assertEquals("Kai", window.rankingRows[0].friendDisplayName)
        val participantRow = window.rows[0] as CloudProgressLeaderboardRow.Participant
        assertEquals("Kai", participantRow.friendDisplayName)
    }

    @Test
    fun parseCloudProgressStreakLeaderboardReadsRankingRows() {
        val response = JSONObject(
            """
            {
              "status": "ready",
              "metric": {
                "metricVersion": "streak_days_v1",
                "title": "Current streak days",
                "description": "Ranks use current streak days from the public daily snapshot. A streak day is any local day with at least one card review rated Again, Hard, Good, or Easy. Public values can trail your live personal streak."
              },
              "snapshotId": "3e6c0b88-5f5a-4db3-8c8c-9d6a3840a1e4",
              "snapshotGeneratedAt": "2026-06-10T12:00:05.000Z",
              "asOfUtcDate": "2026-06-10",
              "nextRefreshAfter": "2026-06-11T12:00:00.000Z",
              "participantCount": 2,
              "viewer": {
                "publicProfileId": "viewer-profile",
                "displayName": "You",
                "rank": 2,
                "streakDays": 3
              },
              "rows": [
                {
                  "kind": "top",
                  "publicProfileId": "participant-1",
                  "anonymousDisplayName": "Silver Bright Harbor",
                  "friendDisplayName": "Kai",
                  "streakDays": 5,
                  "rank": 1
                },
                {
                  "kind": "viewer",
                  "publicProfileId": "viewer-profile",
                  "anonymousDisplayName": "Jade Swift River",
                  "streakDays": 3,
                  "rank": 2
                }
              ],
              "rankingRows": [
                {
                  "kind": "participant",
                  "publicProfileId": "participant-1",
                  "anonymousDisplayName": "Silver Bright Harbor",
                  "friendDisplayName": "Kai",
                  "streakDays": 5,
                  "rank": 1
                },
                {
                  "kind": "viewer",
                  "publicProfileId": "viewer-profile",
                  "anonymousDisplayName": "Jade Swift River",
                  "streakDays": 3,
                  "rank": 2
                }
              ]
            }
            """.trimIndent()
        )

        val leaderboard = parseCloudProgressStreakLeaderboard(
            payload = response,
            fieldPath = "progress.streakLeaderboard"
        )

        assertTrue(leaderboard is CloudProgressStreakLeaderboard.Ready)
        val readyLeaderboard = leaderboard as CloudProgressStreakLeaderboard.Ready
        assertEquals("2026-06-10", readyLeaderboard.asOfUtcDate)
        assertEquals(2, readyLeaderboard.rankingRows.size)
        assertEquals(CloudProgressLeaderboardRankingRowKind.VIEWER, readyLeaderboard.rankingRows[1].kind)
        assertEquals("viewer-profile", readyLeaderboard.rankingRows[1].publicProfileId)
        assertEquals("Kai", readyLeaderboard.rankingRows[0].friendDisplayName)
        val participantRow = readyLeaderboard.rows[0] as CloudProgressStreakLeaderboardRow.Participant
        assertEquals("Kai", participantRow.friendDisplayName)
        assertEquals(5, participantRow.streakDays)
    }

    @Test
    fun parseCloudProgressStreakLeaderboardRejectsIncreasingRankingStreakDays() {
        val response = JSONObject(
            """
            {
              "status": "ready",
              "metric": {
                "metricVersion": "streak_days_v1",
                "title": "Current streak days",
                "description": "Ranks use current streak days from the public daily snapshot. A streak day is any local day with at least one card review rated Again, Hard, Good, or Easy. Public values can trail your live personal streak."
              },
              "snapshotId": "3e6c0b88-5f5a-4db3-8c8c-9d6a3840a1e4",
              "snapshotGeneratedAt": "2026-06-10T12:00:05.000Z",
              "asOfUtcDate": "2026-06-10",
              "nextRefreshAfter": "2026-06-11T12:00:00.000Z",
              "participantCount": 2,
              "viewer": {
                "publicProfileId": "viewer-profile",
                "displayName": "You",
                "rank": 2,
                "streakDays": 5
              },
              "rows": [],
              "rankingRows": [
                {
                  "kind": "participant",
                  "publicProfileId": "participant-1",
                  "anonymousDisplayName": "Silver Bright Harbor",
                  "streakDays": 3,
                  "rank": 1
                },
                {
                  "kind": "viewer",
                  "publicProfileId": "viewer-profile",
                  "anonymousDisplayName": "Jade Swift River",
                  "streakDays": 5,
                  "rank": 2
                }
              ]
            }
            """.trimIndent()
        )

        assertThrows(CloudContractMismatchException::class.java) {
            parseCloudProgressStreakLeaderboard(
                payload = response,
                fieldPath = "progress.streakLeaderboard"
            )
        }
    }

    @Test
    fun parseCloudProgressSummaryResponseRejectsNegativeReviewHistoryWatermarkSequenceId() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "summary": {
                "currentStreakDays": 8,
                "longestStreakDays": 10,
                "hasReviewedToday": true,
                "lastReviewedOn": "2026-04-18",
                "activeReviewDays": 21,
                "streakFreeze": {
                  "availableCredits": 2,
                  "capacity": 2,
                  "balanceUnits": 20,
                  "unitsPerCredit": 10,
                  "earnedUnitsPerStreakDay": 1,
                  "nextCreditProgressUnits": 0,
                  "nextCreditRequiredUnits": 10
                }
              },
              "reviewHistoryWatermarks": [
                { "workspaceId": "workspace-1", "reviewSequenceId": -1 }
              ],
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val error = assertThrows(CloudContractMismatchException::class.java) {
            parseCloudProgressSummaryResponse(
                response = response,
                fieldPath = "progressSummary"
            )
        }

        assertTrue(error.message.orEmpty().contains("progressSummary.reviewHistoryWatermarks[0].reviewSequenceId"))
    }

    @Test
    fun parseCloudProgressSummaryResponseRejectsMalformedReviewHistoryWatermarkItem() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "summary": {
                "currentStreakDays": 8,
                "longestStreakDays": 10,
                "hasReviewedToday": true,
                "lastReviewedOn": "2026-04-18",
                "activeReviewDays": 21,
                "streakFreeze": {
                  "availableCredits": 2,
                  "capacity": 2,
                  "balanceUnits": 20,
                  "unitsPerCredit": 10,
                  "earnedUnitsPerStreakDay": 1,
                  "nextCreditProgressUnits": 0,
                  "nextCreditRequiredUnits": 10
                }
              },
              "reviewHistoryWatermarks": [
                "not-an-object"
              ],
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val error = assertThrows(CloudContractMismatchException::class.java) {
            parseCloudProgressSummaryResponse(
                response = response,
                fieldPath = "progressSummary"
            )
        }

        assertTrue(error.message.orEmpty().contains("progressSummary.reviewHistoryWatermarks[0]"))
    }

    @Test(expected = CloudContractMismatchException::class)
    fun parseCloudProgressReviewScheduleResponseRequiresStableBucketOrder() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "generatedAt": "2026-05-03T12:00:00Z",
              "totalCards": 2,
              "buckets": [
                { "key": "today", "count": 1 },
                { "key": "new", "count": 1 }
              ]
            }
            """.trimIndent()
        )

        parseCloudProgressReviewScheduleResponse(
            response = response,
            fieldPath = "progress.reviewSchedule"
        )
    }

    @Test
    fun parseCloudProgressReviewScheduleResponseRejectsNegativeBucketCount() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "generatedAt": "2026-05-03T12:00:00Z",
              "totalCards": 0,
              "buckets": [
                { "key": "new", "count": -1 },
                { "key": "today", "count": 1 },
                { "key": "days1To7", "count": 0 },
                { "key": "days8To30", "count": 0 },
                { "key": "days31To90", "count": 0 },
                { "key": "days91To360", "count": 0 },
                { "key": "years1To2", "count": 0 },
                { "key": "later", "count": 0 }
              ]
            }
            """.trimIndent()
        )

        val error = assertThrows(CloudContractMismatchException::class.java) {
            parseCloudProgressReviewScheduleResponse(
                response = response,
                fieldPath = "progress.reviewSchedule"
            )
        }

        assertTrue(error.message.orEmpty().contains("progress.reviewSchedule.buckets[0].count"))
    }

    @Test
    fun parseCloudProgressReviewScheduleResponseRejectsNegativeTotalCards() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "generatedAt": "2026-05-03T12:00:00Z",
              "totalCards": -1,
              "buckets": [
                { "key": "new", "count": 0 },
                { "key": "today", "count": 0 },
                { "key": "days1To7", "count": 0 },
                { "key": "days8To30", "count": 0 },
                { "key": "days31To90", "count": 0 },
                { "key": "days91To360", "count": 0 },
                { "key": "years1To2", "count": 0 },
                { "key": "later", "count": 0 }
              ]
            }
            """.trimIndent()
        )

        val error = assertThrows(CloudContractMismatchException::class.java) {
            parseCloudProgressReviewScheduleResponse(
                response = response,
                fieldPath = "progress.reviewSchedule"
            )
        }

        assertTrue(error.message.orEmpty().contains("progress.reviewSchedule.totalCards"))
    }
}
