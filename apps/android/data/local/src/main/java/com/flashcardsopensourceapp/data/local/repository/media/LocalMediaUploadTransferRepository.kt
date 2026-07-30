package com.flashcardsopensourceapp.data.local.repository.media

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.ai.store.GuestAiSessionStore
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteGateway
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.calculateCloudHttpTransientRetryDelayMs
import com.flashcardsopensourceapp.data.local.cloud.remote.transport.cloudHttpTransientRetryMaxAttemptCount
import com.flashcardsopensourceapp.data.local.cloud.wire.CloudContractMismatchException
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.ai.StoredGuestAiSession
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSettings
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadPart
import com.flashcardsopensourceapp.data.local.model.media.CompleteMediaAssetUploadSessionRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAsset
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrl
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadPartUrlsResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadCompletion
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSession
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateRequest
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateResponse
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetUploadSessionCreateStatus
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferKind
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferQueueItem
import com.flashcardsopensourceapp.data.local.model.media.MediaTransferStatus
import com.flashcardsopensourceapp.data.local.model.media.buildMediaBlobCacheRelativePath
import com.flashcardsopensourceapp.data.local.model.media.normalizeMediaSha256
import com.flashcardsopensourceapp.data.local.network.SignedPutUploadHttpException
import com.flashcardsopensourceapp.data.local.network.SignedPutUploader
import com.flashcardsopensourceapp.data.local.network.isRetryableHttpStatusCode
import com.flashcardsopensourceapp.data.local.repository.cloudsync.account.CloudIdentityResetCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.guest.loadActiveGuestSessionOrNull
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.AuthenticatedCloudSession
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudOperationCoordinator
import com.flashcardsopensourceapp.data.local.repository.cloudsync.runtime.CloudSessionProvider
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.buildClientWorkspaceReplicaId
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
import com.flashcardsopensourceapp.data.local.repository.shared.TimeProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.security.MessageDigest

private const val mediaUploadPartSizeBytes: Long = 8_388_608L
private const val mediaUploadPartUrlBatchSize: Int = 100
private const val mediaUploadMaxTransfersPerRun: Int = 3
private const val mediaUploadRetryBaseDelayMillis: Long = 60_000L
private const val mediaUploadRetryMaxDelayMillis: Long = 3_600_000L
private const val mediaUploadErrorMessageLimit: Int = 4_096
private const val mediaUploadRetryMaxExponent: Int = 6
private const val mediaUploadReplicaInvalidErrorCode: String = "MEDIA_ASSET_REPLICA_INVALID"
private val mediaUploadSameSessionCompletionRetryErrorCodes: Set<String> = setOf(
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_DEADLINE_EXCEEDED",
    "MEDIA_ASSET_UPLOAD_SESSION_COMPLETION_IN_PROGRESS"
)

data class MediaUploadTransferRunResult(
    val processedCount: Int,
    val nextAttemptAtMillis: Long?
) {
    init {
        require(processedCount >= 0) {
            "Media upload transfer processedCount must not be negative."
        }
    }
}

class LocalMediaUploadTransferRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val remoteService: CloudRemoteGateway,
    private val operationCoordinator: CloudOperationCoordinator,
    resetCoordinator: CloudIdentityResetCoordinator,
    private val guestSessionStore: GuestAiSessionStore,
    private val mediaFileRootDirectory: File,
    private val signedPutUploader: SignedPutUploader,
    private val timeProvider: TimeProvider
) {
    private val sessionProvider = CloudSessionProvider(
        preferencesStore = preferencesStore,
        remoteService = remoteService,
        operationCoordinator = operationCoordinator,
        resetCoordinator = resetCoordinator
    )

    suspend fun runDueUploads(): MediaUploadTransferRunResult {
        return operationCoordinator.runExclusive {
            val workspace: WorkspaceEntity = loadCurrentWorkspaceOrNull(
                database = database,
                preferencesStore = preferencesStore
            ) ?: return@runExclusive MediaUploadTransferRunResult(processedCount = 0, nextAttemptAtMillis = null)
            val cloudSession: MediaUploadCloudSession = loadMediaUploadCloudSessionOrNull(
                workspaceId = workspace.workspaceId
            ) ?: return@runExclusive MediaUploadTransferRunResult(processedCount = 0, nextAttemptAtMillis = null)

            recoverInProgressUploads(workspaceId = workspace.workspaceId)

            var processedCount = 0
            while (processedCount < mediaUploadMaxTransfersPerRun) {
                val claimedTransfer: MediaTransferQueueEntity = claimNextDueUpload(
                    workspaceId = workspace.workspaceId,
                    nowMillis = timeProvider.currentTimeMillis()
                ) ?: break
                processClaimedUpload(
                    transferEntity = claimedTransfer,
                    cloudSession = cloudSession
                )
                processedCount += 1
            }

            MediaUploadTransferRunResult(
                processedCount = processedCount,
                nextAttemptAtMillis = database.mediaTransferDao().loadNextMediaTransferAttemptAtMillis(
                    workspaceId = workspace.workspaceId,
                    kind = MediaTransferKind.UPLOAD.wireKey,
                    status = MediaTransferStatus.QUEUED.wireKey
                )
            )
        }
    }

    private suspend fun recoverInProgressUploads(workspaceId: String) {
        val nowMillis: Long = timeProvider.currentTimeMillis()
        database.mediaTransferDao().resetInProgressMediaTransfersByKind(
            workspaceId = workspaceId,
            kind = MediaTransferKind.UPLOAD.wireKey,
            inProgressStatus = MediaTransferStatus.IN_PROGRESS.wireKey,
            queuedStatus = MediaTransferStatus.QUEUED.wireKey,
            nextAttemptAtMillis = nowMillis,
            lastError = "Media upload worker restarted before the previous attempt finished.",
            updatedAtMillis = nowMillis
        )
    }

    private suspend fun claimNextDueUpload(
        workspaceId: String,
        nowMillis: Long
    ): MediaTransferQueueEntity? {
        val dueTransfers: List<MediaTransferQueueEntity> = database.mediaTransferDao().loadDueMediaTransfersByKind(
            workspaceId = workspaceId,
            kind = MediaTransferKind.UPLOAD.wireKey,
            status = MediaTransferStatus.QUEUED.wireKey,
            nowMillis = nowMillis,
            limit = 1
        )
        val dueTransfer: MediaTransferQueueEntity = dueTransfers.firstOrNull() ?: return null
        val claimedRowCount: Int = database.mediaTransferDao().claimDueMediaTransfer(
            transferId = dueTransfer.transferId,
            workspaceId = workspaceId,
            kind = MediaTransferKind.UPLOAD.wireKey,
            expectedStatus = MediaTransferStatus.QUEUED.wireKey,
            claimedStatus = MediaTransferStatus.IN_PROGRESS.wireKey,
            nowMillis = nowMillis,
            updatedAtMillis = nowMillis
        )
        if (claimedRowCount == 0) {
            return null
        }

        return requireNotNull(database.mediaTransferDao().loadMediaTransfer(transferId = dueTransfer.transferId)) {
            "Claimed media upload transfer '${dueTransfer.transferId}' disappeared before processing."
        }
    }

    private suspend fun processClaimedUpload(
        transferEntity: MediaTransferQueueEntity,
        cloudSession: MediaUploadCloudSession
    ) {
        var activeUploadSession: ActiveMediaUploadSession? = null
        try {
            val transfer: MediaTransferQueueItem = toMediaTransferQueueItem(entity = transferEntity)
            requireUploadTransferCanUseSession(transfer = transfer, cloudSession = cloudSession)
            val uploadFilePlan: MediaUploadFilePlan = planUploadFile(
                transfer = transfer,
                mediaFileRootDirectory = mediaFileRootDirectory
            )
            val createResponse: MediaAssetUploadSessionCreateResponse = remoteService.createMediaAssetUploadSession(
                apiBaseUrl = cloudSession.apiBaseUrl,
                authorizationHeader = cloudSession.authorizationHeader,
                workspaceId = transfer.workspaceId,
                request = buildUploadSessionCreateRequest(
                    transfer = transfer,
                    uploadFilePlan = uploadFilePlan,
                    cloudSettings = cloudSession.cloudSettings
                )
            )
            requireCreateResponseMatchesTransfer(
                createResponse = createResponse,
                transfer = transfer
            )

            when (createResponse.status) {
                MediaAssetUploadSessionCreateStatus.ALREADY_AVAILABLE -> {
                    val mediaAsset: MediaAsset = requireNotNull(createResponse.mediaAsset) {
                        "Media upload session already_available response must include mediaAsset."
                    }
                    persistSuccessfulUpload(
                        transfer = transfer,
                        uploadFilePlan = uploadFilePlan,
                        mediaAsset = mediaAsset
                    )
                }

                MediaAssetUploadSessionCreateStatus.UPLOAD_REQUIRED -> {
                    val uploadSession: MediaAssetUploadSession = requireNotNull(createResponse.uploadSession) {
                        "Media upload session upload_required response must include uploadSession."
                    }
                    activeUploadSession = ActiveMediaUploadSession(
                        workspaceId = transfer.workspaceId,
                        sessionId = uploadSession.sessionId
                    )
                    requireUploadSessionMatchesPlan(
                        uploadSession = uploadSession,
                        uploadFilePlan = uploadFilePlan
                    )
                    val completionResult: MediaUploadCompletionReplayResult = uploadMultipartBytes(
                        transfer = transfer,
                        uploadFilePlan = uploadFilePlan,
                        uploadSession = uploadSession,
                        cloudSession = cloudSession
                    )
                    val mediaAsset: MediaAsset = completionResult.completion.mediaAsset
                    if (completionResult.retryableCompletionCause == null) {
                        persistSuccessfulUpload(
                            transfer = transfer,
                            uploadFilePlan = uploadFilePlan,
                            mediaAsset = mediaAsset
                        )
                    }
                    activeUploadSession = null
                }
            }
        } catch (error: MediaUploadCompletionTerminalException) {
            try {
                withContext(context = NonCancellable) {
                    recordUploadFailure(transferEntity = transferEntity, error = error)
                }
            } catch (persistenceError: Exception) {
                error.addSuppressed(persistenceError)
                throw error
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (shouldAbortMediaUploadSessionAfterFailure(error = error)) {
                abortActiveUploadSessionIfPossible(
                    activeUploadSession = activeUploadSession,
                    cloudSession = cloudSession,
                    cause = error
                )
            }
            recordUploadFailure(transferEntity = transferEntity, error = error)
        }
    }

    private suspend fun uploadMultipartBytes(
        transfer: MediaTransferQueueItem,
        uploadFilePlan: MediaUploadFilePlan,
        uploadSession: MediaAssetUploadSession,
        cloudSession: MediaUploadCloudSession
    ): MediaUploadCompletionReplayResult {
        val completedParts = mutableListOf<CompleteMediaAssetUploadPart>()
        uploadFilePlan.parts.chunked(size = mediaUploadPartUrlBatchSize).forEach { partBatch ->
            requireUploadSessionNotExpired(uploadSession = uploadSession)
            val partUrlsResponse: MediaAssetUploadPartUrlsResponse = remoteService.createMediaAssetUploadPartUrls(
                apiBaseUrl = cloudSession.apiBaseUrl,
                authorizationHeader = cloudSession.authorizationHeader,
                workspaceId = transfer.workspaceId,
                sessionId = uploadSession.sessionId,
                request = MediaAssetUploadPartUrlsRequest(
                    parts = partBatch.map { part ->
                        MediaAssetUploadPartRequest(
                            partNumber = part.partNumber,
                            sha256 = part.sha256
                        )
                    }
                )
            )
            val partUrlsByNumber: Map<Int, MediaAssetUploadPartUrl> = requirePartUrlsMatchRequest(
                partUrlsResponse = partUrlsResponse,
                uploadSession = uploadSession,
                requestedParts = partBatch
            )
            partBatch.forEach { part ->
                val partUrl: MediaAssetUploadPartUrl = requireNotNull(partUrlsByNumber[part.partNumber]) {
                    "Media upload part URL response did not include partNumber=${part.partNumber}."
                }
                requirePartUrlNotExpired(partUrl = partUrl)
                val partBytes: ByteArray = readUploadPartBytes(
                    file = uploadFilePlan.file,
                    part = part
                )
                val uploadResult = signedPutUploader.uploadSignedPut(
                    url = partUrl.url,
                    headers = partUrl.headers,
                    bodyBytes = partBytes
                )
                completedParts += CompleteMediaAssetUploadPart(
                    partNumber = part.partNumber,
                    eTag = uploadResult.eTag,
                    sha256 = part.sha256
                )
            }
        }

        requireUploadSessionNotExpired(uploadSession = uploadSession)
        val completionRequest = CompleteMediaAssetUploadSessionRequest(
            parts = completedParts.sortedBy { part -> part.partNumber }
        )
        return retryMediaUploadSessionCompletion(
            complete = {
                remoteService.completeMediaAssetUploadSession(
                    apiBaseUrl = cloudSession.apiBaseUrl,
                    authorizationHeader = cloudSession.authorizationHeader,
                    workspaceId = transfer.workspaceId,
                    sessionId = uploadSession.sessionId,
                    request = completionRequest
                )
            },
            wait = { delayMillis ->
                delay(timeMillis = delayMillis)
            },
            persistReplaySuccess = { completion ->
                persistSuccessfulUpload(
                    transfer = transfer,
                    uploadFilePlan = uploadFilePlan,
                    mediaAsset = completion.mediaAsset
                )
            }
        )
    }

    private suspend fun persistSuccessfulUpload(
        transfer: MediaTransferQueueItem,
        uploadFilePlan: MediaUploadFilePlan,
        mediaAsset: MediaAsset
    ) {
        requireMediaAssetMatchesTransfer(
            mediaAsset = mediaAsset,
            transfer = transfer
        )
        val nowMillis: Long = timeProvider.currentTimeMillis()
        database.withTransaction {
            database.mediaAssetDao().insertMediaAsset(mediaAsset = toMediaAssetEntity(mediaAsset = mediaAsset))
            database.mediaTransferDao().upsertMediaBlobCache(
                mediaBlobCache = MediaBlobCacheEntity(
                    sha256 = uploadFilePlan.sha256,
                    mimeType = transfer.mimeType,
                    sizeBytes = uploadFilePlan.sizeBytes,
                    localRelativePath = transfer.localRelativePath,
                    createdAtMillis = transfer.createdAtMillis,
                    lastAccessedAtMillis = nowMillis,
                    sourceMediaAssetId = mediaAsset.mediaAssetId
                )
            )
            database.mediaTransferDao().updateMediaTransferStatus(
                transferId = transfer.transferId,
                status = MediaTransferStatus.SUCCEEDED.wireKey,
                lastError = null,
                updatedAtMillis = nowMillis
            )
        }
    }

    private suspend fun recordUploadFailure(
        transferEntity: MediaTransferQueueEntity,
        error: Exception
    ) {
        val nowMillis: Long = timeProvider.currentTimeMillis()
        val errorMessage: String = renderMediaUploadError(error = error)
        if (isPermanentMediaUploadFailure(error = error)) {
            database.mediaTransferDao().updateMediaTransferStatus(
                transferId = transferEntity.transferId,
                status = MediaTransferStatus.FAILED.wireKey,
                lastError = errorMessage,
                updatedAtMillis = nowMillis
            )
            return
        }

        database.mediaTransferDao().markMediaTransferAttemptFailed(
            transferId = transferEntity.transferId,
            status = MediaTransferStatus.QUEUED.wireKey,
            nextAttemptAtMillis = nowMillis + calculateRetryDelayMillis(attemptCount = transferEntity.attemptCount),
            lastError = errorMessage,
            updatedAtMillis = nowMillis
        )
    }

    private suspend fun loadMediaUploadCloudSessionOrNull(workspaceId: String): MediaUploadCloudSession? {
        if (preferencesStore.loadCloudCredentialRecoveryState() != null) {
            return null
        }

        val cloudSettings: CloudSettings = preferencesStore.currentCloudSettings()
        val activeWorkspaceId: String? = cloudSettings.activeWorkspaceId ?: cloudSettings.linkedWorkspaceId
        require(activeWorkspaceId == workspaceId) {
            "Managed media upload requires active workspace '$workspaceId', " +
                "but cloud settings point to '$activeWorkspaceId'."
        }

        return when (cloudSettings.cloudState) {
            CloudAccountState.LINKED -> {
                val authenticatedSession: AuthenticatedCloudSession = sessionProvider.authenticatedSession()
                MediaUploadCloudSession(
                    apiBaseUrl = authenticatedSession.configuration.apiBaseUrl,
                    authorizationHeader = "Bearer ${authenticatedSession.credentials.idToken}",
                    cloudSettings = cloudSettings
                )
            }

            CloudAccountState.GUEST -> {
                val configuration: CloudServiceConfiguration = preferencesStore.currentServerConfiguration()
                val guestSession: StoredGuestAiSession = loadActiveGuestSessionOrNull(
                    preferencesStore = preferencesStore,
                    guestSessionStore = guestSessionStore,
                    configuration = configuration
                ) ?: return null
                require(guestSession.workspaceId == workspaceId) {
                    "Managed media upload requires guest workspace '$workspaceId', " +
                        "but the stored guest session points to '${guestSession.workspaceId}'."
                }
                MediaUploadCloudSession(
                    apiBaseUrl = guestSession.apiBaseUrl,
                    authorizationHeader = "Guest ${guestSession.guestToken}",
                    cloudSettings = cloudSettings
                )
            }

            CloudAccountState.DISCONNECTED,
            CloudAccountState.LINKING_READY -> null
        }
    }

    private suspend fun abortActiveUploadSessionIfPossible(
        activeUploadSession: ActiveMediaUploadSession?,
        cloudSession: MediaUploadCloudSession,
        cause: Throwable
    ) {
        val uploadSession: ActiveMediaUploadSession = activeUploadSession ?: return
        try {
            remoteService.abortMediaAssetUploadSession(
                apiBaseUrl = cloudSession.apiBaseUrl,
                authorizationHeader = cloudSession.authorizationHeader,
                workspaceId = uploadSession.workspaceId,
                sessionId = uploadSession.sessionId
            )
        } catch (abortError: Exception) {
            cause.addSuppressed(abortError)
        }
    }

}

private data class MediaUploadCloudSession(
    val apiBaseUrl: String,
    val authorizationHeader: String,
    val cloudSettings: CloudSettings
)

private data class ActiveMediaUploadSession(
    val workspaceId: String,
    val sessionId: String
)

private data class MediaUploadFilePlan(
    val file: File,
    val sizeBytes: Long,
    val sha256: String,
    val partSizeBytes: Long,
    val parts: List<MediaUploadFilePart>
) {
    init {
        require(sizeBytes > 0L) {
            "Media upload file plan sizeBytes must be positive."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media upload file plan sha256 must already be normalized."
        }
        require(partSizeBytes > 0L) {
            "Media upload file plan partSizeBytes must be positive."
        }
        require(parts.isNotEmpty()) {
            "Media upload file plan parts must not be empty."
        }
    }
}

private data class MediaUploadFilePart(
    val partNumber: Int,
    val offsetBytes: Long,
    val sizeBytes: Long,
    val sha256: String
) {
    init {
        require(partNumber > 0) {
            "Media upload file part partNumber must be positive."
        }
        require(offsetBytes >= 0L) {
            "Media upload file part offsetBytes must not be negative."
        }
        require(sizeBytes > 0L) {
            "Media upload file part sizeBytes must be positive."
        }
        require(sizeBytes <= Int.MAX_VALUE.toLong()) {
            "Media upload file part sizeBytes must fit in memory."
        }
        require(sha256 == normalizeMediaSha256(rawSha256 = sha256)) {
            "Media upload file part sha256 must already be normalized."
        }
    }
}

private class MediaUploadTransferPermanentException(
    message: String,
    cause: Throwable?
) : IllegalStateException(message, cause)

private class MediaUploadTransferSessionExpiredException(
    message: String,
    cause: Throwable?
) : IOException(message, cause)

internal enum class MediaUploadCompletionTerminalReason(
    val wireKey: String
) {
    RETRY_EXHAUSTED("retry_exhausted"),
    INTERRUPTED("interrupted")
}

private fun renderMediaUploadCompletionInterruption(error: Exception?): String {
    if (error == null) {
        return "none"
    }
    if (error is CloudRemoteException) {
        return buildString {
            append(error.message)
            append(" code=${error.errorCode ?: "none"}")
            append(" status=${error.statusCode ?: "none"}")
            append(" requestId=${error.requestId ?: "none"}")
        }
    }
    return error.message ?: error::class.java.simpleName
}

internal class MediaUploadCompletionTerminalException(
    val reason: MediaUploadCompletionTerminalReason,
    val completionCause: CloudRemoteException,
    val interruptionCause: Exception?
) : Exception(
    buildString {
        append("Media upload completion stopped for this local run: ")
        append("reason=${reason.wireKey}, ")
        append("completionError=${completionCause.message}, ")
        append("completionCode=${completionCause.errorCode ?: "none"}, ")
        append("completionStatus=${completionCause.statusCode ?: "none"}, ")
        append("completionRequestId=${completionCause.requestId ?: "none"}, ")
        append("interruptionError=${renderMediaUploadCompletionInterruption(error = interruptionCause)}")
    },
    completionCause
)

internal data class MediaUploadCompletionReplayResult(
    val completion: MediaAssetUploadCompletion,
    val retryableCompletionCause: CloudRemoteException?
)

internal fun shouldAbortMediaUploadSessionAfterFailure(error: Exception): Boolean {
    if (error is MediaUploadCompletionTerminalException) {
        return false
    }
    return error !is CloudRemoteException ||
        error.errorCode !in mediaUploadSameSessionCompletionRetryErrorCodes
}

internal suspend fun retryMediaUploadSessionCompletion(
    complete: suspend () -> MediaAssetUploadCompletion,
    wait: suspend (Long) -> Unit,
    persistReplaySuccess: suspend (MediaAssetUploadCompletion) -> Unit
): MediaUploadCompletionReplayResult {
    var attemptNumber = 1
    var lastRetryableCompletionError: CloudRemoteException? = null
    while (true) {
        try {
            currentCoroutineContext().ensureActive()
        } catch (error: CancellationException) {
            val completionError = lastRetryableCompletionError ?: throw error
            throw MediaUploadCompletionTerminalException(
                reason = MediaUploadCompletionTerminalReason.INTERRUPTED,
                completionCause = completionError,
                interruptionCause = error
            )
        }

        try {
            val completionError: CloudRemoteException? = lastRetryableCompletionError
            val completion: MediaAssetUploadCompletion = if (completionError == null) {
                complete()
            } else {
                withContext(context = NonCancellable) {
                    val replayCompletion: MediaAssetUploadCompletion = complete()
                    persistReplaySuccess(replayCompletion)
                    replayCompletion
                }
            }
            return MediaUploadCompletionReplayResult(
                completion = completion,
                retryableCompletionCause = completionError
            )
        } catch (error: CancellationException) {
            val completionError = lastRetryableCompletionError
            if (completionError != null) {
                throw MediaUploadCompletionTerminalException(
                    reason = MediaUploadCompletionTerminalReason.INTERRUPTED,
                    completionCause = completionError,
                    interruptionCause = error
                )
            }
            throw error
        } catch (error: CloudRemoteException) {
            val errorCode: String? = error.errorCode
            if (
                errorCode == null ||
                mediaUploadSameSessionCompletionRetryErrorCodes.contains(element = errorCode).not()
            ) {
                val completionError = lastRetryableCompletionError
                if (completionError != null) {
                    throw MediaUploadCompletionTerminalException(
                        reason = MediaUploadCompletionTerminalReason.INTERRUPTED,
                        completionCause = completionError,
                        interruptionCause = error
                    )
                }
                throw error
            }
            lastRetryableCompletionError = error
            if (attemptNumber >= cloudHttpTransientRetryMaxAttemptCount) {
                throw MediaUploadCompletionTerminalException(
                    reason = MediaUploadCompletionTerminalReason.RETRY_EXHAUSTED,
                    completionCause = error,
                    interruptionCause = null
                )
            }

            try {
                wait(
                    error.retryAfterDelayMillis
                        ?: calculateCloudHttpTransientRetryDelayMs(attemptNumber = attemptNumber)
                )
            } catch (waitError: Exception) {
                throw MediaUploadCompletionTerminalException(
                    reason = MediaUploadCompletionTerminalReason.INTERRUPTED,
                    completionCause = error,
                    interruptionCause = waitError
                )
            }
            attemptNumber += 1
        } catch (error: Exception) {
            val completionError = lastRetryableCompletionError
            if (completionError != null) {
                throw MediaUploadCompletionTerminalException(
                    reason = MediaUploadCompletionTerminalReason.INTERRUPTED,
                    completionCause = completionError,
                    interruptionCause = error
                )
            }
            throw error
        }
    }
}

private fun toMediaTransferQueueItem(entity: MediaTransferQueueEntity): MediaTransferQueueItem {
    return MediaTransferQueueItem(
        transferId = entity.transferId,
        workspaceId = entity.workspaceId,
        mediaAssetId = entity.mediaAssetId,
        kind = MediaTransferKind.fromWireKey(wireKey = entity.kind),
        status = MediaTransferStatus.fromWireKey(wireKey = entity.status),
        sha256 = entity.sha256,
        mimeType = entity.mimeType,
        sizeBytes = entity.sizeBytes,
        localRelativePath = entity.localRelativePath,
        attemptCount = entity.attemptCount,
        nextAttemptAtMillis = entity.nextAttemptAtMillis,
        lastError = entity.lastError,
        createdAtMillis = entity.createdAtMillis,
        updatedAtMillis = entity.updatedAtMillis
    )
}

private fun planUploadFile(
    transfer: MediaTransferQueueItem,
    mediaFileRootDirectory: File
): MediaUploadFilePlan {
    if (transfer.kind != MediaTransferKind.UPLOAD) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' has unexpected kind '${transfer.kind.wireKey}'.",
            cause = null
        )
    }
    if (transfer.status != MediaTransferStatus.IN_PROGRESS) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' must be in_progress before upload.",
            cause = null
        )
    }
    if (transfer.localRelativePath != buildMediaBlobCacheRelativePath(sha256 = transfer.sha256)) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' local path does not match SHA-256.",
            cause = null
        )
    }

    val uploadFile: File = resolveUploadFile(
        mediaFileRootDirectory = mediaFileRootDirectory,
        localRelativePath = transfer.localRelativePath
    )
    if (uploadFile.exists().not()) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload file is missing: ${uploadFile.absolutePath}",
            cause = null
        )
    }
    if (uploadFile.isFile.not()) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload path is not a file: ${uploadFile.absolutePath}",
            cause = null
        )
    }
    if (uploadFile.length() <= 0L) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload file must not be empty: ${uploadFile.absolutePath}",
            cause = null
        )
    }
    if (uploadFile.length() != transfer.sizeBytes) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload size mismatch for transfer '${transfer.transferId}': " +
                "queue sizeBytes=${transfer.sizeBytes} file sizeBytes=${uploadFile.length()}.",
            cause = null
        )
    }

    return try {
        buildUploadFilePlan(
            file = uploadFile,
            expectedSha256 = transfer.sha256,
            expectedSizeBytes = transfer.sizeBytes
        )
    } catch (error: IOException) {
        throw MediaUploadTransferPermanentException(
            message = "Cannot read managed media upload file '${uploadFile.absolutePath}': " +
                (error.message ?: error::class.java.simpleName),
            cause = error
        )
    }
}

