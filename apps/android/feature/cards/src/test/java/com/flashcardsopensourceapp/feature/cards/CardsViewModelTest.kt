package com.flashcardsopensourceapp.feature.cards

import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.CardDraft
import com.flashcardsopensourceapp.data.local.model.CardFilter
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.FsrsCardState
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.repository.CardsRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.collect
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
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CardsViewModelTest {
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
    fun searchAndFiltersUpdateVisibleCards() = runTest(dispatcher) {
        val cardsRepository = FakeCardsListRepository(
            cards = listOf(
                sampleCardsListItem(
                    cardId = "card-android",
                    frontText = "What does Room wrap?",
                    tags = listOf("android"),
                    effortLevel = EffortLevel.FAST
                ),
                sampleCardsListItem(
                    cardId = "card-kotlin",
                    frontText = "What does val mean?",
                    tags = listOf("kotlin"),
                    effortLevel = EffortLevel.LONG
                )
            )
        )
        val viewModel = CardsViewModel(
            cardsRepository = cardsRepository,
            workspaceRepository = FakeCardsWorkspaceRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        assertEquals(listOf("What does Room wrap?", "What does val mean?"), viewModel.uiState.value.cards.map(CardSummary::frontText))

        viewModel.updateSearchQuery(query = "val")
        advanceUntilIdle()
        assertEquals(listOf("What does val mean?"), viewModel.uiState.value.cards.map(CardSummary::frontText))

        viewModel.updateSearchQuery(query = "")
        viewModel.applyFilter(
            filter = CardFilter(
                tags = listOf("android"),
                effort = emptyList()
            )
        )
        advanceUntilIdle()
        assertEquals(listOf("What does Room wrap?"), viewModel.uiState.value.cards.map(CardSummary::frontText))

        viewModel.applyFilter(
            filter = CardFilter(
                tags = emptyList(),
                effort = listOf(EffortLevel.LONG)
            )
        )
        advanceUntilIdle()
        assertEquals(listOf("What does val mean?"), viewModel.uiState.value.cards.map(CardSummary::frontText))

        collectionJob.cancel()
    }

    @Test
    fun clearFilterRestoresFullCardsList() = runTest(dispatcher) {
        val viewModel = CardsViewModel(
            cardsRepository = FakeCardsListRepository(
                cards = listOf(
                    sampleCardsListItem(
                        cardId = "card-android",
                        frontText = "What does Room wrap?",
                        tags = listOf("android"),
                        effortLevel = EffortLevel.FAST
                    ),
                    sampleCardsListItem(
                        cardId = "card-compose",
                        frontText = "What is a composable?",
                        tags = listOf("android", "compose"),
                        effortLevel = EffortLevel.LONG
                    )
                )
            ),
            workspaceRepository = FakeCardsWorkspaceRepository()
        )
        val collectionJob = startCollecting(scope = this, viewModel = viewModel)

        advanceUntilIdle()
        viewModel.applyFilter(
            filter = CardFilter(
                tags = listOf("compose"),
                effort = emptyList()
            )
        )
        advanceUntilIdle()
        assertEquals(listOf("What is a composable?"), viewModel.uiState.value.cards.map(CardSummary::frontText))

        viewModel.clearFilter()
        advanceUntilIdle()
        assertEquals(
            listOf("What does Room wrap?", "What is a composable?"),
            viewModel.uiState.value.cards.map(CardSummary::frontText)
        )
        collectionJob.cancel()
    }

    private fun startCollecting(scope: TestScope, viewModel: CardsViewModel): Job {
        return scope.backgroundScope.launch {
            viewModel.uiState.collect()
        }
    }
}

private class FakeCardsListRepository(
    private val cards: List<CardSummary>
) : CardsRepository {
    override fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>> {
        val normalizedQuery = searchQuery.trim().lowercase()
        val filteredCards = cards.filter { card ->
            val queryMatches = normalizedQuery.isEmpty()
                || card.frontText.lowercase().contains(normalizedQuery)
                || card.backText.lowercase().contains(normalizedQuery)
                || card.tags.any { tag -> tag.lowercase().contains(normalizedQuery) }
            val tagsMatch = filter.tags.isEmpty() || filter.tags.all { tag ->
                card.tags.contains(tag)
            }
            val effortMatches = filter.effort.isEmpty() || filter.effort.contains(card.effortLevel)

            queryMatches && tagsMatch && effortMatches
        }

        return flowOf(filteredCards)
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

private class FakeCardsWorkspaceRepository : WorkspaceRepository {
    private val tagsSummaryState = MutableStateFlow(
        WorkspaceTagsSummary(
            tags = listOf(
                WorkspaceTagSummary(tag = "android", cardsCount = 2),
                WorkspaceTagSummary(tag = "compose", cardsCount = 1),
                WorkspaceTagSummary(tag = "kotlin", cardsCount = 1)
            ),
            totalCards = 2
        )
    )

    override fun observeWorkspace(): Flow<WorkspaceSummary?> {
        return flowOf(null)
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return flowOf(
            AppMetadataSummary(
                currentWorkspaceName = "Personal",
                workspaceName = "Personal",
                deckCount = 0,
                cardCount = 0,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Synced"
            )
        )
    }

    override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
        return flowOf(null)
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

private fun sampleCardsListItem(
    cardId: String,
    frontText: String,
    tags: List<String>,
    effortLevel: EffortLevel
): CardSummary {
    return CardSummary(
        cardId = cardId,
        workspaceId = "workspace-demo",
        frontText = frontText,
        backText = "Answer",
        tags = tags,
        effortLevel = effortLevel,
        dueAtMillis = null,
        createdAtMillis = 1L,
        updatedAtMillis = 1L,
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
