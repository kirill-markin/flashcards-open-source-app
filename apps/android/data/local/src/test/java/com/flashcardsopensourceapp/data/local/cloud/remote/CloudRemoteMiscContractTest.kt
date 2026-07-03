package com.flashcardsopensourceapp.data.local.cloud.remote

import com.flashcardsopensourceapp.data.local.cloud.identity.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.cloud.remote.community.buildCloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.cloud.remote.community.parseCloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.guest.buildGuestUpgradeCompleteRequest
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.parseRemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.parseCloudErrorPayload
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

class CloudRemoteMiscContractTest {
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
    fun buildCloudFriendInvitationCreateRequestUsesInviteeDisplayName() {
        val request = buildCloudFriendInvitationCreateRequest(
            request = CloudFriendInvitationCreateRequest(
                inviteeDisplayName = "Priya \uD83C\uDFAF"
            )
        )

        assertEquals("Priya \uD83C\uDFAF", request.getString("inviteeDisplayName"))
        assertEquals(1, request.length())
    }

    @Test
    fun parseCloudFriendInvitationCreateResponseReadsShareUrlAndExpiry() {
        val response = JSONObject(
            """
            {
              "inviteUrl": "https://app.flashcards-open-source-app.com/invite/raw-token",
              "expiresAt": "2026-06-17T10:00:00.000Z"
            }
            """.trimIndent()
        )

        val invitation = parseCloudFriendInvitationCreateResponse(
            response = response,
            fieldPath = "friendInvitation"
        )

        assertEquals("https://app.flashcards-open-source-app.com/invite/raw-token", invitation.inviteUrl)
        assertEquals("2026-06-17T10:00:00.000Z", invitation.expiresAt)
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
