package com.flashcardsopensourceapp.wear.review

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionQueryInputs
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionQueryResult
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.repository.cloudsync.workspace.observeCurrentWorkspace
import com.flashcardsopensourceapp.wear.WearAppGraph
import com.flashcardsopensourceapp.wear.session.WearSessionViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val wearReviewLogTag: String = "WearReview"

/** What the Review screen shows; no due count, as on the Apple Watch. */
sealed interface WearReviewContent {
    data object Loading : WearReviewContent
    data class Card(val card: ReviewCard, val isAnswerRevealed: Boolean) : WearReviewContent
    data class AllDone(val nextDueAtMillis: Long?) : WearReviewContent
    data class Failed(val message: String) : WearReviewContent
}

data class WearReviewUiState(
    val content: WearReviewContent,
    /** Why a rating was not saved; shown in every state, since its card may not come back. */
    val submissionFailureMessage: String?
)

private data class WearReviewScope(
    val workspaceId: String,
    val reviewFilter: ReviewFilter
)

/**
 * The shown card and the card a rating shows next live here, so a rating swaps them at once; the
 * snapshot only confirms or replaces them.
 */
private data class WearReviewDraft(
    val presentedCard: ReviewCard?,
    val preparedNextCard: ReviewCard?,
    val revealedCardId: String?,
    val pendingReviewedCards: Set<PendingReviewedCard>,
    val submissionFailureMessage: String?
)

