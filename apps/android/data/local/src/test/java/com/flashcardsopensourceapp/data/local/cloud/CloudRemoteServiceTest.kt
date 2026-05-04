package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudRemoteServiceTest {
    @Test
    fun buildGuestUpgradeCompleteRequestDeclaresDrainedGuestOutbox() {
        val request = buildGuestUpgradeCompleteRequest(
            guestToken = "guest-token",
            selection = CloudGuestUpgradeSelection.Existing(workspaceId = "workspace-linked"),
            guestWorkspaceSyncedAndOutboxDrained = true,
            supportsDroppedEntities = true
        )

        assertEquals("guest-token", request.getString("guestToken"))
        assertEquals(true, request.getBoolean("guestWorkspaceSyncedAndOutboxDrained"))
        assertEquals(true, request.getBoolean("supportsDroppedEntities"))
        assertEquals("existing", request.getJSONObject("selection").getString("type"))
        assertEquals("workspace-linked", request.getJSONObject("selection").getString("workspaceId"))
    }

    @Test
    fun parseRemotePushResponseTreatsIgnoredAsAcknowledged() {
        val response = JSONObject(
            """
            {
              "operations": [
                {
                  "operationId": "operation-ignored",
                  "status": "ignored"
                }
              ]
            }
            """.trimIndent()
        )

        val parsedResponse = parseRemotePushResponse(response = response)

        assertEquals(1, parsedResponse.operations.size)
        assertEquals("operation-ignored", parsedResponse.operations.single().operationId)
        assertEquals(null, parsedResponse.operations.single().resultingHotChangeId)
    }

    @Test
    fun parseCloudProgressSummaryResponseReadsNestedSummaryObject() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "summary": {
                "currentStreakDays": 8,
                "hasReviewedToday": true,
                "lastReviewedOn": "2026-04-18",
                "activeReviewDays": 21
              },
              "generatedAt": "2026-04-18T12:00:00Z"
            }
            """.trimIndent()
        )

        val summary = parseCloudProgressSummaryResponse(
            response = response,
            fieldPath = "progressSummary"
        )

        assertEquals(8, summary.currentStreakDays)
        assertEquals(true, summary.hasReviewedToday)
        assertEquals("2026-04-18", summary.lastReviewedOn)
        assertEquals(21, summary.activeReviewDays)
    }

    @Test(expected = CloudContractMismatchException::class)
    fun parseCloudProgressSummaryResponseRequiresNestedSummaryObject() {
        val response = JSONObject(
            """
            {
              "timeZone": "Europe/Madrid",
              "currentStreakDays": 8,
              "hasReviewedToday": true,
              "lastReviewedOn": "2026-04-18",
              "activeReviewDays": 21,
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
    fun parseCloudProgressReviewScheduleResponseReadsStableBuckets() {
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

        assertEquals("Europe/Madrid", schedule.timeZone)
        assertEquals("2026-05-03T12:00:00Z", schedule.generatedAt)
        assertEquals(8, schedule.totalCards)
        assertEquals(ProgressReviewScheduleBucketKey.orderedEntries, schedule.buckets.map { bucket -> bucket.key })
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

    @Test
    fun parseCloudErrorPayloadReadsSyncConflictDetails() {
        val parsedError = requireNotNull(
            parseCloudErrorPayload(
                responseBody = JSONObject()
                    .put("code", syncWorkspaceForkRequiredErrorCode)
                    .put("requestId", "request-1")
                    .put(
                        "details",
                        JSONObject().put(
                            "syncConflict",
                            JSONObject()
                                .put("phase", "bootstrap")
                                .put("entityType", "card")
                                .put("entityId", "card-1")
                                .put("entryIndex", 2)
                                .put("recoverable", true)
                                .put("conflictingWorkspaceId", "workspace-source")
                                .put("remoteIsEmpty", true)
                        )
                    )
                    .toString()
            )
        ) {
            "Expected parsed cloud error payload."
        }

        assertEquals(syncWorkspaceForkRequiredErrorCode, parsedError.code)
        assertEquals("request-1", parsedError.requestId)
        assertEquals(SyncEntityType.CARD, parsedError.syncConflict?.entityType)
        assertEquals("card-1", parsedError.syncConflict?.entityId)
        assertEquals(2, parsedError.syncConflict?.entryIndex)
        assertEquals(true, parsedError.syncConflict?.recoverable)
        assertEquals("workspace-source", parsedError.syncConflict?.conflictingWorkspaceId)
        assertEquals(true, parsedError.syncConflict?.remoteIsEmpty)
    }
}
