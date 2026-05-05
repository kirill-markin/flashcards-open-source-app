package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalReviewRollbackContractTest {
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
    fun reviewRepositoryLoadsCurrentDueCardForRollback(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val currentCard = makeNewReviewOrderingCardEntity(
            cardId = "rollback-current-card",
            workspaceId = workspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = nowMillis,
            updatedAtMillis = nowMillis
        )

        database.cardDao().insertCard(card = currentCard)

        val rollbackCard = requireNotNull(
            reviewRepository.loadReviewCardForRollback(
                selectedFilter = ReviewFilter.AllCards,
                cardId = currentCard.cardId
            )
        ) {
            "Expected current due card to load for rollback."
        }

        assertEquals(currentCard.cardId, rollbackCard.cardId)
        assertEquals(currentCard.updatedAtMillis, rollbackCard.updatedAtMillis)
        assertEquals(ReviewCardQueueStatus.ACTIVE, rollbackCard.queueStatus)
    }

    @Test
    fun reviewRepositoryRejectsRollbackForNonCurrentOrInactiveCards(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val oneDayMillis = 86_400_000L
        val activeWorkspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val otherWorkspaceId = "rollback-other-workspace"
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val otherWorkspaceCard = makeNewReviewOrderingCardEntity(
            cardId = "rollback-other-workspace-card",
            workspaceId = otherWorkspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = nowMillis,
            updatedAtMillis = nowMillis
        )
        val futureCard = makeDueReviewOrderingCardEntity(
            cardId = "rollback-future-card",
            workspaceId = activeWorkspaceId,
            effortLevel = EffortLevel.FAST,
            dueAtMillis = nowMillis + oneDayMillis,
            createdAtMillis = nowMillis,
            updatedAtMillis = nowMillis
        )
        val deletedCard = makeNewReviewOrderingCardEntity(
            cardId = "rollback-deleted-card",
            workspaceId = activeWorkspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = nowMillis,
            updatedAtMillis = nowMillis
        ).copy(
            deletedAtMillis = nowMillis
        )

        database.workspaceDao().insertWorkspace(
            workspace = WorkspaceEntity(
                workspaceId = otherWorkspaceId,
                name = "Rollback other workspace",
                createdAtMillis = nowMillis + 1L
            )
        )
        database.cardDao().insertCards(
            cards = listOf(
                otherWorkspaceCard,
                futureCard,
                deletedCard
            )
        )

        assertNull(
            reviewRepository.loadReviewCardForRollback(
                selectedFilter = ReviewFilter.AllCards,
                cardId = otherWorkspaceCard.cardId
            )
        )
        assertNull(
            reviewRepository.loadReviewCardForRollback(
                selectedFilter = ReviewFilter.AllCards,
                cardId = futureCard.cardId
            )
        )
        assertNull(
            reviewRepository.loadReviewCardForRollback(
                selectedFilter = ReviewFilter.AllCards,
                cardId = deletedCard.cardId
            )
        )
    }

    @Test
    fun reviewRepositoryRejectsRollbackWhenFilterResolvesAwayOrDeckPredicateFails(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val decksRepository = createTestDecksRepository(runtime = runtime)
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val visibleTag = TagEntity(
            tagId = "rollback-tag-visible",
            workspaceId = workspaceId,
            name = "Visible"
        )
        val excludedTag = TagEntity(
            tagId = "rollback-tag-excluded",
            workspaceId = workspaceId,
            name = "Excluded"
        )
        val staleTag = TagEntity(
            tagId = "rollback-tag-stale",
            workspaceId = workspaceId,
            name = "Stale"
        )
        val visibleCard = makeNewReviewOrderingCardEntity(
            cardId = "rollback-visible-card",
            workspaceId = workspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = nowMillis,
            updatedAtMillis = nowMillis
        )
        val excludedCard = makeNewReviewOrderingCardEntity(
            cardId = "rollback-excluded-card",
            workspaceId = workspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = nowMillis - 1L,
            updatedAtMillis = nowMillis - 1L
        )
        val deletedStaleCard = makeNewReviewOrderingCardEntity(
            cardId = "rollback-deleted-stale-card",
            workspaceId = workspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = nowMillis - 2L,
            updatedAtMillis = nowMillis - 2L
        ).copy(
            deletedAtMillis = nowMillis
        )

        database.cardDao().insertCards(
            cards = listOf(
                visibleCard,
                excludedCard,
                deletedStaleCard
            )
        )
        database.tagDao().insertTags(tags = listOf(visibleTag, excludedTag, staleTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = visibleCard.cardId, tagId = visibleTag.tagId),
                CardTagEntity(cardId = excludedCard.cardId, tagId = excludedTag.tagId),
                CardTagEntity(cardId = deletedStaleCard.cardId, tagId = staleTag.tagId)
            )
        )
        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "Visible rollback deck",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = emptyList(),
                    tags = listOf("Visible")
                )
            )
        )
        val visibleDeckId = requireNotNull(
            database.deckDao().observeDecks().first().firstOrNull { deck ->
                deck.name == "Visible rollback deck"
            }
        ) {
            "Expected visible rollback deck to exist."
        }.deckId

        val activeReviewTagNames = database.tagDao().loadReviewTagNames(workspaceId = workspaceId)
        val missingTagRollbackCard = reviewRepository.loadReviewCardForRollback(
            selectedFilter = ReviewFilter.Tag(tag = "Stale"),
            cardId = visibleCard.cardId
        )
        val missingDeckRollbackCard = reviewRepository.loadReviewCardForRollback(
            selectedFilter = ReviewFilter.Deck(deckId = "missing-rollback-deck"),
            cardId = visibleCard.cardId
        )
        val mismatchedDeckRollbackCard = reviewRepository.loadReviewCardForRollback(
            selectedFilter = ReviewFilter.Deck(deckId = visibleDeckId),
            cardId = excludedCard.cardId
        )

        assertEquals(listOf("Excluded", "Visible"), activeReviewTagNames)
        assertNull(missingTagRollbackCard)
        assertNull(missingDeckRollbackCard)
        assertNull(mismatchedDeckRollbackCard)
    }
}
