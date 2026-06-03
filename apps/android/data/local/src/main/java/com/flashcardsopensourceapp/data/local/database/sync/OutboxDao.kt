package com.flashcardsopensourceapp.data.local.database.sync

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.OutboxEntryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutboxEntries(entries: List<OutboxEntryEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutboxEntry(entry: OutboxEntryEntity)

    @Query("SELECT COUNT(*) FROM outbox_entries")
    fun observeOutboxEntriesCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM outbox_entries")
    suspend fun countOutboxEntries(): Int

    @Query("SELECT COUNT(*) FROM outbox_entries WHERE workspaceId = :workspaceId")
    suspend fun countOutboxEntriesForWorkspace(workspaceId: String): Int

    @Query("SELECT * FROM outbox_entries WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC, rowid ASC LIMIT :limit")
    suspend fun loadOutboxEntries(workspaceId: String, limit: Int): List<OutboxEntryEntity>

    @Query("SELECT * FROM outbox_entries WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC, rowid ASC")
    suspend fun loadAllOutboxEntries(workspaceId: String): List<OutboxEntryEntity>

    @Query(
        """
        SELECT * FROM outbox_entries
        WHERE workspaceId = :workspaceId
            AND entityType = 'review_event'
            AND operationType = 'append'
        ORDER BY createdAtMillis ASC, rowid ASC
        """
    )
    suspend fun loadPendingReviewEventOutboxEntries(workspaceId: String): List<OutboxEntryEntity>

    @Query(
        """
        SELECT * FROM outbox_entries
        WHERE entityType = 'review_event'
            AND operationType = 'append'
        ORDER BY createdAtMillis ASC, rowid ASC
        """
    )
    fun observePendingReviewEventOutboxEntries(): Flow<List<OutboxEntryEntity>>

    @Query(
        """
        SELECT * FROM outbox_entries
        WHERE entityType = 'card'
            AND operationType = 'upsert'
            AND affectsReviewSchedule = 1
        ORDER BY workspaceId ASC, createdAtMillis ASC, rowid ASC
        """
    )
    fun observePendingReviewScheduleCardUpsertOutboxEntries(): Flow<List<OutboxEntryEntity>>

    @Query("DELETE FROM outbox_entries WHERE workspaceId = :workspaceId")
    suspend fun deleteOutboxEntriesForWorkspace(workspaceId: String)

    @Query("DELETE FROM outbox_entries WHERE outboxEntryId IN (:operationIds)")
    suspend fun deleteOutboxEntries(operationIds: List<String>)

    @Query(
        """
        UPDATE outbox_entries
        SET attemptCount = attemptCount + 1, lastError = :errorMessage
        WHERE outboxEntryId IN (:operationIds)
        """
    )
    suspend fun markOutboxEntriesFailed(operationIds: List<String>, errorMessage: String)

}
