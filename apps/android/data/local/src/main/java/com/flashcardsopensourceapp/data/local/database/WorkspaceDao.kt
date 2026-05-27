package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface WorkspaceDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertWorkspace(workspace: WorkspaceEntity)

    @Query("SELECT COUNT(*) FROM workspaces")
    suspend fun countWorkspaces(): Int

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis DESC, workspaceId DESC")
    fun observeWorkspaces(): Flow<List<WorkspaceEntity>>

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis DESC, workspaceId DESC")
    suspend fun loadWorkspaces(): List<WorkspaceEntity>

    @Query("SELECT * FROM workspaces WHERE workspaceId = :workspaceId LIMIT 1")
    fun observeWorkspaceById(workspaceId: String): Flow<WorkspaceEntity?>

    @Query("SELECT * FROM workspaces WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadWorkspaceById(workspaceId: String): WorkspaceEntity?

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis ASC, workspaceId ASC LIMIT 1")
    fun observeAnyWorkspace(): Flow<WorkspaceEntity?>

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis ASC, workspaceId ASC LIMIT 1")
    suspend fun loadAnyWorkspace(): WorkspaceEntity?

    @Update
    suspend fun updateWorkspace(workspace: WorkspaceEntity)

    @Query("DELETE FROM workspaces")
    suspend fun deleteAllWorkspaces()

    @Query("DELETE FROM workspaces WHERE workspaceId = :workspaceId")
    suspend fun deleteWorkspace(workspaceId: String)
}
