package com.flashcardsopensourceapp.data.local.repository

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.CardFilter
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.cards.queryCards
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.requireCurrentWorkspace
import com.flashcardsopensourceapp.data.local.repository.cloudsync.sync.runLocalOutboxMutationTransaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

class LocalCardsRepository(
    private val database: AppDatabase,
    private val preferencesStore: CloudPreferencesStore,
    private val syncLocalStore: SyncLocalStore
) : CardsRepository {
    override fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>> {
        return database.cardDao().observeCardsWithRelations().map { cards ->
            queryCards(
                cards = cards.map(::toCardSummary).filter { card -> card.deletedAtMillis == null },
                searchText = searchQuery,
                filter = filter
            )
        }
    }

    override fun observeCard(cardId: String): Flow<CardSummary?> {
        return database.cardDao().observeCardWithRelations(cardId = cardId).map { card ->
            card?.let(::toCardSummary)
        }
    }

    override suspend fun createCard(cardDraft: CardDraft) {
        val workspace: WorkspaceEntity = requireCurrentWorkspace(
            database = database,
            preferencesStore = preferencesStore,
            missingWorkspaceMessage = "Workspace is required before creating cards."
        )
        val currentTimeMillis: Long = System.currentTimeMillis()
        val cardId: String = UUID.randomUUID().toString()
        val card: CardEntity = CardEntity(
            cardId = cardId,
            workspaceId = workspace.workspaceId,
            frontText = cardDraft.frontText,
            backText = cardDraft.backText,
            effortLevel = cardDraft.effortLevel,
            dueAtMillis = null,
            createdAtMillis = currentTimeMillis,
            updatedAtMillis = currentTimeMillis,
            reps = 0,
            lapses = 0,
            fsrsCardState = FsrsCardState.NEW,
            fsrsStepIndex = null,
            fsrsStability = null,
            fsrsDifficulty = null,
            fsrsLastReviewedAtMillis = null,
            fsrsScheduledDays = null,
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.cardDao().insertCard(card = card)
            replaceCardTags(
                database = database,
                workspaceId = workspace.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(
                card = card,
                tags = cardDraft.tags,
                affectsReviewSchedule = true
            )
        }
    }

    override suspend fun updateCard(cardId: String, cardDraft: CardDraft) {
        val currentCard: CardEntity = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot update missing card: $cardId"
        }
        val updatedCard: CardEntity = currentCard.copy(
            frontText = cardDraft.frontText,
            backText = cardDraft.backText,
            effortLevel = cardDraft.effortLevel,
            updatedAtMillis = System.currentTimeMillis(),
            deletedAtMillis = null
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.cardDao().updateCard(card = updatedCard)
            replaceCardTags(
                database = database,
                workspaceId = currentCard.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(
                card = updatedCard,
                tags = cardDraft.tags,
                affectsReviewSchedule = currentCard.deletedAtMillis != null
            )
        }
    }

    override suspend fun deleteCard(cardId: String) {
        val card: CardEntity = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot delete missing card: $cardId"
        }

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            val deletedCard: CardEntity = card.copy(
                updatedAtMillis = System.currentTimeMillis(),
                deletedAtMillis = System.currentTimeMillis()
            )
            val cardTags: List<String> = database.cardDao().observeCardWithRelations(cardId = cardId)
                .first()
                ?.tags
                ?.map(TagEntity::name)
                ?: emptyList()
            database.cardDao().updateCard(card = deletedCard)
            syncLocalStore.enqueueCardUpsert(
                card = deletedCard,
                tags = cardTags,
                affectsReviewSchedule = true
            )
        }
    }
}
