package com.flashcardsopensourceapp.data.local.repository.media

import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadPart
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadCompletion
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class MediaUploadCompletionRetryTest {
    @Test
    fun retriesDeadlineAndInProgressWithSameSessionAndOrderedParts() = runTest {
        val sessionId = "55555555-5555-4555-8555-555555555555"
        val request = CompleteMediaAssetUploadSessionRequest(
            parts = listOf(
                CompleteMediaAssetUploadPart(
                    partNumber = 1,
                    eTag = "\"etag-1\"",
                    sha256 = firstSha256
                ),
                CompleteMediaAssetUploadPart(
                    partNumber = 2,
                    eTag = "\"etag-2\"",
                    sha256 = secondSha256
                )
            )
        )
        val completion = MediaAssetUploadCompletion(
            mediaAsset = makeMediaAsset(),
            applied = false
        )
        val attemptSessionIds = mutableListOf<String>()
        val attemptRequests = mutableListOf<CompleteMediaAssetUploadSessionRequest>()
        val retryDelays = mutableListOf<Long>()

        val result = retryMediaUploadSessionCompletion(
            complete = {
                attemptSessionIds += sessionId
                attemptRequests += request
                when (attemptSessionIds.size) {
                    1 -> throw makeCompletionError(
                        code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
                        retryAfterDelayMillis = null
                    )
                    2 -> throw makeCompletionError(
                        code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                        retryAfterDelayMillis = 1_000L
                    )
                    else -> completion
                }
            },
            wait = { delayMillis ->
                retryDelays += delayMillis
            }
        )

        assertEquals(completion, result.completion)
        assertEquals(
            "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
            result.retryableCompletionCause?.errorCode
        )
        assertEquals(listOf(sessionId, sessionId, sessionId), attemptSessionIds)
        assertEquals(listOf(request, request, request), attemptRequests)
        assertTrue(retryDelays[0] in 0L until 250L)
        assertEquals(1_000L, retryDelays[1])
    }

    @Test
    fun cancellationDuringCompletionBackoffStopsBeforeReplay() = runTest {
        var completionAttemptCount = 0

        try {
            retryMediaUploadSessionCompletion(
                complete = {
                    completionAttemptCount += 1
                    throw makeCompletionError(
                        code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                        retryAfterDelayMillis = 60_000L
                    )
                },
                wait = {
                    throw CancellationException("Upload worker cancelled")
                }
            )
            fail("Expected cancellation")
        } catch (error: MediaUploadCompletionTerminalException) {
            assertEquals(1, completionAttemptCount)
            assertEquals(MediaUploadCompletionTerminalReason.INTERRUPTED, error.reason)
            assertTrue(error.interruptionCause is CancellationException)
            assertFalse(shouldAbortMediaUploadSessionAfterFailure(error = error))
        }
    }

    @Test
    fun retryExhaustionDoesNotAuthorizeAbort() = runTest {
        var completionAttemptCount = 0
        var retryDelayCount = 0

        try {
            retryMediaUploadSessionCompletion(
                complete = {
                    completionAttemptCount += 1
                    throw makeCompletionError(
                        code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                        retryAfterDelayMillis = 0L
                    )
                },
                wait = {
                    retryDelayCount += 1
                }
            )
            fail("Expected retry exhaustion")
        } catch (error: MediaUploadCompletionTerminalException) {
            assertEquals(MediaUploadCompletionTerminalReason.RETRY_EXHAUSTED, error.reason)
            assertEquals("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS", error.completionCause.errorCode)
            assertEquals(4, completionAttemptCount)
            assertEquals(3, retryDelayCount)
            assertFalse(shouldAbortMediaUploadSessionAfterFailure(error = error))
        }
    }

    @Test
    fun terminalCompletionFailureIsNotRetriedAndKeepsAbortCleanup() = runTest {
        var completionAttemptCount = 0
        var retryDelayCount = 0

        try {
            retryMediaUploadSessionCompletion(
                complete = {
                    completionAttemptCount += 1
                    throw makeCompletionError(
                        code = "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH",
                        retryAfterDelayMillis = null
                    )
                },
                wait = {
                    retryDelayCount += 1
                }
            )
            fail("Expected terminal completion failure")
        } catch (error: CloudRemoteException) {
            assertEquals("MEDIA_ASSET_UPLOAD_PROOF_MISMATCH", error.errorCode)
            assertEquals(1, completionAttemptCount)
            assertEquals(0, retryDelayCount)
            assertTrue(shouldAbortMediaUploadSessionAfterFailure(error = error))
        }
    }

    private fun makeCompletionError(
        code: String,
        retryAfterDelayMillis: Long?
    ): CloudRemoteException {
        return CloudRemoteException(
            message = "Completion is still being applied",
            statusCode = 503,
            responseBody = """{"code":"$code"}""",
            errorCode = code,
            requestId = "completion-request-1",
            syncConflict = null,
            retryAfterDelayMillis = retryAfterDelayMillis,
            androidObservationAlreadyCaptured = false
        )
    }

    private fun makeMediaAsset(): MediaAsset {
        return MediaAsset(
            mediaAssetId = "22222222-2222-4222-8222-222222222222",
            workspaceId = "11111111-1111-4111-8111-111111111111",
            mimeType = "text/plain",
            sizeBytes = 11L,
            sha256 = firstSha256,
            sourceUrl = null,
            createdAtMillis = 1L,
            clientUpdatedAtMillis = 1L,
            lastModifiedByReplicaId = "33333333-3333-4333-8333-333333333333",
            lastOperationId = "media-upload-transfer-1",
            updatedAtMillis = 2L,
            deletedAtMillis = null
        )
    }

    private companion object {
        const val firstSha256: String = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        const val secondSha256: String = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    }
}
