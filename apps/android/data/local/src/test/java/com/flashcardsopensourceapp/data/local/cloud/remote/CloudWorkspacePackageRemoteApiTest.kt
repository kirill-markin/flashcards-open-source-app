package com.flashcardsopensourceapp.data.local.cloud.remote

import com.flashcardsopensourceapp.data.local.cloud.remote.transport.CloudBinaryHttpResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.buildWorkspacePackageExportRequestBody
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.parseWorkspacePackageExportDownloadResponse
import com.flashcardsopensourceapp.data.local.cloud.remote.workspace.parseWorkspacePackageExportPreviewResponse
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
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

class CloudWorkspacePackageRemoteApiTest {
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
}
