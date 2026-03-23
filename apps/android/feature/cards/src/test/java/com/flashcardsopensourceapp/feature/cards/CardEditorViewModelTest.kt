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
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CardEditorViewModelTest {
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
    fun saveRequiresFrontAndBackText() = runTest(dispatcher) {
        val viewModel = CardEditorViewModel(
            cardsRepository = FakeCardsRepository(),
            workspaceRepository = FakeWorkspaceRepository(),
            editingCardId = null
        )
        val collectionJob = startCollecting(
            scope = this,
            viewModel = viewModel
        )

        advanceUntilIdle()
        val didSave = viewModel.save(editingCardId = null)
        advanceUntilIdle()

        assertFalse(didSave)
        assertEquals("Front text is required.", viewModel.uiState.value.frontTextErrorMessage)
        assertEquals("Back text is required.", viewModel.uiState.value.backTextErrorMessage)
        collectionJob.cancel()
    }

    @Test
    fun addTagCanonicalizesWorkspaceSuggestionAndAvoidsDuplicates() = runTest(dispatcher) {
        val viewModel = CardEditorViewModel(
            cardsRepository = FakeCardsRepository(),
            workspaceRepository = FakeWorkspaceRepository(
                tagsSummary = WorkspaceTagsSummary(
                    tags = listOf(
                        WorkspaceTagSummary(
                            tag = "UI",
                            cardsCount = 2
                        )
                    ),
                    totalCards = 2
                )
            ),
            editingCardId = null
        )
        val collectionJob = startCollecting(
            scope = this,
            viewModel = viewModel
        )

        advanceUntilIdle()
        viewModel.addTag(rawValue = "ui")
        viewModel.addTag(rawValue = "UI")
        advanceUntilIdle()

        assertEquals(listOf("UI"), viewModel.uiState.value.selectedTags)
        collectionJob.cancel()
    }

    @Test
    fun existingCardLoadsStructuredStateAndSavesUpdatedTags() = runTest(dispatcher) {
        val cardsRepository = FakeCardsRepository(
            initialCard = sampleCard(
                cardId = "card-42",
                frontText = "What is Room?",
                backText = "SQLite abstraction",
                tags = listOf("storage", "android")
            )
        )
        val viewModel = CardEditorViewModel(
            cardsRepository = cardsRepository,
            workspaceRepository = FakeWorkspaceRepository(
                tagsSummary = WorkspaceTagsSummary(
                    tags = listOf(
                        WorkspaceTagSummary(tag = "storage", cardsCount = 1),
                        WorkspaceTagSummary(tag = "android", cardsCount = 1),
                        WorkspaceTagSummary(tag = "compose", cardsCount = 1)
                    ),
                    totalCards = 1
                )
            ),
            editingCardId = "card-42"
        )
        val collectionJob = startCollecting(
            scope = this,
            viewModel = viewModel
        )

        advanceUntilIdle()
        assertEquals("What is Room?", viewModel.uiState.value.frontText)
        assertEquals(listOf("storage", "android"), viewModel.uiState.value.selectedTags)

        viewModel.toggleTag(tag = "compose")
        viewModel.removeTag(tag = "storage")
        advanceUntilIdle()
        val didSave = viewModel.save(editingCardId = "card-42")
        advanceUntilIdle()

        assertTrue(didSave)
        val updatedDraft = requireNotNull(cardsRepository.updatedDraft)
        assertEquals("What is Room?", updatedDraft.frontText)
        assertEquals("SQLite abstraction", updatedDraft.backText)
        assertEquals(listOf("android", "compose"), updatedDraft.tags)
        assertEquals(EffortLevel.FAST, updatedDraft.effortLevel)
        collectionJob.cancel()
    }

    private fun startCollecting(scope: TestScope, viewModel: CardEditorViewModel): Job {
        return scope.backgroundScope.launch {
            viewModel.uiState.collect()
        }
    }
}

private class FakeCardsRepository(
    initialCard: CardSummary? = null
) : CardsRepository {
    private val cardFlow = MutableStateFlow(value = initialCard)
    var createdDraft: CardDraft? = null
    var updatedDraft: CardDraft? = null

    override fun observeCards(searchQuery: String, filter: CardFilter): Flow<List<CardSummary>> {
        return flowOf(emptyList())
    }

    override fun observeCard(cardId: String): Flow<CardSummary?> {
        return cardFlow
    }

    override suspend fun createCard(cardDraft: CardDraft) {
        createdDraft = cardDraft
    }

    override suspend fun updateCard(cardId: String, cardDraft: CardDraft) {
        updatedDraft = cardDraft
    }

    override suspend fun deleteCard(cardId: String) {
    }
}

private class FakeWorkspaceRepository(
    private val tagsSummary: WorkspaceTagsSummary = WorkspaceTagsSummary(
        tags = emptyList(),
        totalCards = 0
    )
) : WorkspaceRepository {
    override fun observeWorkspace(): Flow<WorkspaceSummary?> {
        return flowOf(null)
    }

    override fun observeAppMetadata(): Flow<AppMetadataSummary> {
        return flowOf(
            AppMetadataSummary(
                currentWorkspaceName = "Workspace",
                workspaceName = "Workspace",
                deckCount = 0,
                cardCount = 0,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Draft local-only shell"
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
        return flowOf(tagsSummary)
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

private fun sampleCard(
    cardId: String,
    frontText: String,
    backText: String,
    tags: List<String>
): CardSummary {
    return CardSummary(
        cardId = cardId,
        workspaceId = "workspace-local",
        frontText = frontText,
        backText = backText,
        tags = tags,
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
}
