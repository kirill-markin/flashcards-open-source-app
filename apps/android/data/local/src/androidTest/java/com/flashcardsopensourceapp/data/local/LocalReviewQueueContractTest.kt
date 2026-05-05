package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewIntervalDescription
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalReviewQueueContractTest {
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
    fun reviewRepositoryResolvesMissingFiltersAndCountsPendingCards(): Unit = runBlocking {
        bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val cardsRepository = createTestCardsRepository(runtime = runtime)
        val decksRepository = createTestDecksRepository(runtime = runtime)
        val reviewRepository = createTestReviewRepository(runtime = runtime)

        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "UI basics",
                backText = "Compose UI",
                tags = listOf("ui"),
                effortLevel = EffortLevel.FAST
            )
        )
        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "Material components",
                backText = "Material 3",
                tags = listOf("ui"),
                effortLevel = EffortLevel.FAST
            )
        )
        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "Offline sync",
                backText = "Queue writes locally first.",
                tags = listOf("sync"),
                effortLevel = EffortLevel.LONG
            )
        )
        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "UI cards",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = emptyList(),
                    tags = listOf("ui")
                )
            )
        )

        val orderedCards = database.cardDao().observeCardsWithRelations().first().map { card ->
            card.card
        }

        val allCardsSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Deck(deckId = "missing-deck"),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val pendingSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = setOf(
                PendingReviewedCard(
                    cardId = orderedCards.first().cardId,
                    updatedAtMillis = orderedCards.first().updatedAtMillis
                )
            ),
            presentedCardId = null
        ).first()
        val tagSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tag(tag = "ui"),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val effortSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Effort(effortLevel = EffortLevel.FAST),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()

        assertEquals(ReviewFilter.AllCards, allCardsSnapshot.selectedFilter)
        assertEquals(3, allCardsSnapshot.dueCount)
        assertEquals(3, allCardsSnapshot.totalCount)
        assertEquals(2, pendingSnapshot.remainingCount)
        assertEquals(3, pendingSnapshot.dueCount)
        assertEquals(3, pendingSnapshot.totalCount)
        assertEquals(2, tagSnapshot.dueCount)
        assertEquals(2, tagSnapshot.totalCount)
        assertEquals(ReviewFilter.Effort(effortLevel = EffortLevel.FAST), effortSnapshot.selectedFilter)
        assertEquals(2, effortSnapshot.dueCount)
        assertEquals(2, effortSnapshot.totalCount)
        assertEquals(
            ReviewIntervalDescription.Minutes(count = 10),
            tagSnapshot.answerOptions.first { option ->
                option.rating == ReviewRating.GOOD
            }.intervalDescription
        )
    }

    @Test
    fun reviewTimelinePageMovesAlreadyRatedCardsToTail(): Unit = runBlocking {
        bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = 100L)
        val cardsRepository = createTestCardsRepository(runtime = runtime)
        val reviewRepository = createTestReviewRepository(runtime = runtime)

        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "First",
                backText = "One",
                tags = listOf("alpha"),
                effortLevel = EffortLevel.FAST
            )
        )
        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "Second",
                backText = "Two",
                tags = listOf("beta"),
                effortLevel = EffortLevel.FAST
            )
        )
        cardsRepository.createCard(
            cardDraft = CardDraft(
                frontText = "Third",
                backText = "Three",
                tags = listOf("gamma"),
                effortLevel = EffortLevel.FAST
            )
        )

        val orderedCards = database.cardDao().observeCardsWithRelations().first().map { card ->
            card.card
        }
        val pendingCards = orderedCards.take(2).map { card ->
            PendingReviewedCard(
                cardId = card.cardId,
                updatedAtMillis = card.updatedAtMillis
            )
        }.toSet()

        val page = reviewRepository.loadReviewTimelinePage(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = pendingCards,
            offset = 0,
            limit = 10
        )

        assertEquals(3, page.cards.size)
        assertEquals(pendingCards.map { card -> card.cardId }.toSet(), page.cards.takeLast(2).map { card -> card.cardId }.toSet())
        assertFalse(page.cards.first().cardId in pendingCards.map { card -> card.cardId }.toSet())
        assertTrue(page.hasMoreCards.not())
    }

    @Test
    fun reviewQueuePrioritizesRecentDueCardsBeforeOldDueNewCardsAndFutureCards(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val fiveMinutesMillis = 5 * 60 * 1_000L
        val fortyFiveMinutesMillis = 45 * 60 * 1_000L
        val oneDayMillis = 86_400_000L
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)

        database.cardDao().insertCards(
            listOf(
                makeDueReviewOrderingCardEntity(
                    cardId = "old-due-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - oneDayMillis,
                    createdAtMillis = nowMillis - (2 * oneDayMillis),
                    updatedAtMillis = nowMillis - (2 * oneDayMillis)
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "new-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = nowMillis - oneDayMillis,
                    updatedAtMillis = nowMillis - oneDayMillis
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "future-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis + oneDayMillis,
                    createdAtMillis = nowMillis - oneDayMillis,
                    updatedAtMillis = nowMillis - oneDayMillis
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-due-1115-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - fortyFiveMinutesMillis,
                    createdAtMillis = nowMillis - fortyFiveMinutesMillis,
                    updatedAtMillis = nowMillis - fortyFiveMinutesMillis
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-due-1155-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - fiveMinutesMillis,
                    createdAtMillis = nowMillis - fiveMinutesMillis,
                    updatedAtMillis = nowMillis - fiveMinutesMillis
                )
            )
        )

        val sessionSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val timelinePage = reviewRepository.loadReviewTimelinePage(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = emptySet(),
            offset = 0,
            limit = 10
        )
        val topReviewCard = database.cardDao().loadTopReviewCard(
            workspaceId = workspaceId,
            nowMillis = nowMillis
        )

        assertEquals(
            listOf("recent-due-1115-card", "recent-due-1155-card", "old-due-card", "new-card"),
            sessionSnapshot.cards.map { card -> card.cardId }
        )
        assertEquals(4, sessionSnapshot.dueCount)
        assertEquals(5, sessionSnapshot.totalCount)
        assertEquals(
            listOf("recent-due-1115-card", "recent-due-1155-card", "old-due-card", "new-card", "future-card"),
            timelinePage.cards.map { card -> card.cardId }
        )
        assertEquals("recent-due-1115-card", topReviewCard?.cardId)
    }

    @Test
    fun reviewRepositoryLoadsBoundedReviewQueueWindowAndSqlCounts(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)

        database.cardDao().insertCards(
            (0 until 10).map { index ->
                makeNewReviewOrderingCardEntity(
                    cardId = "new-card-${index.toString().padStart(length = 2, padChar = '0')}",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = 1_000L + index,
                    updatedAtMillis = 1_000L + index
                )
            }
        )

        val sessionSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()

        assertEquals(8, sessionSnapshot.cards.size)
        assertEquals("new-card-09", sessionSnapshot.presentedCard?.cardId)
        assertEquals(
            listOf(
                "new-card-09",
                "new-card-08",
                "new-card-07",
                "new-card-06",
                "new-card-05",
                "new-card-04",
                "new-card-03",
                "new-card-02"
            ),
            sessionSnapshot.cards.map { card -> card.cardId }
        )
        assertEquals(10, sessionSnapshot.dueCount)
        assertEquals(10, sessionSnapshot.remainingCount)
        assertEquals(10, sessionSnapshot.totalCount)
        assertTrue(sessionSnapshot.hasMoreCards)
    }

    @Test
    fun reviewRepositoryPreservesPresentedCardOutsideBoundedWindowOnlyWhenActive(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val fiveMinutesMillis = 5 * 60 * 1_000L
        val oneDayMillis = 86_400_000L
        val oldDueAtMillis = nowMillis - oneDayMillis
        val recentDueAtMillis = nowMillis - fiveMinutesMillis
        val futureDueAtMillis = nowMillis + oneDayMillis
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)

        database.cardDao().insertCards(
            listOf(
                makeDueReviewOrderingCardEntity(
                    cardId = "old-presented-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = oldDueAtMillis,
                    createdAtMillis = nowMillis - (2 * oneDayMillis),
                    updatedAtMillis = nowMillis - (2 * oneDayMillis)
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "future-presented-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = futureDueAtMillis,
                    createdAtMillis = nowMillis - oneDayMillis,
                    updatedAtMillis = nowMillis - oneDayMillis
                )
            ) + (0 until 8).map { index ->
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-card-${index.toString().padStart(length = 2, padChar = '0')}",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = recentDueAtMillis,
                    createdAtMillis = nowMillis - 1_000L + index,
                    updatedAtMillis = nowMillis - 1_000L + index
                )
            }
        )

        val preservedSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = emptySet(),
            presentedCardId = "old-presented-card"
        ).first()
        val futurePresentedSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = emptySet(),
            presentedCardId = "future-presented-card"
        ).first()

        assertEquals(
            listOf(
                "recent-card-07",
                "recent-card-06",
                "recent-card-05",
                "recent-card-04",
                "recent-card-03",
                "recent-card-02",
                "recent-card-01",
                "recent-card-00"
            ),
            preservedSnapshot.cards.map { card -> card.cardId }
        )
        assertEquals("old-presented-card", preservedSnapshot.presentedCard?.cardId)
        assertTrue(preservedSnapshot.answerOptionsByCardId.containsKey("old-presented-card"))
        assertEquals(9, preservedSnapshot.dueCount)
        assertEquals(10, preservedSnapshot.totalCount)
        assertEquals("recent-card-07", futurePresentedSnapshot.presentedCard?.cardId)
        assertFalse(futurePresentedSnapshot.answerOptionsByCardId.containsKey("future-presented-card"))
    }
}
