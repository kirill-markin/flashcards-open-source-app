package com.flashcardsopensourceapp.data.local

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
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
class LocalReviewFilterContractTest {
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
    fun reviewRepositoryResolvesDeletedOnlyDirectTagFromActiveReviewTagsAsAllCards(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val staleTag = TagEntity(
            tagId = "tag-stale",
            workspaceId = workspaceId,
            name = "Stale"
        )
        val visibleTag = TagEntity(
            tagId = "tag-visible",
            workspaceId = workspaceId,
            name = "Visible"
        )

        database.cardDao().insertCards(
            listOf(
                makeNewReviewOrderingCardEntity(
                    cardId = "visible-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = nowMillis,
                    updatedAtMillis = nowMillis
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "deleted-stale-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = nowMillis - 1L,
                    updatedAtMillis = nowMillis - 1L
                ).copy(
                    deletedAtMillis = nowMillis
                )
            )
        )
        database.tagDao().insertTags(tags = listOf(staleTag, visibleTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = "deleted-stale-card", tagId = staleTag.tagId),
                CardTagEntity(cardId = "visible-card", tagId = visibleTag.tagId)
            )
        )

        val activeReviewTagNames = database.tagDao().loadReviewTagNames(workspaceId = workspaceId)
        val sessionSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tag(tag = "stale"),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val timelinePage = reviewRepository.loadReviewTimelinePage(
            selectedFilter = ReviewFilter.Tag(tag = "stale"),
            pendingReviewedCards = emptySet(),
            offset = 0,
            limit = 10
        )

