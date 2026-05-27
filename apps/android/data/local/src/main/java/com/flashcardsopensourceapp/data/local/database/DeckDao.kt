package com.flashcardsopensourceapp.data.local.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import kotlinx.coroutines.flow.Flow

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

    @Query("SELECT * FROM decks WHERE workspaceId = :workspaceId ORDER BY createdAtMillis ASC, deckId ASC")
    suspend fun loadDecks(workspaceId: String): List<DeckEntity>

    @Query("SELECT COUNT(*) FROM decks")
    fun observeDeckCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM decks WHERE deletedAtMillis IS NULL")
    suspend fun countDecks(): Int

    @Query("DELETE FROM decks")
    suspend fun deleteAllDecks()

    @Query("UPDATE decks SET workspaceId = :newWorkspaceId WHERE workspaceId = :oldWorkspaceId")
    suspend fun reassignWorkspace(oldWorkspaceId: String, newWorkspaceId: String)
}
