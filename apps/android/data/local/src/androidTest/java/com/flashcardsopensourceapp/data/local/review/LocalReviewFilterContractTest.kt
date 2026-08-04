package com.flashcardsopensourceapp.data.local.review

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.database.core.AppDatabase
import com.flashcardsopensourceapp.data.local.database.entities.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.entities.TagEntity
import com.flashcardsopensourceapp.data.local.database.entities.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.cards.DeckDraft
import com.flashcardsopensourceapp.data.local.model.cards.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
import com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload
import com.flashcardsopensourceapp.data.local.notifications.SharedPreferencesReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.decodePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.notifications.makePersistedReviewFilter
import com.flashcardsopensourceapp.data.local.support.LocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.bootstrapTestWorkspace
import com.flashcardsopensourceapp.data.local.support.closeLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.createLocalDatabaseTestRuntime
import com.flashcardsopensourceapp.data.local.support.createTestDecksRepository
import com.flashcardsopensourceapp.data.local.support.createTestReviewRepository
import com.flashcardsopensourceapp.data.local.support.makeNewReviewOrderingCardEntity
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
    fun reviewRepositoryDropsDeletedOnlyTagWithoutBroadeningTheSelection(): Unit = runBlocking {
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
                    createdAtMillis = nowMillis,
                    updatedAtMillis = nowMillis
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "deleted-stale-card",
                    workspaceId = workspaceId,
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
            selectedFilter = ReviewFilter.Tags(tags = listOf("stale")),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val partiallyResolvedSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tags(tags = listOf("stale", "Visible")),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val timelinePage = reviewRepository.loadReviewTimelinePage(
            selectedFilter = ReviewFilter.Tags(tags = listOf("stale")),
            pendingReviewedCards = emptySet(),
            offset = 0,
            limit = 10
        )

        assertEquals(listOf("Visible"), activeReviewTagNames)
        assertEquals(ReviewFilter.Tags(tags = emptyList()), sessionSnapshot.selectedFilter)
        assertTrue(sessionSnapshot.cards.isEmpty())
        assertEquals(null, sessionSnapshot.presentedCard)
        assertEquals(0, sessionSnapshot.dueCount)
        assertEquals(0, sessionSnapshot.totalCount)
        assertTrue(timelinePage.cards.isEmpty())
        assertFalse(timelinePage.hasMoreCards)
        assertEquals(
            ReviewFilter.Tags(tags = listOf("Visible")),
            partiallyResolvedSnapshot.selectedFilter
        )
        assertEquals(listOf("visible-card"), partiallyResolvedSnapshot.cards.map { card -> card.cardId })
        assertEquals(1, partiallyResolvedSnapshot.dueCount)
        assertEquals(1, partiallyResolvedSnapshot.totalCount)
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
                    createdAtMillis = 100L,
                    updatedAtMillis = 100L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "other-workspace-presented-card",
                    workspaceId = otherWorkspaceId,
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
            createdAtMillis = 100L,
            updatedAtMillis = 100L
        )
        val otherWorkspaceCard = makeNewReviewOrderingCardEntity(
            cardId = "other-workspace-pending-card",
            workspaceId = otherWorkspaceId,
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
    fun reviewRepositoryMatchesAnySelectedTagAndTreatsEmptySelectionAsMatchNone(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val alphaTag = TagEntity(tagId = "tag-alpha", workspaceId = workspaceId, name = "Alpha")
        val betaTag = TagEntity(tagId = "tag-beta", workspaceId = workspaceId, name = "Beta")
        val gammaTag = TagEntity(tagId = "tag-gamma", workspaceId = workspaceId, name = "Gamma")
        val cardsById = listOf(
            "alpha-card",
            "beta-card",
            "both-card",
            "gamma-card",
            "untagged-card"
        ).mapIndexed { index, cardId ->
            makeNewReviewOrderingCardEntity(
                cardId = cardId,
                workspaceId = workspaceId,
                createdAtMillis = index.toLong(),
                updatedAtMillis = index.toLong()
            )
        }.associateBy { card ->
            card.cardId
        }

        database.cardDao().insertCards(cards = cardsById.values.toList())
        database.tagDao().insertTags(tags = listOf(alphaTag, betaTag, gammaTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = "alpha-card", tagId = alphaTag.tagId),
                CardTagEntity(cardId = "beta-card", tagId = betaTag.tagId),
                CardTagEntity(cardId = "both-card", tagId = alphaTag.tagId),
                CardTagEntity(cardId = "both-card", tagId = betaTag.tagId),
                CardTagEntity(cardId = "gamma-card", tagId = gammaTag.tagId)
            )
        )

        val orSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tags(tags = listOf("Alpha", "Beta")),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val emptySnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tags(tags = emptyList()),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val allTagsSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = ReviewFilter.Tags(tags = listOf("Alpha", "Beta", "Gamma")),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()

        assertEquals(setOf("alpha-card", "beta-card", "both-card"), orSnapshot.cards.map { it.cardId }.toSet())
        assertEquals(3, orSnapshot.dueCount)
        assertEquals(3, orSnapshot.totalCount)
        assertEquals(ReviewFilter.Tags(tags = emptyList()), emptySnapshot.selectedFilter)
        assertTrue(emptySnapshot.cards.isEmpty())
        assertEquals(0, emptySnapshot.dueCount)
        assertEquals(0, emptySnapshot.totalCount)
        assertEquals(ReviewFilter.AllCards, allTagsSnapshot.selectedFilter)
        assertEquals(cardsById.keys, allTagsSnapshot.cards.map { it.cardId }.toSet())
    }

    @Test
    fun reviewPreferencesPersistMultiTagSelectionPerWorkspaceAndDecodeLegacyValues() {
        val store = SharedPreferencesReviewPreferencesStore(context = runtime.context)
        val decomposedTag = "E\u0301clair"
        val firstWorkspaceFilter = makeReviewTagFilter(
            tagNames = listOf("Alpha", " Éclair ", decomposedTag)
        )
        val secondWorkspaceFilter = ReviewFilter.Tags(tags = emptyList())
        val missingTagFilter = ReviewFilter.Tags(tags = listOf("Alpha", "missing"))
        store.saveSelectedReviewFilter(workspaceId = "workspace-a", reviewFilter = firstWorkspaceFilter)
        store.saveSelectedReviewFilter(workspaceId = "workspace-b", reviewFilter = secondWorkspaceFilter)
        store.saveSelectedReviewFilter(workspaceId = "workspace-missing", reviewFilter = missingTagFilter)

        val preferences = runtime.context.getSharedPreferences(
            "flashcards-review-preferences",
            Context.MODE_PRIVATE
        )
        check(
            preferences.edit()
                .putString("selected-review-filter::legacy-tag", "{\"kind\":\"tag\",\"tag\":\"Legacy\"}")
                .putString("selected-review-filter::legacy-deck", "{\"kind\":\"deck\",\"deckId\":\"deck-1\"}")
                .putString("selected-review-filter::legacy-effort", "{\"kind\":\"effort\",\"effortLevel\":\"MEDIUM\"}")
                .putString(
                    "selected-review-filter::unicode-tags",
                    "{\"kind\":\"tags\",\"tags\":[\" Éclair \",\"$decomposedTag\"]}"
                )
                .commit()
        ) {
            "Could not seed legacy review preferences."
        }

        assertEquals(firstWorkspaceFilter, store.loadSelectedReviewFilter(workspaceId = "workspace-a"))
        assertEquals(secondWorkspaceFilter, store.loadSelectedReviewFilter(workspaceId = "workspace-b"))
        assertEquals(missingTagFilter, store.loadSelectedReviewFilter(workspaceId = "workspace-missing"))
        assertEquals(
            ReviewFilter.Tags(tags = listOf("Legacy")),
            store.loadSelectedReviewFilter(workspaceId = "legacy-tag")
        )
        assertEquals(
            ReviewFilter.Deck(deckId = "deck-1"),
            store.loadSelectedReviewFilter(workspaceId = "legacy-deck")
        )
        assertEquals(
            ReviewFilter.Tags(tags = listOf("medium")),
            store.loadSelectedReviewFilter(workspaceId = "legacy-effort")
        )
        assertEquals(
            makeReviewTagFilter(tagNames = listOf("Éclair", decomposedTag)),
            store.loadSelectedReviewFilter(workspaceId = "unicode-tags")
        )
    }

    @Test
    fun scheduledNotificationPayloadCodecPreservesMultiTagAndLegacySingleTagFilters() {
        runtime.context.deleteSharedPreferences("flashcards-review-notifications")
        val store = SharedPreferencesReviewNotificationsStore(context = runtime.context)
        val decomposedTag = "E\u0301clair"
        val selectedFilter = makeReviewTagFilter(
            tagNames = listOf("Alpha", "Éclair", decomposedTag)
        )
        store.saveScheduledPayloads(
            payloads = listOf(
                ScheduledReviewNotificationPayload(
                    workspaceId = "workspace-a",
                    reviewFilter = makePersistedReviewFilter(reviewFilter = selectedFilter),
                    cardId = "card-1",
                    frontText = "Front",
                    scheduledAtMillis = 1_000L,
                    requestId = "request-1"
                )
            )
        )

        assertEquals(
            selectedFilter,
            decodePersistedReviewFilter(filter = store.loadScheduledPayloads().single().reviewFilter)
        )

        val preferences = runtime.context.getSharedPreferences(
            "flashcards-review-notifications",
            Context.MODE_PRIVATE
        )
        check(
            preferences.edit().putString(
                "review-notifications-scheduled-payloads",
                "[{\"workspaceId\":\"workspace-a\",\"reviewFilter\":{\"kind\":\"tag\",\"tag\":\"Legacy\"}," +
                    "\"cardId\":\"card-1\",\"frontText\":\"Front\",\"scheduledAtMillis\":1000," +
                    "\"requestId\":\"request-legacy\"}]"
            ).commit()
        ) {
            "Could not seed legacy scheduled review notification payload."
        }

        assertEquals(
            ReviewFilter.Tags(tags = listOf("Legacy")),
            decodePersistedReviewFilter(filter = store.loadScheduledPayloads().single().reviewFilter)
        )
        assertTrue(runtime.context.deleteSharedPreferences("flashcards-review-notifications"))
    }

    @Test
    fun reviewRepositoryMatchesCanonicalUnicodeTagIdentityInBoundedQueueAndCounts(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val workspaceId = bootstrapTestWorkspace(runtime = runtime, currentTimeMillis = nowMillis)
        val reviewRepository = createTestReviewRepository(runtime = runtime)
        val decomposedTagName = "E\u0301clair"
        val composedTag = TagEntity(
            tagId = "tag-eclair-composed",
            workspaceId = workspaceId,
            name = "Éclair"
        )
        val decomposedTag = TagEntity(
            tagId = "tag-eclair-decomposed",
            workspaceId = workspaceId,
            name = decomposedTagName
        )
        val plainTag = TagEntity(
            tagId = "tag-plain",
            workspaceId = workspaceId,
            name = "Plain"
        )

        database.cardDao().insertCards(
            listOf(
                makeNewReviewOrderingCardEntity(
                    cardId = "composed-tag-card",
                    workspaceId = workspaceId,
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "decomposed-tag-card",
                    workspaceId = workspaceId,
                    createdAtMillis = 150L,
                    updatedAtMillis = 150L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "plain-tag-card",
                    workspaceId = workspaceId,
                    createdAtMillis = 100L,
                    updatedAtMillis = 100L
                )
            )
        )
        database.tagDao().insertTags(tags = listOf(composedTag, decomposedTag, plainTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = "composed-tag-card", tagId = composedTag.tagId),
                CardTagEntity(cardId = "composed-tag-card", tagId = decomposedTag.tagId),
                CardTagEntity(cardId = "decomposed-tag-card", tagId = decomposedTag.tagId),
                CardTagEntity(cardId = "plain-tag-card", tagId = plainTag.tagId)
            )
        )

        val sessionSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = makeReviewTagFilter(tagNames = listOf("éclair", decomposedTagName)),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val allTagsSnapshot = reviewRepository.observeReviewSession(
            selectedFilter = makeReviewTagFilter(tagNames = listOf("ÉCLAIR", decomposedTagName, "plain")),
            pendingReviewedCards = emptySet(),
            presentedCardId = null
        ).first()
        val boundedQueueCardIds = database.reviewQueueDao().observeNewReviewQueueByAnyTags(
            workspaceId = workspaceId,
            tagNames = listOf("Éclair", decomposedTagName),
            limit = 8
        ).first().map { card ->
            card.card.cardId
        }
        val dueCount = database.reviewCountDao().observeReviewDueCountByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Éclair", decomposedTagName)
        ).first()
        val totalCount = database.reviewCountDao().observeReviewTotalCountByAnyTags(
            workspaceId = workspaceId,
            tagNames = listOf("Éclair", decomposedTagName)
        ).first()

        assertEquals(makeReviewTagFilter(tagNames = listOf(decomposedTagName)), sessionSnapshot.selectedFilter)
        assertEquals(
            listOf("decomposed-tag-card", "composed-tag-card"),
            sessionSnapshot.cards.map { card -> card.cardId }
        )
        assertEquals("decomposed-tag-card", sessionSnapshot.presentedCard?.cardId)
        assertEquals(2, sessionSnapshot.dueCount)
        assertEquals(2, sessionSnapshot.remainingCount)
        assertEquals(2, sessionSnapshot.totalCount)
        assertEquals(listOf("decomposed-tag-card", "composed-tag-card"), boundedQueueCardIds)
        assertEquals(2, dueCount)
        assertEquals(2, totalCount)
        assertEquals(ReviewFilter.AllCards, allTagsSnapshot.selectedFilter)
        assertEquals(3, allTagsSnapshot.totalCount)
        assertEquals(
            listOf(ReviewTagFilterOption(tag = decomposedTagName, totalCount = 2)),
            sessionSnapshot.availableTagFilters.filter { tag ->
                tag.tag != "Plain"
            }
        )
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
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "other-deck-card",
                    workspaceId = workspaceId,
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
                    tags = listOf("привет")
                )
            )
        )
        decksRepository.createDeck(
            deckDraft = DeckDraft(
                name = "Missing tag deck",
                filterDefinition = buildDeckFilterDefinition(
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