private fun resolveUploadFile(
    mediaFileRootDirectory: File,
    localRelativePath: String
): File {
    val rootDirectory: File = mediaFileRootDirectory.canonicalFile
    val uploadFile: File = File(rootDirectory, localRelativePath).canonicalFile
    val rootPath: String = rootDirectory.path
    val uploadFilePath: String = uploadFile.path
    if (uploadFilePath != rootPath && uploadFilePath.startsWith(prefix = "$rootPath${File.separator}").not()) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload path escapes file root: root='$rootPath' relativePath='$localRelativePath'.",
            cause = null
        )
    }
    return uploadFile
}

private fun buildUploadFilePlan(
    file: File,
    expectedSha256: String,
    expectedSizeBytes: Long
): MediaUploadFilePlan {
    val fullDigest: MessageDigest = MessageDigest.getInstance("SHA-256")
    var partDigest: MessageDigest = MessageDigest.getInstance("SHA-256")
    val parts = mutableListOf<MediaUploadFilePart>()
    val buffer = ByteArray(size = 64 * 1024)
    var totalSizeBytes = 0L
    var currentPartSizeBytes = 0L
    var currentPartOffsetBytes = 0L
    var currentPartNumber = 1

    FileInputStream(file).use { input ->
        while (true) {
            val readByteCount: Int = input.read(buffer)
            if (readByteCount == -1) {
                break
            }

            var consumedByteCount = 0
            while (consumedByteCount < readByteCount) {
                val remainingReadBytes: Int = readByteCount - consumedByteCount
                val remainingPartBytes: Long = mediaUploadPartSizeBytes - currentPartSizeBytes
                val chunkByteCount: Int = minOf(remainingReadBytes, remainingPartBytes.toInt())
                fullDigest.update(buffer, consumedByteCount, chunkByteCount)
                partDigest.update(buffer, consumedByteCount, chunkByteCount)
                consumedByteCount += chunkByteCount
                currentPartSizeBytes += chunkByteCount.toLong()
                totalSizeBytes += chunkByteCount.toLong()

                if (currentPartSizeBytes == mediaUploadPartSizeBytes) {
                    parts += MediaUploadFilePart(
                        partNumber = currentPartNumber,
                        offsetBytes = currentPartOffsetBytes,
                        sizeBytes = currentPartSizeBytes,
                        sha256 = encodeDigestHex(bytes = partDigest.digest())
                    )
                    currentPartNumber += 1
                    currentPartOffsetBytes = totalSizeBytes
                    currentPartSizeBytes = 0L
                    partDigest = MessageDigest.getInstance("SHA-256")
                }
            }
        }
    }

    if (currentPartSizeBytes > 0L) {
        parts += MediaUploadFilePart(
            partNumber = currentPartNumber,
            offsetBytes = currentPartOffsetBytes,
            sizeBytes = currentPartSizeBytes,
            sha256 = encodeDigestHex(bytes = partDigest.digest())
        )
    }

    val computedSha256: String = encodeDigestHex(bytes = fullDigest.digest())
    if (totalSizeBytes != expectedSizeBytes) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload size changed while reading: " +
                "expected $expectedSizeBytes byte(s), read $totalSizeBytes byte(s).",
            cause = null
        )
    }
    if (computedSha256 != expectedSha256) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload SHA-256 mismatch: expected '$expectedSha256' but read '$computedSha256'.",
            cause = null
        )
    }

    return MediaUploadFilePlan(
        file = file,
        sizeBytes = totalSizeBytes,
        sha256 = computedSha256,
        partSizeBytes = mediaUploadPartSizeBytes,
        parts = parts
    )
}

