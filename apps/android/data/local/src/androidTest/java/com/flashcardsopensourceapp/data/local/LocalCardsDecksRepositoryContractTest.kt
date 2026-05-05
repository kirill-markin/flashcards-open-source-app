package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalCardsDecksRepositoryContractTest {
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
    fun cardsDecksAndWorkspaceSummariesFollowAlignedContract(): Unit = runBlocking {
        bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val cardsRepository = createTestCardsRepository(runtime = runtime)
        val decksRepository = createTestDecksRepository(runtime = runtime)
        val workspaceRepository = createTestWorkspaceRepository(runtime = runtime)

        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "What is a ViewModel?",
                backText = "A lifecycle-aware state holder for a screen.",
                tags = listOf("android", "state"),
                effortLevel = EffortLevel.FAST
            )
        )
        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "What is SQLite used for?",
                backText = "Persistent local storage.",
                tags = listOf("storage"),
                effortLevel = EffortLevel.MEDIUM
            )
        )
        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "Storage Cards",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = emptyList(),
                    tags = listOf("storage")
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

        assertEquals(2, cards.size)
        assertTrue(decks.any { deck -> deck.name == "Storage Cards" && deck.totalCards == 1 })
        assertTrue(tagsSummary.tags.any { tag -> tag.tag == "android" && tag.cardsCount == 1 })
        assertTrue(tagsSummary.tags.any { tag -> tag.tag == "storage" && tag.cardsCount == 1 })
        assertEquals(2, overview?.totalCards)
        assertEquals(1, overview?.deckCount)
        assertEquals(2, overview?.dueCount)
        assertEquals(2, overview?.newCount)
    }

    @Test
    fun observeCardsWithRelationsOrdersCardsByUpdatedAtDescending(): Unit = runBlocking {
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val olderCard = CardEntity(
            cardId = "card-older",
            workspaceId = workspaceId,
            frontText = "Older",
            backText = "Back",
            effortLevel = EffortLevel.FAST,
            dueAtMillis = null,
            createdAtMillis = 100L,
            updatedAtMillis = 100L,
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
        val newerCard = CardEntity(
            cardId = "card-newer",
            workspaceId = workspaceId,
            frontText = "Newer",
            backText = "Back",
            effortLevel = EffortLevel.FAST,
            dueAtMillis = null,
            createdAtMillis = 200L,
            updatedAtMillis = 200L,
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

        database.cardDao().insertCard(card = olderCard)
        database.cardDao().insertCard(card = newerCard)
        database.cardDao().updateCard(
            card = olderCard.copy(
                frontText = "Older updated",
                updatedAtMillis = 300L
            )
        )

        val orderedCardIds = database.cardDao().observeCardsWithRelations().first().map { card ->
            card.card.cardId
        }

        assertEquals(listOf("card-older", "card-newer"), orderedCardIds)
    }
}
