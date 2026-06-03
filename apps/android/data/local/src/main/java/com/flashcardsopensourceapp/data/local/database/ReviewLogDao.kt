package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface ReviewLogDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertReviewLog(reviewLog: ReviewLogEntity)

    @Query("SELECT * FROM review_logs")
    fun observeReviewLogs(): Flow<List<ReviewLogEntity>>

    @Query("SELECT COUNT(*) FROM review_logs")
    suspend fun countReviewLogs(): Int

    @Query("SELECT COUNT(*) FROM review_logs WHERE workspaceId = :workspaceId")
    suspend fun countReviewLogs(workspaceId: String): Int

    @Query(
        """
        SELECT COUNT(*)
        FROM review_logs
        WHERE workspaceId = :workspaceId
            AND reviewedAtMillis >= :startMillis
            AND reviewedAtMillis < :endMillis
        """
    )
    suspend fun countReviewLogsBetween(workspaceId: String, startMillis: Long, endMillis: Long): Int

    @Query(
        """
        SELECT EXISTS(
            SELECT 1
            FROM review_logs
            WHERE reviewedAtMillis >= :startMillis
                AND reviewedAtMillis < :endMillis
            LIMIT 1
        )
        """
    )
    suspend fun hasReviewLogsBetween(startMillis: Long, endMillis: Long): Boolean

    @Query(
        """
        SELECT EXISTS(
            SELECT 1
            FROM review_logs
            WHERE workspaceId = :workspaceId
                AND reviewedAtMillis < :beforeMillis
            LIMIT 1
        )
        """
    )
    suspend fun hasReviewLogsBefore(workspaceId: String, beforeMillis: Long): Boolean

    @Query(
        """
        SELECT EXISTS(
            SELECT 1
            FROM review_logs
            WHERE reviewedAtMillis < :endMillis
            LIMIT 1
        )
        """
    )
    suspend fun hasReviewLogsBefore(endMillis: Long): Boolean

    @Query(
        """
        SELECT COUNT(*)
        FROM review_logs
        WHERE reviewedAtMillis >= :startMillis
            AND reviewedAtMillis < :endMillis
        """
    )
    suspend fun countReviewLogsBetween(startMillis: Long, endMillis: Long): Int

    @Query("SELECT * FROM review_logs ORDER BY reviewedAtMillis DESC")
    suspend fun loadReviewLogs(): List<ReviewLogEntity>

    @Query("SELECT * FROM review_logs WHERE reviewLogId IN (:reviewLogIds)")
    suspend fun loadReviewLogs(reviewLogIds: List<String>): List<ReviewLogEntity>

    @Query("SELECT * FROM review_logs WHERE reviewLogId = :reviewLogId LIMIT 1")
    suspend fun loadReviewLog(reviewLogId: String): ReviewLogEntity?

    @Query("SELECT * FROM review_logs WHERE workspaceId = :workspaceId ORDER BY reviewedAtMillis DESC")
    suspend fun loadReviewLogs(workspaceId: String): List<ReviewLogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReviewLogs(reviewLogs: List<ReviewLogEntity>)

    @Query("UPDATE review_logs SET cardId = :newCardId WHERE workspaceId = :workspaceId AND cardId = :oldCardId")
    suspend fun reassignReviewLogsToCard(workspaceId: String, oldCardId: String, newCardId: String)

    @Query("DELETE FROM review_logs WHERE reviewLogId IN (:reviewLogIds)")
    suspend fun deleteReviewLogs(reviewLogIds: List<String>)

    @Query("DELETE FROM review_logs")
    suspend fun deleteAllReviewLogs()

    @Query("UPDATE review_logs SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}