private fun buildUploadSessionCreateRequest(
    transfer: MediaTransferQueueItem,
    uploadFilePlan: MediaUploadFilePlan,
    cloudSettings: CloudSettings
): MediaAssetUploadSessionCreateRequest {
    return MediaAssetUploadSessionCreateRequest(
        mediaAssetId = transfer.mediaAssetId,
        mimeType = transfer.mimeType,
        sizeBytes = uploadFilePlan.sizeBytes,
        sha256 = uploadFilePlan.sha256,
        partSizeBytes = uploadFilePlan.partSizeBytes,
        partCount = uploadFilePlan.parts.size,
        sourceUrl = null,
        createdAtMillis = transfer.createdAtMillis,
        clientUpdatedAtMillis = transfer.updatedAtMillis,
        lastModifiedByReplicaId = buildClientWorkspaceReplicaId(
            workspaceId = transfer.workspaceId,
            installationId = cloudSettings.installationId
        ),
        lastOperationId = transfer.transferId
    )
}

private fun requireUploadTransferCanUseSession(
    transfer: MediaTransferQueueItem,
    cloudSession: MediaUploadCloudSession
) {
    val activeWorkspaceId: String? = cloudSession.cloudSettings.activeWorkspaceId
        ?: cloudSession.cloudSettings.linkedWorkspaceId
    if (activeWorkspaceId != transfer.workspaceId) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload transfer '${transfer.transferId}' targets workspace " +
                "'${transfer.workspaceId}', but active cloud workspace is '$activeWorkspaceId'.",
            cause = null
        )
    }
}

