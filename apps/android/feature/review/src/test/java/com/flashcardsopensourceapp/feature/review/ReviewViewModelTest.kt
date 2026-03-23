package com.flashcardsopensourceapp.feature.review

import com.flashcardsopensourceapp.data.local.model.CardSummary
import com.flashcardsopensourceapp.data.local.model.DeckFilterDefinition
import com.flashcardsopensourceapp.data.local.model.DeckSummary
import com.flashcardsopensourceapp.data.local.model.EffortLevel
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceTagsSummary
import com.flashcardsopensourceapp.data.local.model.buildReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.buildReviewTimelinePage
import com.flashcardsopensourceapp.data.local.model.makeDefaultWorkspaceSchedulerSettings
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
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
        val reviewViewModel = ReviewViewModel(
            reviewRepository = FakeReviewRepository()
        )
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
        val reviewViewModel = ReviewViewModel(reviewRepository = reviewRepository)
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
        val reviewViewModel = ReviewViewModel(
            reviewRepository = FakeReviewRepository()
        )
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
        val reviewViewModel = ReviewViewModel(
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
        val reviewViewModel = ReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = sampleCards(count = 25))
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.startPreview()
        advanceUntilIdle()

        assertEquals(20, previewCardEntries(reviewViewModel).size)
        reviewViewModel.loadNextPreviewPageIfNeeded(
            itemCardId = previewCardEntries(reviewViewModel).last().card.cardId
        )
        advanceUntilIdle()

        assertEquals(25, previewCardEntries(reviewViewModel).size)
        assertFalse(reviewViewModel.uiState.value.hasMorePreviewCards)
        collectionJob.cancel()
    }

    @Test
    fun coldStartDoesNotRestorePendingSessionState() = runTest(dispatcher) {
        val reviewRepository = FakeReviewRepository()
        val firstViewModel = ReviewViewModel(reviewRepository = reviewRepository)
        val firstCollectionJob = startCollecting(viewModel = firstViewModel)

        advanceUntilIdle()
        firstViewModel.rateCard(rating = ReviewRating.GOOD)
        advanceUntilIdle()
        assertEquals(2, firstViewModel.uiState.value.remainingCount)

        val secondViewModel = ReviewViewModel(reviewRepository = reviewRepository)
        val secondCollectionJob = startCollecting(viewModel = secondViewModel)
        advanceUntilIdle()

        assertEquals(3, secondViewModel.uiState.value.remainingCount)
        assertEquals("card-1", secondViewModel.uiState.value.preparedCurrentCard?.card?.cardId)
        firstCollectionJob.cancel()
        secondCollectionJob.cancel()
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
        val reviewViewModel = ReviewViewModel(reviewRepository = reviewRepository)
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.startPreview()
        advanceUntilIdle()
        assertEquals("Preview failed.", reviewViewModel.uiState.value.previewErrorMessage)

        reviewViewModel.retryPreview()
        advanceUntilIdle()

        assertEquals(3, previewCardEntries(reviewViewModel).size)
        assertEquals("", reviewViewModel.uiState.value.previewErrorMessage)
        collectionJob.cancel()
    }

    @Test
    fun previewIgnoresNonLastVisibleCardForNextPageLoading() = runTest(dispatcher) {
        val reviewViewModel = ReviewViewModel(
            reviewRepository = FakeReviewRepository(cards = sampleCards(count = 25))
        )
        val collectionJob = startCollecting(viewModel = reviewViewModel)

        advanceUntilIdle()
        reviewViewModel.startPreview()
        advanceUntilIdle()

        reviewViewModel.loadNextPreviewPageIfNeeded(itemCardId = "card-5")
        advanceUntilIdle()

        assertEquals(20, previewCardEntries(reviewViewModel).size)
        assertTrue(reviewViewModel.uiState.value.hasMorePreviewCards)
        collectionJob.cancel()
    }

    @Test
    fun preparedNextPresentationUpdatesWhenQueueHeadChanges() = runTest(dispatcher) {
        val reviewViewModel = ReviewViewModel(
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

    private class FakeReviewRepository(
        private val cards: List<CardSummary> = sampleCards(count = 3),
        private val recordReviewHandler: suspend () -> Unit = {},
        private val timelineHandler: (suspend (
            ReviewFilter,
            Set<String>,
            Int,
            Int
        ) -> ReviewTimelinePage)? = null
    ) : ReviewRepository {
        override fun observeReviewSession(
            selectedFilter: ReviewFilter,
            pendingReviewedCardIds: Set<String>
        ): Flow<ReviewSessionSnapshot> {
            return flowOf(
                buildReviewSessionSnapshot(
                    selectedFilter = selectedFilter,
                    pendingReviewedCardIds = pendingReviewedCardIds,
                    decks = sampleDecks(),
                    cards = cards,
                    tagsSummary = sampleTagsSummary(cards = cards),
                    settings = makeDefaultWorkspaceSchedulerSettings(
                        workspaceId = "workspace-demo",
                        updatedAtMillis = 100L
                    ),
                    reviewedAtMillis = 1_000L
                )
            )
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
                cards = cards
            )
        }

        override suspend fun recordReview(cardId: String, rating: ReviewRating, reviewedAtMillis: Long) {
            recordReviewHandler()
        }
    }

    private companion object {
        private lateinit var pendingRecordReview: CompletableDeferred<Unit>
        private var previewFailureCount: Int = 0

        private fun sampleCards(count: Int): List<CardSummary> {
            return (1..count).map { index ->
                CardSummary(
                    cardId = "card-$index",
                    workspaceId = "workspace-demo",
                    frontText = "Front $index",
                    backText = "Back $index",
                    tags = if (index % 2 == 0) listOf("ui") else listOf("basics"),
                    effortLevel = EffortLevel.FAST,
                    dueAtMillis = null,
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
