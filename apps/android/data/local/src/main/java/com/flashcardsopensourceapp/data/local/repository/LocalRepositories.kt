package com.flashcardsopensourceapp.data.local.repository

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import java.util.Locale
import java.util.UUID

class LocalCardsRepository(
    private val database: AppDatabase
) : CardsRepository {
    override fun observeCards(): Flow<List<CardSummary>> {
        return database.cardDao().observeCardsWithRelations().map { cards ->
            cards.map(::toCardSummary)
        }
    }

    override fun observeCard(cardId: String): Flow<CardSummary?> {
        return database.cardDao().observeCardWithRelations(cardId = cardId).map { card ->
            card?.let(::toCardSummary)
        }
    }

    override suspend fun createCard(cardDraft: CardDraft) {
        val workspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace is required before creating cards."
        }
        val currentTimeMillis = System.currentTimeMillis()
        val cardId = UUID.randomUUID().toString()
        val card = CardEntity(
            cardId = cardId,
            workspaceId = workspace.workspaceId,
            deckId = cardDraft.deckId,
            frontText = cardDraft.frontText,
            backText = cardDraft.backText,
            effortLevel = cardDraft.effortLevel,
            createdAtMillis = currentTimeMillis,
            updatedAtMillis = currentTimeMillis
        )

        database.withTransaction {
            database.cardDao().insertCard(card = card)
            replaceCardTags(
                database = database,
                workspaceId = workspace.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
        }
    }

    override suspend fun updateCard(cardId: String, cardDraft: CardDraft) {
        val currentCard = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot update missing card: $cardId"
        }
        val updatedCard = currentCard.copy(
            deckId = cardDraft.deckId,
            frontText = cardDraft.frontText,
            backText = cardDraft.backText,
            effortLevel = cardDraft.effortLevel,
            updatedAtMillis = System.currentTimeMillis()
        )

        database.withTransaction {
            database.cardDao().updateCard(card = updatedCard)
            replaceCardTags(
                database = database,
                workspaceId = currentCard.workspaceId,
                cardId = cardId,
                tags = cardDraft.tags
            )
        }
    }

    override suspend fun deleteCard(cardId: String) {
        database.cardDao().deleteCard(cardId = cardId)
    }
}

class LocalDecksRepository(
    private val database: AppDatabase
) : DecksRepository {
    override fun observeDecks(): Flow<List<DeckSummary>> {
        return database.deckDao().observeDecks().map { decks ->
            decks.map { deck ->
                DeckSummary(
                    deckId = deck.deckId,
                    workspaceId = deck.workspaceId,
                    name = deck.name,
                    position = deck.position
                )
            }
        }
    }
}

class LocalWorkspaceRepository(
    private val database: AppDatabase
) : WorkspaceRepository {
    override fun observeWorkspace(): Flow<WorkspaceSummary?> {
        return database.workspaceDao().observeWorkspace().map { workspace ->
            workspace?.let {
                WorkspaceSummary(
                    workspaceId = it.workspaceId,
                    name = it.name,
                    createdAtMillis = it.createdAtMillis
                )
            }
        }
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return combine(
            observeWorkspace(),
            database.deckDao().observeDeckCount(),
            database.cardDao().observeCardCount()
        ) { workspace, deckCount, cardCount ->
            AppMetadataSummary(
                workspaceName = workspace?.name ?: "Unavailable",
                deckCount = deckCount,
                cardCount = cardCount,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Draft local-only shell"
            )
        }
    }
}

class LocalReviewRepository(
    private val database: AppDatabase
) : ReviewRepository {
    override fun observeReviewCards(): Flow<List<ReviewCard>> {
        return database.cardDao().observeReviewCards().map { cards ->
            cards.map { card ->
                ReviewCard(
                    cardId = card.card.cardId,
                    deckName = card.deck.name,
                    frontText = card.card.frontText,
                    backText = card.card.backText,
                    tags = card.tags.map { it.name }
                )
            }
        }
    }

    override suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long) {
        val card = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot review missing card: $cardId"
        }

        // TODO: Port FSRS scheduling logic from apps/ios/Flashcards/Flashcards/FsrsScheduler.swift.
        // TODO: Port review submission failure handling from apps/ios/Flashcards/Flashcards/ReviewSubmissionExecutor.swift.
        database.reviewLogDao().insertReviewLog(
            reviewLog = com.flashcardsopensourceapp.data.local.database.ReviewLogEntity(
                reviewLogId = UUID.randomUUID().toString(),
                workspaceId = card.workspaceId,
                cardId = cardId,
                rating = rating,
                reviewedAtMillis = reviewedAtMillis
            )
        )
    }
}

class LocalSyncRepository : SyncRepository {
    override suspend fun scheduleDraftSync() {
        // TODO: Port outbox drain and sync cursor logic from apps/ios/Flashcards/Flashcards/CloudSync.
    }
}

private fun toCardSummary(card: com.flashcardsopensourceapp.data.local.database.CardWithRelations): CardSummary {
    return CardSummary(
        cardId = card.card.cardId,
        workspaceId = card.card.workspaceId,
        deckId = card.card.deckId,
        deckName = card.deck.name,
        frontText = card.card.frontText,
        backText = card.card.backText,
        tags = card.tags.map { it.name }.sorted(),
        effortLevel = card.card.effortLevel,
        createdAtMillis = card.card.createdAtMillis,
        updatedAtMillis = card.card.updatedAtMillis
    )
}

private suspend fun replaceCardTags(
    database: AppDatabase,
    workspaceId: String,
    cardId: String,
    tags: List<String>
) {
    val normalizedTags = normalizeTags(tags = tags)
    database.tagDao().deleteCardTags(cardId = cardId)

    if (normalizedTags.isEmpty()) {
        return
    }

    val existingTags = database.tagDao().loadTagsByNames(
        workspaceId = workspaceId,
        names = normalizedTags
    )
    val missingNames = normalizedTags - existingTags.map { it.name }.toSet()
    val createdTags = missingNames.map { name ->
        TagEntity(
            tagId = UUID.randomUUID().toString(),
            workspaceId = workspaceId,
            name = name
        )
    }

    if (createdTags.isNotEmpty()) {
        database.tagDao().insertTags(tags = createdTags)
    }

    val resolvedTags = database.tagDao().loadTagsByNames(
        workspaceId = workspaceId,
        names = normalizedTags
    )

    database.tagDao().insertCardTags(
        cardTags = resolvedTags.map { tag ->
            CardTagEntity(cardId = cardId, tagId = tag.tagId)
        }
    )
}

private fun normalizeTags(tags: List<String>): List<String> {
    return tags.map { tag ->
        tag.trim().lowercase(Locale.US)
    }.filter { tag ->
        tag.isNotEmpty()
    }.distinct()
}
