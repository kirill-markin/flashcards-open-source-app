package com.flashcardsopensourceapp.data.local.cloud.remote

import com.flashcardsopensourceapp.data.local.cloud.identity.syncWorkspaceForkRequiredErrorCode
import com.flashcardsopensourceapp.data.local.cloud.remote.community.buildCloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.cloud.remote.community.parseCloudFriendInvitationCreateResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.guest.buildGuestUpgradeCompleteRequest
import com.flashcardsopensourceapp.data.local.cloud.remote.media.buildCompleteMediaAssetUploadSessionRequestBody
import com.flashcardsopensourceapp.data.local.cloud.remote.media.buildMediaAssetUploadPartUrlsRequestBody
import com.flashcardsopensourceapp.data.local.cloud.remote.media.buildMediaAssetUploadSessionCreateRequestBody
import com.flashcardsopensourceapp.data.local.cloud.remote.media.parseCompleteMediaAssetUploadSessionResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.media.parseMediaAssetDownloadUrlResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.media.parseMediaAssetUploadPartUrlsResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.media.parseMediaAssetUploadSessionAbortResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.media.parseMediaAssetUploadSessionCreateResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.progress.parseCloudProgressLeaderboard
import com.flashcardsopensourceapp.data.local.cloud.remote.progress.parseCloudProgressReviewScheduleResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.progress.parseCloudProgressSeriesResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.progress.parseCloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.cloud.remote.progress.parseCloudProgressSummaryResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.parseRemotePushResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudBinaryHttpResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.parseCloudErrorPayload
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.buildWorkspacePackageExportRequestBody
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.parseWorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.parseWorkspacePackageExportPreviewResponse
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudFriendInvitationCreateRequest
import com.flashcardsopensourceapp.data.local.model.cloud.CloudGuestUpgradeSelection
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadPart
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateStatus
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressLeaderboardRankingRowKind
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboard
import com.flashcardsopensourceapp.data.local.model.progress.CloudProgressStreakLeaderboardRow
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.data.local.model.progress.ProgressReviewScheduleBucketKey
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportMetadataInput
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportRequest
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportSelection
import com.flashcardsopensourceapp.data.local.model.workspace.WorkspacePackageExportTagPolicyInput
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

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
    fun buildWorkspacePackageExportRequestBodyEncodesTagFiltersAndMetadata() {
        val request = WorkspacePackageExportRequest(
            selection = WorkspacePackageExportSelection.TagFilters(
                includeTags = listOf("spanish", "verbs"),
                excludeTags = listOf("archived")
            ),
            tagPolicy = WorkspacePackageExportTagPolicyInput(
                additionalRemovedTags = listOf("remove-me")
            ),
            packageMetadata = WorkspacePackageExportMetadataInput(
                label = "Spanish verbs",
                author = null,
                comment = "Practice deck",
                createdAt = "2026-06-30T10:00:00.000Z",
                sourceUrl = null
            )
        )

        val body = buildWorkspacePackageExportRequestBody(request = request)

        val selection = body.getJSONObject("selection")
        assertEquals("tagFilters", selection.getString("kind"))
        assertEquals("spanish", selection.getJSONArray("includeTags").getString(0))
        assertEquals("verbs", selection.getJSONArray("includeTags").getString(1))
        assertEquals("archived", selection.getJSONArray("excludeTags").getString(0))
        assertEquals("remove-me", body.getJSONObject("tagPolicy").getJSONArray("additionalRemovedTags").getString(0))
        val metadata = body.getJSONObject("packageMetadata")
        assertEquals("Spanish verbs", metadata.getString("label"))
        assertTrue(metadata.isNull("author"))
        assertEquals("Practice deck", metadata.getString("comment"))
        assertEquals("2026-06-30T10:00:00.000Z", metadata.getString("createdAt"))
        assertTrue(metadata.isNull("sourceUrl"))
    }

    @Test
    fun parseWorkspacePackageExportPreviewResponseReadsCountsAndMetadata() {
        val response = JSONObject(
            """
            {
              "selectedCardCount": 2,
              "availableTagCounts": [
                { "tag": "import:2026-06-30", "cardsCount": 2 },
                { "tag": "spanish", "cardsCount": 1 }
              ],
              "tagsSelectedForRemoval": [
                { "tag": "import:2026-06-30", "cardsCount": 2 }
              ],
              "referencedMediaCount": 3,
              "approximateReferencedMediaBytes": 1234567890123,
              "defaultPackageMetadata": {
                "label": "Workspace export",
                "author": "Kirill",
                "createdAt": "2026-06-30T10:00:00.000Z",
                "sourceUrl": "https://flashcards-open-source-app.com"
              }
            }
            """.trimIndent()
        )

        val preview = parseWorkspacePackageExportPreviewResponse(
            response = response,
            fieldPath = "workspacePackageExportPreview"
        )

        assertEquals(2, preview.selectedCardCount)
        assertEquals("import:2026-06-30", preview.availableTagCounts[0].tag)
        assertEquals(2, preview.availableTagCounts[0].cardsCount)
        assertEquals("spanish", preview.availableTagCounts[1].tag)
        assertEquals("import:2026-06-30", preview.tagsSelectedForRemoval.single().tag)
        assertEquals(3, preview.referencedMediaCount)
        assertEquals(1234567890123L, preview.approximateReferencedMediaBytes)
        assertEquals("Workspace export", preview.defaultPackageMetadata.label)
        assertEquals("Kirill", preview.defaultPackageMetadata.author)
        assertEquals(null, preview.defaultPackageMetadata.comment)
        assertEquals("2026-06-30T10:00:00.000Z", preview.defaultPackageMetadata.createdAt)
        assertEquals("https://flashcards-open-source-app.com", preview.defaultPackageMetadata.sourceUrl)
    }

    @Test
    fun parseWorkspacePackageExportPreviewResponseRejectsNegativeCounts() {
        val response = JSONObject(
            """
            {
              "selectedCardCount": -1,
              "availableTagCounts": [],
              "tagsSelectedForRemoval": [],
              "referencedMediaCount": 0,
              "approximateReferencedMediaBytes": 0,
              "defaultPackageMetadata": {
                "label": "Workspace export",
                "createdAt": "2026-06-30T10:00:00.000Z"
              }
            }
            """.trimIndent()
        )

        assertThrows(CloudContractMismatchException::class.java) {
            parseWorkspacePackageExportPreviewResponse(
                response = response,
                fieldPath = "workspacePackageExportPreview"
            )
        }
    }

    @Test
    fun parseWorkspacePackageExportDownloadResponseReadsZipBytesAndFilename() {
        val bytes = byteArrayOf(0x50.toByte(), 0x4b.toByte(), 0x03.toByte(), 0x04.toByte())
        val response = CloudBinaryHttpResponse(
            bodyBytes = bytes,
            contentType = "application/zip",
            contentDisposition = "attachment; filename=\"flashcards.zip\""
        )

        val export = parseWorkspacePackageExportDownloadResponse(
            response = response,
            fieldPath = "workspacePackageExport"
        )

        assertArrayEquals(bytes, export.packageBytes)
        assertEquals("flashcards.zip", export.fileName)
        assertEquals("application/zip", export.contentType)
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
    fun parseMediaAssetDownloadUrlResponseReadsSignedGetUrl() {
        val response = JSONObject(
            """
            {
              "mediaAsset": {
                "mediaAssetId": "media-asset-1",
                "workspaceId": "workspace-1",
                "mimeType": "image/png",
                "sizeBytes": 128,
                "sha256": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
                "sourceUrl": null,
                "createdAt": "2026-03-10T09:00:00.000Z",
                "clientUpdatedAt": "2026-03-10T09:01:00.000Z",
                "lastModifiedByReplicaId": "device-1",
                "lastOperationId": "operation-1",
                "updatedAt": "2026-03-10T09:02:00.000Z",
                "deletedAt": null
              },
              "download": {
                "method": "GET",
                "url": "https://media.example.test/media-asset-1",
                "expiresAt": "2026-03-10T10:00:00.000Z",
                "rangeRequests": true
              }
            }
            """.trimIndent()
        )

        val parsedResponse = parseMediaAssetDownloadUrlResponse(
            response = response,
            fieldPath = "mediaAssetDownloadUrl"
        )

        assertEquals("media-asset-1", parsedResponse.mediaAsset.mediaAssetId)
        assertEquals("workspace-1", parsedResponse.mediaAsset.workspaceId)
        assertEquals("image/png", parsedResponse.mediaAsset.mimeType)
        assertEquals("https://media.example.test/media-asset-1", parsedResponse.url)
        assertEquals(Instant.parse("2026-03-10T10:00:00.000Z").toEpochMilli(), parsedResponse.expiresAtMillis)
    }

    @Test
    fun buildMediaAssetUploadSessionCreateRequestBodyEncodesUploadMetadata() {
        val request = MediaAssetUploadSessionCreateRequest(
            mediaAssetId = "media-asset-1",
            mimeType = "image/png",
            sizeBytes = 128,
            sha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
            partSizeBytes = 128,
            partCount = 1,
            sourceUrl = null,
            createdAtMillis = Instant.parse("2026-03-10T09:00:00.000Z").toEpochMilli(),
            clientUpdatedAtMillis = Instant.parse("2026-03-10T09:01:00.000Z").toEpochMilli(),
            lastModifiedByReplicaId = "device-1",
            lastOperationId = "operation-1"
        )

        val body = buildMediaAssetUploadSessionCreateRequestBody(request = request)

        assertEquals("media-asset-1", body.getString("mediaAssetId"))
        assertEquals("image/png", body.getString("mimeType"))
        assertEquals(128L, body.getLong("sizeBytes"))
        assertTrue(body.isNull("sourceUrl"))
        assertEquals("2026-03-10T09:00:00.000Z", body.getString("createdAt"))
        assertEquals("2026-03-10T09:01:00.000Z", body.getString("clientUpdatedAt"))
    }

    @Test
    fun buildMediaAssetUploadSessionPartRequestsEncodeParts() {
        val sha256 = "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8"
        val partUrlsBody = buildMediaAssetUploadPartUrlsRequestBody(
            request = MediaAssetUploadPartUrlsRequest(
                parts = listOf(MediaAssetUploadPartRequest(partNumber = 1, sha256 = sha256))
            )
        )
        val completeBody = buildCompleteMediaAssetUploadSessionRequestBody(
            request = CompleteMediaAssetUploadSessionRequest(
                parts = listOf(
                    CompleteMediaAssetUploadPart(
                        partNumber = 1,
                        eTag = "\"etag-1\"",
                        sha256 = sha256
                    )
                )
            )
        )

        assertEquals(1, partUrlsBody.getJSONArray("parts").getJSONObject(0).getInt("partNumber"))
        assertEquals(sha256, partUrlsBody.getJSONArray("parts").getJSONObject(0).getString("sha256"))
        assertEquals("\"etag-1\"", completeBody.getJSONArray("parts").getJSONObject(0).getString("eTag"))
    }

    @Test
    fun parseMediaAssetUploadSessionCreateResponseReadsUploadRequiredSession() {
        val response = JSONObject(
            """
            {
              "workspaceId": "workspace-1",
              "mediaAssetId": "media-asset-1",
              "status": "upload_required",
              "mediaAsset": null,
              "uploadSession": {
                "sessionId": "session-1",
                "expiresAt": "2026-03-10T10:00:00.000Z",
                "partSizeBytes": 8388608,
                "partCount": 2
              }
            }
            """.trimIndent()
        )

        val parsedResponse = parseMediaAssetUploadSessionCreateResponse(
            response = response,
            fieldPath = "mediaAssetUploadSessionCreate"
        )

        assertEquals(MediaAssetUploadSessionCreateStatus.UPLOAD_REQUIRED, parsedResponse.status)
        assertEquals(null, parsedResponse.mediaAsset)
        assertEquals("session-1", parsedResponse.uploadSession?.sessionId)
        assertEquals(2, parsedResponse.uploadSession?.partCount)
    }

    @Test
    fun parseMediaAssetUploadSessionCreateResponseRejectsInconsistentStatusPayload() {
        val response = JSONObject(
            """
            {
              "workspaceId": "workspace-1",
              "mediaAssetId": "media-asset-1",
              "status": "upload_required",
              "mediaAsset": {
                "mediaAssetId": "media-asset-1",
                "workspaceId": "workspace-1",
                "mimeType": "image/png",
                "sizeBytes": 128,
                "sha256": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
                "sourceUrl": null,
                "createdAt": "2026-03-10T09:00:00.000Z",
                "clientUpdatedAt": "2026-03-10T09:01:00.000Z",
                "lastModifiedByReplicaId": "device-1",
                "lastOperationId": "operation-1",
                "updatedAt": "2026-03-10T09:02:00.000Z",
                "deletedAt": null
              },
              "uploadSession": null
            }
            """.trimIndent()
        )

        assertThrows(CloudContractMismatchException::class.java) {
            parseMediaAssetUploadSessionCreateResponse(
                response = response,
                fieldPath = "mediaAssetUploadSessionCreate"
            )
        }
    }

    @Test
    fun parseMediaAssetUploadPartUrlsResponseReadsPutUrlsAndHeaders() {
        val response = JSONObject(
            """
            {
              "sessionId": "session-1",
              "partUrls": [
                {
                  "partNumber": 1,
                  "method": "PUT",
                  "url": "https://media.example.test/session-1/part-1",
                  "expiresAt": "2026-03-10T10:00:00.000Z",
                  "headers": {
                    "x-amz-checksum-sha256": "checksum-1"
                  }
                }
              ]
            }
            """.trimIndent()
        )

        val parsedResponse = parseMediaAssetUploadPartUrlsResponse(
            response = response,
            fieldPath = "mediaAssetUploadPartUrls"
        )

        assertEquals("session-1", parsedResponse.sessionId)
        assertEquals(1, parsedResponse.partUrls.single().partNumber)
        assertEquals("PUT", parsedResponse.partUrls.single().method)
        assertEquals("checksum-1", parsedResponse.partUrls.single().headers["x-amz-checksum-sha256"])
    }

    @Test
    fun parseMediaAssetUploadPartUrlsResponseRejectsNonPutMethods() {
        val response = JSONObject(
            """
            {
              "sessionId": "session-1",
              "partUrls": [
                {
                  "partNumber": 1,
                  "method": "POST",
                  "url": "https://media.example.test/session-1/part-1",
                  "expiresAt": "2026-03-10T10:00:00.000Z",
                  "headers": {}
                }
              ]
            }
            """.trimIndent()
        )

        assertThrows(CloudContractMismatchException::class.java) {
            parseMediaAssetUploadPartUrlsResponse(
                response = response,
                fieldPath = "mediaAssetUploadPartUrls"
            )
        }
    }

    @Test
    fun parseCompleteAndAbortMediaAssetUploadSessionResponses() {
        val completionResponse = JSONObject(
            """
            {
              "mediaAsset": {
                "mediaAssetId": "media-asset-1",
                "workspaceId": "workspace-1",
                "mimeType": "image/png",
                "sizeBytes": 128,
                "sha256": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
                "sourceUrl": null,
                "createdAt": "2026-03-10T09:00:00.000Z",
                "clientUpdatedAt": "2026-03-10T09:01:00.000Z",
                "lastModifiedByReplicaId": "device-1",
                "lastOperationId": "operation-1",
                "updatedAt": "2026-03-10T09:02:00.000Z",
                "deletedAt": null
              },
              "applied": true
            }
            """.trimIndent()
        )
        val abortResponse = JSONObject(
            """
            {
              "sessionId": "session-1",
              "abortedAt": "2026-03-10T10:00:00.000Z"
            }
            """.trimIndent()
        )

        val completion = parseCompleteMediaAssetUploadSessionResponse(
            response = completionResponse,
            fieldPath = "completeMediaAssetUploadSession"
        )
        val abort = parseMediaAssetUploadSessionAbortResponse(
            response = abortResponse,
            fieldPath = "mediaAssetUploadSessionAbort"
        )

        assertEquals("media-asset-1", completion.mediaAsset.mediaAssetId)
        assertEquals(true, completion.applied)
        assertEquals("session-1", abort.sessionId)
        assertEquals(Instant.parse("2026-03-10T10:00:00.000Z").toEpochMilli(), abort.abortedAtMillis)
    }

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
