package com.flashcardsopensourceapp.data.local.database.review

import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

data class ReviewTagCardRow(
    val tag: String,
    val cardId: String
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
