package com.flashcardsopensourceapp.data.local.database.review

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import com.flashcardsopensourceapp.data.local.database.entities.CardWithRelations
import kotlinx.coroutines.flow.Flow

@Dao
interface ReviewQueueDao {
    @Transaction
    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NOT NULL
            AND dueAtMillis <= :nowMillis
            AND fsrsLastReviewedAtMillis IS NOT NULL
            AND fsrsLastReviewedAtMillis >= :cutoffMillis
            AND fsrsLastReviewedAtMillis <= :nowMillis
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeRecentlyReviewedDueReviewQueue(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        limit: Int
    ): Flow<List<CardWithRelations>>

    @Transaction
    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NOT NULL
            AND dueAtMillis <= :nowMillis
            AND fsrsLastReviewedAtMillis IS NOT NULL
            AND fsrsLastReviewedAtMillis >= :cutoffMillis
            AND fsrsLastReviewedAtMillis <= :nowMillis
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeRecentlyReviewedDueReviewQueueByAnyTags(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        tagNames: List<String>,
        limit: Int
    ): Flow<List<CardWithRelations>>

    @Transaction
    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NOT NULL
            AND dueAtMillis <= :nowMillis
            AND (
                fsrsLastReviewedAtMillis IS NULL
                OR fsrsLastReviewedAtMillis < :cutoffMillis
                OR fsrsLastReviewedAtMillis > :nowMillis
            )
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeOtherDueReviewQueue(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        limit: Int
    ): Flow<List<CardWithRelations>>

    @Transaction
    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NOT NULL
            AND dueAtMillis <= :nowMillis
            AND (
                fsrsLastReviewedAtMillis IS NULL
                OR fsrsLastReviewedAtMillis < :cutoffMillis
                OR fsrsLastReviewedAtMillis > :nowMillis
            )
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeOtherDueReviewQueueByAnyTags(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        tagNames: List<String>,
        limit: Int
    ): Flow<List<CardWithRelations>>

    @Transaction
    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NULL
        ORDER BY createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeNewReviewQueue(
        workspaceId: String,
        limit: Int
    ): Flow<List<CardWithRelations>>

    @Transaction
    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NULL
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        ORDER BY createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeNewReviewQueueByAnyTags(
        workspaceId: String,
        tagNames: List<String>,
        limit: Int
    ): Flow<List<CardWithRelations>>

    @Transaction
    @Query(
        """
        SELECT cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
        FROM (
            SELECT 0 AS activeQueueBucket, cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
            FROM (
                SELECT * FROM cards INDEXED BY index_cards_workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_createdAtMillis_cardId
                WHERE workspaceId = :workspaceId
                    AND deletedAtMillis IS NULL
                    AND dueAtMillis IS NOT NULL
                    AND dueAtMillis <= :nowMillis
                    AND fsrsLastReviewedAtMillis IS NOT NULL
                    AND fsrsLastReviewedAtMillis >= :cutoffMillis
                    AND fsrsLastReviewedAtMillis <= :nowMillis
                ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
                LIMIT :limit
            )
            UNION ALL
            SELECT 1 AS activeQueueBucket, cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
            FROM (
                SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
                WHERE workspaceId = :workspaceId
                    AND deletedAtMillis IS NULL
                    AND dueAtMillis IS NOT NULL
                    AND dueAtMillis <= :nowMillis
                    AND (
                        fsrsLastReviewedAtMillis IS NULL
                        OR fsrsLastReviewedAtMillis < :cutoffMillis
                        OR fsrsLastReviewedAtMillis > :nowMillis
                    )
                ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
                LIMIT :limit
            )
            UNION ALL
            SELECT 2 AS activeQueueBucket, cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
            FROM (
                SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
                WHERE workspaceId = :workspaceId
                    AND deletedAtMillis IS NULL
                    AND dueAtMillis IS NULL
                ORDER BY createdAtMillis DESC, cardId ASC
                LIMIT :limit
            )
        )
        ORDER BY activeQueueBucket ASC, dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeBucketedActiveReviewQueue(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        limit: Int
    ): Flow<List<CardWithRelations>>

    @Transaction
    @Query(
        """
        SELECT cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
        FROM (
            SELECT 0 AS activeQueueBucket, cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
            FROM (
                SELECT * FROM cards INDEXED BY index_cards_workspaceId_fsrsLastReviewedAtMillis_dueAtMillis_createdAtMillis_cardId
                WHERE workspaceId = :workspaceId
                    AND deletedAtMillis IS NULL
                    AND dueAtMillis IS NOT NULL
                    AND dueAtMillis <= :nowMillis
                    AND fsrsLastReviewedAtMillis IS NOT NULL
                    AND fsrsLastReviewedAtMillis >= :cutoffMillis
                    AND fsrsLastReviewedAtMillis <= :nowMillis
                    AND EXISTS (
                        SELECT 1
                        FROM card_tags
                        INNER JOIN tags ON tags.tagId = card_tags.tagId
                        WHERE card_tags.cardId = cards.cardId
                            AND tags.workspaceId = cards.workspaceId
                            AND tags.name IN (:tagNames)
                    )
                ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
                LIMIT :limit
            )
            UNION ALL
            SELECT 1 AS activeQueueBucket, cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
            FROM (
                SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
                WHERE workspaceId = :workspaceId
                    AND deletedAtMillis IS NULL
                    AND dueAtMillis IS NOT NULL
                    AND dueAtMillis <= :nowMillis
                    AND (
                        fsrsLastReviewedAtMillis IS NULL
                        OR fsrsLastReviewedAtMillis < :cutoffMillis
                        OR fsrsLastReviewedAtMillis > :nowMillis
                    )
                    AND EXISTS (
                        SELECT 1
                        FROM card_tags
                        INNER JOIN tags ON tags.tagId = card_tags.tagId
                        WHERE card_tags.cardId = cards.cardId
                            AND tags.workspaceId = cards.workspaceId
                            AND tags.name IN (:tagNames)
                    )
                ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
                LIMIT :limit
            )
            UNION ALL
            SELECT 2 AS activeQueueBucket, cardId, workspaceId, frontText, backText, dueAtMillis, createdAtMillis, updatedAtMillis, reps, lapses, fsrsCardState, fsrsStepIndex, fsrsStability, fsrsDifficulty, fsrsLastReviewedAtMillis, fsrsScheduledDays, deletedAtMillis
            FROM (
                SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
                WHERE workspaceId = :workspaceId
                    AND deletedAtMillis IS NULL
                    AND dueAtMillis IS NULL
                    AND EXISTS (
                        SELECT 1
                        FROM card_tags
                        INNER JOIN tags ON tags.tagId = card_tags.tagId
                        WHERE card_tags.cardId = cards.cardId
                            AND tags.workspaceId = cards.workspaceId
                            AND tags.name IN (:tagNames)
                    )
                ORDER BY createdAtMillis DESC, cardId ASC
                LIMIT :limit
            )
        )
        ORDER BY activeQueueBucket ASC, dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT :limit
        """
    )
    fun observeBucketedActiveReviewQueueByAnyTags(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        tagNames: List<String>,
        limit: Int
    ): Flow<List<CardWithRelations>>
}
