package com.flashcardsopensourceapp.feature.settings

import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckDraft
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.DecksRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceLibraryViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun decksListStartsWithSyntheticAllCardsEntry() = runTest(dispatcher) {
        val viewModel = DecksViewModel(
            decksRepository = FakeDecksRepository(),
            workspaceRepository = FakeLibraryWorkspaceRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()

        assertEquals(DeckListTargetUiState.AllCards, viewModel.uiState.value.deckEntries.first().target)
        assertEquals("All cards", viewModel.uiState.value.deckEntries.first().title)
        assertEquals(
            listOf("All cards", "UI", "Basics"),
            viewModel.uiState.value.deckEntries.map(DeckListEntryUiState::title)
        )
        collectionJob.cancel()
    }

    @Test
    fun allCardsDetailUsesWorkspaceTotalsAndCards() = runTest(dispatcher) {
        val viewModel = DeckDetailViewModel(
            decksRepository = FakeDecksRepository(),
            cardsRepository = FakeCardsRepository(),
            workspaceRepository = FakeLibraryWorkspaceRepository(),
            deckDetailRequest = DeckDetailRequest.AllCards
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()

        val detail = viewModel.uiState.value.detail as DeckDetailInfoUiState.AllCards
        assertEquals("All cards", detail.title)
        assertEquals(4, detail.totalCards)
        assertEquals(2, detail.dueCards)
        assertEquals(2, viewModel.uiState.value.cards.size)
        collectionJob.cancel()
    }

    @Test
    fun tagsSearchIsTrimmedAndCaseInsensitive() = runTest(dispatcher) {
        val viewModel = WorkspaceTagsViewModel(workspaceRepository = FakeLibraryWorkspaceRepository())
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.updateSearchQuery("  ANDROID ")
        advanceUntilIdle()

        assertEquals(listOf("Android"), viewModel.uiState.value.tags.map(WorkspaceTagSummary::tag))
        assertEquals(4, viewModel.uiState.value.totalCards)
        collectionJob.cancel()
    }

    @Test
    fun decksListReactsToDeckRepositoryChangesWithoutManualReload() = runTest(dispatcher) {
        val decksRepository = FakeDecksRepository()
        val viewModel = DecksViewModel(
            decksRepository = decksRepository,
            workspaceRepository = FakeLibraryWorkspaceRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        decksRepository.appendDeck(
            deck = sampleDeckSummary(
                deckId = "deck-storage",
                name = "Storage Focus",
                tags = listOf("Android", "storage")
            )
        )
        advanceUntilIdle()

        assertEquals(
            listOf("All cards", "UI", "Basics", "Storage Focus"),
            viewModel.uiState.value.deckEntries.map(DeckListEntryUiState::title)
        )
        collectionJob.cancel()
    }

    @Test
    fun deckDetailReactsWhenMatchingCardsChange() = runTest(dispatcher) {
        val matchingCard = sampleLibraryCard(
            cardId = "card-ui",
            frontText = "How do Material 3 chips work?",
            tags = listOf("Android")
        )
        val updatedMatchingCard = sampleLibraryCard(
            cardId = "card-ui-2",
            frontText = "How do adaptive panes work?",
            tags = listOf("Android")
        )
        val decksRepository = FakeDecksRepository(
            deckCards = mapOf(
                "deck-ui" to listOf(matchingCard)
            )
        )
        val viewModel = DeckDetailViewModel(
            decksRepository = decksRepository,
            cardsRepository = FakeCardsRepository(),
            workspaceRepository = FakeLibraryWorkspaceRepository(),
            deckDetailRequest = DeckDetailRequest.PersistedDeck(deckId = "deck-ui")
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        assertEquals(listOf("How do Material 3 chips work?"), viewModel.uiState.value.cards.map(CardSummary::frontText))

        decksRepository.replaceDeckCards(
            deckId = "deck-ui",
            cards = listOf(updatedMatchingCard)
        )
        advanceUntilIdle()

        assertEquals(listOf("How do adaptive panes work?"), viewModel.uiState.value.cards.map(CardSummary::frontText))
        collectionJob.cancel()
    }

    private fun startCollecting(scope: TestScope, viewModel: DecksViewModel): Job {
        return scope.launch {
            viewModel.uiState.collect { }
        }
    }

    private fun startCollecting(scope: TestScope, viewModel: DeckDetailViewModel): Job {
        return scope.launch {
            viewModel.uiState.collect { }
        }
    }

    private fun startCollecting(scope: TestScope, viewModel: WorkspaceTagsViewModel): Job {
        return scope.launch {
            viewModel.uiState.collect { }
        }
    }
}

private class FakeDecksRepository(
    initialDecks: List<DeckSummary> = listOf(
        sampleDeckSummary(
            deckId = "deck-ui",
            name = "UI",
            tags = listOf("Android")
        ),
        sampleDeckSummary(
            deckId = "deck-kotlin",
            name = "Basics",
            tags = listOf("kotlin"),
            createdAtMillis = 2L
        )
    ),
    deckCards: Map<String, List<CardSummary>> = emptyMap()
) : DecksRepository {
    private val decksState = MutableStateFlow(initialDecks)
    private val deckCardsState = MutableStateFlow(deckCards)

    override fun observeDecks(): Flow<List<DeckSummary>> {
        return decksState
    }

    override fun observeDeck(deckId: String): Flow<DeckSummary?> {
        return decksState.map { decks ->
            decks.firstOrNull { deck -> deck.deckId == deckId }
        }
    }

    override fun observeDeckCards(deckId: String): Flow<List<CardSummary>> {
        return deckCardsState.map { cardsByDeck ->
            cardsByDeck[deckId].orEmpty()
        }
    }

    override suspend fun createDeck(deckDraft: DeckDraft) {
        decksState.value = decksState.value + sampleDeckSummary(
            deckId = "created-${decksState.value.size + 1}",
            name = deckDraft.name,
            tags = deckDraft.filterDefinition.tags
        )
    }

    override suspend fun updateDeck(deckId: String, deckDraft: DeckDraft) {
        decksState.value = decksState.value.map { deck ->
            if (deck.deckId == deckId) {
                deck.copy(
                    name = deckDraft.name,
                    filterDefinition = deckDraft.filterDefinition
                )
            } else {
                deck
            }
        }
    }

    override suspend fun deleteDeck(deckId: String) {
        decksState.value = decksState.value.filterNot { deck ->
            deck.deckId == deckId
        }
        deckCardsState.value = deckCardsState.value - deckId
    }

    fun appendDeck(deck: DeckSummary) {
        decksState.value = decksState.value + deck
    }

    fun replaceDeckCards(deckId: String, cards: List<CardSummary>) {
        deckCardsState.value = deckCardsState.value + (deckId to cards)
    }
}

private class FakeCardsRepository : CardsRepository {
    private val cardsState = MutableStateFlow(
        listOf(
            sampleLibraryCard(
                cardId = "card-1",
                frontText = "What does Room wrap on Android?",
                tags = listOf("Android")
            ),
            sampleLibraryCard(
                cardId = "card-2",
                frontText = "What is an immutable binding?",
                tags = listOf("kotlin"),
                dueAtMillis = 100L,
                createdAtMillis = 2L
            )
        )
    )

    override fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>> {
        return cardsState
    }

    override fun observeCard(cardId: String): Flow<CardSummary?> {
        return cardsState.map { cards ->
            cards.firstOrNull { card -> card.cardId == cardId }
        }
    }

    override suspend fun createCard(cardDraft: CardDraft) {
    }

    override suspend fun updateCard(cardId: String, cardDraft: CardDraft) {
    }

    override suspend fun deleteCard(cardId: String) {
    }
}

private class FakeLibraryWorkspaceRepository : WorkspaceRepository {
    private val overviewState = MutableStateFlow(
        WorkspaceOverviewSummary(
            workspaceId = "workspace-local",
            workspaceName = "Personal",
            totalCards = 4,
            deckCount = 2,
            tagsCount = 2,
            dueCount = 2,
            newCount = 3,
            reviewedCount = 1
        )
    )
    private val tagsSummaryState = MutableStateFlow(
        WorkspaceTagsSummary(
            tags = listOf(
                WorkspaceTagSummary(tag = "Android", cardsCount = 2),
                WorkspaceTagSummary(tag = "kotlin", cardsCount = 2)
            ),
            totalCards = 4
        )
    )

    override fun observeWorkspace(): Flow<WorkspaceSummary?> {
        return flowOf(
            WorkspaceSummary(
                workspaceId = "workspace-local",
                name = "Personal",
                createdAtMillis = 1L
            )
        )
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return flowOf(
            AppMetadataSummary(
                currentWorkspaceName = "Personal",
                workspaceName = "Personal",
                deckCount = 2,
                cardCount = 4,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Synced"
            )
        )
    }

    override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
        return overviewState
    }

    override fun observeWorkspaceSchedulerSettings(): Flow<WorkspaceSchedulerSettings?> {
        return flowOf(null)
    }

    override fun observeWorkspaceTagsSummary(): Flow<WorkspaceTagsSummary> {
        return tagsSummaryState
    }

    override fun observeDeviceDiagnostics(): Flow<DeviceDiagnosticsSummary?> {
        return flowOf(null)
    }

    override suspend fun loadWorkspaceExportData(): WorkspaceExportData? {
        return null
    }

    override suspend fun updateWorkspaceSchedulerSettings(
        desiredRetention: Double,
        learningStepsMinutes: List<Int>,
        relearningStepsMinutes: List<Int>,
        maximumIntervalDays: Int,
        enableFuzz: Boolean
    ) {
    }
}

private fun sampleDeckSummary(
    deckId: String,
    name: String,
    tags: List<String>,
    createdAtMillis: Long = 1L
): DeckSummary {
    return DeckSummary(
        deckId = deckId,
        workspaceId = "workspace-local",
        name = name,
        filterDefinition = DeckFilterDefinition(
            version = 2,
            effortLevels = emptyList(),
            tags = tags
        ),
        totalCards = 1,
        dueCards = 1,
        newCards = 1,
        reviewedCards = 0,
        createdAtMillis = createdAtMillis,
        updatedAtMillis = createdAtMillis
    )
}

private fun sampleLibraryCard(
    cardId: String,
    frontText: String,
    tags: List<String>,
    dueAtMillis: Long? = null,
    createdAtMillis: Long = 1L
): CardSummary {
    return CardSummary(
        cardId = cardId,
        workspaceId = "workspace-local",
        frontText = frontText,
        backText = "Answer",
        tags = tags,
        effortLevel = EffortLevel.FAST,
        dueAtMillis = dueAtMillis,
        createdAtMillis = createdAtMillis,
        updatedAtMillis = createdAtMillis,
        reps = 0,
        lapses = 0,
        fsrsCardState = com.flashcardsopensourceapp.data.local.model.FsrsCardState.NEW,
        fsrsStepIndex = null,
        fsrsStability = null,
        fsrsDifficulty = null,
        fsrsLastReviewedAtMillis = null,
        fsrsScheduledDays = null,
        deletedAtMillis = null
    )
}