private fun requireCreateResponseMatchesTransfer(
    createResponse: MediaAssetUploadSessionCreateResponse,
    transfer: MediaTransferQueueItem
) {
    if (createResponse.workspaceId != transfer.workspaceId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload create workspaceId: " +
                "expected '${transfer.workspaceId}', got '${createResponse.workspaceId}'."
        )
    }
    if (createResponse.mediaAssetId != transfer.mediaAssetId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload create mediaAssetId: " +
                "expected '${transfer.mediaAssetId}', got '${createResponse.mediaAssetId}'."
        )
    }
}

private fun requireUploadSessionMatchesPlan(
    uploadSession: MediaAssetUploadSession,
    uploadFilePlan: MediaUploadFilePlan
) {
    if (uploadSession.partSizeBytes != uploadFilePlan.partSizeBytes) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload session partSizeBytes: " +
                "expected ${uploadFilePlan.partSizeBytes}, got ${uploadSession.partSizeBytes}."
        )
    }
    if (uploadSession.partCount != uploadFilePlan.parts.size) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload session partCount: " +
                "expected ${uploadFilePlan.parts.size}, got ${uploadSession.partCount}."
        )
    }
    requireUploadSessionNotExpired(uploadSession = uploadSession)
}

private fun requireUploadSessionNotExpired(uploadSession: MediaAssetUploadSession) {
    if (uploadSession.expiresAtMillis <= System.currentTimeMillis()) {
        throw MediaUploadTransferSessionExpiredException(
            message = "Media upload session '${uploadSession.sessionId}' is expired.",
            cause = null
        )
    }
}

