package com.flashcardsopensourceapp.data.local.database.review

import androidx.room.Dao
import androidx.room.Query
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel

internal const val activeReviewRecentPriorityWindowMillis: Long = 60L * 60L * 1_000L

@Dao
interface ReviewCardSelectionDao {
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
        LIMIT 1
        """
    )
    suspend fun loadTopRecentlyReviewedDueReviewCard(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long
    ): CardEntity?

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
            AND effortLevel IN (:effortLevels)
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopRecentlyReviewedDueReviewCardByEffortLevels(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        effortLevels: List<EffortLevel>
    ): CardEntity?

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
        LIMIT 1
        """
    )
    suspend fun loadTopRecentlyReviewedDueReviewCardByAnyTags(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        tagNames: List<String>
    ): CardEntity?

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
            AND effortLevel IN (:effortLevels)
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopRecentlyReviewedDueReviewCardByEffortLevelsAndAnyTags(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        effortLevels: List<EffortLevel>,
        tagNames: List<String>
    ): CardEntity?

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
        LIMIT 1
        """
    )
    suspend fun loadTopOtherDueReviewCard(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long
    ): CardEntity?

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
            AND effortLevel IN (:effortLevels)
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopOtherDueReviewCardByEffortLevels(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        effortLevels: List<EffortLevel>
    ): CardEntity?

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
        LIMIT 1
        """
    )
    suspend fun loadTopOtherDueReviewCardByAnyTags(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        tagNames: List<String>
    ): CardEntity?

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
            AND effortLevel IN (:effortLevels)
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        ORDER BY dueAtMillis ASC, createdAtMillis DESC, cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopOtherDueReviewCardByEffortLevelsAndAnyTags(
        workspaceId: String,
        cutoffMillis: Long,
        nowMillis: Long,
        effortLevels: List<EffortLevel>,
        tagNames: List<String>
    ): CardEntity?

    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NULL
        ORDER BY createdAtMillis DESC, cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopNewReviewCard(workspaceId: String): CardEntity?

    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NULL
            AND effortLevel IN (:effortLevels)
        ORDER BY createdAtMillis DESC, cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopNewReviewCardByEffortLevels(
        workspaceId: String,
        effortLevels: List<EffortLevel>
    ): CardEntity?

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
        LIMIT 1
        """
    )
    suspend fun loadTopNewReviewCardByAnyTags(
        workspaceId: String,
        tagNames: List<String>
    ): CardEntity?

    @Query(
        """
        SELECT * FROM cards INDEXED BY index_cards_workspaceId_dueAtMillis_createdAtMillis_cardId
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND dueAtMillis IS NULL
            AND effortLevel IN (:effortLevels)
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND tags.name IN (:tagNames)
            )
        ORDER BY createdAtMillis DESC, cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopNewReviewCardByEffortLevelsAndAnyTags(
        workspaceId: String,
        effortLevels: List<EffortLevel>,
        tagNames: List<String>
    ): CardEntity?
}

suspend fun loadTopActiveReviewCard(
    reviewCardSelectionDao: ReviewCardSelectionDao,
    workspaceId: String,
    nowMillis: Long,
    effortLevels: List<EffortLevel>,
    tagNames: List<String>
): CardEntity? {
    val cutoffMillis = nowMillis - activeReviewRecentPriorityWindowMillis
    return loadTopRecentlyReviewedDueReviewCardForPredicate(
        reviewCardSelectionDao = reviewCardSelectionDao,
        workspaceId = workspaceId,
        cutoffMillis = cutoffMillis,
        nowMillis = nowMillis,
        effortLevels = effortLevels,
        tagNames = tagNames
    ) ?: loadTopOtherDueReviewCardForPredicate(
        reviewCardSelectionDao = reviewCardSelectionDao,
        workspaceId = workspaceId,
        cutoffMillis = cutoffMillis,
        nowMillis = nowMillis,
        effortLevels = effortLevels,
        tagNames = tagNames
    ) ?: loadTopNewReviewCardForPredicate(
        reviewCardSelectionDao = reviewCardSelectionDao,
        workspaceId = workspaceId,
        effortLevels = effortLevels,
        tagNames = tagNames
    )
}

private suspend fun loadTopRecentlyReviewedDueReviewCardForPredicate(
    reviewCardSelectionDao: ReviewCardSelectionDao,
    workspaceId: String,
    cutoffMillis: Long,
    nowMillis: Long,
    effortLevels: List<EffortLevel>,
    tagNames: List<String>
): CardEntity? {
    return when {
        effortLevels.isEmpty() && tagNames.isEmpty() -> reviewCardSelectionDao.loadTopRecentlyReviewedDueReviewCard(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis
        )

        effortLevels.isNotEmpty() && tagNames.isEmpty() -> reviewCardSelectionDao.loadTopRecentlyReviewedDueReviewCardByEffortLevels(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            effortLevels = effortLevels
        )

        effortLevels.isEmpty() -> reviewCardSelectionDao.loadTopRecentlyReviewedDueReviewCardByAnyTags(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            tagNames = tagNames
        )

        else -> reviewCardSelectionDao.loadTopRecentlyReviewedDueReviewCardByEffortLevelsAndAnyTags(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            effortLevels = effortLevels,
            tagNames = tagNames
        )
    }
}

private suspend fun loadTopOtherDueReviewCardForPredicate(
    reviewCardSelectionDao: ReviewCardSelectionDao,
    workspaceId: String,
    cutoffMillis: Long,
    nowMillis: Long,
    effortLevels: List<EffortLevel>,
    tagNames: List<String>
): CardEntity? {
    return when {
        effortLevels.isEmpty() && tagNames.isEmpty() -> reviewCardSelectionDao.loadTopOtherDueReviewCard(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis
        )

        effortLevels.isNotEmpty() && tagNames.isEmpty() -> reviewCardSelectionDao.loadTopOtherDueReviewCardByEffortLevels(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            effortLevels = effortLevels
        )

        effortLevels.isEmpty() -> reviewCardSelectionDao.loadTopOtherDueReviewCardByAnyTags(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            tagNames = tagNames
        )

        else -> reviewCardSelectionDao.loadTopOtherDueReviewCardByEffortLevelsAndAnyTags(
            workspaceId = workspaceId,
            cutoffMillis = cutoffMillis,
            nowMillis = nowMillis,
            effortLevels = effortLevels,
            tagNames = tagNames
        )
    }
}

private suspend fun loadTopNewReviewCardForPredicate(
    reviewCardSelectionDao: ReviewCardSelectionDao,
    workspaceId: String,
    effortLevels: List<EffortLevel>,
    tagNames: List<String>
): CardEntity? {
    return when {
        effortLevels.isEmpty() && tagNames.isEmpty() -> reviewCardSelectionDao.loadTopNewReviewCard(
            workspaceId = workspaceId
        )

        effortLevels.isNotEmpty() && tagNames.isEmpty() -> reviewCardSelectionDao.loadTopNewReviewCardByEffortLevels(
            workspaceId = workspaceId,
            effortLevels = effortLevels
        )

        effortLevels.isEmpty() -> reviewCardSelectionDao.loadTopNewReviewCardByAnyTags(
            workspaceId = workspaceId,
            tagNames = tagNames
        )

        else -> reviewCardSelectionDao.loadTopNewReviewCardByEffortLevelsAndAnyTags(
            workspaceId = workspaceId,
            effortLevels = effortLevels,
            tagNames = tagNames
        )
    }
}
