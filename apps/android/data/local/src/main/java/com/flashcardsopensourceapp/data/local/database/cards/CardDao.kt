package com.flashcardsopensourceapp.data.local.database.cards

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardWithRelations
import kotlinx.coroutines.flow.Flow

data class LocalSyncDiagnosticsCardCounts(
    val localActiveCards: Int,
    val localDeletedCards: Int
)

data class LocalSyncDiagnosticsCardMarkdownRow(
    val cardId: String,
    val frontText: String,
    val backText: String
)

@Dao
interface CardDao {
    @Transaction
    @Query("SELECT * FROM cards ORDER BY updatedAtMillis DESC, createdAtMillis DESC")
    fun observeCardsWithRelations(): Flow<List<CardWithRelations>>

    @Transaction
    @Query("SELECT * FROM cards WHERE cardId = :cardId LIMIT 1")
    fun observeCardWithRelations(cardId: String): Flow<CardWithRelations?>

    @Transaction
    @Query("SELECT * FROM cards WHERE cardId = :cardId AND workspaceId = :workspaceId LIMIT 1")
    fun observeCardWithRelationsByWorkspace(cardId: String, workspaceId: String): Flow<CardWithRelations?>

    @Transaction
    @Query("SELECT * FROM cards ORDER BY createdAtMillis ASC")
    fun observeReviewCards(): Flow<List<CardWithRelations>>

    @Transaction
    @Query("SELECT * FROM cards WHERE workspaceId = :workspaceId AND cardId IN (:cardIds)")
    fun observeCardsWithRelationsByWorkspaceAndIds(
        workspaceId: String,
        cardIds: List<String>
    ): Flow<List<CardWithRelations>>

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

    @Query("SELECT * FROM cards WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC, cardId ASC")
    suspend fun loadCards(workspaceId: String): List<CardEntity>

    @Query(
        """
        SELECT
            COUNT(CASE WHEN deletedAtMillis IS NULL THEN 1 END) AS localActiveCards,
            COUNT(CASE WHEN deletedAtMillis IS NOT NULL THEN 1 END) AS localDeletedCards
        FROM cards
        WHERE workspaceId = :workspaceId
        """
    )
    fun observeLocalSyncDiagnosticsCardCounts(workspaceId: String): Flow<LocalSyncDiagnosticsCardCounts>

    @Query(
        """
        SELECT cardId, frontText, backText
        FROM cards
        WHERE workspaceId = :workspaceId
            AND deletedAtMillis IS NULL
        ORDER BY updatedAtMillis DESC, createdAtMillis DESC, cardId ASC
        """
    )
    fun observeLocalSyncDiagnosticsActiveCardMarkdownRows(
        workspaceId: String
    ): Flow<List<LocalSyncDiagnosticsCardMarkdownRow>>

    @Query("SELECT COUNT(*) FROM cards")
    fun observeCardCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM cards WHERE deletedAtMillis IS NULL")
    suspend fun countActiveCards(): Int

    @Query("DELETE FROM cards")
    suspend fun deleteAllCards()

    @Query("UPDATE cards SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}
