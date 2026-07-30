package com.flashcardsopensourceapp.data.local.repository.media

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadCompletion
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrl
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSession
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionAbort
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateStatus
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.model.sync.AccountPreferences
import com.flashcardsopensourceapp.data.local.model.sync.CloudAccountSnapshot
import com.flashcardsopensourceapp.data.local.network.SignedPutUploadResult
import com.flashcardsopensourceapp.data.local.network.SignedPutUploader
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.CloudIdentityTestEnvironment
import com.flashcardsopensourceapp.data.local.repository.cloudsync.support.FakeCloudRemoteGateway
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import java.io.File
import java.security.MessageDigest
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalMediaUploadTransferRepositoryCompletionRetryTest {
    private lateinit var environment: CloudIdentityTestEnvironment
    private lateinit var mediaFileRootDirectory: File

    @Before
    fun setUp() = runBlocking {
        environment = CloudIdentityTestEnvironment.create()
        mediaFileRootDirectory = File(
            environment.context.filesDir,
            "media-upload-completion-retry-${System.nanoTime()}"
        )
    }

    @After
    fun tearDown() {
        if (mediaFileRootDirectory.exists() && mediaFileRootDirectory.deleteRecursively().not()) {
            throw IllegalStateException(
                "Cannot delete media upload completion retry test directory '${mediaFileRootDirectory.absolutePath}'."
            )
        }
        environment.close()
    }

    @Test
    fun repositoryRetriesOnlyCompletionAndAcceptsSameSessionReplay() = runBlocking {
        val context = createRepositoryContext(
            completionOutcomes = listOf(
                CompletionOutcome.Retryable(
                    code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
                    retryAfterDelayMillis = 0L
                ),
                CompletionOutcome.Retryable(
                    code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterDelayMillis = 0L
                ),
                CompletionOutcome.Success(
                    applied = false,
                    cancelBeforeReturn = false
                )
            )
        )

        context.repository.runDueUploads()

        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(listOf(sessionId, sessionId, sessionId), context.remoteGateway.completionSessionIds)
        assertEquals(3, context.remoteGateway.completionRequests.size)
        assertTrue(context.remoteGateway.completionRequests.all { request ->
            request == context.remoteGateway.completionRequests.first()
        })
        assertEquals(0, context.remoteGateway.abortSessionIds.size)
        assertEquals(
            MediaTransferStatus.SUCCEEDED.wireKey,
            loadTransfer().status
        )
    }

    @Test
    fun repositoryMarksCompletionRetryExhaustionTerminalWithoutRestartOrAbort() = runBlocking {
        val context = createRepositoryContext(
            completionOutcomes = listOf(
                CompletionOutcome.Retryable(
                    code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterDelayMillis = 0L
                )
            )
        )

        context.repository.runDueUploads()

        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(4, context.remoteGateway.completionRequests.size)
        assertEquals(0, context.remoteGateway.abortSessionIds.size)
        val exhaustedTransfer = loadTransfer()
        assertEquals(MediaTransferStatus.FAILED.wireKey, exhaustedTransfer.status)
        assertTrue(
            exhaustedTransfer.lastError?.contains("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS") == true
        )

        context.repository.runDueUploads()
        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(4, context.remoteGateway.completionRequests.size)
    }

    @Test
    fun repositoryCancellationDuringCompletionBackoffIsTerminalWithoutAbort() = runBlocking {
        val context = createRepositoryContext(
            completionOutcomes = listOf(
                CompletionOutcome.Retryable(
                    code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterDelayMillis = 60_000L
                )
            )
        )
        val uploadJob = launch {
            context.repository.runDueUploads()
        }

        context.remoteGateway.firstCompletionAttempt.await()
        uploadJob.cancelAndJoin()

        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(listOf(sessionId), context.remoteGateway.completionSessionIds)
        assertEquals(0, context.remoteGateway.abortSessionIds.size)
        assertEquals(MediaTransferStatus.FAILED.wireKey, loadTransfer().status)

        context.repository.runDueUploads()
        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(1, context.remoteGateway.completionRequests.size)
    }

    @Test
    fun repositoryPersistsReplaySuccessWhenCancellationArrivesBeforeLocalDisposition() = runBlocking {
        val context = createRepositoryContext(
            completionOutcomes = listOf(
                CompletionOutcome.Retryable(
                    code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterDelayMillis = 0L
                ),
                CompletionOutcome.Success(
                    applied = false,
                    cancelBeforeReturn = true
                )
            )
        )
        val uploadJob = launch {
            context.repository.runDueUploads()
        }

        joinAll(uploadJob)

        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(listOf(sessionId, sessionId), context.remoteGateway.completionSessionIds)
        assertEquals(0, context.remoteGateway.abortSessionIds.size)
        assertEquals(MediaTransferStatus.SUCCEEDED.wireKey, loadTransfer().status)

        context.repository.runDueUploads()
        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(2, context.remoteGateway.completionRequests.size)
    }

    @Test
    fun repositoryTerminalizesLaterTerminalResponseAfterDurableCompletionBegins() = runBlocking {
        val context = createRepositoryContext(
            completionOutcomes = listOf(
                CompletionOutcome.Retryable(
                    code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS",
                    retryAfterDelayMillis = 0L
                ),
                CompletionOutcome.Terminal(code = "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH")
            )
        )

        context.repository.runDueUploads()

        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(listOf(sessionId, sessionId), context.remoteGateway.completionSessionIds)
        assertEquals(0, context.remoteGateway.abortSessionIds.size)
        val failedTransfer = loadTransfer()
        assertEquals(MediaTransferStatus.FAILED.wireKey, failedTransfer.status)
        assertTrue(
            failedTransfer.lastError?.contains("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS") == true
        )
        assertTrue(failedTransfer.lastError?.contains("MEDIA_ASSET_UPLOAD_PROOF_MISMATCH") == true)

        context.repository.runDueUploads()
        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(2, context.remoteGateway.completionRequests.size)
    }

    @Test
    fun repositoryTerminalizesInvalidReplayAssetAfterDurableCompletionBegins() = runBlocking {
        val context = createRepositoryContext(
            completionOutcomes = listOf(
                CompletionOutcome.Retryable(
                    code = "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
                    retryAfterDelayMillis = 0L
                ),
                CompletionOutcome.InvalidSuccess
            )
        )

        context.repository.runDueUploads()

        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(listOf(sessionId, sessionId), context.remoteGateway.completionSessionIds)
        assertEquals(0, context.remoteGateway.abortSessionIds.size)
        val failedTransfer = loadTransfer()
        assertEquals(MediaTransferStatus.FAILED.wireKey, failedTransfer.status)
        assertTrue(
            failedTransfer.lastError?.contains("MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED") == true
        )
        assertTrue(
            failedTransfer.lastError?.contains("Cloud contract mismatch for completed media asset id") == true
        )

        context.repository.runDueUploads()
        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(2, context.remoteGateway.completionRequests.size)
    }

    @Test
    fun repositoryAbortsTerminalCompletionFailure() = runBlocking {
        val context = createRepositoryContext(
            completionOutcomes = listOf(
                CompletionOutcome.Terminal(code = "MEDIA_ASSET_UPLOAD_PROOF_MISMATCH")
            )
        )

        context.repository.runDueUploads()

        assertEquals(1, context.remoteGateway.createRequests.size)
        assertEquals(1, context.signedPutUploader.uploadedBodies.size)
        assertEquals(listOf(sessionId), context.remoteGateway.completionSessionIds)
        assertEquals(listOf(sessionId), context.remoteGateway.abortSessionIds)
        val failedTransfer = loadTransfer()
        assertEquals(MediaTransferStatus.FAILED.wireKey, failedTransfer.status)
        assertTrue(failedTransfer.lastError?.contains("MEDIA_ASSET_UPLOAD_PROOF_MISMATCH") == true)
    }

    private suspend fun createRepositoryContext(
        completionOutcomes: List<CompletionOutcome>
    ): MediaUploadRepositoryTestContext {
        val workspaceId = environment.requireLocalWorkspaceId()
        environment.prepareLinkedCloudIdentity(localWorkspaceId = workspaceId)
        val mediaBytes = "hello world".toByteArray()
        val sha256 = sha256Hex(bytes = mediaBytes)
        val localRelativePath = buildMediaBlobCacheRelativePath(sha256 = sha256)
        val mediaFile = File(mediaFileRootDirectory, localRelativePath)
        check(mediaFile.parentFile?.mkdirs() == true) {
            "Cannot create media upload test cache directory '${mediaFile.parentFile?.absolutePath}'."
        }
        mediaFile.writeBytes(mediaBytes)
        environment.database.mediaTransferDao().upsertMediaBlobCache(
            mediaBlobCache = MediaBlobCacheEntity(
                sha256 = sha256,
                mimeType = "text/plain",
                sizeBytes = mediaBytes.size.toLong(),
                localRelativePath = localRelativePath,
                createdAtMillis = nowMillis,
                lastAccessedAtMillis = nowMillis,
                sourceMediaAssetId = mediaAssetId
            )
        )
        environment.database.mediaTransferDao().upsertMediaTransfer(
            mediaTransfer = MediaTransferQueueEntity(
                transferId = transferId,
                workspaceId = workspaceId,
                mediaAssetId = mediaAssetId,
                kind = MediaTransferKind.UPLOAD.wireKey,
                status = MediaTransferStatus.QUEUED.wireKey,
                sha256 = sha256,
                mimeType = "text/plain",
                sizeBytes = mediaBytes.size.toLong(),
                localRelativePath = localRelativePath,
                attemptCount = 0,
                nextAttemptAtMillis = nowMillis,
                lastError = null,
                createdAtMillis = nowMillis,
                updatedAtMillis = nowMillis
            )
        )

        val remoteGateway = RecordingMediaUploadGateway(
            workspaceId = workspaceId,
            expectedSha256 = sha256,
            completionOutcomes = completionOutcomes
        )
        val signedPutUploader = RecordingSignedPutUploader()
        return MediaUploadRepositoryTestContext(
            remoteGateway = remoteGateway,
            signedPutUploader = signedPutUploader,
            repository = LocalMediaUploadTransferRepository(
                database = environment.database,
                preferencesStore = environment.cloudPreferencesStore,
                remoteService = remoteGateway,
                operationCoordinator = environment.operationCoordinator,
                resetCoordinator = environment.resetCoordinator,
                guestSessionStore = environment.guestAiSessionStore,
                mediaFileRootDirectory = mediaFileRootDirectory,
                signedPutUploader = signedPutUploader,
                timeProvider = FixedMediaUploadTimeProvider(currentTimeMillis = nowMillis)
            )
        )
    }

    private suspend fun loadTransfer(): MediaTransferQueueEntity {
        val transfer = environment.database.mediaTransferDao().loadMediaTransfer(transferId = transferId)
        assertNotNull(transfer)
        return requireNotNull(transfer)
    }

    private companion object {
        const val mediaAssetId: String = "22222222-2222-4222-8222-222222222222"
        const val sessionId: String = completionTestSessionId
        const val transferId: String = "media-upload-transfer-1"
        const val nowMillis: Long = 1_000L
    }
}

