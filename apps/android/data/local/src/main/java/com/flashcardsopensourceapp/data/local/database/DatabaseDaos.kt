package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

@Dao
interface AppLocalSettingsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSettings(settings: AppLocalSettingsEntity)

    @Update
    suspend fun updateSettings(settings: AppLocalSettingsEntity)

    @Query("SELECT * FROM app_local_settings WHERE settingsId = 1 LIMIT 1")
    fun observeSettings(): Flow<AppLocalSettingsEntity?>

    @Query("SELECT * FROM app_local_settings WHERE settingsId = 1 LIMIT 1")
    suspend fun loadSettings(): AppLocalSettingsEntity?

    @Query("DELETE FROM app_local_settings")
    suspend fun deleteAllSettings()
}

@Dao
interface WorkspaceDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertWorkspace(workspace: WorkspaceEntity)

    @Query("SELECT COUNT(*) FROM workspaces")
    suspend fun countWorkspaces(): Int

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis DESC, workspaceId DESC")
    fun observeWorkspaces(): Flow<List<WorkspaceEntity>>

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis DESC, workspaceId DESC")
    suspend fun loadWorkspaces(): List<WorkspaceEntity>

    @Query("SELECT * FROM workspaces WHERE workspaceId = :workspaceId LIMIT 1")
    fun observeWorkspaceById(workspaceId: String): Flow<WorkspaceEntity?>

    @Query("SELECT * FROM workspaces WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadWorkspaceById(workspaceId: String): WorkspaceEntity?

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis ASC, workspaceId ASC LIMIT 1")
    fun observeAnyWorkspace(): Flow<WorkspaceEntity?>

    @Query("SELECT * FROM workspaces ORDER BY createdAtMillis ASC, workspaceId ASC LIMIT 1")
    suspend fun loadAnyWorkspace(): WorkspaceEntity?

    @Update
    suspend fun updateWorkspace(workspace: WorkspaceEntity)

    @Query("DELETE FROM workspaces")
    suspend fun deleteAllWorkspaces()

    @Query("DELETE FROM workspaces WHERE workspaceId = :workspaceId")
    suspend fun deleteWorkspace(workspaceId: String)
}

