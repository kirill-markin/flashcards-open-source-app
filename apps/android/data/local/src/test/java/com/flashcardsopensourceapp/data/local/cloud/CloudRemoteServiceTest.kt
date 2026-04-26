package com.flashcardsopensourceapp.data.local.cloud

import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.SyncEntityType
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class CloudRemoteServiceTest {
    @Test
    fun buildGuestUpgradeCompleteRequestDeclaresDrainedGuestOutbox() {
        val request = CloudRemoteService().buildGuestUpgradeCompleteRequest(
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

        val parsedResponse = CloudRemoteService().parseRemotePushResponse(response = response)

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

        val summary = CloudRemoteService().parseCloudProgressSummaryResponse(
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

        CloudRemoteService().parseCloudProgressSummaryResponse(
            response = response,
            fieldPath = "progressSummary"
        )
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
