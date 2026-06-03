package com.flashcardsopensourceapp.data.local.database.progress

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalCacheStateEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressLocalDayCountEntity
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewHistoryStateEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ProgressLocalCacheDao {
    @Query("SELECT * FROM progress_local_day_counts ORDER BY timeZone ASC, workspaceId ASC, localDate ASC")
    fun observeProgressLocalDayCounts(): Flow<List<ProgressLocalDayCountEntity>>

    @Query(
        """
        SELECT * FROM progress_local_day_counts
        WHERE timeZone = :timeZone AND workspaceId = :workspaceId AND localDate = :localDate
        LIMIT 1
        """
    )
    suspend fun loadProgressLocalDayCount(
        timeZone: String,
        workspaceId: String,
        localDate: String
    ): ProgressLocalDayCountEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressLocalDayCount(entry: ProgressLocalDayCountEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressLocalDayCounts(entries: List<ProgressLocalDayCountEntity>)

    @Query(
        """
        DELETE FROM progress_local_day_counts
        WHERE timeZone = :timeZone AND workspaceId = :workspaceId
        """
    )
    suspend fun deleteProgressLocalDayCounts(
        timeZone: String,
        workspaceId: String
    )

    @Query("DELETE FROM progress_local_day_counts WHERE timeZone = :timeZone")
    suspend fun deleteProgressLocalDayCounts(timeZone: String)

    @Query("DELETE FROM progress_local_day_counts")
    suspend fun deleteAllProgressLocalDayCounts()

    @Query(
        """
        UPDATE progress_local_day_counts
        SET workspaceId = :newWorkspaceId
        WHERE workspaceId = :oldWorkspaceId
        """
    )
    suspend fun reassignWorkspaceProgressLocalDayCounts(
        oldWorkspaceId: String,
        newWorkspaceId: String
    )

    @Query("SELECT * FROM progress_review_history_state ORDER BY workspaceId ASC")
    fun observeProgressReviewHistoryStates(): Flow<List<ProgressReviewHistoryStateEntity>>

    @Query("SELECT * FROM progress_review_history_state ORDER BY workspaceId ASC")
    suspend fun loadProgressReviewHistoryStates(): List<ProgressReviewHistoryStateEntity>

    @Query("SELECT * FROM progress_review_history_state WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadProgressReviewHistoryState(workspaceId: String): ProgressReviewHistoryStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressReviewHistoryState(entry: ProgressReviewHistoryStateEntity)

    @Query("DELETE FROM progress_review_history_state WHERE workspaceId = :workspaceId")
    suspend fun deleteProgressReviewHistoryState(workspaceId: String)

    @Query("DELETE FROM progress_review_history_state")
    suspend fun deleteAllProgressReviewHistoryStates()

    @Query(
        """
        UPDATE progress_review_history_state
        SET workspaceId = :newWorkspaceId
        WHERE workspaceId = :oldWorkspaceId
        """
    )
    suspend fun reassignProgressReviewHistoryState(
        oldWorkspaceId: String,
        newWorkspaceId: String
    )

    @Query("SELECT * FROM progress_local_cache_state ORDER BY timeZone ASC, workspaceId ASC")
    fun observeProgressLocalCacheStates(): Flow<List<ProgressLocalCacheStateEntity>>

    @Query(
        """
        SELECT * FROM progress_local_cache_state
        WHERE timeZone = :timeZone AND workspaceId = :workspaceId
        LIMIT 1
        """
    )
    suspend fun loadProgressLocalCacheState(
        timeZone: String,
        workspaceId: String
    ): ProgressLocalCacheStateEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressLocalCacheState(entry: ProgressLocalCacheStateEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProgressLocalCacheStates(entries: List<ProgressLocalCacheStateEntity>)

    @Query(
        """
        DELETE FROM progress_local_cache_state
        WHERE timeZone = :timeZone AND workspaceId = :workspaceId
        """
    )
    suspend fun deleteProgressLocalCacheState(
        timeZone: String,
        workspaceId: String
    )

    @Query("DELETE FROM progress_local_cache_state WHERE timeZone = :timeZone")
    suspend fun deleteProgressLocalCacheStates(timeZone: String)

    @Query("DELETE FROM progress_local_cache_state")
    suspend fun deleteAllProgressLocalCacheStates()

    @Query(
        """
        UPDATE progress_local_cache_state
        SET workspaceId = :newWorkspaceId
        WHERE workspaceId = :oldWorkspaceId
        """
    )
    suspend fun reassignProgressLocalCacheStates(
        oldWorkspaceId: String,
        newWorkspaceId: String
    )
}
