package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
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
                effortLevel = EffortLevel.MEDIUM
            )
        )
        val createdCardId = database.cardDao().observeCardsWithRelations().first()
            .first { card -> card.card.frontText == "What is a repository?" }
            .card.cardId

        cardsRepository.updateCard(
            cardId = createdCardId,
            cardDraft = CardDraft(
                frontText = "What is a repository pattern?",
                backText = "A boundary that owns data access.",
                tags = listOf("architecture", "data"),
                effortLevel = EffortLevel.LONG
            )
        )
        cardsRepository.deleteCard(cardId = createdCardId)

        val entries = database.outboxDao().loadOutboxEntries(workspaceId = workspaceId, limit = 20)
            .filter { entry -> entry.entityId == createdCardId }

        assertEquals(3, entries.size)
        assertTrue(entries.all { entry -> entry.entityType == "card" })
        assertTrue(entries.all { entry -> entry.operationType == "upsert" })
        assertTrue(entries.any { entry ->
            JSONObject(entry.payloadJson).getString("frontText") == "What is a repository pattern?"
        })
        assertTrue(entries.any { entry ->
            JSONObject(entry.payloadJson).optString("deletedAt").isNotBlank()
        })
    }

    @Test
    fun deckMutationsWriteOutboxEntriesForCreateUpdateAndDelete(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val decksRepository = createTestDecksRepository(runtime = runtime)

        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "Architecture",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = listOf(EffortLevel.MEDIUM),
                    tags = listOf("architecture")
                )
            )
        )
        val createdDeckId = database.deckDao().observeDecks().first()
            .first { deck -> deck.name == "Architecture" }
            .deckId

        decksRepository.updateDeck(
            deckId = createdDeckId,
            deckDraft = DeckDraft(
                name = "Architecture Updated",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = listOf(EffortLevel.LONG),
                    tags = listOf("architecture", "data")
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
                effortLevel = EffortLevel.FAST
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
        assertTrue(entries.any { entry ->
            entry.entityType == "review_event" && entry.entityId == reviewLogs.first().reviewLogId
        })
        assertTrue(entries.any { entry ->
            entry.entityType == "card" && entry.entityId == cardId
        })
    }
}