@Dao
interface WorkspaceSchedulerSettingsDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWorkspaceSchedulerSettings(settings: WorkspaceSchedulerSettingsEntity)

    @Update
    suspend fun updateWorkspaceSchedulerSettings(settings: WorkspaceSchedulerSettingsEntity)

    @Query("SELECT * FROM workspace_scheduler_settings WHERE workspaceId = :workspaceId LIMIT 1")
    fun observeWorkspaceSchedulerSettings(workspaceId: String): Flow<WorkspaceSchedulerSettingsEntity?>

    @Query("SELECT * FROM workspace_scheduler_settings WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadWorkspaceSchedulerSettings(workspaceId: String): WorkspaceSchedulerSettingsEntity?

    @Query("UPDATE workspace_scheduler_settings SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}

@Dao
interface DeckDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertDeck(deck: DeckEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDecks(decks: List<DeckEntity>)

    @Update
    suspend fun updateDeck(deck: DeckEntity)

    @Query("DELETE FROM decks WHERE deckId = :deckId")
    suspend fun deleteDeck(deckId: String)

    @Query("SELECT * FROM decks ORDER BY createdAtMillis DESC, deckId DESC")
    fun observeDecks(): Flow<List<DeckEntity>>

    @Query("SELECT * FROM decks WHERE deckId = :deckId LIMIT 1")
    fun observeDeck(deckId: String): Flow<DeckEntity?>

    @Query("SELECT * FROM decks WHERE deckId = :deckId LIMIT 1")
    suspend fun loadDeck(deckId: String): DeckEntity?

    @Query("SELECT COUNT(*) FROM decks")
    fun observeDeckCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM decks WHERE deletedAtMillis IS NULL")
    suspend fun countDecks(): Int

    @Query("DELETE FROM decks")
    suspend fun deleteAllDecks()

    @Query("UPDATE decks SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
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

    @Query(
        """
        SELECT * FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
        ORDER BY
            CASE
                WHEN dueAtMillis IS NULL THEN 0
                ELSE 1
            END ASC,
            dueAtMillis ASC,
            createdAtMillis DESC,
            cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopReviewCard(workspaceId: String, nowMillis: Long): CardEntity?

    @Query(
        """
        SELECT * FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
            AND effortLevel IN (:effortLevels)
        ORDER BY
            CASE
                WHEN dueAtMillis IS NULL THEN 0
                ELSE 1
            END ASC,
            dueAtMillis ASC,
            createdAtMillis DESC,
            cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopReviewCardByEffortLevels(
        workspaceId: String,
        nowMillis: Long,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>
    ): CardEntity?

    @Query(
        """
        SELECT * FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
            AND (dueAtMillis IS NULL OR dueAtMillis <= :nowMillis)
            AND EXISTS (
                SELECT 1
                FROM card_tags
                INNER JOIN tags ON tags.tagId = card_tags.tagId
                WHERE card_tags.cardId = cards.cardId
                    AND tags.workspaceId = cards.workspaceId
                    AND LOWER(tags.name) IN (:normalizedTagNames)
            )
        ORDER BY
            CASE
                WHEN dueAtMillis IS NULL THEN 0
                ELSE 1
            END ASC,
            dueAtMillis ASC,
            createdAtMillis DESC,
            cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopReviewCardByAnyTags(
        workspaceId: String,
        nowMillis: Long,
        normalizedTagNames: List<String>
    ): CardEntity?

    @Query(
        """
        SELECT * FROM cards
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
                    AND LOWER(tags.name) IN (:normalizedTagNames)
            )
        ORDER BY
            CASE
                WHEN dueAtMillis IS NULL THEN 0
                ELSE 1
            END ASC,
            dueAtMillis ASC,
            createdAtMillis DESC,
            cardId ASC
        LIMIT 1
        """
    )
    suspend fun loadTopReviewCardByEffortLevelsAndAnyTags(
        workspaceId: String,
        nowMillis: Long,
        effortLevels: List<com.flashcardsopensourceapp.data.local.model.EffortLevel>,
        normalizedTagNames: List<String>
    ): CardEntity?

    @Query("SELECT COUNT(*) FROM cards")
    fun observeCardCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM cards WHERE deletedAtMillis IS NULL")
    suspend fun countActiveCards(): Int

    @Query("DELETE FROM cards")
    suspend fun deleteAllCards()

    @Query("UPDATE cards SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
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

    @Query("SELECT * FROM tags WHERE workspaceId = :workspaceId")
    suspend fun loadTagsForWorkspace(workspaceId: String): List<TagEntity>

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

@Dao
interface ReviewLogDao {
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertReviewLog(reviewLog: ReviewLogEntity)

    @Query("SELECT * FROM review_logs")
    fun observeReviewLogs(): Flow<List<ReviewLogEntity>>

    @Query("SELECT COUNT(*) FROM review_logs")
    suspend fun countReviewLogs(): Int

    @Query("SELECT * FROM review_logs ORDER BY reviewedAtMillis DESC")
    suspend fun loadReviewLogs(): List<ReviewLogEntity>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReviewLogs(reviewLogs: List<ReviewLogEntity>)

    @Query("DELETE FROM review_logs")
    suspend fun deleteAllReviewLogs()

    @Query("UPDATE review_logs SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}

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

    @Query("SELECT * FROM outbox_entries WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC LIMIT :limit")
    suspend fun loadOutboxEntries(workspaceId: String, limit: Int): List<OutboxEntryEntity>

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

    @Query("UPDATE outbox_entries SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}

@Dao
interface SyncStateDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSyncState(syncState: SyncStateEntity)

    @Query("SELECT * FROM sync_state WHERE workspaceId = :workspaceId LIMIT 1")
    fun observeSyncState(workspaceId: String): Flow<SyncStateEntity?>

    @Query("SELECT * FROM sync_state WHERE workspaceId = :workspaceId LIMIT 1")
    suspend fun loadSyncState(workspaceId: String): SyncStateEntity?

    @Query("DELETE FROM sync_state")
    suspend fun deleteAllSyncState()

    @Query("UPDATE sync_state SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}
