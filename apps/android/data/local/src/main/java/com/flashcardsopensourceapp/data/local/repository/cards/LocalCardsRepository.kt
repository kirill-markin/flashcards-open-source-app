package com.flashcardsopensourceapp.data.local.repository.cards

import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.sync.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardEntity
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cards.defaultCardType
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.CardImportText
import com.flashcardsopensourceapp.data.local.model.cards.CardFilter
import com.flashcardsopensourceapp.data.local.model.cards.CardSummary
import com.flashcardsopensourceapp.data.local.model.cards.applyTagSelectionChanges
import com.flashcardsopensourceapp.data.local.model.cards.cardMetadataAfterAuthoredEdit
import com.flashcardsopensourceapp.data.local.model.cards.decodeCardMetadataJson
import com.flashcardsopensourceapp.data.local.model.cards.encodeCardMetadataJson
import com.flashcardsopensourceapp.data.local.model.cards.makeDefaultCardMetadata
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTags
import com.flashcardsopensourceapp.data.local.model.cloud.formatIsoTimestamp
import com.flashcardsopensourceapp.data.local.model.scheduling.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.cards.queryCards
import com.flashcardsopensourceapp.data.local.repository.CardImportWorkspaceChangedException
import com.flashcardsopensourceapp.data.local.repository.CardUnavailableException
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.loadCurrentWorkspaceOrNull
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
        val card = makeNewCard(
            workspaceId = workspace.workspaceId,
            cardDraft = cardDraft,
            currentTimeMillis = System.currentTimeMillis()
        )

        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            database.cardDao().insertCard(card = card)
            replaceCardTags(
                database = database,
                workspaceId = workspace.workspaceId,
                cardId = card.cardId,
                tags = cardDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(
                card = card,
                tags = cardDraft.tags,
                affectsReviewSchedule = true
            )
        }
    }

    override suspend fun importSpreadsheetCards(workspaceId: String, rows: List<CardImportText>, tags: List<String>) {
        require(rows.isNotEmpty() && rows.all { row -> row.frontText.isNotBlank() && row.backText.isNotBlank() }) {
            "Spreadsheet import requires cards with both sides filled in."
        }
        runLocalOutboxMutationTransaction(database = database, preferencesStore = preferencesStore) {
            val workspace = loadCurrentWorkspaceOrNull(database = database, preferencesStore = preferencesStore)
            if (workspace?.workspaceId != workspaceId) throw CardImportWorkspaceChangedException()

            val existingTags = database.tagDao().loadTagsForWorkspace(workspaceId = workspaceId).map(TagEntity::name)
            val currentTimeMillis = System.currentTimeMillis()
            val tagNames = normalizeTags(values = tags, referenceTags = existingTags).ifEmpty {
                listOf(makeSpreadsheetImportTag(currentTimeMillis = currentTimeMillis))
            }
            val resolvedTags = resolveOrCreateCardTags(database = database, workspaceId = workspaceId, names = tagNames)
            for (row in rows) {
                val card = makeNewCard(
                    workspaceId = workspaceId,
                    cardDraft = CardDraft(frontText = row.frontText.trim(), backText = row.backText.trim(), tags = tagNames),
                    currentTimeMillis = currentTimeMillis
                )
                database.cardDao().insertCard(card = card)
                database.tagDao().insertCardTags(cardTags = resolvedTags.map { tag ->
                    CardTagEntity(cardId = card.cardId, tagId = tag.tagId)
                })
                syncLocalStore.enqueueCardUpsert(card = card, tags = tagNames, affectsReviewSchedule = true)
            }
        }
    }

    override suspend fun updateCard(cardId: String, cardDraft: CardDraft, savedTags: List<String>): CardDraft {
        return runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            val currentCard = database.cardDao().loadCard(cardId = cardId)
            if (currentCard == null || currentCard.deletedAtMillis != null) {
                throw CardUnavailableException(cardId = cardId)
            }
            val currentTags = requireNotNull(database.cardDao().observeCardWithRelations(cardId = cardId).first()) {
                "Cannot load relations for card being updated: $cardId"
            }.tags.map(TagEntity::name)
            val updatedDraft = CardDraft(
                frontText = cardDraft.frontText,
                backText = cardDraft.backText,
                tags = applyTagSelectionChanges(
                    savedTags = savedTags,
                    selectedTags = cardDraft.tags,
                    currentTags = currentTags
                )
            )
            val updatedCard: CardEntity = currentCard.copy(
                frontText = cardDraft.frontText,
                backText = cardDraft.backText,
                metadataJson = encodeCardMetadataJson(metadata = cardMetadataAfterAuthoredEdit(
                    metadata = decodeCardMetadataJson(metadataJson = currentCard.metadataJson),
                    frontText = currentCard.frontText, backText = currentCard.backText,
                    tags = currentTags, cardType = currentCard.cardType, input = updatedDraft
                )),
                updatedAtMillis = System.currentTimeMillis()
            )

            database.cardDao().updateCard(card = updatedCard)
            replaceCardTags(
                database = database,
                workspaceId = currentCard.workspaceId,
                cardId = cardId,
                tags = updatedDraft.tags
            )
            syncLocalStore.enqueueCardUpsert(
                card = updatedCard,
                tags = updatedDraft.tags,
                affectsReviewSchedule = false
            )
            updatedDraft
        }
    }

    override suspend fun deleteCard(cardId: String) {
        runLocalOutboxMutationTransaction(
            database = database,
            preferencesStore = preferencesStore
        ) {
            val card: CardEntity = database.cardDao().loadCard(cardId = cardId)
                ?: return@runLocalOutboxMutationTransaction
            if (card.deletedAtMillis != null) {
                return@runLocalOutboxMutationTransaction
            }

            val deletionTimestampMillis: Long = System.currentTimeMillis()
            val deletedCard: CardEntity = card.copy(
                updatedAtMillis = deletionTimestampMillis,
                deletedAtMillis = deletionTimestampMillis
            )
            val cardTags: List<String> = requireNotNull(
                database.cardDao().observeCardWithRelations(cardId = cardId).first()
            ) {
                "Cannot load relations for card being deleted: $cardId"
            }.tags.map(TagEntity::name)
            database.cardDao().updateCard(card = deletedCard)
            syncLocalStore.enqueueCardUpsert(
                card = deletedCard,
                tags = cardTags,
                affectsReviewSchedule = true
            )
        }
    }
}

private fun makeNewCard(workspaceId: String, cardDraft: CardDraft, currentTimeMillis: Long): CardEntity {
    return CardEntity(
        cardId = UUID.randomUUID().toString(),
        workspaceId = workspaceId,
        frontText = cardDraft.frontText,
        backText = cardDraft.backText,
        cardType = defaultCardType,
        metadataJson = encodeCardMetadataJson(metadata = makeDefaultCardMetadata(
            createdAt = formatIsoTimestamp(currentTimeMillis)
        ).copy(onboardingDemo = cardDraft.onboardingDemo)),
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
}

private fun makeSpreadsheetImportTag(currentTimeMillis: Long): String {
    val date = formatIsoTimestamp(currentTimeMillis).take(10)
    return "import:$date-${UUID.randomUUID()}"
}