private data class MediaUploadRepositoryTestContext(
    val remoteGateway: RecordingMediaUploadGateway,
    val signedPutUploader: RecordingSignedPutUploader,
    val repository: LocalMediaUploadTransferRepository
)

private sealed interface CompletionOutcome {
    data class Retryable(
        val code: String,
        val retryAfterDelayMillis: Long
    ) : CompletionOutcome

    data class Success(
        val applied: Boolean,
        val cancelBeforeReturn: Boolean
    ) : CompletionOutcome

    data object InvalidSuccess : CompletionOutcome

    data class Terminal(
        val code: String
    ) : CompletionOutcome
}

private class RecordingMediaUploadGateway(
    private val workspaceId: String,
    private val expectedSha256: String,
    private val completionOutcomes: List<CompletionOutcome>
) : CloudRemoteGateway by FakeCloudRemoteGateway.standard() {
    init {
        require(completionOutcomes.isNotEmpty()) {
            "Media upload completion outcomes must not be empty."
        }
    }

    val createRequests = mutableListOf<MediaAssetUploadSessionCreateRequest>()
    val completionSessionIds = mutableListOf<String>()
    val completionRequests = mutableListOf<CompleteMediaAssetUploadSessionRequest>()
    val abortSessionIds = mutableListOf<String>()
    val firstCompletionAttempt = CompletableDeferred<Unit>()

    override suspend fun fetchCloudAccount(
        apiBaseUrl: String,
        authorizationHeader: String
    ): CloudAccountSnapshot {
        return CloudAccountSnapshot(
            userId = "user-1",
            email = "user@example.com",
            preferences = AccountPreferences(reviewReactionAnimationsEnabled = true),
            workspaces = listOf(
                CloudWorkspaceSummary(
                    workspaceId = workspaceId,
                    name = "Test workspace",
                    createdAtMillis = 1L,
                    isSelected = true
                )
            )
        )
    }

    override suspend fun createMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        request: MediaAssetUploadSessionCreateRequest
    ): MediaAssetUploadSessionCreateResponse {
        check(workspaceId == this.workspaceId)
        check(request.sha256 == expectedSha256)
        createRequests += request
        return MediaAssetUploadSessionCreateResponse(
            workspaceId = workspaceId,
            mediaAssetId = request.mediaAssetId,
            status = MediaAssetUploadSessionCreateStatus.UPLOAD_REQUIRED,
            mediaAsset = null,
            uploadSession = MediaAssetUploadSession(
                sessionId = completionTestSessionId,
                expiresAtMillis = Long.MAX_VALUE,
                partSizeBytes = request.partSizeBytes,
                partCount = request.partCount
            )
        )
    }

    override suspend fun createMediaAssetUploadPartUrls(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        request: MediaAssetUploadPartUrlsRequest
    ): MediaAssetUploadPartUrlsResponse {
        check(workspaceId == this.workspaceId)
        check(sessionId == completionTestSessionId)
        return MediaAssetUploadPartUrlsResponse(
            sessionId = sessionId,
            partUrls = request.parts.map { part ->
                MediaAssetUploadPartUrl(
                    partNumber = part.partNumber,
                    method = "PUT",
                    url = "https://uploads.example.test/part-${part.partNumber}",
                    expiresAtMillis = Long.MAX_VALUE,
                    headers = emptyMap()
                )
            }
        )
    }

    override suspend fun completeMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String,
        request: CompleteMediaAssetUploadSessionRequest
    ): MediaAssetUploadCompletion {
        check(workspaceId == this.workspaceId)
        completionSessionIds += sessionId
        completionRequests += request
        firstCompletionAttempt.complete(Unit)
        val outcomeIndex = completionRequests.lastIndex.coerceAtMost(completionOutcomes.lastIndex)
        return when (val outcome = completionOutcomes[outcomeIndex]) {
            is CompletionOutcome.Retryable -> throw CloudRemoteException(
                message = "Completion is still being applied",
                statusCode = 503,
                responseBody = """{"code":"${outcome.code}"}""",
                errorCode = outcome.code,
                requestId = "completion-request-1",
                syncConflict = null,
                retryAfterDelayMillis = outcome.retryAfterDelayMillis,
                androidObservationAlreadyCaptured = false
            )
            is CompletionOutcome.Success -> {
                if (outcome.cancelBeforeReturn) {
                    currentCoroutineContext().cancel(
                        CancellationException("Upload worker cancelled after completion replay")
                    )
                }
                MediaAssetUploadCompletion(
                    mediaAsset = createMediaAsset(),
                    applied = outcome.applied
                )
            }
            CompletionOutcome.InvalidSuccess -> MediaAssetUploadCompletion(
                mediaAsset = createMediaAsset().copy(
                    mediaAssetId = "77777777-7777-4777-8777-777777777777"
                ),
                applied = false
            )
            is CompletionOutcome.Terminal -> throw CloudRemoteException(
                message = "Completion payload is invalid",
                statusCode = 400,
                responseBody = """{"code":"${outcome.code}"}""",
                errorCode = outcome.code,
                requestId = "completion-request-terminal",
                syncConflict = null,
                retryAfterDelayMillis = null,
                androidObservationAlreadyCaptured = false
            )
        }
    }

    override suspend fun abortMediaAssetUploadSession(
        apiBaseUrl: String,
        authorizationHeader: String,
        workspaceId: String,
        sessionId: String
    ): MediaAssetUploadSessionAbort {
        check(workspaceId == this.workspaceId)
        abortSessionIds += sessionId
        return MediaAssetUploadSessionAbort(
            sessionId = sessionId,
            abortedAtMillis = 2_000L
        )
    }

    private fun createMediaAsset(): MediaAsset {
        val createRequest = createRequests.single()
        return MediaAsset(
            mediaAssetId = createRequest.mediaAssetId,
            workspaceId = workspaceId,
            mimeType = createRequest.mimeType,
            sizeBytes = createRequest.sizeBytes,
            sha256 = createRequest.sha256,
            sourceUrl = null,
            createdAtMillis = createRequest.createdAtMillis,
            clientUpdatedAtMillis = createRequest.clientUpdatedAtMillis,
            lastModifiedByReplicaId = createRequest.lastModifiedByReplicaId,
            lastOperationId = createRequest.lastOperationId,
            updatedAtMillis = 2_000L,
            deletedAtMillis = null
        )
    }
}

private class RecordingSignedPutUploader : SignedPutUploader {
    val uploadedBodies = mutableListOf<ByteArray>()

    override suspend fun uploadSignedPut(
        url: String,
        headers: Map<String, String>,
        bodyBytes: ByteArray
    ): SignedPutUploadResult {
        uploadedBodies += bodyBytes.copyOf()
        return SignedPutUploadResult(eTag = "\"etag-${uploadedBodies.size}\"")
    }
}

private class FixedMediaUploadTimeProvider(
    private val currentTimeMillis: Long
) : TimeProvider {
    override fun currentZoneId(): ZoneId {
        return ZoneId.of("UTC")
    }

    override fun currentTimeMillis(): Long {
        return currentTimeMillis
    }
}

private fun sha256Hex(bytes: ByteArray): String {
    return MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString(separator = "") { byte -> "%02x".format(byte.toInt() and 0xff) }
}

private const val completionTestSessionId: String = "55555555-5555-4555-8555-555555555555"
