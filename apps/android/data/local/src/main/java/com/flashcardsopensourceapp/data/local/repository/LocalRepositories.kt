package com.flashcardsopensourceapp.data.local.repository

import androidx.room.withTransaction
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.CardWithRelations
import com.flashcardsopensourceapp.data.local.database.DeckEntity
import com.flashcardsopensourceapp.data.local.database.ReviewLogEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.matchesDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.normalizeTags
import com.flashcardsopensourceapp.data.local.model.queryCards
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

class LocalCardsRepository(
    private val database: AppDatabase
) : CardsRepository {
    override fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>> {
        return database.cardDao().observeCardsWithRelations().map { cards ->
            queryCards(
                cards = cards.map(::toCardSummary),
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
        val workspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace is required before creating cards."
        }
        val currentTimeMillis = System.currentTimeMillis()
        val cardId = UUID.randomUUID().toString()
        val card = CardEntity(
            cardId = cardId,
            workspaceId = workspace.workspaceId,
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
        val card = requireNotNull(database.cardDao().loadCard(cardId = cardId)) {
            "Cannot delete missing card: $cardId"
        }

        database.withTransaction {
            database.tagDao().deleteCardTags(cardId = cardId)
            database.cardDao().deleteCard(cardId = cardId)
            database.tagDao().deleteUnusedTags(workspaceId = card.workspaceId)
        }
    }
}

class LocalDecksRepository(
    private val database: AppDatabase
) : DecksRepository {
    override fun observeDecks(): Flow<List<DeckSummary>> {
        return combine(
            database.deckDao().observeDecks(),
            database.cardDao().observeCardsWithRelations(),
            database.reviewLogDao().observeReviewLogs()
        ) { decks, cards, reviewLogs ->
            val cardSummaries = cards.map(::toCardSummary)
            val reviewedCardIds = reviewLogs.map { reviewLog ->
                reviewLog.cardId
            }.toSet()

            decks.map { deck ->
                toDeckSummary(
                    deck = deck,
                    cards = cardSummaries,
                    reviewedCardIds = reviewedCardIds
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

            val filterDefinition = decodeDeckFilterDefinition(filterDefinitionJson = deck.filterDefinitionJson)
            cards.map(::toCardSummary).filter { card ->
                matchesDeckFilterDefinition(
                    filterDefinition = filterDefinition,
                    card = card
                )
            }
        }
    }

    override suspend fun createDeck(deckDraft: DeckDraft) {
        val workspace = requireNotNull(database.workspaceDao().loadWorkspace()) {
            "Workspace is required before creating decks."
        }
        val normalizedDeckDraft = normalizeDeckDraft(deckDraft = deckDraft)
        val currentTimeMillis = System.currentTimeMillis()

        database.deckDao().insertDeck(
            deck = DeckEntity(
                deckId = UUID.randomUUID().toString(),
                workspaceId = workspace.workspaceId,
                name = normalizedDeckDraft.name,
                filterDefinitionJson = encodeDeckFilterDefinition(
                    filterDefinition = normalizedDeckDraft.filterDefinition
                ),
                createdAtMillis = currentTimeMillis,
                updatedAtMillis = currentTimeMillis
            )
        )
    }

    override suspend fun updateDeck(deckId: String, deckDraft: DeckDraft) {
        val currentDeck = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot update missing deck: $deckId"
        }
        val normalizedDeckDraft = normalizeDeckDraft(deckDraft = deckDraft)

        database.deckDao().updateDeck(
            deck = currentDeck.copy(
                name = normalizedDeckDraft.name,
                filterDefinitionJson = encodeDeckFilterDefinition(
                    filterDefinition = normalizedDeckDraft.filterDefinition
                ),
                updatedAtMillis = System.currentTimeMillis()
            )
        )
    }

    override suspend fun deleteDeck(deckId: String) {
        val existingDeck = requireNotNull(database.deckDao().loadDeck(deckId = deckId)) {
            "Cannot delete missing deck: $deckId"
        }

        database.deckDao().deleteDeck(deckId = existingDeck.deckId)
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
            observeWorkspaceOverview(),
            database.cardDao().observeCardCount()
        ) { overview, cardCount ->
            AppMetadataSummary(
                workspaceName = overview?.workspaceName ?: "Unavailable",
                deckCount = overview?.deckCount ?: 0,
                cardCount = cardCount,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Draft local-only shell"
            )
        }
    }

    override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
        return combine(
            database.workspaceDao().observeWorkspace(),
            database.deckDao().observeDecks(),
            database.cardDao().observeCardsWithRelations(),
            database.reviewLogDao().observeReviewLogs()
        ) { workspace, decks, cards, reviewLogs ->
            if (workspace == null) {
                return@combine null
            }

            val cardSummaries = cards.map(::toCardSummary)
            val reviewedCardIds = reviewLogs.map { reviewLog ->
                reviewLog.cardId
            }.toSet()
            val tagsSummary = makeWorkspaceTagsSummary(cards = cardSummaries)

            WorkspaceOverviewSummary(
                workspaceId = workspace.workspaceId,
                workspaceName = workspace.name,
                totalCards = cardSummaries.size,
                deckCount = decks.size,
                tagsCount = tagsSummary.tags.size,
                dueCount = cardSummaries.size,
                newCount = cardSummaries.count { card ->
                    reviewedCardIds.contains(card.cardId).not()
                },
                reviewedCount = reviewedCardIds.size
            )
        }
    }

    override fun observeWorkspaceTagsSummary(): Flow<WorkspaceTagsSummary> {
        return database.cardDao().observeCardsWithRelations().map { cards ->
            makeWorkspaceTagsSummary(cards = cards.map(::toCardSummary))
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
                    frontText = card.card.frontText,
                    backText = card.card.backText,
                    tags = card.tags.map { it.name },
                    effortLevel = card.card.effortLevel
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
            reviewLog = ReviewLogEntity(
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

private fun toCardSummary(card: CardWithRelations): CardSummary {
    return CardSummary(
        cardId = card.card.cardId,
        workspaceId = card.card.workspaceId,
        frontText = card.card.frontText,
        backText = card.card.backText,
        tags = normalizeTags(
            values = card.tags.map { tag -> tag.name },
            referenceTags = emptyList()
        ),
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
    val workspaceTags = database.tagDao().loadTagsForWorkspace(workspaceId = workspaceId)
    val normalizedTags = normalizeTags(
        values = tags,
        referenceTags = workspaceTags.map { tag -> tag.name }
    )
    database.tagDao().deleteCardTags(cardId = cardId)

    if (normalizedTags.isEmpty()) {
        database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
        return
    }

    val existingTags = database.tagDao().loadTagsByNames(
        workspaceId = workspaceId,
        names = normalizedTags
    )
    val missingNames = normalizedTags.filter { normalizedTag ->
        existingTags.none { existingTag ->
            existingTag.name == normalizedTag
        }
    }
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
    database.tagDao().deleteUnusedTags(workspaceId = workspaceId)
}

private fun normalizeDeckDraft(deckDraft: DeckDraft): DeckDraft {
    val trimmedName = deckDraft.name.trim()

    require(trimmedName.isNotEmpty()) {
        "Deck name must not be empty."
    }
    require(deckDraft.filterDefinition.version == 2) {
        "Deck filter version must be 2."
    }

    return DeckDraft(
        name = trimmedName,
        filterDefinition = buildDeckFilterDefinition(
            effortLevels = deckDraft.filterDefinition.effortLevels,
            tags = deckDraft.filterDefinition.tags
        )
    )
}

private fun toDeckSummary(
    deck: DeckEntity,
    cards: List<CardSummary>,
    reviewedCardIds: Set<String>
): DeckSummary {
    val filterDefinition = decodeDeckFilterDefinition(filterDefinitionJson = deck.filterDefinitionJson)
    val matchingCards = cards.filter { card ->
        matchesDeckFilterDefinition(filterDefinition = filterDefinition, card = card)
    }

    return DeckSummary(
        deckId = deck.deckId,
        workspaceId = deck.workspaceId,
        name = deck.name,
        filterDefinition = filterDefinition,
        totalCards = matchingCards.size,
        dueCards = matchingCards.size,
        newCards = matchingCards.count { card ->
            reviewedCardIds.contains(card.cardId).not()
        },
        reviewedCards = matchingCards.count { card ->
            reviewedCardIds.contains(card.cardId)
        },
        createdAtMillis = deck.createdAtMillis,
        updatedAtMillis = deck.updatedAtMillis
    )
}

private fun makeWorkspaceTagsSummary(cards: List<CardSummary>): WorkspaceTagsSummary {
    val counts = cards.fold(emptyMap<String, Int>()) { result, card ->
        card.tags.fold(result) { tagResult, tag ->
            tagResult + (tag to ((tagResult[tag] ?: 0) + 1))
        }
    }
    val tags = counts.entries.map { entry ->
        WorkspaceTagSummary(
            tag = entry.key,
            cardsCount = entry.value
        )
    }.sortedWith(
        compareByDescending<WorkspaceTagSummary> { tagSummary ->
            tagSummary.cardsCount
        }.thenBy { tagSummary ->
            tagSummary.tag.lowercase()
        }
    )

    return WorkspaceTagsSummary(
        tags = tags,
        totalCards = cards.size
    )
}

private fun encodeDeckFilterDefinition(filterDefinition: DeckFilterDefinition): String {
    val jsonObject = JSONObject()
    val effortArray = JSONArray()
    val tagArray = JSONArray()

    filterDefinition.effortLevels.distinct().forEach { effortLevel ->
        effortArray.put(effortLevel.name)
    }
    filterDefinition.tags.forEach { tag ->
        tagArray.put(tag)
    }

    jsonObject.put("version", filterDefinition.version)
    jsonObject.put("effortLevels", effortArray)
    jsonObject.put("tags", tagArray)

    return jsonObject.toString()
}

private fun decodeDeckFilterDefinition(filterDefinitionJson: String): DeckFilterDefinition {
    val jsonObject = JSONObject(filterDefinitionJson)
    val version = jsonObject.getInt("version")
    val effortLevels = jsonObject.optJSONArray("effortLevels")?.toStringList()?.map { value ->
        enumValueOf<com.flashcardsopensourceapp.data.local.model.EffortLevel>(value)
    } ?: emptyList()
    val tags = jsonObject.optJSONArray("tags")?.toStringList() ?: emptyList()

    return buildDeckFilterDefinition(
        effortLevels = effortLevels,
        tags = tags
    ).copy(version = version)
}

private fun JSONArray.toStringList(): List<String> {
    return buildList {
        for (index in 0 until length()) {
            add(getString(index))
        }
    }
}
