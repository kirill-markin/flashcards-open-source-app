package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface TagDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertTags(tags: List<TagEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCardTags(cardTags: List<CardTagEntity>)

    @Query("DELETE FROM card_tags WHERE cardId = :cardId")
    suspend fun deleteCardTags(cardId: String)

    @Query("SELECT * FROM tags WHERE workspaceId = :workspaceId AND name IN (:names)")
    suspend fun loadTagsByNames(workspaceId: String, names: List<String>): List<TagEntity>

    @Query("SELECT * FROM tags WHERE workspaceId = :workspaceId")
    suspend fun loadTagsForWorkspace(workspaceId: String): List<TagEntity>

    @Query("SELECT * FROM tags WHERE workspaceId = :workspaceId ORDER BY name ASC, tagId ASC")
    suspend fun loadTags(workspaceId: String): List<TagEntity>

    @Query("SELECT * FROM tags WHERE workspaceId = :workspaceId ORDER BY name ASC, tagId ASC")
    fun observeTags(workspaceId: String): Flow<List<TagEntity>>

    @Query(
        """
        SELECT DISTINCT tags.name
        FROM tags
        INNER JOIN card_tags ON card_tags.tagId = tags.tagId
        INNER JOIN cards ON cards.cardId = card_tags.cardId
        WHERE cards.workspaceId = :workspaceId
            AND tags.workspaceId = cards.workspaceId
            AND cards.deletedAtMillis IS NULL
        ORDER BY tags.name ASC
        """
    )
    suspend fun loadReviewTagNames(workspaceId: String): List<String>

    @Query(
        """
        SELECT DISTINCT tags.name
        FROM tags
        INNER JOIN card_tags ON card_tags.tagId = tags.tagId
        INNER JOIN cards ON cards.cardId = card_tags.cardId
        WHERE cards.workspaceId = :workspaceId
            AND tags.workspaceId = cards.workspaceId
            AND cards.deletedAtMillis IS NULL
        ORDER BY tags.name ASC
        """
    )
    fun observeReviewTagNames(workspaceId: String): Flow<List<String>>

    @Query(
        """
        SELECT card_tags.*
        FROM card_tags
        INNER JOIN cards ON cards.cardId = card_tags.cardId
        INNER JOIN tags ON tags.tagId = card_tags.tagId
        WHERE cards.workspaceId = :workspaceId
            AND tags.workspaceId = :workspaceId
        ORDER BY cards.createdAtMillis ASC, cards.cardId ASC, card_tags.tagId ASC
        """
    )
    suspend fun loadCardTags(workspaceId: String): List<CardTagEntity>

    @Query("UPDATE card_tags SET cardId = :newCardId WHERE cardId = :oldCardId")
    suspend fun reassignCardTagsToCard(oldCardId: String, newCardId: String)

    @Query("SELECT EXISTS(SELECT 1 FROM tags WHERE workspaceId = :workspaceId AND LOWER(name) = LOWER(:tagName) LIMIT 1)")
    suspend fun hasTag(workspaceId: String, tagName: String): Boolean

    @Query("DELETE FROM tags WHERE workspaceId = :workspaceId AND tagId NOT IN (SELECT DISTINCT tagId FROM card_tags)")
    suspend fun deleteUnusedTags(workspaceId: String)

    @Query("SELECT COUNT(*) FROM tags")
    suspend fun countTags(): Int

    @Query("DELETE FROM tags")
    suspend fun deleteAllTags()

    @Query("DELETE FROM card_tags")
    suspend fun deleteAllCardTags()

    @Query("UPDATE tags SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}
