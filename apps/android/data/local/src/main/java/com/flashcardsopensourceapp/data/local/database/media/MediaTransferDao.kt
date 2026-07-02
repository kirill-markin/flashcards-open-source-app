package com.flashcardsopensourceapp.data.local.database.media

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.MediaBlobCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.MediaTransferQueueEntity

@Dao
interface MediaTransferDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertMediaBlobCache(mediaBlobCache: MediaBlobCacheEntity)

    @Query("SELECT * FROM media_blob_cache WHERE sha256 = :sha256 LIMIT 1")
    suspend fun loadMediaBlobCache(sha256: String): MediaBlobCacheEntity?

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
        UPDATE media_transfer_queue
        SET status = :claimedStatus,
            updatedAtMillis = :updatedAtMillis
        WHERE transferId IN (:transferIds)
            AND status = :expectedStatus
        """
    )
    suspend fun markMediaTransfersClaimed(
        transferIds: List<String>,
        expectedStatus: String,
        claimedStatus: String,
        updatedAtMillis: Long
    )

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
            attemptCount = attemptCount + 1,
            nextAttemptAtMillis = :nextAttemptAtMillis,
            lastError = :lastError,
            updatedAtMillis = :updatedAtMillis
        WHERE transferId = :transferId
        """
    )
    suspend fun markMediaTransferAttemptFailed(
        transferId: String,
        status: String,
        nextAttemptAtMillis: Long,
        lastError: String,
        updatedAtMillis: Long
    )

    @Query("DELETE FROM media_transfer_queue WHERE transferId = :transferId")
    suspend fun deleteMediaTransfer(transferId: String)

    @Query("DELETE FROM media_transfer_queue WHERE workspaceId = :workspaceId")
    suspend fun deleteMediaTransfersForWorkspace(workspaceId: String)
}
