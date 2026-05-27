package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

data class ReviewEffortCountRow(
    val effortLevel: com.flashcardsopensourceapp.data.local.model.EffortLevel,
    val totalCount: Int
)

data class ReviewTagCountRow(
    val tag: String,
    val totalCount: Int
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
            AND effortLevel IN (:effortLevels)
        """
    )
    fun observeReviewTotalCountByEffortLevels(
        workspaceId: String,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>
    ): Flow<Int>

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
            AND effortLevel IN (:effortLevels)
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
    fun observeReviewTotalCountByEffortLevelsAndAnyTags(
        workspaceId: String,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>,
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
            AND effortLevel IN (:effortLevels)
        """
    )
    fun observeReviewDueCountByEffortLevels(
        workspaceId: String,
        nowMillis: Long,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>
    ): Flow<Int>

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
            AND effortLevel IN (:effortLevels)
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
    fun observeReviewDueCountByEffortLevelsAndAnyTags(
        workspaceId: String,
        nowMillis: Long,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>,
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
            AND effortLevel IN (:effortLevels)
        """
    )
    suspend fun countReviewDueCardsByEffortLevels(
        workspaceId: String,
        nowMillis: Long,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>
    ): Int

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
        SELECT COUNT(*) FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
            AND effortLevel IN (:effortLevels)
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
    suspend fun countReviewDueCardsByEffortLevelsAndAnyTags(
        workspaceId: String,
        nowMillis: Long,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>,
        tagNames: List<String>
    ): Int

    @Query(
        """
        SELECT effortLevel, COUNT(*) AS totalCount
        FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
        GROUP BY effortLevel
        """
    )
    fun observeReviewEffortDueCounts(workspaceId: String, nowMillis: Long): Flow<List<ReviewEffortCountRow>>

    @Query(
        """
        SELECT tags.name AS tag, COUNT(DISTINCT cards.cardId) AS totalCount
        FROM cards
        INNER JOIN card_tags ON card_tags.cardId = cards.cardId
        INNER JOIN tags ON tags.tagId = card_tags.tagId
        WHERE cards.workspaceId = :workspaceId
            AND tags.workspaceId = cards.workspaceId
            AND cards.deletedAtMillis IS NULL
            AND (cards.dueAtMillis IS NULL OR cards.dueAtMillis <= :nowMillis)
        GROUP BY tags.name
        """
    )
    fun observeReviewTagDueCounts(workspaceId: String, nowMillis: Long): Flow<List<ReviewTagCountRow>>
}
