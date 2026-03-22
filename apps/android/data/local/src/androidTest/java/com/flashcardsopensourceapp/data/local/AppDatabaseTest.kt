package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.seed.DemoDataSeeder
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppDatabaseTest {
    private lateinit var database: AppDatabase

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(
            context = context,
            klass = AppDatabase::class.java
        ).allowMainThreadQueries().build()
    }

    @After
    fun tearDown() {
        database.close()
    }

    @Test
    fun seedIsIdempotentAndCreatesDraftSyncTables(): Unit = runBlocking {
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
        val cardsRepository = LocalCardsRepository(database = database)
        val decksRepository = LocalDecksRepository(database = database)
        val workspaceRepository = LocalWorkspaceRepository(database = database)

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
        val reviewRepository = LocalReviewRepository(database = database)

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
        val reviewRepository = LocalReviewRepository(database = database)

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
}
