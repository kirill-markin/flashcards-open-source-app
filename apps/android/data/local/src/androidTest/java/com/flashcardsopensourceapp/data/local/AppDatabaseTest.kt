package com.flashcardsopensourceapp.data.local

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.flashcardsopensourceapp.data.local.bootstrap.ensureLocalWorkspaceShell
import com.flashcardsopensourceapp.data.local.bootstrap.localWorkspaceName
import com.flashcardsopensourceapp.data.local.cloud.CloudPreferencesStore
import com.flashcardsopensourceapp.data.local.cloud.SyncLocalStore
import com.flashcardsopensourceapp.data.local.database.AppDatabase
import com.flashcardsopensourceapp.data.local.database.CardEntity
import com.flashcardsopensourceapp.data.local.database.CardTagEntity
import com.flashcardsopensourceapp.data.local.database.TagEntity
import com.flashcardsopensourceapp.data.local.database.WorkspaceEntity
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewCardQueueStatus
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewIntervalDescription
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.buildDeckFilterDefinition
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalCardsRepository
import com.flashcardsopensourceapp.data.local.repository.LocalDecksRepository
import com.flashcardsopensourceapp.data.local.repository.LocalProgressCacheStore
import com.flashcardsopensourceapp.data.local.repository.LocalReviewRepository
import com.flashcardsopensourceapp.data.local.repository.LocalWorkspaceRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.SystemTimeProvider
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.data.local.review.SharedPreferencesReviewPreferencesStore
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
import org.junit.Assert.assertNull
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
    fun setUp() = runBlocking {
        context = ApplicationProvider.getApplicationContext()
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")
        context.deleteSharedPreferences("flashcards-review-preferences")
        database = Room.inMemoryDatabaseBuilder(
            context = context,
            klass = AppDatabase::class.java
        ).allowMainThreadQueries().build()
        preferencesStore = CloudPreferencesStore(context = context, database = database)
        preferencesStore.hydrateCloudSettingsFromDatabase()
        syncLocalStore = SyncLocalStore(
            database = database,
            preferencesStore = preferencesStore,
            reviewPreferencesStore = SharedPreferencesReviewPreferencesStore(context = context),
            localProgressCacheStore = LocalProgressCacheStore(
                database = database,
                timeProvider = SystemTimeProvider
            ),
            timeProvider = SystemTimeProvider
        )
        syncRepository = FakeSyncRepository()
    }

    @After
    fun tearDown() {
        database.close()
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")
        context.deleteSharedPreferences("flashcards-review-preferences")
    }

    @Test
    fun localWorkspaceBootstrapIsIdempotentAndCreatesEmptyState(): Unit = runBlocking {
        val firstWorkspaceId = bootstrapLocalWorkspace(currentTimeMillis = 100L)
        val secondWorkspaceId = bootstrapLocalWorkspace(currentTimeMillis = 200L)

        assertEquals(firstWorkspaceId, secondWorkspaceId)
        assertEquals(1, database.workspaceDao().countWorkspaces())
        assertEquals(localWorkspaceName, database.workspaceDao().loadAnyWorkspace()?.name)
        assertEquals(0, database.outboxDao().countOutboxEntries())
        assertNotNull(database.syncStateDao().loadSyncState(workspaceId = firstWorkspaceId))
        assertNotNull(
            database.workspaceSchedulerSettingsDao().loadWorkspaceSchedulerSettings(workspaceId = firstWorkspaceId)
        )
        assertTrue(database.cardDao().observeCardsWithRelations().first().isEmpty())
        assertTrue(database.deckDao().observeDecks().first().isEmpty())
    }

    @Test
    fun cloudPreferencesStoreMigratesLegacyIdentityFromPreferencesIntoDatabaseSettings() = runBlocking {
        database.close()
        context.deleteSharedPreferences("flashcards-cloud-metadata")
        context.deleteSharedPreferences("flashcards-cloud-secrets")

        val legacyPreferences = context.getSharedPreferences("flashcards-cloud-metadata", Context.MODE_PRIVATE)
        legacyPreferences.edit()
            .putString("installation-id", "legacy-installation-id")
            .putString("cloud-state", "LINKED")
            .putString("linked-user-id", "legacy-user")
            .putString("linked-workspace-id", "legacy-workspace")
            .putString("linked-email", "legacy@example.com")
            .putString("active-workspace-id", "legacy-workspace")
            .putLong("updated-at-millis", 456L)
            .commit()

        database = Room.inMemoryDatabaseBuilder(
            context = context,
            klass = AppDatabase::class.java
        ).allowMainThreadQueries().build()
        val migratedStore = CloudPreferencesStore(context = context, database = database)
        migratedStore.hydrateCloudSettingsFromDatabase()

        val migratedSettings = migratedStore.currentCloudSettings()
        val storedSettings = requireNotNull(database.appLocalSettingsDao().loadSettings()) {
            "Expected app_local_settings after legacy migration."
        }

        assertEquals("legacy-installation-id", migratedSettings.installationId)
        assertEquals("legacy-workspace", migratedSettings.activeWorkspaceId)
        assertEquals("legacy-installation-id", storedSettings.installationId)
        assertEquals("LINKED", storedSettings.cloudState)
        assertEquals("legacy-user", storedSettings.linkedUserId)
        assertEquals("legacy-workspace", storedSettings.linkedWorkspaceId)
        assertEquals("legacy@example.com", storedSettings.linkedEmail)
        assertEquals("legacy-workspace", storedSettings.activeWorkspaceId)
        assertEquals(456L, storedSettings.updatedAtMillis)
    }

    @Test
    fun cardsDecksAndWorkspaceSummariesFollowAlignedContract(): Unit = runBlocking {
        bootstrapLocalWorkspace(currentTimeMillis = 100L)
        val cardsRepository = makeCardsRepository()
        val decksRepository = makeDecksRepository()
        val workspaceRepository = makeWorkspaceRepository()

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
    fun reviewRepositoryResolvesMissingFiltersAndCountsPendingCards(): Unit = runBlocking {
        bootstrapLocalWorkspace(currentTimeMillis = 100L)
        val cardsRepository = makeCardsRepository()
        val decksRepository = makeDecksRepository()
        val reviewRepository = makeReviewRepository()

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
        bootstrapLocalWorkspace(currentTimeMillis = 100L)
        val cardsRepository = makeCardsRepository()
        val reviewRepository = makeReviewRepository()

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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val reviewRepository = makeReviewRepository()

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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val reviewRepository = makeReviewRepository()

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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val reviewRepository = makeReviewRepository()

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

    @Test
    fun reviewRepositoryLoadsCurrentDueCardForRollback(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val reviewRepository = makeReviewRepository()
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
        val activeWorkspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val otherWorkspaceId = "rollback-other-workspace"
        val reviewRepository = makeReviewRepository()
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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val decksRepository = makeDecksRepository()
        val reviewRepository = makeReviewRepository()
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

    @Test
    fun reviewRepositoryResolvesDeletedOnlyDirectTagFromActiveReviewTagsAsAllCards(): Unit = runBlocking {
        val nowMillis = System.currentTimeMillis()
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val reviewRepository = makeReviewRepository()
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
        val activeWorkspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val otherWorkspaceId = "other-workspace"
        val reviewRepository = makeReviewRepository()

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
        val activeWorkspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val otherWorkspaceId = "other-pending-workspace"
        val reviewRepository = makeReviewRepository()
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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val reviewRepository = makeReviewRepository()
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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val decksRepository = makeDecksRepository()
        val reviewRepository = makeReviewRepository()
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

    @Test
    fun topReviewCardQueriesUseRecentDueBoundariesAndFilters(): Unit = runBlocking {
        val nowMillis = 12 * 60 * 60 * 1_000L
        val oneHourMillis = 60 * 60 * 1_000L
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = nowMillis)
        val priorityTag = TagEntity(
            tagId = "tag-priority",
            workspaceId = workspaceId,
            name = "Priority"
        )
        val futureTag = TagEntity(
            tagId = "tag-future-only",
            workspaceId = workspaceId,
            name = "Future Only"
        )

        database.cardDao().insertCards(
            listOf(
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-a",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 300L,
                    updatedAtMillis = 300L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-b",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 300L,
                    updatedAtMillis = 300L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "recent-cutoff-older-created",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis - oneHourMillis,
                    createdAtMillis = 200L,
                    updatedAtMillis = 200L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "old-boundary-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.LONG,
                    dueAtMillis = nowMillis - oneHourMillis - 1L,
                    createdAtMillis = 400L,
                    updatedAtMillis = 400L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "due-now-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.MEDIUM,
                    dueAtMillis = nowMillis,
                    createdAtMillis = 500L,
                    updatedAtMillis = 500L
                ),
                makeNewReviewOrderingCardEntity(
                    cardId = "new-medium-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.MEDIUM,
                    createdAtMillis = 600L,
                    updatedAtMillis = 600L
                ),
                makeDueReviewOrderingCardEntity(
                    cardId = "future-card",
                    workspaceId = workspaceId,
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = nowMillis + 1L,
                    createdAtMillis = 700L,
                    updatedAtMillis = 700L
                )
            )
        )
        database.tagDao().insertTags(tags = listOf(priorityTag, futureTag))
        database.tagDao().insertCardTags(
            cardTags = listOf(
                CardTagEntity(cardId = "recent-cutoff-a", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "recent-cutoff-b", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "recent-cutoff-older-created", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "old-boundary-card", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "due-now-card", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "new-medium-card", tagId = priorityTag.tagId),
                CardTagEntity(cardId = "future-card", tagId = futureTag.tagId)
            )
        )

        val allCardsTop = database.cardDao().loadTopReviewCard(
            workspaceId = workspaceId,
            nowMillis = nowMillis
        )
        val effortTop = database.cardDao().loadTopReviewCardByEffortLevels(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(EffortLevel.FAST)
        )
        val tagTop = database.cardDao().loadTopReviewCardByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Priority")
        )
        val effortAndTagTop = database.cardDao().loadTopReviewCardByEffortLevelsAndAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(EffortLevel.MEDIUM),
            tagNames = listOf("Priority")
        )
        val futureOnlyTagTop = database.cardDao().loadTopReviewCardByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Future Only")
        )
        val boundedQueue = database.cardDao().observeActiveReviewQueue(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            limit = 4
        ).first().map { card ->
            card.card.cardId
        }
        val effortAndTagQueue = database.cardDao().observeActiveReviewQueueByEffortLevelsAndAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(EffortLevel.MEDIUM),
            tagNames = listOf("Priority"),
            limit = 10
        ).first().map { card ->
            card.card.cardId
        }
        val priorityDueCount = database.cardDao().observeReviewDueCountByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Priority")
        ).first()
        val priorityTotalCount = database.cardDao().observeReviewTotalCountByAnyTags(
            workspaceId = workspaceId,
            tagNames = listOf("Priority")
        ).first()
        val futureOnlyDueCount = database.cardDao().observeReviewDueCountByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            tagNames = listOf("Future Only")
        ).first()
        val futureOnlyTotalCount = database.cardDao().observeReviewTotalCountByAnyTags(
            workspaceId = workspaceId,
            tagNames = listOf("Future Only")
        ).first()

        assertEquals("recent-cutoff-a", allCardsTop?.cardId)
        assertEquals("recent-cutoff-a", effortTop?.cardId)
        assertEquals("recent-cutoff-a", tagTop?.cardId)
        assertEquals("due-now-card", effortAndTagTop?.cardId)
        assertNull(futureOnlyTagTop)
        assertEquals(
            listOf("recent-cutoff-a", "recent-cutoff-b", "recent-cutoff-older-created", "due-now-card"),
            boundedQueue
        )
        assertEquals(listOf("due-now-card", "new-medium-card"), effortAndTagQueue)
        assertEquals(6, priorityDueCount)
        assertEquals(6, priorityTotalCount)
        assertEquals(0, futureOnlyDueCount)
        assertEquals(1, futureOnlyTotalCount)
    }

    @Test
    fun observeCardsWithRelationsOrdersCardsByUpdatedAtDescending(): Unit = runBlocking {
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = 100L)
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

    @Test
    fun workspaceRepositoryExposesDeviceDiagnosticsAndExportDataForEmptyWorkspace(): Unit = runBlocking {
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = 100L)
        val workspaceRepository = makeWorkspaceRepository()

        val diagnostics = workspaceRepository.observeDeviceDiagnostics().first()
        val exportData = workspaceRepository.loadWorkspaceExportData()

        assertEquals(workspaceId, diagnostics?.workspaceId)
        assertEquals(localWorkspaceName, diagnostics?.workspaceName)
        assertEquals(0, diagnostics?.outboxEntriesCount)
        assertEquals(null, diagnostics?.lastSyncCursor)
        assertEquals(null, diagnostics?.lastSyncAttemptAtMillis)

        assertEquals(workspaceId, exportData?.workspaceId)
        assertEquals(localWorkspaceName, exportData?.workspaceName)
        assertTrue(exportData?.cards?.isEmpty() == true)
    }

    @Test
    fun cardMutationsWriteOutboxEntriesForCreateUpdateAndDelete(): Unit = runBlocking {
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = 100L)
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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = 100L)
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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = 100L)
        val workspaceRepository = makeWorkspaceRepository()

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
        val workspaceId = bootstrapLocalWorkspace(currentTimeMillis = 100L)
        val cardsRepository = makeCardsRepository()
        val reviewRepository = makeReviewRepository()

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

    private suspend fun bootstrapLocalWorkspace(currentTimeMillis: Long): String {
        val workspaceId = ensureLocalWorkspaceShell(
            database = database,
            currentTimeMillis = currentTimeMillis
        )
        preferencesStore.hydrateCloudSettingsFromDatabase()
        return workspaceId
    }

    private fun makeCardsRepository(): CardsRepository {
        return LocalCardsRepository(
            database = database,
            preferencesStore = preferencesStore,
            syncLocalStore = syncLocalStore
        )
    }

    private fun makeDecksRepository(): DecksRepository {
        return LocalDecksRepository(
            database = database,
            preferencesStore = preferencesStore,
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
            syncLocalStore = syncLocalStore,
            localProgressCacheStore = LocalProgressCacheStore(
                database = database,
                timeProvider = SystemTimeProvider
            )
        )
    }

    private fun makeDueReviewOrderingCardEntity(
        cardId: String,
        workspaceId: String,
        effortLevel: EffortLevel,
        dueAtMillis: Long,
        createdAtMillis: Long,
        updatedAtMillis: Long
    ): CardEntity {
        return CardEntity(
            cardId = cardId,
            workspaceId = workspaceId,
            frontText = cardId,
            backText = "Back",
            effortLevel = effortLevel,
            dueAtMillis = dueAtMillis,
            createdAtMillis = createdAtMillis,
            updatedAtMillis = updatedAtMillis,
            reps = 1,
            lapses = 0,
            fsrsCardState = FsrsCardState.REVIEW,
            fsrsStepIndex = null,
            fsrsStability = 1.0,
            fsrsDifficulty = 1.0,
            fsrsLastReviewedAtMillis = createdAtMillis,
            fsrsScheduledDays = 1,
            deletedAtMillis = null
        )
    }

    private fun makeNewReviewOrderingCardEntity(
        cardId: String,
        workspaceId: String,
        effortLevel: EffortLevel,
        createdAtMillis: Long,
        updatedAtMillis: Long
    ): CardEntity {
        return CardEntity(
            cardId = cardId,
            workspaceId = workspaceId,
            frontText = cardId,
            backText = "Back",
            effortLevel = effortLevel,
            dueAtMillis = null,
            createdAtMillis = createdAtMillis,
            updatedAtMillis = updatedAtMillis,
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
