package com.flashcardsopensourceapp.data.local.database.media

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.MediaAssetEntity

@Dao
interface MediaAssetDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertMediaAsset(mediaAsset: MediaAssetEntity)

    @Query("SELECT * FROM media_assets WHERE mediaAssetId = :mediaAssetId LIMIT 1")
    suspend fun loadMediaAsset(mediaAssetId: String): MediaAssetEntity?

    @Query("SELECT * FROM media_assets WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC, mediaAssetId ASC")
    suspend fun loadMediaAssets(workspaceId: String): List<MediaAssetEntity>

    @Query("SELECT COUNT(*) FROM media_assets WHERE workspaceId = :workspaceId")
    suspend fun countMediaAssets(workspaceId: String): Int
}
