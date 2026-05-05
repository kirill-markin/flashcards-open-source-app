package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.matchesDeckFilterDefinition
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.util.UUID

class LocalDecksRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncLocalStore: SyncLocalStore
) : DecksRepository {
    override fun observeDecks(): Flow<List<DeckSummary>> {
        return combine(
            database.deckDao().observeDecks(),
            database.cardDao().observeCardsWithRelations()
        ) { decks, cards ->
            val cardSummaries: List<CardSummary> = cards.map(::toCardSummary)
            val nowMillis: Long = System.currentTimeMillis()

            decks.filter { deck -> deck.deletedAtMillis == null }.map { deck ->
                toDeckSummary(
                    deck = deck,
                    cards = cardSummaries.filter { card -> card.deletedAtMillis == null },
                    nowMillis = nowMillis
                )
            }
        }
    }

    override fun observeDeck(deckId: String): Flow<DeckSummary?> {
        return observeDecks().map { decks ->
            decks.firstOrNull { deck ->
                deck.deckId == deckId
            }
        }
    }

    override fun observeDeckCards(deckId: String): Flow<List<CardSummary>> {
        return combine(
            database.deckDao().observeDeck(deckId = deckId),
            database.cardDao().observeCardsWithRelations()
        ) { deck, cards ->
            if (deck == null) {
                return@combine emptyList()
            }

            val filterDefinition: DeckFilterDefinition = decodeDeckFilterDefinition(
                filterDefinitionJson = deck.filterDefinitionJson
            )
            cards.map(::toCardSummary).filter { card ->
                card.deletedAtMillis == null &&
                    matchesDeckFilterDefinition(
                        filterDefinition = filterDefinition,
                        card = card
                    )
            }
        }
    }

    override suspend fun createDeck(deckDraft: DeckDraft) {
        val workspace: WorkspaceEntity = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace is required before creating decks."
        )
        val normalizedDeckDraft: DeckDraft = normalizeDeckDraft(deckDraft = deckDraft)
        val currentTimeMillis: Long = System.currentTimeMillis()
        val deck: DeckEntity = DeckEntity(
            deckId = UUID.randomUUID().toString(),
            workspaceId = workspace.workspaceId,
            name = normalizedDeckDraft.name,
            filterDefinitionJson = encodeDeckFilterDefinition(
                filterDefinition = normalizedDeckDraft.filterDefinition
            ),
            createdAtMillis = currentTimeMillis,
            updatedAtMillis = currentTimeMillis,
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.deckDao().insertDeck(deck = deck)
            syncLocalStore.enqueueDeckUpsert(deck)
        }
    }

    override suspend fun updateDeck(deckId: String, deckDraft: DeckDraft) {
        val currentDeck: DeckEntity = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot update missing deck: $deckId"
        }
        val normalizedDeckDraft: DeckDraft = normalizeDeckDraft(deckDraft = deckDraft)
        val updatedDeck: DeckEntity = currentDeck.copy(
            name = normalizedDeckDraft.name,
            filterDefinitionJson = encodeDeckFilterDefinition(
                filterDefinition = normalizedDeckDraft.filterDefinition
            ),
            updatedAtMillis = System.currentTimeMillis(),
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.deckDao().updateDeck(deck = updatedDeck)
            syncLocalStore.enqueueDeckUpsert(updatedDeck)
        }
    }

    override suspend fun deleteDeck(deckId: String) {
        val existingDeck: DeckEntity = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot delete missing deck: $deckId"
        }

        val deletedDeck: DeckEntity = existingDeck.copy(
            updatedAtMillis = System.currentTimeMillis(),
            deletedAtMillis = System.currentTimeMillis()
        )
        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.deckDao().updateDeck(deck = deletedDeck)
            syncLocalStore.enqueueDeckUpsert(deletedDeck)
        }
    }
}