private fun requirePartUrlNotExpired(partUrl: MediaAssetUploadPartUrl) {
    if (partUrl.expiresAtMillis <= System.currentTimeMillis()) {
        throw MediaUploadTransferSessionExpiredException(
            message = "Media upload part URL for partNumber=${partUrl.partNumber} is expired.",
            cause = null
        )
    }
}

private fun requirePartUrlsMatchRequest(
    partUrlsResponse: MediaAssetUploadPartUrlsResponse,
    uploadSession: MediaAssetUploadSession,
    requestedParts: List<MediaUploadFilePart>
): Map<Int, MediaAssetUploadPartUrl> {
    if (partUrlsResponse.sessionId != uploadSession.sessionId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload part URLs sessionId: " +
                "expected '${uploadSession.sessionId}', got '${partUrlsResponse.sessionId}'."
        )
    }
    val expectedPartNumbers: Set<Int> = requestedParts.map { part -> part.partNumber }.toSet()
    val actualPartNumbers: Set<Int> = partUrlsResponse.partUrls.map { partUrl -> partUrl.partNumber }.toSet()
    if (actualPartNumbers != expectedPartNumbers) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for media upload part URLs: " +
                "expected partNumbers=$expectedPartNumbers, got partNumbers=$actualPartNumbers."
        )
    }
    return partUrlsResponse.partUrls.associateBy { partUrl -> partUrl.partNumber }
}

