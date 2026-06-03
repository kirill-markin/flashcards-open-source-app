package com.flashcardsopensourceapp.data.local.database.sync

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.SyncStateEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface SyncStateDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSyncState(syncState: SyncStateEntity)

    @Query("SELECT * FROM sync_state WHERE workspaceId = :workspaceId LIMIT 1")
    fun observeSyncState(workspaceId: String): Flow<SyncStateEntity?>

    @Query("SELECT * FROM sync_state WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadSyncState(workspaceId: String): SyncStateEntity?

    @Query("SELECT * FROM sync_state ORDER BY workspaceId ASC")
    fun observeSyncStates(): Flow<List<SyncStateEntity>>

    @Query("DELETE FROM sync_state")
    suspend fun deleteAllSyncState()

    @Query("DELETE FROM sync_state WHERE workspaceId = :workspaceId")
    suspend fun deleteSyncState(workspaceId: String)

    @Query("UPDATE sync_state SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)

    @Query(
        """
        UPDATE sync_state
        SET lastSyncError = NULL, blockedInstallationId = NULL
        WHERE blockedInstallationId IS NOT NULL
        """
    )
    suspend fun clearBlockedSyncState()
}
