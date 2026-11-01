package com.flashcardsopensourceapp.data.local.database.review

import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

data class ReviewTagCardRow(
    val tag: String,
    val cardId: String
)

data class ReviewOverdueCountRow(
    val overdueCount: Int,
    val nextDueAtMillis: Long?
)

@Dao
interface ReviewCountDao {
    @Query(
        """
        SELECT COUNT(*) FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
        """
    )
    fun observeReviewTotalCount(workspaceId: String): Flow<Int>

    @Query(
        """
        SELECT COUNT(*) FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        """
    )
    fun observeReviewTotalCountByAnyTags(
        workspaceId: String,
        tagNames: List<String>
    ): Flow<Int>

    @Query(
        """
        SELECT COUNT(*) FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
        """
    )
    fun observeReviewDueCount(workspaceId: String, nowMillis: Long): Flow<Int>

    @Query(
        """
        SELECT COUNT(*) FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        """
    )
    fun observeReviewDueCountByAnyTags(
        workspaceId: String,
        nowMillis: Long,
        tagNames: List<String>
    ): Flow<Int>

    @Query(
        """
        SELECT COUNT(*) FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
        """
    )
    suspend fun countReviewDueCards(workspaceId: String, nowMillis: Long): Int

    @Query(
        """
        SELECT COUNT(*) FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        """
    )
    suspend fun countReviewDueCardsByAnyTags(
        workspaceId: String,
        nowMillis: Long,
        tagNames: List<String>
    ): Int

    // New cards (dueAtMillis IS NULL) are never overdue.
    @Query(
        """
        SELECT
            COUNT(CASE WHEN dueAtMillis <= :nowMillis THEN 1 END) AS overdueCount,
            MIN(CASE WHEN dueAtMillis > :nowMillis THEN dueAtMillis END) AS nextDueAtMillis
        FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NOT NULL
        """
    )
    fun observeReviewOverdueCount(workspaceId: String, nowMillis: Long): Flow<ReviewOverdueCountRow>

    @Query(
        """
        SELECT
            COUNT(CASE WHEN dueAtMillis <= :nowMillis THEN 1 END) AS overdueCount,
            MIN(CASE WHEN dueAtMillis > :nowMillis THEN dueAtMillis END) AS nextDueAtMillis
        FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NOT NULL
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        """
    )
    fun observeReviewOverdueCountByAnyTags(
        workspaceId: String,
        nowMillis: Long,
        tagNames: List<String>
    ): Flow<ReviewOverdueCountRow>

    @Query(
        """
        SELECT DISTINCT tags.name AS tag, cards.cardId AS cardId
        FROM cards
        INNER JOIN card_tags ON card_tags.cardId = cards.cardId
        INNER JOIN tags ON tags.tagId = card_tags.tagId
        WHERE cards.workspaceId = :workspaceId
            AND tags.workspaceId = cards.workspaceId
            AND cards.deletedAtMillis IS NULL
            AND (cards.dueAtMillis IS NULL OR cards.dueAtMillis <= :nowMillis)
        """
    )
    fun observeReviewTagDueCards(workspaceId: String, nowMillis: Long): Flow<List<ReviewTagCardRow>>
}
