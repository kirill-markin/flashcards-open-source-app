package com.flashcardsopensourceapp.data.local.cloud.remote.media

import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadPart
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateStatus
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class CloudMediaAssetRemoteApiTest {
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
}
