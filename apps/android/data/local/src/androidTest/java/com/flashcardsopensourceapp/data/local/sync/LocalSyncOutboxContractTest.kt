package com.flashcardsopensourceapp.data.local.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.remote.sync.RemoteBootstrapEntry
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.model.cards.CardCreationKind
import com.flashcardsopensourceapp.data.local.model.cards.CardDraft
import com.flashcardsopensourceapp.data.local.model.cards.CardImportText
import com.flashcardsopensourceapp.data.local.model.cards.DeckDraft
import com.flashcardsopensourceapp.data.local.model.cards.defaultCardType
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.cards.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.sync.SyncEntityType
import com.flashcardsopensourceapp.data.local.model.sync.SyncOperationPayload
import com.flashcardsopensourceapp.data.local.support.LocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.bootstrapTestWorkspace
import com.flashcardsopensourceapp.data.local.support.closeLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.createLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.createTestCardsRepository
import com.flashcardsopensourceapp.data.local.support.createTestDecksRepository
import com.flashcardsopensourceapp.data.local.support.createTestReviewRepository
import com.flashcardsopensourceapp.data.local.support.createTestWorkspaceRepository
import com.flashcardsopensourceapp.data.local.support.makeNewReviewOrderingCardEntity
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalSyncOutboxContractTest {
    private lateinit var runtime: LocalDatabaseTestRuntime
    private val database: AppDatabase
        get() = runtime.database

    @Before
    fun setUp() = runBlocking {
        runtime = createLocalDatabaseTestRuntime()
    }

    @After
    fun tearDown() {
        if (::runtime.isInitialized) {
            closeLocalDatabaseTestRuntime(runtime = runtime)
        }
    }

    @Test
    fun cardMutationsWriteOutboxEntriesForCreateUpdateAndDelete(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val cardsRepository = createTestCardsRepository(runtime = runtime)

        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "What is a repository?",
                backText = "A boundary that owns data access.",
                tags = listOf("architecture"),
            )
        )
        val createdCard = database.cardDao().observeCardsWithRelations().first()
            .single { card -> card.card.frontText == "What is a repository?" }
        val createdCardId = createdCard.card.cardId

        cardsRepository.updateCard(
            cardId = createdCardId,
            savedTags = createdCard.tags.map { tag -> tag.name },
            cardDraft = CardDraft(
                frontText = "What is a repository pattern?",
                backText = "A boundary that owns data access.",
                tags = listOf("architecture", "data"),
            )
        )
        cardsRepository.deleteCard(cardId = createdCardId)

        val entries = database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = 20)
            .filter { entry -> entry.entityId == createdCardId }

        assertEquals(3, entries.size)
        assertTrue(entries.all { entry -> entry.entityType == "card" })
        assertTrue(entries.all { entry -> entry.operationType == "upsert" })
        assertTrue(entries.all { entry ->
            JSONObject(entry.payloadJson).getString("cardType") == defaultCardType
        })
        assertTrue(entries.all { entry ->
            val payload = JSONObject(entry.payloadJson)
            payload.getJSONObject("metadata")
                .getJSONObject("source")
                .getString("createdAt") == payload.getString("createdAt")
        })
        entries.forEach { entry ->
            assertEquals("user_added", JSONObject(entry.payloadJson).getJSONObject("metadata").getString("creationKind"))
        }
        assertTrue(entries.any { entry ->
            JSONObject(entry.payloadJson).getString("frontText") == "What is a repository pattern?"
        })
        val deletedPayload = entries
            .map { entry -> JSONObject(entry.payloadJson) }
            .single { payload -> payload.isNull("deletedAt").not() }
        val deletedTags = deletedPayload.getJSONArray("tags")
        assertEquals(
            setOf("architecture", "data"),
            (0 until deletedTags.length()).map { index -> deletedTags.getString(index) }.toSet()
        )
        val deletedCard = requireNotNull(database.cardDao().loadCard(cardId = createdCardId))
        assertEquals(deletedCard.updatedAtMillis, requireNotNull(deletedCard.deletedAtMillis))

        val operationIds = entries.map { entry -> entry.outboxEntryId }
        runtime.syncLocalStore.markOutboxEntriesFailed(operationIds = operationIds, errorMessage = "Network unavailable")
        val retryEntries = runtime.syncLocalStore.loadOutboxEntries(workspaceId = workspaceId)
            .filter { entry -> entry.operationId in operationIds }
        assertEquals(3, retryEntries.size)
        retryEntries.forEach { entry ->
            assertEquals(1, entry.attemptCount)
            val payload = (entry.operation.payload as SyncOperationPayload.Card).payload
            assertEquals(CardCreationKind.USER_ADDED, payload.metadata.creationKind)
        }
    }

    @Test
    fun bootstrapRoundTripKeepsCreationKindOnlyOnNewUserAddedCards(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val cardsRepository = createTestCardsRepository(runtime = runtime)
        val demo = CardDraft.onboardingDemo(frontText = "Demo prompt", backText = "Demo answer", tags = listOf("demo"))
        val manual = CardDraft(frontText = "Manual prompt", backText = "Manual answer", tags = listOf("demo"))
        val imported = CardImportText(frontText = "Imported prompt", backText = "Imported answer")
        val legacy = makeNewReviewOrderingCardEntity(
            cardId = "legacy-card",
            workspaceId = workspaceId,
            createdAtMillis = 100L,
            updatedAtMillis = 100L
        )
        cardsRepository.createCard(cardDraft = demo)
        cardsRepository.createCard(cardDraft = manual)
        cardsRepository.importSpreadsheetCards(workspaceId = workspaceId, rows = listOf(imported), tags = emptyList())
        database.cardDao().insertCard(card = legacy)
        cardsRepository.updateCard(
            cardId = legacy.cardId,
            cardDraft = CardDraft(frontText = "Edited legacy prompt", backText = legacy.backText, tags = emptyList()),
            savedTags = emptyList()
        )

        val bootstrap = runtime.syncLocalStore.buildBootstrapEntries(workspaceId = workspaceId)
        val entries = (0 until bootstrap.length()).map { index -> bootstrap.getJSONObject(index) }
            .filter { entry -> entry.getString("entityType") == "card" }
            .map { entry ->
                RemoteBootstrapEntry(
                    entityType = SyncEntityType.CARD,
                    entityId = entry.getString("entityId"),
                    action = entry.getString("action"),
                    payload = entry.getJSONObject("payload")
                )
            }
        val addedFronts = setOf(manual.frontText, imported.frontText)
        assertEquals(4, entries.size)
        assertEquals(addedFronts, entries.filter { entry ->
            entry.payload.getJSONObject("metadata").optString("creationKind") == "user_added"
        }.map { entry -> entry.payload.getString("frontText") }.toSet())

        val demoMetadata = entries.single { entry -> entry.payload.getString("frontText") == demo.frontText }
            .payload.getJSONObject("metadata")
        assertTrue(demoMetadata.has("onboardingDemo"))
        assertFalse(demoMetadata.has("creationKind"))
        demoMetadata.put("creationKind", "user_added")
        database.outboxDao().deleteOutboxEntriesForWorkspace(workspaceId = workspaceId)
        entries.forEach { entry -> database.cardDao().deleteCard(cardId = entry.entityId) }
        runtime.syncLocalStore.applyBootstrapEntries(workspaceId = workspaceId, entries = entries)
        val restoredCards = database.cardDao().loadCards(workspaceId = workspaceId)
        assertEquals(4, restoredCards.size)
        restoredCards.forEach { card ->
            val metadata = JSONObject(card.metadataJson)
            if (card.frontText in addedFronts) {
                assertEquals("user_added", metadata.getString("creationKind"))
            } else {
                assertFalse(metadata.has("creationKind"))
            }
        }
    }

    @Test
    fun cardDeletionDoesNotRepeatForTombstonedOrPhysicallyAbsentCards(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val cardsRepository = createTestCardsRepository(runtime = runtime)

        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "What makes deletion idempotent?",
                backText = "Repeating it preserves the same deleted state.",
                tags = listOf("architecture"),
            )
        )
        val cardId = database.cardDao().observeCardsWithRelations().first()
            .single()
            .card.cardId

        cardsRepository.deleteCard(cardId = cardId)
        val deletedCard = requireNotNull(database.cardDao().loadCard(cardId = cardId))
        cardsRepository.deleteCard(cardId = cardId)
        assertEquals(deletedCard, database.cardDao().loadCard(cardId = cardId))
        database.cardDao().deleteCard(cardId = cardId)
        cardsRepository.deleteCard(cardId = cardId)

        val cardEntries = database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = 20)
            .filter { entry -> entry.entityId == cardId }
        assertEquals(2, cardEntries.size)
        assertEquals(
            1,
            cardEntries.count { entry ->
                JSONObject(entry.payloadJson).isNull("deletedAt").not()
            }
        )
    }

    @Test
    fun deckMutationsWriteOutboxEntriesForCreateUpdateAndDelete(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val decksRepository = createTestDecksRepository(runtime = runtime)

        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "Architecture",
                filterDefinition = buildDeckFilterDefinition(
                    tags = listOf("architecture", "medium")
                )
            )
        )
        val createdDeck = decksRepository.observeDecks().first().single { deck -> deck.name == "Architecture" }
        val createdDeckId = createdDeck.deckId

        decksRepository.updateDeck(
            deckId = createdDeckId,
            savedDraft = DeckDraft(name = createdDeck.name, filterDefinition = createdDeck.filterDefinition),
            deckDraft = DeckDraft(
                name = "Architecture Updated",
                filterDefinition = buildDeckFilterDefinition(
                    tags = listOf("architecture", "data", "long")
                )
            )
        )
        decksRepository.deleteDeck(deckId = createdDeckId)

        val entries = database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = 20)
            .filter { entry -> entry.entityId == createdDeckId }

        assertEquals(3, entries.size)
        assertTrue(entries.all { entry -> entry.entityType == "deck" })
        assertTrue(entries.any { entry ->
            JSONObject(entry.payloadJson).getString("name") == "Architecture Updated"
        })
        assertTrue(entries.any { entry ->
            JSONObject(entry.payloadJson).optString("deletedAt").isNotBlank()
        })
    }

    @Test
    fun workspaceSchedulerSaveWritesSyncOutboxEntry(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val workspaceRepository = createTestWorkspaceRepository(runtime = runtime)

        workspaceRepository.updateWorkspaceSchedulerSettings(
            desiredRetention = 0.87,
            learningStepsMinutes = listOf(3, 15),
            relearningStepsMinutes = listOf(20),
            maximumIntervalDays = 400,
            enableFuzz = false
        )

        val entries = database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = 20)
            .filter { entry -> entry.entityType == "workspace_scheduler_settings" }
        val updatedSettingsPayload = JSONObject(entries.last().payloadJson)

        assertEquals(1, entries.size)
        assertEquals("fsrs-6", updatedSettingsPayload.getString("algorithm"))
        assertEquals(0.87, updatedSettingsPayload.getDouble("desiredRetention"), 0.0001)
        assertEquals(false, updatedSettingsPayload.getBoolean("enableFuzz"))
    }

    @Test
    fun recordReviewWritesReviewEventAndCardOutboxEntries(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val cardsRepository = createTestCardsRepository(runtime = runtime)
        val reviewRepository = createTestReviewRepository(runtime = runtime)

        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "What is WorkManager?",
                backText = "Reliable background work scheduling.",
                tags = listOf("android"),
            )
        )
        val cardId = database.cardDao().observeCardsWithRelations().first()
            .first { card -> card.card.frontText == "What is WorkManager?" }
            .card.cardId

        reviewRepository.recordReview(
            cardId = cardId,
            rating = ReviewRating.GOOD,
            reviewedAtMillis = 1_000L
        )

        val reviewLogs = database.reviewLogDao().loadReviewLogs()
        val entries = database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = 20)

        assertEquals(1, reviewLogs.size)
        assertFalse(reviewLogs.first().replicaId.isBlank())
        assertFalse(reviewLogs.first().clientEventId.isBlank())
        assertFalse(reviewLogs.first().reviewedTimeZone.isNullOrBlank())
        val reviewEventEntry = entries.first { entry ->
            entry.entityType == "review_event" && entry.entityId == reviewLogs.first().reviewLogId
        }
        assertEquals(
            reviewLogs.first().reviewedTimeZone,
            JSONObject(reviewEventEntry.payloadJson).getString("reviewedTimeZone")
        )
        val cardEntries = entries.filter { entry ->
            entry.entityType == "card" && entry.entityId == cardId
        }
        assertEquals(2, cardEntries.size)
        cardEntries.forEach { entry ->
            assertEquals("user_added", JSONObject(entry.payloadJson).getJSONObject("metadata").getString("creationKind"))
        }
    }
}