private fun readUploadPartBytes(
    file: File,
    part: MediaUploadFilePart
): ByteArray {
    return try {
        RandomAccessFile(file, "r").use { randomAccessFile ->
            randomAccessFile.seek(part.offsetBytes)
            val bytes = ByteArray(size = part.sizeBytes.toInt())
            randomAccessFile.readFully(bytes)
            bytes
        }
    } catch (error: EOFException) {
        throw MediaUploadTransferPermanentException(
            message = "Managed media upload file ended before partNumber=${part.partNumber}.",
            cause = error
        )
    } catch (error: IOException) {
        throw MediaUploadTransferPermanentException(
            message = "Cannot read managed media upload partNumber=${part.partNumber}: " +
                (error.message ?: error::class.java.simpleName),
            cause = error
        )
    }
}

private fun requireMediaAssetMatchesTransfer(
    mediaAsset: MediaAsset,
    transfer: MediaTransferQueueItem
) {
    if (mediaAsset.mediaAssetId != transfer.mediaAssetId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset id: " +
                "expected '${transfer.mediaAssetId}', got '${mediaAsset.mediaAssetId}'."
        )
    }
    if (mediaAsset.workspaceId != transfer.workspaceId) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset workspaceId: " +
                "expected '${transfer.workspaceId}', got '${mediaAsset.workspaceId}'."
        )
    }
    if (mediaAsset.sha256 != transfer.sha256) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset sha256: " +
                "expected '${transfer.sha256}', got '${mediaAsset.sha256}'."
        )
    }
    if (mediaAsset.sizeBytes != transfer.sizeBytes) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset sizeBytes: " +
                "expected ${transfer.sizeBytes}, got ${mediaAsset.sizeBytes}."
        )
    }
    if (mediaAsset.mimeType != transfer.mimeType) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset mimeType: " +
                "expected '${transfer.mimeType}', got '${mediaAsset.mimeType}'."
        )
    }
    if (mediaAsset.deletedAtMillis != null) {
        throw CloudContractMismatchException(
            "Cloud contract mismatch for completed media asset deletedAtMillis: expected null, got ${mediaAsset.deletedAtMillis}."
        )
    }
}

