package com.flashcardsopensourceapp.data.local.database.media

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity
import kotlinx.coroutines.flow.Flow

data class LocalSyncDiagnosticsMediaBlobAggregate(
    val localMediaBlobs: Int,
    val localMediaBytes: Long,
    val latestCacheWriteAtMillis: Long?
)

data class LocalSyncDiagnosticsMediaTransferAggregate(
    val pendingMediaUploads: Int,
    val failedMediaUploads: Int,
    val oldestPendingMediaTransferAtMillis: Long?,
    val latestMediaUploadSuccessAtMillis: Long?,
    val latestMediaTransferError: String?
)

data class LocalSyncDiagnosticsMediaTransferProblemRow(
    val transferId: String,
    val mediaAssetId: String,
    val kind: String,
    val status: String,
    val createdAtMillis: Long,
    val attemptCount: Int,
    val lastError: String?
)

@Dao
interface MediaTransferDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMediaBlobCache(mediaBlobCache: MediaBlobCacheEntity)

    @Query("SELECT * FROM media_blob_cache WHERE sha256 = :sha256 LIMIT 1")
    suspend fun loadMediaBlobCache(sha256: String): MediaBlobCacheEntity?

    @Query(
        """
        SELECT
            COUNT(*) AS localMediaBlobs,
            COALESCE(SUM(sizeBytes), 0) AS localMediaBytes,
            MAX(createdAtMillis) AS latestCacheWriteAtMillis
        FROM media_blob_cache
        """
    )
    fun observeLocalSyncDiagnosticsMediaBlobAggregate(): Flow<LocalSyncDiagnosticsMediaBlobAggregate>

    @Query(
        """
        SELECT * FROM media_blob_cache
        WHERE sourceMediaAssetId = :mediaAssetId
        ORDER BY lastAccessedAtMillis DESC, sha256 ASC
        """
    )
    suspend fun loadMediaBlobCachesForMediaAsset(mediaAssetId: String): List<MediaBlobCacheEntity>

    @Query(
        """
        UPDATE media_blob_cache
        SET lastAccessedAtMillis = :lastAccessedAtMillis
        WHERE sha256 = :sha256
        """
    )
    suspend fun updateMediaBlobCacheLastAccessed(
        sha256: String,
        lastAccessedAtMillis: Long
    )

    @Query("DELETE FROM media_blob_cache WHERE sha256 = :sha256")
    suspend fun deleteMediaBlobCache(sha256: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMediaTransfer(mediaTransfer: MediaTransferQueueEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMediaTransfers(mediaTransfers: List<MediaTransferQueueEntity>)

    @Query("SELECT * FROM media_transfer_queue WHERE transferId = :transferId LIMIT 1")
    suspend fun loadMediaTransfer(transferId: String): MediaTransferQueueEntity?

    @Query(
        """
        SELECT EXISTS(
            SELECT 1 FROM media_transfer_queue
            WHERE workspaceId = :workspaceId
                AND mediaAssetId = :mediaAssetId
                AND sha256 = :sha256
                AND kind = :kind
                AND status IN (:statuses)
        )
        """
    )
    suspend fun hasMediaTransferForMediaAsset(
        workspaceId: String,
        mediaAssetId: String,
        sha256: String,
        kind: String,
        statuses: List<String>
    ): Boolean

    @Query(
        """
        SELECT
            COUNT(
                CASE
                    WHEN kind = :uploadKind
                        AND (status = :queuedStatus OR status = :inProgressStatus)
                    THEN 1
                END
            ) AS pendingMediaUploads,
            COUNT(
                CASE
                    WHEN kind = :uploadKind
                        AND status = :failedStatus
                    THEN 1
                END
            ) AS failedMediaUploads,
            MIN(
                CASE
                    WHEN kind = :uploadKind
                        AND (status = :queuedStatus OR status = :inProgressStatus)
                    THEN createdAtMillis
                END
            ) AS oldestPendingMediaTransferAtMillis,
            MAX(
                CASE
                    WHEN kind = :uploadKind
                        AND status = :succeededStatus
                    THEN updatedAtMillis
                END
            ) AS latestMediaUploadSuccessAtMillis,
            (
                SELECT recent.lastError
                FROM media_transfer_queue AS recent
                WHERE recent.workspaceId = :workspaceId
                    AND recent.lastError IS NOT NULL
                    AND recent.lastError != ''
                ORDER BY recent.updatedAtMillis DESC, recent.transferId ASC
                LIMIT 1
            ) AS latestMediaTransferError
        FROM media_transfer_queue
        WHERE workspaceId = :workspaceId
        """
    )
    fun observeLocalSyncDiagnosticsMediaTransferAggregate(
        workspaceId: String,
        uploadKind: String,
        queuedStatus: String,
        inProgressStatus: String,
        failedStatus: String,
        succeededStatus: String
    ): Flow<LocalSyncDiagnosticsMediaTransferAggregate>

    @Query(
        """
        SELECT transferId, mediaAssetId, kind, status, createdAtMillis, attemptCount, lastError
        FROM media_transfer_queue
        WHERE workspaceId = :workspaceId
            AND kind = :kind
            AND status = :failedStatus
        ORDER BY updatedAtMillis DESC, transferId ASC
        LIMIT :limit
        """
    )
    fun observeLocalSyncDiagnosticsMediaTransferProblemRows(
        workspaceId: String,
        kind: String,
        failedStatus: String,
        limit: Int
    ): Flow<List<LocalSyncDiagnosticsMediaTransferProblemRow>>

    @Query(
        """
        SELECT * FROM media_transfer_queue
        WHERE workspaceId = :workspaceId
            AND status = :status
            AND nextAttemptAtMillis <= :nowMillis
        ORDER BY nextAttemptAtMillis ASC, createdAtMillis ASC, transferId ASC
        LIMIT :limit
        """
    )
    suspend fun loadDueMediaTransfers(
        workspaceId: String,
        status: String,
        nowMillis: Long,
        limit: Int
    ): List<MediaTransferQueueEntity>

    @Query(
        """
        SELECT * FROM media_transfer_queue
        WHERE workspaceId = :workspaceId
            AND kind = :kind
            AND status = :status
            AND nextAttemptAtMillis <= :nowMillis
        ORDER BY nextAttemptAtMillis ASC, createdAtMillis ASC, transferId ASC
        LIMIT :limit
        """
    )
    suspend fun loadDueMediaTransfersByKind(
        workspaceId: String,
        kind: String,
        status: String,
        nowMillis: Long,
        limit: Int
    ): List<MediaTransferQueueEntity>

    @Query(
        """
        SELECT MIN(nextAttemptAtMillis) FROM media_transfer_queue
        WHERE workspaceId = :workspaceId
            AND kind = :kind
            AND status = :status
        """
    )
    suspend fun loadNextMediaTransferAttemptAtMillis(
        workspaceId: String,
        kind: String,
        status: String
    ): Long?

    @Query(
        """
        UPDATE media_transfer_queue
        SET status = :claimedStatus,
            updatedAtMillis = :updatedAtMillis
        WHERE transferId = :transferId
            AND workspaceId = :workspaceId
            AND kind = :kind
            AND status = :expectedStatus
            AND nextAttemptAtMillis <= :nowMillis
        """
    )
    suspend fun claimDueMediaTransfer(
        transferId: String,
        workspaceId: String,
        kind: String,
        expectedStatus: String,
        claimedStatus: String,
        nowMillis: Long,
        updatedAtMillis: Long
    ): Int

    @Query(
        """
        UPDATE media_transfer_queue
        SET status = :queuedStatus,
            nextAttemptAtMillis = :nextAttemptAtMillis,
            lastError = :lastError,
            updatedAtMillis = :updatedAtMillis
        WHERE workspaceId = :workspaceId
            AND kind = :kind
            AND status = :inProgressStatus
        """
    )
    suspend fun resetInProgressMediaTransfersByKind(
        workspaceId: String,
        kind: String,
        inProgressStatus: String,
        queuedStatus: String,
        nextAttemptAtMillis: Long,
        lastError: String,
        updatedAtMillis: Long
    ): Int

    @Query(
        """
        UPDATE media_transfer_queue
        SET status = :status,
            lastError = :lastError,
            updatedAtMillis = :updatedAtMillis
        WHERE transferId = :transferId
        """
    )
    suspend fun updateMediaTransferStatus(
        transferId: String,
        status: String,
        lastError: String?,
        updatedAtMillis: Long
    )

    @Query(
        """
        UPDATE media_transfer_queue
        SET status = :status,
            lastError = :lastError,
            updatedAtMillis = :updatedAtMillis
        WHERE transferId = :transferId
            AND status != :succeededStatus
        """
    )
    suspend fun markMediaTransferPermanentlyFailed(
        transferId: String,
        status: String,
        succeededStatus: String,
        lastError: String,
        updatedAtMillis: Long
    )

    @Query(
        """
        UPDATE media_transfer_queue
        SET status = :status,
            attemptCount = attemptCount + 1,
            nextAttemptAtMillis = :nextAttemptAtMillis,
            lastError = :lastError,
            updatedAtMillis = :updatedAtMillis
        WHERE transferId = :transferId
            AND status != :succeededStatus
        """
    )
    suspend fun markMediaTransferAttemptFailed(
        transferId: String,
        status: String,
        succeededStatus: String,
        nextAttemptAtMillis: Long,
        lastError: String,
        updatedAtMillis: Long
    )

    @Query("DELETE FROM media_transfer_queue WHERE transferId = :transferId")
    suspend fun deleteMediaTransfer(transferId: String)

    @Query(
        """
        SELECT * FROM media_transfer_queue
        WHERE workspaceId = :workspaceId
        ORDER BY createdAtMillis ASC, transferId ASC
        """
    )
    suspend fun loadMediaTransfersForWorkspace(workspaceId: String): List<MediaTransferQueueEntity>

    @Query("DELETE FROM media_transfer_queue WHERE workspaceId = :workspaceId")
    suspend fun deleteMediaTransfersForWorkspace(workspaceId: String)
}
