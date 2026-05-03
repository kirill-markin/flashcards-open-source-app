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
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
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
import com.flashcardsopensourceapp.data.local.repository.SystemProgressTimeProvider
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
                timeProvider = SystemProgressTimeProvider
            )
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
        assertEquals(3, allCardsSnapshot.totalCount)
        assertEquals(2, pendingSnapshot.remainingCount)
        assertEquals(3, pendingSnapshot.totalCount)
        assertEquals(2, tagSnapshot.totalCount)
        assertEquals(ReviewFilter.Effort(effortLevel = EffortLevel.FAST), effortSnapshot.selectedFilter)
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
        assertEquals(
            listOf("recent-due-1115-card", "recent-due-1155-card", "old-due-card", "new-card", "future-card"),
            timelinePage.cards.map { card -> card.cardId }
        )
        assertEquals("recent-due-1115-card", topReviewCard?.cardId)
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
            normalizedTagNames = listOf("priority")
        )
        val effortAndTagTop = database.cardDao().loadTopReviewCardByEffortLevelsAndAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            effortLevels = listOf(EffortLevel.MEDIUM),
            normalizedTagNames = listOf("priority")
        )
        val futureOnlyTagTop = database.cardDao().loadTopReviewCardByAnyTags(
            workspaceId = workspaceId,
            nowMillis = nowMillis,
            normalizedTagNames = listOf("future only")
        )

        assertEquals("recent-cutoff-a", allCardsTop?.cardId)
        assertEquals("recent-cutoff-a", effortTop?.cardId)
        assertEquals("recent-cutoff-a", tagTop?.cardId)
        assertEquals("due-now-card", effortAndTagTop?.cardId)
        assertNull(futureOnlyTagTop)
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
                timeProvider = SystemProgressTimeProvider
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