private fun toMediaAssetEntity(mediaAsset: MediaAsset): MediaAssetEntity {
    return MediaAssetEntity(
        mediaAssetId = mediaAsset.mediaAssetId,
        workspaceId = mediaAsset.workspaceId,
        mimeType = mediaAsset.mimeType,
        sizeBytes = mediaAsset.sizeBytes,
        sha256 = mediaAsset.sha256,
        sourceUrl = mediaAsset.sourceUrl,
        createdAtMillis = mediaAsset.createdAtMillis,
        clientUpdatedAtMillis = mediaAsset.clientUpdatedAtMillis,
        lastModifiedByReplicaId = mediaAsset.lastModifiedByReplicaId,
        lastOperationId = mediaAsset.lastOperationId,
        updatedAtMillis = mediaAsset.updatedAtMillis,
        deletedAtMillis = mediaAsset.deletedAtMillis
    )
}

private fun isMediaUploadSessionExpiredFailure(error: Exception): Boolean {
    if (error is MediaUploadTransferSessionExpiredException) {
        return true
    }
    if (error is CloudRemoteException) {
        return error.errorCode == "MEDIA_ASSET_UPLOAD_SESSION_EXPIRED"
    }
    if (error is SignedPutUploadHttpException) {
        val responseBody: String = error.responseBody.lowercase()
        return error.statusCode == 403 &&
            (responseBody.contains("expired") || responseBody.contains("request has expired"))
    }
    return false
}

private fun isPermanentMediaUploadFailure(error: Exception): Boolean {
    if (isMediaUploadSessionExpiredFailure(error = error)) {
        return false
    }
    if (error is MediaUploadTransferPermanentException) {
        return true
    }
    if (error is MediaUploadCompletionTerminalException) {
        return true
    }
    if (error is CloudContractMismatchException) {
        return true
    }
    if (error is IllegalArgumentException) {
        return true
    }
    if (error is CloudRemoteException) {
        if (error.errorCode == mediaUploadReplicaInvalidErrorCode) {
            return false
        }
        val statusCode: Int = error.statusCode ?: return false
        return isRetryableHttpStatusCode(statusCode = statusCode).not()
    }
    if (error is SignedPutUploadHttpException) {
        return error.retryEligible.not()
    }
    return false
}

private fun calculateRetryDelayMillis(attemptCount: Int): Long {
    val failedAttemptCount: Int = attemptCount + 1
    val exponent: Int = minOf(failedAttemptCount - 1, mediaUploadRetryMaxExponent)
    val multiplier: Long = 1L shl exponent
    return minOf(mediaUploadRetryBaseDelayMillis * multiplier, mediaUploadRetryMaxDelayMillis)
}

private fun renderMediaUploadError(error: Exception): String {
    val message = error.message ?: error::class.java.simpleName
    val suppressedMessages: List<String> = error.suppressed.map { suppressed ->
        suppressed.message ?: suppressed::class.java.simpleName
    }
    val fullMessage = if (suppressedMessages.isEmpty()) {
        message
    } else {
        "$message Suppressed=${suppressedMessages.joinToString(separator = " | ")}"
    }
    return fullMessage.take(n = mediaUploadErrorMessageLimit)
}

private fun encodeDigestHex(bytes: ByteArray): String {
    val hexChars = "0123456789abcdef".toCharArray()
    val result = CharArray(size = bytes.size * 2)
    bytes.forEachIndexed { index, byte ->
        val value: Int = byte.toInt() and 0xff
        result[index * 2] = hexChars[value ushr 4]
        result[(index * 2) + 1] = hexChars[value and 0x0f]
    }
    return String(result)
}
