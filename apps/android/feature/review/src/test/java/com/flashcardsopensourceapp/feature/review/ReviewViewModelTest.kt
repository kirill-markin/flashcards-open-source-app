package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.SyncStatus
import com.flashcardsopensourceapp.data.local.model.SyncStatusSnapshot
import com.flashcardsopensourceapp.data.local.model.AppMetadataSummary
import com.flashcardsopensourceapp.data.local.model.DeviceDiagnosticsSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.model.WorkspaceOverviewSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.model.WorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.buildReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.CompletableDeferred
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
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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
class ReviewViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        previewFailureCount = 0
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun revealAnswerOpensOnlyForCurrentCard() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(reviewRepository = FakeReviewRepository())
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        assertFalse(reviewViewModel.uiState.value.isAnswerVisible)

        reviewViewModel.revealAnswer()
        advanceUntilIdle()

        assertTrue(reviewViewModel.uiState.value.isAnswerVisible)
        assertEquals("card-1", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        collectionJob.cancel()
    }

    @Test
    fun rateCardImmediatelyAdvancesQueueBeforeRepositoryWriteCompletes() = runTest(dispatcher) {
        val reviewRepository = FakeReviewRepository(
            recordReviewHandler = {
                CompletableDeferred<Unit>().also { deferred ->
                    pendingRecordReview = deferred
                }.await()
            }
        )
        val reviewViewModel = createReviewViewModel(reviewRepository = reviewRepository)
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.rateCard(rating = ReviewRating.GOOD)
        advanceUntilIdle()

        assertEquals("card-2", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        assertEquals("card-3", reviewViewModel.uiState.value.preparedNextCard?.card?.cardId)
        assertEquals(2, reviewViewModel.uiState.value.remainingCount)
        assertEquals(0, reviewViewModel.uiState.value.reviewedInSessionCount)

        pendingRecordReview.complete(Unit)
        advanceUntilIdle()

        assertEquals(1, reviewViewModel.uiState.value.reviewedInSessionCount)
        assertEquals("card-2", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        assertEquals("card-3", reviewViewModel.uiState.value.preparedNextCard?.card?.cardId)
        collectionJob.cancel()
    }

    @Test
    fun selectingFilterResetsVisibleAnswer() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(reviewRepository = FakeReviewRepository())
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.revealAnswer()
        advanceUntilIdle()
        assertTrue(reviewViewModel.uiState.value.isAnswerVisible)

        reviewViewModel.selectFilter(reviewFilter = ReviewFilter.Tag(tag = "ui"))
        advanceUntilIdle()

        assertFalse(reviewViewModel.uiState.value.isAnswerVisible)
        assertEquals(ReviewFilter.Tag(tag = "ui"), reviewViewModel.uiState.value.selectedFilter)
        collectionJob.cancel()
    }

    @Test
    fun failedReviewRestoresCardAndShowsError() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(
                recordReviewHandler = {
                    throw IllegalStateException("Review failed to save.")
                }
            )
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.rateCard(rating = ReviewRating.HARD)
        advanceUntilIdle()

        assertEquals("card-1", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        assertEquals(0, reviewViewModel.uiState.value.reviewedInSessionCount)
        assertEquals("Review failed to save.", reviewViewModel.uiState.value.errorMessage)
        collectionJob.cancel()
    }

    @Test
    fun previewLoadsFirstPageAndAppendsNextPage() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = sampleCards(count = 25))
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.startPreview()
        advanceUntilIdle()

        assertEquals(20, previewCardEntries(viewModel = reviewViewModel).size)
        reviewViewModel.loadNextPreviewPageIfNeeded(
            itemCardId = previewCardEntries(viewModel = reviewViewModel).last().card.cardId
        )
        advanceUntilIdle()

        assertEquals(25, previewCardEntries(viewModel = reviewViewModel).size)
        assertFalse(reviewViewModel.uiState.value.hasMorePreviewCards)
        collectionJob.cancel()
    }

    @Test
    fun coldStartDoesNotRestorePendingSessionState() = runTest(dispatcher) {
        val reviewRepository = FakeReviewRepository()
        val firstViewModel = createReviewViewModel(reviewRepository = reviewRepository)
        val firstCollectionJob = startCollecting(viewModel = firstViewModel)

        advanceUntilIdle()
        firstViewModel.rateCard(rating = ReviewRating.GOOD)
        advanceUntilIdle()
        assertEquals(2, firstViewModel.uiState.value.remainingCount)

        val secondViewModel = createReviewViewModel(reviewRepository = reviewRepository)
        val secondCollectionJob = startCollecting(viewModel = secondViewModel)
        advanceUntilIdle()

        assertEquals(3, secondViewModel.uiState.value.remainingCount)
        assertEquals("card-1", secondViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        firstCollectionJob.cancel()
        secondCollectionJob.cancel()
    }

    @Test
    fun selectedFilterRestoresAfterRecreatingViewModel() = runTest(dispatcher) {
        val reviewRepository = FakeReviewRepository()
        val reviewPreferencesStore = FakeReviewPreferencesStore()
        val firstViewModel = createReviewViewModel(
            reviewRepository = reviewRepository,
            reviewPreferencesStore = reviewPreferencesStore
        )
        val firstCollectionJob = startCollecting(viewModel = firstViewModel)

        advanceUntilIdle()
        firstViewModel.selectFilter(reviewFilter = ReviewFilter.Deck(deckId = "deck-ui"))
        advanceUntilIdle()

        val secondViewModel = createReviewViewModel(
            reviewRepository = reviewRepository,
            reviewPreferencesStore = reviewPreferencesStore
        )
        val secondCollectionJob = startCollecting(viewModel = secondViewModel)
        advanceUntilIdle()

        assertEquals(ReviewFilter.Deck(deckId = "deck-ui"), secondViewModel.uiState.value.selectedFilter)
        firstCollectionJob.cancel()
        secondCollectionJob.cancel()
    }

    @Test
    fun invalidSavedFilterFallsBackToAllCardsAndRewritesPreference() = runTest(dispatcher) {
        val reviewPreferencesStore = FakeReviewPreferencesStore().apply {
            saveSelectedReviewFilter(
                workspaceId = "workspace-demo",
                reviewFilter = ReviewFilter.Deck(deckId = "missing-deck")
            )
        }
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(),
            reviewPreferencesStore = reviewPreferencesStore
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()

        assertEquals(ReviewFilter.AllCards, reviewViewModel.uiState.value.selectedFilter)
        assertEquals(ReviewFilter.AllCards, reviewPreferencesStore.loadSelectedReviewFilter(workspaceId = "workspace-demo"))
        collectionJob.cancel()
    }

    @Test
    fun switchingWorkspaceRestoresScopedFilterAndClearsPreviewState() = runTest(dispatcher) {
        val reviewPreferencesStore = FakeReviewPreferencesStore().apply {
            saveSelectedReviewFilter(
                workspaceId = "workspace-demo",
                reviewFilter = ReviewFilter.Deck(deckId = "deck-ui")
            )
            saveSelectedReviewFilter(
                workspaceId = "workspace-second",
                reviewFilter = ReviewFilter.Tag(tag = "basics")
            )
        }
        val workspaceRepository = FakeWorkspaceRepository(cardCount = 3)
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = sampleCards(count = 25)),
            workspaceRepository = workspaceRepository,
            reviewPreferencesStore = reviewPreferencesStore
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        try {
            advanceUntilIdle()
            assertEquals(ReviewFilter.Deck(deckId = "deck-ui"), reviewViewModel.uiState.value.selectedFilter)

            reviewViewModel.revealAnswer()
            reviewViewModel.startPreview()
            reviewViewModel.rateCard(rating = ReviewRating.GOOD)
            advanceUntilIdle()

            workspaceRepository.switchWorkspace(
                workspaceId = "workspace-second",
                workspaceName = "Second",
                cardCount = 3
            )
            advanceUntilIdle()

            assertEquals(ReviewFilter.Tag(tag = "basics"), reviewViewModel.uiState.value.selectedFilter)
            assertFalse(reviewViewModel.uiState.value.isAnswerVisible)
            assertTrue(reviewViewModel.uiState.value.previewItems.isEmpty())
            assertEquals(0, reviewViewModel.uiState.value.reviewedInSessionCount)
        } finally {
            collectionJob.cancel()
        }
    }

    @Test
    fun previewRetryLoadsAgainAfterFailure() = runTest(dispatcher) {
        val reviewRepository = FakeReviewRepository(
            timelineHandler = { selectedFilter, pendingReviewedCardIds, offset, limit ->
                if (offset == 0 && previewFailureCount == 0) {
                    previewFailureCount += 1
                    throw IllegalStateException("Preview failed.")
                }

                defaultTimelinePage(
                    selectedFilter = selectedFilter,
                    pendingReviewedCardIds = pendingReviewedCardIds,
                    offset = offset,
                    limit = limit,
                    cards = sampleCards(count = 3)
                )
            }
        )
        val reviewViewModel = createReviewViewModel(reviewRepository = reviewRepository)
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.startPreview()
        advanceUntilIdle()
        assertEquals("Preview failed.", reviewViewModel.uiState.value.previewErrorMessage)

        reviewViewModel.retryPreview()
        advanceUntilIdle()

        assertEquals(3, previewCardEntries(viewModel = reviewViewModel).size)
        assertEquals("", reviewViewModel.uiState.value.previewErrorMessage)
        collectionJob.cancel()
    }

    @Test
    fun emptyWorkspaceShowsNoCardsYetState() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = emptyList()),
            workspaceRepository = FakeWorkspaceRepository(cardCount = 0)
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()

        assertEquals(ReviewEmptyState.NO_CARDS_YET, reviewViewModel.uiState.value.emptyState)
        collectionJob.cancel()
    }

    @Test
    fun allCardsWithOnlyFutureCardsShowsSessionCompleteState() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(
                cards = sampleCards(count = 2, dueAtMillis = 5_000L)
            ),
            workspaceRepository = FakeWorkspaceRepository(cardCount = 2)
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()

        assertEquals(ReviewEmptyState.SESSION_COMPLETE, reviewViewModel.uiState.value.emptyState)
        collectionJob.cancel()
    }

    @Test
    fun filteredReviewWithNoMatchingDueCardsShowsFilterEmptyState() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = sampleCards(count = 1)),
            workspaceRepository = FakeWorkspaceRepository(cardCount = 1)
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.selectFilter(reviewFilter = ReviewFilter.Tag(tag = "ui"))
        advanceUntilIdle()

        assertEquals(ReviewEmptyState.FILTER_EMPTY, reviewViewModel.uiState.value.emptyState)
        collectionJob.cancel()
    }

    @Test
    fun previewIgnoresNonLastVisibleCardForNextPageLoading() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = sampleCards(count = 25))
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.startPreview()
        advanceUntilIdle()

        reviewViewModel.loadNextPreviewPageIfNeeded(itemCardId = "card-5")
        advanceUntilIdle()

        assertEquals(20, previewCardEntries(viewModel = reviewViewModel).size)
        assertTrue(reviewViewModel.uiState.value.hasMorePreviewCards)
        collectionJob.cancel()
    }

    @Test
    fun preparedNextPresentationUpdatesWhenQueueHeadChanges() = runTest(dispatcher) {
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = sampleCards(count = 4))
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()

        assertEquals("card-1", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        assertEquals("card-2", reviewViewModel.uiState.value.preparedNextCard?.card?.cardId)

        reviewViewModel.rateCard(rating = ReviewRating.GOOD)
        advanceUntilIdle()

        assertEquals("card-2", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        assertEquals("card-3", reviewViewModel.uiState.value.preparedNextCard?.card?.cardId)
        collectionJob.cancel()
    }

    @Test
    fun successfulSyncWithoutQueueChangeDoesNotShowRemoteUpdateMessage() = runTest(dispatcher) {
        val syncRepository = FakeSyncRepository()
        val messageController = FakeMessageController()
        val reviewViewModel = createReviewViewModel(
            reviewRepository = FakeReviewRepository(),
            syncRepository = syncRepository,
            messageController = messageController
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        syncRepository.startSync()
        advanceUntilIdle()
        syncRepository.completeSyncSuccessfully(lastSuccessfulSyncAtMillis = 10L)
        advanceUntilIdle()

        assertTrue(messageController.messages.isEmpty())
        collectionJob.cancel()
    }

    @Test
    fun successfulSyncWithChangedQueueClearsStaleOptimisticCardAndShowsMessageOnce() = runTest(dispatcher) {
        val reviewRepository = FakeReviewRepository(
            cards = sampleCards(count = 4),
            recordReviewHandler = {
                CompletableDeferred<Unit>().also { deferred ->
                    pendingRecordReview = deferred
                }.await()
            }
        )
        val syncRepository = FakeSyncRepository()
        val messageController = FakeMessageController()
        val reviewViewModel = createReviewViewModel(
            reviewRepository = reviewRepository,
            syncRepository = syncRepository,
            messageController = messageController
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.revealAnswer()
        reviewViewModel.rateCard(rating = ReviewRating.GOOD)
        advanceUntilIdle()

        assertEquals("card-2", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        syncRepository.startSync()
        advanceUntilIdle()
        reviewRepository.replaceCards(
            nextCards = sampleCards(count = 4).filter { card ->
                card.cardId != "card-2"
            }
        )
        advanceUntilIdle()
        syncRepository.completeSyncSuccessfully(lastSuccessfulSyncAtMillis = 20L)
        advanceUntilIdle()

        assertEquals("card-3", reviewViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        assertFalse(reviewViewModel.uiState.value.isAnswerVisible)
        assertEquals(listOf("This review updated on another device."), messageController.messages)

        reviewRepository.replaceCards(
            nextCards = sampleCards(count = 4).filter { card ->
                card.cardId != "card-2"
            }
        )
        advanceUntilIdle()

        assertEquals(1, messageController.messages.size)
        pendingRecordReview.complete(Unit)
        advanceUntilIdle()
        collectionJob.cancel()
    }

    private fun createReviewViewModel(reviewRepository: FakeReviewRepository): ReviewViewModel {
        return ReviewViewModel(
            reviewRepository = reviewRepository,
            syncRepository = FakeSyncRepository(),
            messageController = FakeMessageController(),
            reviewPreferencesStore = FakeReviewPreferencesStore(),
            workspaceRepository = FakeWorkspaceRepository(cardCount = 3)
        )
    }

    private fun createReviewViewModel(
        reviewRepository: FakeReviewRepository,
        syncRepository: FakeSyncRepository,
        messageController: FakeMessageController
    ): ReviewViewModel {
        return ReviewViewModel(
            reviewRepository = reviewRepository,
            syncRepository = syncRepository,
            messageController = messageController,
            reviewPreferencesStore = FakeReviewPreferencesStore(),
            workspaceRepository = FakeWorkspaceRepository(cardCount = 3)
        )
    }

    private fun createReviewViewModel(
        reviewRepository: FakeReviewRepository,
        workspaceRepository: FakeWorkspaceRepository
    ): ReviewViewModel {
        return createReviewViewModel(
            reviewRepository = reviewRepository,
            workspaceRepository = workspaceRepository,
            reviewPreferencesStore = FakeReviewPreferencesStore()
        )
    }

    private fun createReviewViewModel(
        reviewRepository: FakeReviewRepository,
        reviewPreferencesStore: FakeReviewPreferencesStore
    ): ReviewViewModel {
        return ReviewViewModel(
            reviewRepository = reviewRepository,
            syncRepository = FakeSyncRepository(),
            messageController = FakeMessageController(),
            reviewPreferencesStore = reviewPreferencesStore,
            workspaceRepository = FakeWorkspaceRepository(cardCount = 3)
        )
    }

    private fun createReviewViewModel(
        reviewRepository: FakeReviewRepository,
        workspaceRepository: FakeWorkspaceRepository,
        reviewPreferencesStore: FakeReviewPreferencesStore
    ): ReviewViewModel {
        return ReviewViewModel(
            reviewRepository = reviewRepository,
            syncRepository = FakeSyncRepository(),
            messageController = FakeMessageController(),
            reviewPreferencesStore = reviewPreferencesStore,
            workspaceRepository = workspaceRepository
        )
    }

    private class FakeReviewRepository(
        cards: List<CardSummary> = sampleCards(count = 3),
        private val recordReviewHandler: suspend () -> Unit = {},
        private val timelineHandler: (suspend (
            ReviewFilter,
            Set<String>,
            Int,
            Int
        ) -> ReviewTimelinePage)? = null
    ) : ReviewRepository {
        private val cardsState = MutableStateFlow(cards)

        override fun observeReviewSession(
            selectedFilter: ReviewFilter,
            pendingReviewedCardIds: Set<String>
        ): Flow<ReviewSessionSnapshot> {
            return cardsState.map { currentCards ->
                buildReviewSessionSnapshot(
                    selectedFilter = selectedFilter,
                    pendingReviewedCardIds = pendingReviewedCardIds,
                    decks = sampleDecks(),
                    cards = currentCards,
                    tagsSummary = sampleTagsSummary(cards = currentCards),
                    settings = makeDefaultWorkspaceSchedulerSettings(
                        workspaceId = "workspace-demo",
                        updatedAtMillis = 100L
                    ),
                    reviewedAtMillis = 1_000L
                )
            }
        }

        override suspend fun loadReviewTimelinePage(
            selectedFilter: ReviewFilter,
            pendingReviewedCardIds: Set<String>,
            offset: Int,
            limit: Int
        ): ReviewTimelinePage {
            return timelineHandler?.invoke(
                selectedFilter,
                pendingReviewedCardIds,
                offset,
                limit
            ) ?: defaultTimelinePage(
                selectedFilter = selectedFilter,
                pendingReviewedCardIds = pendingReviewedCardIds,
                offset = offset,
                limit = limit,
                cards = cardsState.value
            )
        }

        override suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long) {
            recordReviewHandler()
        }

        fun replaceCards(nextCards: List<CardSummary>) {
            cardsState.value = nextCards
        }
    }

    private class FakeSyncRepository : SyncRepository {
        private val syncStatusState = MutableStateFlow(
            SyncStatusSnapshot(
                status = SyncStatus.Idle,
                lastSuccessfulSyncAtMillis = null,
                lastErrorMessage = ""
            )
        )

        override fun observeSyncStatus(): Flow<SyncStatusSnapshot> {
            return syncStatusState
        }

        override suspend fun scheduleSync() {
        }

        override suspend fun syncNow() {
        }

        fun startSync() {
            syncStatusState.value = syncStatusState.value.copy(
                status = SyncStatus.Syncing,
                lastErrorMessage = ""
            )
        }

        fun completeSyncSuccessfully(lastSuccessfulSyncAtMillis: Long) {
            syncStatusState.value = SyncStatusSnapshot(
                status = SyncStatus.Idle,
                lastSuccessfulSyncAtMillis = lastSuccessfulSyncAtMillis,
                lastErrorMessage = ""
            )
        }
    }

    private class FakeMessageController : TransientMessageController {
        val messages = mutableListOf<String>()

        override fun showMessage(message: String) {
            messages += message
        }
    }

    private class FakeWorkspaceRepository(
        private val cardCount: Int
    ) : WorkspaceRepository {
        private val workspaceState = MutableStateFlow(
            WorkspaceSummary(
                workspaceId = "workspace-demo",
                name = "Demo",
                createdAtMillis = 1L
            )
        )
        private val appMetadataState = MutableStateFlow(
            AppMetadataSummary(
                currentWorkspaceName = "Demo",
                workspaceName = "Demo",
                deckCount = 2,
                cardCount = cardCount,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Synced"
            )
        )

        override fun observeWorkspace(): Flow<WorkspaceSummary?> {
            return workspaceState
        }

        override fun observeAppMetadata(): Flow<AppMetadataSummary> {
            return appMetadataState
        }

        override fun observeWorkspaceOverview(): Flow<WorkspaceOverviewSummary?> {
            return flowOf(null)
        }

        override fun observeWorkspaceSchedulerSettings(): Flow<WorkspaceSchedulerSettings?> {
            return flowOf(null)
        }

        override fun observeWorkspaceTagsSummary(): Flow<WorkspaceTagsSummary> {
            return flowOf(WorkspaceTagsSummary(tags = emptyList(), totalCards = cardCount))
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

        fun switchWorkspace(workspaceId: String, workspaceName: String, cardCount: Int) {
            workspaceState.value = WorkspaceSummary(
                workspaceId = workspaceId,
                name = workspaceName,
                createdAtMillis = 1L
            )
            appMetadataState.value = AppMetadataSummary(
                currentWorkspaceName = workspaceName,
                workspaceName = workspaceName,
                deckCount = 2,
                cardCount = cardCount,
                localStorageLabel = "Room + SQLite",
                syncStatusText = "Synced"
            )
        }
    }

    private class FakeReviewPreferencesStore : ReviewPreferencesStore {
        private val values = mutableMapOf<String, ReviewFilter>()

        override fun loadSelectedReviewFilter(workspaceId: String): ReviewFilter {
            return values[workspaceId] ?: ReviewFilter.AllCards
        }

        override fun saveSelectedReviewFilter(workspaceId: String, reviewFilter: ReviewFilter) {
            values[workspaceId] = reviewFilter
        }

        override fun clearSelectedReviewFilter(workspaceId: String) {
            values.remove(workspaceId)
        }
    }

    private companion object {
        private lateinit var pendingRecordReview: CompletableDeferred<Unit>
        private var previewFailureCount: Int = 0

        private fun sampleCards(count: Int, dueAtMillis: Long? = null): List<CardSummary> {
            return (1..count).map { index ->
                CardSummary(
                    cardId = "card-$index",
                    workspaceId = "workspace-demo",
                    frontText = "Front $index",
                    backText = "Back $index",
                    tags = if (index % 2 == 0) listOf("ui") else listOf("basics"),
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = dueAtMillis,
                    createdAtMillis = index.toLong(),
                    updatedAtMillis = index.toLong(),
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
        }

        private fun sampleDecks(): List<DeckSummary> {
            return listOf(
                DeckSummary(
                    deckId = "deck-basics",
                    workspaceId = "workspace-demo",
                    name = "Basics",
                    filterDefinition = DeckFilterDefinition(
                        version = 2,
                        effortLevels = emptyList(),
                        tags = listOf("basics")
                    ),
                    totalCards = 2,
                    dueCards = 2,
                    newCards = 2,
                    reviewedCards = 0,
                    createdAtMillis = 1L,
                    updatedAtMillis = 1L
                ),
                DeckSummary(
                    deckId = "deck-ui",
                    workspaceId = "workspace-demo",
                    name = "UI",
                    filterDefinition = DeckFilterDefinition(
                        version = 2,
                        effortLevels = emptyList(),
                        tags = listOf("ui")
                    ),
                    totalCards = 1,
                    dueCards = 1,
                    newCards = 1,
                    reviewedCards = 0,
                    createdAtMillis = 2L,
                    updatedAtMillis = 2L
                )
            )
        }

        private fun sampleTagsSummary(cards: List<CardSummary>): WorkspaceTagsSummary {
            val basicsCount = cards.count { card -> card.tags.contains("basics") }
            val uiCount = cards.count { card -> card.tags.contains("ui") }

            return WorkspaceTagsSummary(
                tags = listOf(
                    WorkspaceTagSummary(tag = "basics", cardsCount = basicsCount),
                    WorkspaceTagSummary(tag = "ui", cardsCount = uiCount)
                ),
                totalCards = cards.size
            )
        }

        private fun defaultTimelinePage(
            selectedFilter: ReviewFilter,
            pendingReviewedCardIds: Set<String>,
            offset: Int,
            limit: Int,
            cards: List<CardSummary>
        ): ReviewTimelinePage {
            return buildReviewTimelinePage(
                selectedFilter = selectedFilter,
                pendingReviewedCardIds = pendingReviewedCardIds,
                decks = sampleDecks(),
                cards = cards,
                tagsSummary = sampleTagsSummary(cards = cards),
                reviewedAtMillis = 1_000L,
                offset = offset,
                limit = limit
            )
        }
    }

    private fun TestScope.startCollecting(viewModel: ReviewViewModel): Job {
        return backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            viewModel.uiState.collect { }
        }
    }

    private fun previewCardEntries(viewModel: ReviewViewModel): List<ReviewPreviewListItem.CardEntry> {
        return viewModel.uiState.value.previewItems.filterIsInstance<ReviewPreviewListItem.CardEntry>()
    }
}
