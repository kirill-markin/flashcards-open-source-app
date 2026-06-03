package com.flashcardsopensourceapp.data.local.database.cards

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceSchedulerSettingsEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface WorkspaceSchedulerSettingsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWorkspaceSchedulerSettings(settings: WorkspaceSchedulerSettingsEntity)

    @Update
    suspend fun updateWorkspaceSchedulerSettings(settings: WorkspaceSchedulerSettingsEntity)

    @Query("SELECT * FROM workspace_scheduler_settings WHERE workspaceId = :workspaceId LIMIT 1")
    fun observeWorkspaceSchedulerSettings(workspaceId: String): Flow<WorkspaceSchedulerSettingsEntity?>

    @Query("SELECT * FROM workspace_scheduler_settings WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadWorkspaceSchedulerSettings(workspaceId: String): WorkspaceSchedulerSettingsEntity?

    @Query("UPDATE workspace_scheduler_settings SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}
