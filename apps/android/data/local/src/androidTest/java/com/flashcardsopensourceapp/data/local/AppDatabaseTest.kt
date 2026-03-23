package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.seed.DemoDataSeeder
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppDatabaseTest {
    private lateinit var database: AppDatabase
    private lateinit var context: Context
    private lateinit var preferencesStore: CloudPreferencesStore
    private lateinit var syncLocalStore: SyncLocalStore
    private lateinit var syncRepository: FakeSyncRepository

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")
        database = Room.inMemoryDatabaseBuilder(
            context = context,
            klass = AppDatabase::class.java
        ).allowMainThreadQueries().build()
        preferencesStore = CloudPreferencesStore(context = context)
        syncLocalStore = SyncLocalStore(
            database = database,
            preferencesStore = preferencesStore
        )
        syncRepository = FakeSyncRepository()
    }

    @After
    fun tearDown() {
        database.close()
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")
    }

    @Test
    fun seedIsIdempotentAndCreatesSyncTables(): Unit = runBlocking {
        val seeder = DemoDataSeeder(database = database)

        seeder.seedIfNeeded(currentTimeMillis = 100L)
        seeder.seedIfNeeded(currentTimeMillis = 200L)

        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals(1, database.outboxDao().countOutboxEntries())
        assertNotNull(database.syncStateDao().loadSyncState(workspaceId = "workspace-demo"))
        assertNotNull(
            database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(workspaceId = "workspace-demo")
        )
    }

    @Test
    fun cardsDecksAndWorkspaceSummariesFollowAlignedContract(): Unit = runBlocking {
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val cardsRepository = makeCardsRepository()
        val decksRepository = makeDecksRepository()
        val workspaceRepository = makeWorkspaceRepository()

        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "What is a ViewModel?",
                backText = "A lifecycle-aware state holder for a screen.",
                tags = listOf("ui", "state"),
                effortLevel = EffortLevel.FAST
            )
        )
        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "SQLite Cards",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = emptyList(),
                    tags = listOf("sqlite")
                )
            )
        )

        val cards = cardsRepository.observeCards(
            searchQuery = "",
            filter = CardFilter(
                tags = emptyList(),
                effort = emptyList()
            )
        ).first()
        val decks = decksRepository.observeDecks().first()
        val tagsSummary = workspaceRepository.observeWorkspaceTagsSummary().first()
        val overview = workspaceRepository.observeWorkspaceOverview().first()

        assertTrue(cards.any { card -> card.frontText == "What is a ViewModel?" })
        assertTrue(decks.any { deck -> deck.name == "SQLite Cards" && deck.totalCards == 2 })
        assertTrue(tagsSummary.tags.any { tag -> tag.tag == "ui" && tag.cardsCount >= 3 })
        assertEquals(11, overview?.totalCards)
        assertEquals(4, overview?.deckCount)
        assertEquals(11, overview?.dueCount)
        assertEquals(11, overview?.newCount)
    }

    @Test
    fun reviewRepositoryResolvesMissingFiltersAndCountsPendingCards(): Unit = runBlocking {
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val reviewRepository = makeReviewRepository()

        val allCardsSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Deck(deckId = "missing-deck"),
            pendingReviewedCardIds = emptySet()
        ).first()
        val pendingSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCardIds = setOf("card-1")
        ).first()
        val tagSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tag(tag = "ui"),
            pendingReviewedCardIds = emptySet()
        ).first()

        assertEquals(ReviewFilter.AllCards, allCardsSnapshot.selectedFilter)
        assertEquals(10, allCardsSnapshot.totalCount)
        assertEquals(9, pendingSnapshot.remainingCount)
        assertEquals(10, pendingSnapshot.totalCount)
        assertEquals(3, tagSnapshot.totalCount)
        assertEquals("in 10 minutes", tagSnapshot.answerOptions.first { option ->
            option.rating == com.flashcardsopensourceapp.data.local.model.ReviewRating.GOOD
        }.intervalDescription)
    }

    @Test
    fun reviewTimelinePageMovesAlreadyRatedCardsToTail(): Unit = runBlocking {
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val reviewRepository = makeReviewRepository()

        val page = reviewRepository.loadReviewTimelinePage(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCardIds = setOf("card-1", "card-2"),
            offset = 0,
            limit = 10
        )

        assertEquals("card-3", page.cards.first().cardId)
        assertEquals(listOf("card-1", "card-2"), page.cards.takeLast(2).map { card -> card.cardId })
        assertTrue(page.hasMoreCards.not())
    }

    @Test
    fun workspaceRepositoryExposesDeviceDiagnosticsAndExportData(): Unit = runBlocking {
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val workspaceRepository = makeWorkspaceRepository()

        val diagnostics = workspaceRepository.observeDeviceDiagnostics().first()
        val exportData = workspaceRepository.loadWorkspaceExportData()

        assertEquals("workspace-demo", diagnostics?.workspaceId)
        assertEquals("Personal Workspace", diagnostics?.workspaceName)
        assertEquals(1, diagnostics?.outboxEntriesCount)
        assertEquals(null, diagnostics?.lastSyncCursor)
        assertEquals(null, diagnostics?.lastSyncAttemptAtMillis)

        assertEquals("workspace-demo", exportData?.workspaceId)
        assertEquals("Personal Workspace", exportData?.workspaceName)
        assertEquals(10, exportData?.cards?.size)
        assertEquals("What does val mean in Kotlin?", exportData?.cards?.first()?.frontText)
    }

    @Test
    fun cardMutationsWriteOutboxEntriesForCreateUpdateAndDelete(): Unit = runBlocking {
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val cardsRepository = makeCardsRepository()

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

        val entries = database.outboxDao().loadOutboxEntries(workspaceId = "workspace-demo", limit = 20)
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
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val decksRepository = makeDecksRepository()

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

        val entries = database.outboxDao().loadOutboxEntries(workspaceId = "workspace-demo", limit = 20)
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
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val workspaceRepository = makeWorkspaceRepository()

        workspaceRepository.updateWorkspaceSchedulerSettings(
            desiredRetention = 0.87,
            learningStepsMinutes = listOf(3, 15),
            relearningStepsMinutes = listOf(20),
            maximumIntervalDays = 400,
            enableFuzz = false
        )

        val entries = database.outboxDao().loadOutboxEntries(workspaceId = "workspace-demo", limit = 20)
            .filter { entry -> entry.entityType == "workspace_scheduler_settings" }
        val updatedSettingsPayload = JSONObject(entries.last().payloadJson)

        assertEquals(2, entries.size)
        assertEquals("fsrs-6", updatedSettingsPayload.getString("algorithm"))
        assertEquals(0.87, updatedSettingsPayload.getDouble("desiredRetention"), 0.0001)
        assertEquals(false, updatedSettingsPayload.getBoolean("enableFuzz"))
    }

    @Test
    fun recordReviewWritesReviewEventAndCardOutboxEntries(): Unit = runBlocking {
        DemoDataSeeder(database = database).seedIfNeeded(currentTimeMillis = 100L)
        val reviewRepository = makeReviewRepository()

        reviewRepository.recordReview(
            cardId = "card-1",
            rating = com.flashcardsopensourceapp.data.local.model.ReviewRating.GOOD,
            reviewedAtMillis = 1_000L
        )

        val reviewLogs = database.reviewLogDao().loadReviewLogs()
        val entries = database.outboxDao().loadOutboxEntries(workspaceId = "workspace-demo", limit = 20)

        assertEquals(1, reviewLogs.size)
        assertFalse(reviewLogs.first().deviceId.isBlank())
        assertFalse(reviewLogs.first().clientEventId.isBlank())
        assertTrue(entries.any { entry -> entry.entityType == "review_event" && entry.entityId == reviewLogs.first().reviewLogId })
        assertTrue(entries.any { entry -> entry.entityType == "card" && entry.entityId == "card-1" })
    }

    private fun makeCardsRepository(): CardsRepository {
        return LocalCardsRepository(
            database = database,
            syncLocalStore = syncLocalStore
        )
    }

    private fun makeDecksRepository(): DecksRepository {
        return LocalDecksRepository(
            database = database,
            syncLocalStore = syncLocalStore
        )
    }

    private fun makeWorkspaceRepository(): WorkspaceRepository {
        return LocalWorkspaceRepository(
            database = database,
            preferencesStore = preferencesStore,
            syncRepository = syncRepository,
            syncLocalStore = syncLocalStore
        )
    }

    private fun makeReviewRepository(): ReviewRepository {
        return LocalReviewRepository(
            database = database,
            preferencesStore = preferencesStore,
            syncLocalStore = syncLocalStore
        )
    }
}

private class FakeSyncRepository : SyncRepository {
    private val syncStatus = MutableStateFlow(
        SyncStatusSnapshot(
            status = SyncStatus.Idle,
            lastSuccessfulSyncAtMillis = null,
            lastErrorMessage = ""
        )
    )

    override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
        return syncStatus.asStateFlow()
    }

    override suspend fun scheduleSync() {
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Syncing)
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Idle)
    }

    override suspend fun syncNow() {
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Syncing)
        syncStatus.value = syncStatus.value.copy(status = SyncStatus.Idle)
    }
}
