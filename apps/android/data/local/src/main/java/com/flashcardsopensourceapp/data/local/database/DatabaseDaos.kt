package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface WorkspaceDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertWorkspace(workspace: WorkspaceEntity)

    @Query("SELECT COUNT(*) FROM workspaces")
    suspend fun countWorkspaces(): Int

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis ASC LIMIT 1")
    fun observeWorkspace(): Flow<WorkspaceEntity?>

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis ASC LIMIT 1")
    suspend fun loadWorkspace(): WorkspaceEntity?
}

@Dao
interface DeckDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDecks(decks: List<DeckEntity>)

    @Query("SELECT * FROM decks ORDER BY position ASC, name ASC")
    fun observeDecks(): Flow<List<DeckEntity>>

    @Query("SELECT COUNT(*) FROM decks")
    fun observeDeckCount(): Flow<Int>
}

@Dao
interface CardDao {
    @Transaction
    @Query("SELECT * FROM cards ORDER BY updatedAtMillis DESC, createdAtMillis DESC")
    fun observeCardsWithRelations(): Flow<List<CardWithRelations>>

    @Transaction
    @Query("SELECT * FROM cards WHERE cardId = :cardId LIMIT 1")
    fun observeCardWithRelations(cardId: String): Flow<CardWithRelations?>

    @Transaction
    @Query("SELECT * FROM cards ORDER BY createdAtMillis ASC")
    fun observeReviewCards(): Flow<List<CardWithRelations>>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertCard(card: CardEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCards(cards: List<CardEntity>)

    @Update
    suspend fun updateCard(card: CardEntity)

    @Query("DELETE FROM cards WHERE cardId = :cardId")
    suspend fun deleteCard(cardId: String)

    @Query("SELECT * FROM cards WHERE cardId = :cardId LIMIT 1")
    suspend fun loadCard(cardId: String): CardEntity?

    @Query("SELECT COUNT(*) FROM cards")
    fun observeCardCount(): Flow<Int>
}

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

    @Query("SELECT COUNT(*) FROM tags")
    suspend fun countTags(): Int
}

@Dao
interface ReviewLogDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertReviewLog(reviewLog: ReviewLogEntity)

    @Query("SELECT COUNT(*) FROM review_logs")
    suspend fun countReviewLogs(): Int
}

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOutboxEntries(entries: List<OutboxEntryEntity>)

    @Query("SELECT COUNT(*) FROM outbox_entries")
    suspend fun countOutboxEntries(): Int
}

@Dao
interface SyncStateDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSyncState(syncState: SyncStateEntity)

    @Query("SELECT * FROM sync_state WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadSyncState(workspaceId: String): SyncStateEntity?
}
