package com.flashcardsopensourceapp.data.local.database.progress

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLeaderboardCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSeriesCacheEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressSummaryCacheEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ProgressRemoteCacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressSummaryCache(entry: ProgressSummaryCacheEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressSeriesCache(entry: ProgressSeriesCacheEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressReviewScheduleCache(entry: ProgressReviewScheduleCacheEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressLeaderboardCache(entry: ProgressLeaderboardCacheEntity)

    @Query("SELECT * FROM progress_summary_cache ORDER BY updatedAtMillis DESC, scopeKey DESC")
    fun observeProgressSummaryCaches(): Flow<List<ProgressSummaryCacheEntity>>

    @Query("SELECT * FROM progress_series_cache ORDER BY updatedAtMillis DESC, scopeKey DESC")
    fun observeProgressSeriesCaches(): Flow<List<ProgressSeriesCacheEntity>>

    @Query("SELECT * FROM progress_review_schedule_cache ORDER BY updatedAtMillis DESC, scopeKey DESC")
    fun observeProgressReviewScheduleCaches(): Flow<List<ProgressReviewScheduleCacheEntity>>

    @Query("SELECT * FROM progress_leaderboard_cache ORDER BY updatedAtMillis DESC, scopeKey DESC")
    fun observeProgressLeaderboardCaches(): Flow<List<ProgressLeaderboardCacheEntity>>

    @Query("DELETE FROM progress_leaderboard_cache")
    suspend fun deleteAllProgressLeaderboardCaches()
}