/**
 * The watch's Review session over the shared bounded queue: a rating hides its card at once, saves
 * it to the local outbox, then asks the session to sync. The workspace and Review filter are the
 * ones the phone handed over. See docs/fsrs-scheduling-logic.md#non-blocking-review.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WearReviewViewModel(
    private val appGraph: WearAppGraph,
    private val requestSync: () -> Unit,
    successfulSyncs: Flow<Long?>
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = WearReviewDraft(
            presentedCard = null,
            preparedNextCard = null,
            revealedCardId = null,
            pendingReviewedCards = emptySet(),
            submissionFailureMessage = null
        )
    )

    /** Null until the session's first snapshot. */
    private val sessionSnapshotState = MutableStateFlow<ReviewSessionSnapshot?>(value = null)
    private val loadFailureMessageState = MutableStateFlow<String?>(value = null)

    /** The queue's "now"; it moves on a refresh or at the next due time, never on a rating. */
    private val queueNowMillis = MutableStateFlow(value = System.currentTimeMillis())
    private val sessionRestartCount = MutableStateFlow(value = 0)

    /** Changes with every new session, so a failed save never restores its card into a later one. */
    private var sessionGeneration: Long = 0L
    private var sessionScope: WearReviewScope? = null

    /** The filter the session's snapshots resolved to, null before the first one. */
    private var sessionResolvedFilter: ReviewFilter? = null
    private var scheduledNextDueAtMillis: Long? = null
    private var nextDueRefreshJob: Job? = null

    // Reveal and failure changes must not restart the queries, so only the query inputs reach the repository.
    private val queryInputs: Flow<ReviewSessionQueryInputs> = combine(draftState, queueNowMillis) { draft, nowMillis ->
        makeWearReviewQueryInputs(draft = draft, nowMillis = nowMillis)
    }.distinctUntilChanged()

    private val reviewScopes: Flow<WearReviewScope?> = observeCurrentWorkspace(
        database = appGraph.database,
        preferencesStore = appGraph.cloudPreferencesStore
    ).map { workspace ->
        workspace?.workspaceId
    }.distinctUntilChanged().flatMapLatest { workspaceId ->
        if (workspaceId == null) {
            flowOf(null)
        } else {
            appGraph.reviewPreferencesStore.observeSelectedReviewFilter(workspaceId = workspaceId).map { reviewFilter ->
                WearReviewScope(workspaceId = workspaceId, reviewFilter = reviewFilter)
            }
        }
    }.distinctUntilChanged()

    val uiState: StateFlow<WearReviewUiState> = combine(
        draftState,
        sessionSnapshotState,
        loadFailureMessageState
    ) { draft, snapshot, loadFailureMessage ->
        makeWearReviewUiState(draft = draft, snapshot = snapshot, loadFailureMessage = loadFailureMessage)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = WearReviewUiState(content = WearReviewContent.Loading, submissionFailureMessage = null)
    )

    init {
        viewModelScope.launch {
            combine(reviewScopes, sessionRestartCount) { scope, _ -> scope }.collectLatest { scope ->
                runSession(scope = scope)
            }
        }
        viewModelScope.launch {
            successfulSyncs.filterNotNull().collect {
                refreshKeepingShownCard()
            }
        }
    }

    fun revealAnswer() {
        draftState.update { draft ->
            val presentedCard = draft.presentedCard ?: return@update draft
            draft.copy(revealedCardId = presentedCard.cardId)
        }
    }

    fun rate(rating: ReviewRating) {
        val draft = draftState.value
        val ratedCard = draft.presentedCard ?: return
        if (draft.revealedCardId != ratedCard.cardId) {
            return
        }
        val pendingReviewedCard = PendingReviewedCard(cardId = ratedCard.cardId, updatedAtMillis = ratedCard.updatedAtMillis)
        val pendingReviewedCards = draft.pendingReviewedCards + pendingReviewedCard
        val nextCard = draft.preparedNextCard
        val nextPreparedCard = nextCard?.let { shownCard ->
            chooseWearPreparedNextCard(
                sessionCards = sessionSnapshotState.value?.cards ?: emptyList(),
                shownCard = shownCard,
                pendingReviewedCards = pendingReviewedCards
            )
        }
        val reviewedAtMillis = System.currentTimeMillis()
        val generation = sessionGeneration
        draftState.value = draft.copy(
            presentedCard = nextCard,
            preparedNextCard = nextPreparedCard,
            revealedCardId = null,
            pendingReviewedCards = pendingReviewedCards,
            submissionFailureMessage = null
        )
        viewModelScope.launch {
            saveReview(
                ratedCard = ratedCard,
                rating = rating,
                reviewedAtMillis = reviewedAtMillis,
                pendingReviewedCard = pendingReviewedCard,
                generation = generation
            )
        }
    }

    /** A sync or a return to the foreground; the shown card stays, and a failed read starts again. */
    fun refreshKeepingShownCard() {
        queueNowMillis.value = System.currentTimeMillis()
        if (loadFailureMessageState.value != null) {
            retry()
        }
    }

    fun retry() {
        sessionRestartCount.update { count -> count + 1 }
    }

    private suspend fun runSession(scope: WearReviewScope?) {
        val previousScope = sessionScope
        // Following the phone onto the scope already shown, such as the all-cards fallback it saves after
        // the selected deck was deleted, keeps the card.
        val isShownScope = scope != null &&
            previousScope?.workspaceId == scope.workspaceId &&
            sessionResolvedFilter == scope.reviewFilter
        if (isShownScope.not()) {
            startNewSession()
        }
        sessionScope = scope
        loadFailureMessageState.value = null
        if (scope == null) {
            return
        }

        try {
            appGraph.reviewRepository.observeReviewSessionWithInputs(
                selectedFilter = scope.reviewFilter,
                queryInputs = queryInputs
            ).flowOn(Dispatchers.Default).collect { result ->
                applySnapshot(result = result)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearReviewFailure(event = "watch_review_load_failed", error = error)
            // A card already on screen stays reviewable; only an empty screen shows the failure.
            loadFailureMessageState.value = error.message ?: error::class.java.name
        }
    }

    private fun startNewSession() {
        sessionGeneration += 1L
        sessionResolvedFilter = null
        sessionSnapshotState.value = null
        draftState.update { draft ->
            draft.copy(
                presentedCard = null,
                preparedNextCard = null,
                revealedCardId = null,
                submissionFailureMessage = null
            )
        }
        queueNowMillis.value = System.currentTimeMillis()
    }

    private fun applySnapshot(result: ReviewSessionQueryResult) {
        val snapshot = result.snapshot
        if (snapshot.isLoading) {
            return
        }
        val draft = draftState.value
        // A snapshot read before a rating, a save, or a failed save's return can arrive after it and would
        // undo it. Every such change moves the inputs, whose own snapshot follows.
        val snapshotQueryInputs = result.queryInputs
        if (
            snapshotQueryInputs != null &&
            snapshotQueryInputs != makeWearReviewQueryInputs(draft = draft, nowMillis = queueNowMillis.value)
        ) {
            return
        }
        scheduleNextDueRefresh(nextDueAtMillis = snapshot.nextDueAtMillis)

        val previousResolvedFilter = sessionResolvedFilter
        sessionResolvedFilter = snapshot.selectedFilter
        val hasPinnedCards = draft.presentedCard != null || draft.preparedNextCard != null
        if (previousResolvedFilter is ReviewFilter.Deck && snapshot.selectedFilter == ReviewFilter.AllCards && hasPinnedCards) {
            // The selected deck no longer exists; the fallback to all cards is a new scope, so the session
            // starts over from the queue's head.
            startNewSession()
            sessionResolvedFilter = snapshot.selectedFilter
            return
        }

        sessionSnapshotState.value = snapshot
        draftState.update { current ->
            current.copy(
                presentedCard = snapshot.presentedCard,
                preparedNextCard = snapshot.preparedNextCard,
                revealedCardId = current.revealedCardId?.takeIf { cardId -> cardId == snapshot.presentedCard?.cardId }
            )
        }
    }

    private suspend fun saveReview(
        ratedCard: ReviewCard,
        rating: ReviewRating,
        reviewedAtMillis: Long,
        pendingReviewedCard: PendingReviewedCard,
        generation: Long
    ) {
        try {
            appGraph.reviewRepository.recordReview(
                cardId = ratedCard.cardId,
                rating = rating,
                reviewedAtMillis = reviewedAtMillis
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            logWearReviewFailure(event = "watch_review_submission_failed", error = error)
            restoreFailedReview(
                ratedCard = ratedCard,
                pendingReviewedCard = pendingReviewedCard,
                generation = generation,
                errorMessage = error.message ?: error::class.java.name
            )
            return
        }
        draftState.update { draft ->
            draft.copy(pendingReviewedCards = draft.pendingReviewedCards - pendingReviewedCard)
        }
        // The rating is already in the local outbox, so the sync can push it.
        requestSync()
    }

    /**
     * Nothing was saved, so a card still in review returns as the shown card with its answer revealed,
     * as before the rating.
     */
    private suspend fun restoreFailedReview(
        ratedCard: ReviewCard,
        pendingReviewedCard: PendingReviewedCard,
        generation: Long,
        errorMessage: String
    ) {
        val scope = sessionScope
        val rollbackCard: ReviewCard? = if (scope != null && generation == sessionGeneration) {
            try {
                appGraph.reviewRepository.loadActiveReviewCard(selectedFilter = scope.reviewFilter, cardId = ratedCard.cardId)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                logWearReviewFailure(event = "watch_review_rollback_load_failed", error = error)
                null
            }
        } else {
            null
        }

        draftState.update { draft ->
            val pendingReviewedCards = draft.pendingReviewedCards - pendingReviewedCard
            if (generation != sessionGeneration) {
                return@update draft.copy(pendingReviewedCards = pendingReviewedCards)
            }
            if (rollbackCard == null) {
                return@update draft.copy(pendingReviewedCards = pendingReviewedCards, submissionFailureMessage = errorMessage)
            }
            draft.copy(
                presentedCard = rollbackCard,
                // The card shown after the failed rating is prepared next again.
                preparedNextCard = draft.presentedCard?.takeIf { card -> card.cardId != rollbackCard.cardId },
                revealedCardId = rollbackCard.cardId,
                pendingReviewedCards = pendingReviewedCards,
                submissionFailureMessage = errorMessage
            )
        }
    }

    /** One timer at the earliest future due time moves the queue's "now", so a card rated Again returns. */
    private fun scheduleNextDueRefresh(nextDueAtMillis: Long?) {
        if (nextDueAtMillis == scheduledNextDueAtMillis) {
            return
        }
        scheduledNextDueAtMillis = nextDueAtMillis
        nextDueRefreshJob?.cancel()
        val dueAtMillis = nextDueAtMillis ?: return
        nextDueRefreshJob = viewModelScope.launch {
            delay(timeMillis = dueAtMillis - System.currentTimeMillis())
            // At least the due time, so that card counts even if the wall clock lags the delay.
            queueNowMillis.value = maxOf(System.currentTimeMillis(), dueAtMillis)
        }
    }

    companion object {
        fun factory(appGraph: WearAppGraph, sessionViewModel: WearSessionViewModel): ViewModelProvider.Factory {
            return viewModelFactory {
                initializer {
                    WearReviewViewModel(
                        appGraph = appGraph,
                        requestSync = sessionViewModel::requestSync,
                        successfulSyncs = sessionViewModel.lastSuccessfulSyncAtMillis
                    )
                }
            }
        }
    }
}

private fun makeWearReviewQueryInputs(draft: WearReviewDraft, nowMillis: Long): ReviewSessionQueryInputs {
    return ReviewSessionQueryInputs(
        pendingReviewedCards = draft.pendingReviewedCards,
        presentedCardId = draft.presentedCard?.cardId,
        preparedNextCardId = draft.preparedNextCard?.cardId,
        nowMillis = nowMillis
    )
}

private fun chooseWearPreparedNextCard(
    sessionCards: List<ReviewCard>,
    shownCard: ReviewCard,
    pendingReviewedCards: Set<PendingReviewedCard>
): ReviewCard? {
    val ratedCardIds: Set<String> = pendingReviewedCards.map { pendingReviewedCard -> pendingReviewedCard.cardId }.toSet()
    return sessionCards.firstOrNull { card ->
        card.cardId != shownCard.cardId && ratedCardIds.contains(card.cardId).not()
    }
}

private fun makeWearReviewUiState(
    draft: WearReviewDraft,
    snapshot: ReviewSessionSnapshot?,
    loadFailureMessage: String?
): WearReviewUiState {
    val presentedCard = draft.presentedCard
    val content: WearReviewContent = when {
        presentedCard != null -> WearReviewContent.Card(
            card = presentedCard,
            isAnswerRevealed = draft.revealedCardId == presentedCard.cardId
        )

        loadFailureMessage != null -> WearReviewContent.Failed(message = loadFailureMessage)
        // Cards beyond the loaded window are still coming, so only an exhausted queue is all done.
        snapshot != null && snapshot.hasMoreCards.not() -> WearReviewContent.AllDone(nextDueAtMillis = snapshot.nextDueAtMillis)
        else -> WearReviewContent.Loading
    }
    return WearReviewUiState(content = content, submissionFailureMessage = draft.submissionFailureMessage)
}

private fun logWearReviewFailure(event: String, error: Throwable) {
    Log.w(wearReviewLogTag, "event=$event error=${error.message} errorType=${error::class.java.name}")
}
