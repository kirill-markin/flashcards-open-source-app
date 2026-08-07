package com.flashcardsopensourceapp.data.local.database.media

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity
import kotlinx.coroutines.flow.Flow

data class LocalSyncDiagnosticsMediaAssetCounts(
    val localActiveMediaAssets: Int,
    val deletedMediaAssets: Int
)

data class LocalSyncDiagnosticsMediaAssetIdRow(
    val mediaAssetId: String
)

data class LocalSyncDiagnosticsMissingMediaBlobRow(
    val mediaAssetId: String,
    val sha256: String
)

@Dao
interface MediaAssetDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMediaAsset(mediaAsset: MediaAssetEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMediaAssets(mediaAssets: List<MediaAssetEntity>)

    @Query("DELETE FROM media_assets WHERE mediaAssetId = :mediaAssetId")
    suspend fun deleteMediaAsset(mediaAssetId: String)

    @Query("SELECT * FROM media_assets WHERE mediaAssetId = :mediaAssetId LIMIT 1")
    suspend fun loadMediaAsset(mediaAssetId: String): MediaAssetEntity?

    @Query("SELECT * FROM media_assets WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC, mediaAssetId ASC")
    suspend fun loadMediaAssets(workspaceId: String): List<MediaAssetEntity>

    @Query("SELECT * FROM media_assets WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC, mediaAssetId ASC")
    fun observeMediaAssets(workspaceId: String): Flow<List<MediaAssetEntity>>

    @Query(
        """
        SELECT
            COUNT(CASE WHEN deletedAtMillis IS NULL THEN 1 END) AS localActiveMediaAssets,
            COUNT(CASE WHEN deletedAtMillis IS NOT NULL THEN 1 END) AS deletedMediaAssets
        FROM media_assets
        WHERE workspaceId = :workspaceId
        """
    )
    fun observeLocalSyncDiagnosticsMediaAssetCounts(workspaceId: String): Flow<LocalSyncDiagnosticsMediaAssetCounts>

    @Query(
        """
        SELECT mediaAssetId
        FROM media_assets
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
        ORDER BY mediaAssetId ASC
        """
    )
    fun observeLocalSyncDiagnosticsActiveMediaAssetIds(
        workspaceId: String
    ): Flow<List<LocalSyncDiagnosticsMediaAssetIdRow>>

    @Query(
        """
        SELECT COUNT(*)
        FROM media_assets
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM media_blob_cache
                WHERE media_blob_cache.sha256 = media_assets.sha256
            )
        """
    )
    fun observeLocalSyncDiagnosticsAssetsMissingLocalBlobCount(workspaceId: String): Flow<Int>

    @Query(
        """
        SELECT mediaAssetId, sha256
        FROM media_assets
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND NOT EXISTS (
                SELECT 1 FROM media_blob_cache
                WHERE media_blob_cache.sha256 = media_assets.sha256
            )
        ORDER BY updatedAtMillis DESC, mediaAssetId ASC
        LIMIT :limit
        """
    )
    fun observeLocalSyncDiagnosticsMissingMediaBlobRows(
        workspaceId: String,
        limit: Int
    ): Flow<List<LocalSyncDiagnosticsMissingMediaBlobRow>>
}