        assertEquals(listOf("Visible"), activeReviewTagNames)
        assertEquals(ReviewFilter.AllCards, sessionSnapshot.selectedFilter)
        assertEquals(listOf("visible-card"), sessionSnapshot.cards.map { card -> card.cardId })
        assertEquals("visible-card", sessionSnapshot.presentedCard?.cardId)
        assertEquals(1, sessionSnapshot.dueCount)
        assertEquals(1, sessionSnapshot.totalCount)
        assertEquals(listOf("visible-card"), timelinePage.cards.map { card -> card.cardId })
        assertFalse(timelinePage.hasMoreCards)
    }

    @Test
    fun reviewRepositoryDoesNotPreservePresentedCardFromAnotherWorkspace(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val activeWorkspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val otherWorkspaceId = "other-workspace"
        val reviewRepository = createTestReviewRepository(runtime = runtime)

        database.workspaceDao().insertWorkspace(
            workspace = WorkspaceEntity(
                workspaceId = otherWorkspaceId,
                name = "Other",
                createdAtMillis = nowMillis + 1L
            )
        )
        database.cardDao().insertCards(
            listOf(
                makeNewReviewOrderingCardEntity(
                    cardId = "active-workspace-card",
                    workspaceId = activeWorkspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = 100L,
                    updatedAtMillis = 100L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "other-workspace-presented-card",
                    workspaceId = otherWorkspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                )
            )
        )

        val sessionSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = emptySet(),
            presentedCardId = "other-workspace-presented-card"
        ).first()

        assertEquals(listOf("active-workspace-card"), sessionSnapshot.cards.map { card -> card.cardId })
        assertEquals("active-workspace-card", sessionSnapshot.presentedCard?.cardId)
        assertFalse(sessionSnapshot.answerOptionsByCardId.containsKey("other-workspace-presented-card"))
        assertEquals(1, sessionSnapshot.dueCount)
        assertEquals(1, sessionSnapshot.totalCount)
    }

    @Test
    fun reviewRepositoryDoesNotSubtractPendingReviewedCardFromAnotherWorkspace(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val activeWorkspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val otherWorkspaceId = "other-pending-workspace"
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val activeWorkspaceCard = makeNewReviewOrderingCardEntity(
            cardId = "active-workspace-card",
            workspaceId = activeWorkspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = 100L,
            updatedAtMillis = 100L
        )
        val otherWorkspaceCard = makeNewReviewOrderingCardEntity(
            cardId = "other-workspace-pending-card",
            workspaceId = otherWorkspaceId,
            effortLevel = EffortLevel.FAST,
            createdAtMillis = 200L,
            updatedAtMillis = 200L
        )

        database.workspaceDao().insertWorkspace(
            workspace = WorkspaceEntity(
                workspaceId = otherWorkspaceId,
                name = "Other pending",
                createdAtMillis = nowMillis + 1L
            )
        )
        database.cardDao().insertCards(cards = listOf(activeWorkspaceCard, otherWorkspaceCard))

        val sessionSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.AllCards,
            pendingReviewedCards = setOf(
                PendingReviewedCard(
                    cardId = otherWorkspaceCard.cardId,
                    updatedAtMillis = otherWorkspaceCard.updatedAtMillis
                )
            ),
            presentedCardId = null
        ).first()

        assertEquals(listOf(activeWorkspaceCard.cardId), sessionSnapshot.cards.map { card -> card.cardId })
        assertEquals(activeWorkspaceCard.cardId, sessionSnapshot.presentedCard?.cardId)
        assertEquals(1, sessionSnapshot.dueCount)
        assertEquals(1, sessionSnapshot.remainingCount)
        assertEquals(1, sessionSnapshot.totalCount)
    }

    @Test
    fun reviewRepositoryMatchesUnicodeTagFilterInBoundedQueueAndCounts(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val unicodeTag = TagEntity(
            tagId = "tag-eclair",
            workspaceId = workspaceId,
            name = "Éclair"
        )
        val plainTag = TagEntity(
            tagId = "tag-plain",
            workspaceId = workspaceId,
            name = "Plain"
        )

        database.cardDao().insertCards(
            listOf(
                makeNewReviewOrderingCardEntity(
                    cardId = "unicode-tag-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "plain-tag-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = 100L,
                    updatedAtMillis = 100L
                )
            )
        )
        database.tagDao().insertTags(tags = listOf(unicodeTag, plainTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = "unicode-tag-card", tagId = unicodeTag.tagId),
                CardTagEntity(cardId = "plain-tag-card", tagId = plainTag.tagId)
            )
        )

        val sessionSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tag(tag = "éclair"),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val boundedQueueCardIds = database.cardDao().observeActiveReviewQueueByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Éclair"),
            limit = 8
        ).first().map { card ->
            card.card.cardId
        }
        val dueCount = database.cardDao().observeReviewDueCountByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Éclair")
        ).first()
        val totalCount = database.cardDao().observeReviewTotalCountByAnyTags(
            workspaceId = workspaceId,
            tagNames = listOf("Éclair")
        ).first()

        assertEquals(ReviewFilter.Tag(tag = "Éclair"), sessionSnapshot.selectedFilter)
        assertEquals(listOf("unicode-tag-card"), sessionSnapshot.cards.map { card -> card.cardId })
        assertEquals("unicode-tag-card", sessionSnapshot.presentedCard?.cardId)
        assertEquals(1, sessionSnapshot.dueCount)
        assertEquals(1, sessionSnapshot.remainingCount)
        assertEquals(1, sessionSnapshot.totalCount)
        assertEquals(listOf("unicode-tag-card"), boundedQueueCardIds)
        assertEquals(1, dueCount)
        assertEquals(1, totalCount)
        assertTrue(sessionSnapshot.availableTagFilters.any { tag ->
            tag.tag == "Éclair" && tag.totalCount == 1
        })
    }

    @Test
    fun reviewRepositoryMatchesDeckFilterUnicodeTagsThroughExactStoredNames(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val decksRepository = createTestDecksRepository(runtime = runtime)
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val unicodeTag = TagEntity(
            tagId = "tag-privet",
            workspaceId = workspaceId,
            name = "Привет"
        )

        database.cardDao().insertCards(
            listOf(
                makeNewReviewOrderingCardEntity(
                    cardId = "unicode-deck-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "other-deck-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    createdAtMillis = 100L,
                    updatedAtMillis = 100L
                )
            )
        )
        database.tagDao().insertTags(tags = listOf(unicodeTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = "unicode-deck-card", tagId = unicodeTag.tagId)
            )
        )
        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "Unicode deck",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = emptyList(),
                    tags = listOf("привет")
                )
            )
        )
        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "Missing tag deck",
                filterDefinition = buildDeckFilterDefinition(
                    effortLevels = emptyList(),
                    tags = listOf("missing-unicode-tag")
                )
            )
        )
        val decks = database.deckDao().observeDecks().first()
        val unicodeDeckId = requireNotNull(decks.firstOrNull { deck ->
            deck.name == "Unicode deck"
        }) {
            "Expected Unicode deck to exist."
        }.deckId
        val missingTagDeckId = requireNotNull(decks.firstOrNull { deck ->
            deck.name == "Missing tag deck"
        }) {
            "Expected missing tag deck to exist."
        }.deckId

        val unicodeDeckSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Deck(deckId = unicodeDeckId),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val missingTagDeckSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Deck(deckId = missingTagDeckId),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()

        assertEquals(listOf("unicode-deck-card"), unicodeDeckSnapshot.cards.map { card -> card.cardId })
        assertEquals(1, unicodeDeckSnapshot.dueCount)
        assertEquals(1, unicodeDeckSnapshot.totalCount)
        assertTrue(unicodeDeckSnapshot.availableDeckFilters.any { deck ->
            deck.deckId == unicodeDeckId && deck.totalCount == 1
        })
        assertTrue(unicodeDeckSnapshot.availableDeckFilters.any { deck ->
            deck.deckId == missingTagDeckId && deck.totalCount == 0
        })
        assertTrue(missingTagDeckSnapshot.cards.isEmpty())
        assertEquals(0, missingTagDeckSnapshot.dueCount)
        assertEquals(0, missingTagDeckSnapshot.totalCount)
    }
}
