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
            listOf("All cards", "Android UI", "Kotlin Basics"),
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

private class FakeDecksRepository : DecksRepository {
    private val decksState = MutableStateFlow(
        listOf(
            DeckSummary(
                deckId = "deck-ui",
                workspaceId = "workspace-demo",
                name = "Android UI",
                filterDefinition = DeckFilterDefinition(
                    version = 2,
                    effortLevels = emptyList(),
                    tags = listOf("Android")
                ),
                totalCards = 1,
                dueCards = 1,
                newCards = 1,
                reviewedCards = 0,
                createdAtMillis = 1L,
                updatedAtMillis = 1L
            ),
            DeckSummary(
                deckId = "deck-kotlin",
                workspaceId = "workspace-demo",
                name = "Kotlin Basics",
                filterDefinition = DeckFilterDefinition(
                    version = 2,
                    effortLevels = emptyList(),
                    tags = listOf("kotlin")
                ),
                totalCards = 1,
                dueCards = 1,
                newCards = 1,
                reviewedCards = 0,
                createdAtMillis = 2L,
                updatedAtMillis = 2L
            )
        )
    )

    override fun observeDecks(): Flow<List<DeckSummary>> {
        return decksState
    }

    override fun observeDeck(deckId: String): Flow<DeckSummary?> {
        return decksState.map { decks ->
            decks.firstOrNull { deck -> deck.deckId == deckId }
        }
    }

    override fun observeDeckCards(deckId: String): Flow<List<CardSummary>> {
        return flowOf(emptyList())
    }

    override suspend fun createDeck(deckDraft: DeckDraft) {
    }

    override suspend fun updateDeck(deckId: String, deckDraft: DeckDraft) {
    }

    override suspend fun deleteDeck(deckId: String) {
    }
}

private class FakeCardsRepository : CardsRepository {
    private val cards = listOf(
        CardSummary(
            cardId = "card-1",
            workspaceId = "workspace-demo",
            frontText = "What does Room wrap on Android?",
            backText = "SQLite",
            tags = listOf("Android"),
            effortLevel = EffortLevel.FAST,
            dueAtMillis = null,
            createdAtMillis = 1L,
            updatedAtMillis = 1L,
            reps = 0,
            lapses = 0,
            fsrsCardState = com.flashcardsopensourceapp.data.local.model.FsrsCardState.NEW,
            fsrsStepIndex = null,
            fsrsStability = null,
            fsrsDifficulty = null,
            fsrsLastReviewedAtMillis = null,
            fsrsScheduledDays = null,
            deletedAtMillis = null
        ),
        CardSummary(
            cardId = "card-2",
            workspaceId = "workspace-demo",
            frontText = "What does val mean in Kotlin?",
            backText = "Immutable reference",
            tags = listOf("kotlin"),
            effortLevel = EffortLevel.FAST,
            dueAtMillis = 100L,
            createdAtMillis = 2L,
            updatedAtMillis = 2L,
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
    )

    override fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>> {
        return flowOf(cards)
    }

    override fun observeCard(cardId: String): Flow<CardSummary?> {
        return flowOf(cards.firstOrNull { card -> card.cardId == cardId })
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
            workspaceId = "workspace-demo",
            workspaceName = "Demo",
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
                workspaceId = "workspace-demo",
                name = "Demo",
                createdAtMillis = 1L
            )
        )
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return flowOf(
            AppMetadataSummary(
                currentWorkspaceName = "Demo",
                workspaceName = "Demo",
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
