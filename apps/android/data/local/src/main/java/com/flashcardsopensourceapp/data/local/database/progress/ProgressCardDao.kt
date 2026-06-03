package com.flashcardsopensourceapp.data.local.database.progress

import androidx.room.Dao
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.ProgressReviewScheduleCardDueEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ProgressCardDao {
    @Query(
        """
        SELECT cardId, workspaceId, dueAtMillis
        FROM cards
        WHERE deletedAtMillis IS NULL
        ORDER BY workspaceId ASC, dueAtMillis ASC, cardId ASC
        """
    )
    fun observeProgressReviewScheduleCardDueDates(): Flow<List<ProgressReviewScheduleCardDueEntity>>
}
