package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.ReviewAnswerOption
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewDeckFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewEffortFilterOption
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.model.ReviewTagFilterOption
import com.flashcardsopensourceapp.data.local.notifications.NotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.defaultNotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.reviewNotificationPermissionPromptThreshold
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val reviewPreviewPageSize: Int = 20

private fun hasEnoughReviewHistoryForNotificationPrompt(reviewCount: Int): Boolean {
    return reviewCount >= reviewNotificationPermissionPromptThreshold
}

internal fun clearPendingReviewedCard(
    pendingReviewedCards: Set<PendingReviewedCard>,
    pendingReviewedCard: PendingReviewedCard
): Set<PendingReviewedCard> {
    return pendingReviewedCards - pendingReviewedCard
}

internal data class ReviewDraftState(
    val requestedFilter: ReviewFilter,
    val presentedCard: ReviewCard?,
    val revealedCardId: String?,
    val reviewedInSessionCount: Int,
    val pendingReviewedCards: Set<PendingReviewedCard>,
    val optimisticPreparedCurrentCard: PreparedReviewCardPresentation?,
    val previewCards: List<ReviewCard>,
    val nextPreviewOffset: Int,
    val hasMorePreviewCards: Boolean,
    val isPreviewLoading: Boolean,
    val previewErrorMessage: String,
    val errorMessage: String,
    val isNotificationPermissionPromptVisible: Boolean,
    val isHardAnswerReminderVisible: Boolean
)

internal data class ReviewSubmissionSessionContext(
    val requestedFilter: ReviewFilter,
    val observedRequestedFilter: ReviewFilter,
    val selectedFilter: ReviewFilter,
    val sessionGeneration: Long,
    val filterGeneration: Long
)

internal enum class OwnedReviewSubmissionObservationState {
    LOCAL_WRITE_PENDING,
    COMMIT_PENDING_OBSERVATION
}

internal data class OwnedReviewSubmission(
    val pendingReviewedCard: PendingReviewedCard,
    val reviewedCard: ReviewCard,
    val presentedCard: ReviewCard?,
    val observationState: OwnedReviewSubmissionObservationState
)

internal data class OwnedReviewSessionObservationSuppression(
    val consumedPendingReviewedCards: Set<PendingReviewedCard>
)

internal data class FailedReviewSubmissionRollbackLookup(
    val currentContext: ReviewSubmissionSessionContext,
    val rollbackCard: ReviewCard?
)

private data class ObservedReviewSessionState(
    val requestedFilter: ReviewFilter,
    val sessionSnapshot: ReviewSessionSnapshot
)

internal data class ObservedReviewSessionSignature(
    val requestedFilter: ReviewFilter,
    val selectedFilter: ReviewFilter,
    val selectedFilterTitle: String,
    val reviewCards: List<ReviewCard>,
    val presentedCard: ReviewCard?,
    val dueCount: Int,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean,
    val availableDeckFilters: List<ReviewDeckFilterOption>,
    val availableEffortFilters: List<ReviewEffortFilterOption>,
    val availableTagFilters: List<ReviewTagFilterOption>
)

private data class VisibleAutoSyncChangeSignature(
    val selectedFilterTitle: String,
    val reviewCardIds: List<String>,
    val preparedCurrentCard: PreparedReviewCardPresentation?,
    val remainingCount: Int,
    val totalCount: Int,
    val hasMoreCards: Boolean,
    val availableDeckFilters: List<ReviewDeckFilterOption>,
    val availableEffortFilters: List<ReviewEffortFilterOption>,
    val availableTagFilters: List<ReviewTagFilterOption>
)

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModel(
    private val reviewRepository: ReviewRepository,
    private val progressRepository: ProgressRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val shouldShowNotificationPermissionPrePrompt: () -> Boolean,
    private val onReviewNotificationsChanged: (ReviewNotificationsReconcileTrigger) -> Unit,
    private val onSuccessfulReviewRecorded: (Long) -> Unit,
    private val onNotificationPermissionGranted: () -> Unit,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    workspaceRepository: WorkspaceRepository,
    private val textProvider: ReviewTextProvider
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = ReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            presentedCard = null,
            revealedCardId = null,
            reviewedInSessionCount = 0,
            pendingReviewedCards = emptySet(),
            optimisticPreparedCurrentCard = null,
            previewCards = emptyList(),
            nextPreviewOffset = 0,
            hasMorePreviewCards = true,
            isPreviewLoading = false,
            previewErrorMessage = "",
            errorMessage = "",
            isNotificationPermissionPromptVisible = false,
            isHardAnswerReminderVisible = false
        )
    )

    private val reviewSessionState = draftState.flatMapLatest { state ->
        reviewRepository.observeReviewSession(
            selectedFilter = state.requestedFilter,
            pendingReviewedCards = state.pendingReviewedCards,
            presentedCardId = state.presentedCard?.cardId
        ).map { sessionSnapshot ->
            ObservedReviewSessionState(
                requestedFilter = state.requestedFilter,
                sessionSnapshot = sessionSnapshot
            )
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = ObservedReviewSessionState(
            requestedFilter = ReviewFilter.AllCards,
            sessionSnapshot = loadingReviewSessionSnapshot(textProvider = textProvider)
        )
    )
    private val visibleAppScreenState = visibleAppScreenRepository.observeVisibleAppScreen().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = VisibleAppScreen.OTHER
    )
    private val workspaceState = workspaceRepository.observeWorkspace().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = null
    )
    private val appMetadataState = workspaceRepository.observeAppMetadata().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = com.flashcardsopensourceapp.data.local.model.AppMetadataSummary(
            currentWorkspaceName = textProvider.loadingLabel,
            workspaceName = textProvider.loadingLabel,
            deckCount = 0,
            cardCount = 0,
            localStorage = com.flashcardsopensourceapp.data.local.model.AppMetadataStorage.ROOM_SQLITE,
            syncStatus = com.flashcardsopensourceapp.data.local.model.AppMetadataSyncStatus.Message(
                text = textProvider.loadingLabel
            )
        )
    )

    private var pendingAutoSyncRequestId: String? = null
    private var visibleAutoSyncChangeSignatureAtStart: VisibleAutoSyncChangeSignature? = null
    private var lastVisibleAutoSyncChangeSignature: VisibleAutoSyncChangeSignature? = null
    private var lastObservedReviewSessionSignature: ObservedReviewSessionSignature? = null
    private var ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission> = emptyMap()
    private var reviewSessionGeneration: Long = 0L
    private var reviewFilterGeneration: Long = 0L
    private var activeWorkspaceId: String? = null
    private var workspaceGeneration: Long = 0L
    /** Fixed-size in-memory review history for the current review session only. */
    private var recentReviewRatings: List<ReviewRating> = emptyList()
    /** Device-level cooldown timestamp for the hard-answer reminder. */
    private var hardAnswerReminderLastShownAtMillis: Long? = reviewPreferencesStore.loadHardAnswerReminderLastShownAt()

    val uiState: StateFlow<ReviewUiState> = combine(
        reviewSessionState,
        draftState,
        appMetadataState,
        progressRepository.observeSummarySnapshot()
    ) { reviewSessionState, state, appMetadata, progressSummarySnapshot ->
        val sessionSnapshot = reviewSessionState.sessionSnapshot
        val displayedCurrentCard = state.optimisticPreparedCurrentCard?.card
            ?: resolveDisplayedCurrentCard(
                sessionCards = sessionSnapshot.cards,
                presentedCard = sessionSnapshot.presentedCard
            )
        val displayedQueue = buildDisplayedReviewQueue(
            sessionCards = sessionSnapshot.cards,
            displayedCurrentCard = displayedCurrentCard
        )
        val sessionPreparedCurrentCard = if (state.optimisticPreparedCurrentCard == null) {
            prepareDisplayedSessionCardPresentation(
                displayedCard = displayedCurrentCard,
                answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId,
                textProvider = textProvider
            )
        } else {
            null
        }
        val currentPreparedCard = if (state.optimisticPreparedCurrentCard != null) {
            state.optimisticPreparedCurrentCard
        } else {
            sessionPreparedCurrentCard
        }
        val displayedNextCard = displayedQueue.getOrNull(index = 1)
        val preparedNextCard = prepareDisplayedSessionCardPresentation(
            displayedCard = displayedNextCard,
            answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId,
            textProvider = textProvider
        )
        val emptyState = resolveReviewEmptyState(
            selectedFilter = sessionSnapshot.selectedFilter,
            remainingCount = sessionSnapshot.remainingCount,
            totalCount = sessionSnapshot.totalCount,
            workspaceCardCount = appMetadata.cardCount
        )

        ReviewUiState(
            isLoading = sessionSnapshot.isLoading,
            selectedFilter = sessionSnapshot.selectedFilter,
            selectedFilterTitle = textProvider.filterTitle(
                selectedFilter = sessionSnapshot.selectedFilter,
                availableDeckFilters = sessionSnapshot.availableDeckFilters
            ),
            remainingCount = sessionSnapshot.remainingCount,
            totalCount = sessionSnapshot.totalCount,
            reviewedInSessionCount = state.reviewedInSessionCount,
            isAnswerVisible = state.revealedCardId == currentPreparedCard?.card?.cardId,
            currentCardIdForEditing = currentPreparedCard?.card?.cardId,
            preparedCurrentCard = currentPreparedCard,
            preparedNextCard = preparedNextCard,
            availableDeckFilters = sessionSnapshot.availableDeckFilters,
            availableEffortFilters = sessionSnapshot.availableEffortFilters,
            availableTagFilters = sessionSnapshot.availableTagFilters,
            reviewProgressBadge = progressSummarySnapshot?.toReviewProgressBadgeState()
                ?: createEmptyReviewProgressBadgeState(),
            isPreviewLoading = state.isPreviewLoading,
            previewItems = buildReviewPreviewItems(
                cards = state.previewCards,
                currentCardId = currentPreparedCard?.card?.cardId,
                textProvider = textProvider
            ),
            hasMorePreviewCards = state.hasMorePreviewCards,
            emptyState = emptyState,
            previewErrorMessage = state.previewErrorMessage,
            errorMessage = state.errorMessage,
            isNotificationPermissionPromptVisible = state.isNotificationPermissionPromptVisible,
            isHardAnswerReminderVisible = state.isHardAnswerReminderVisible
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = ReviewUiState(
            isLoading = true,
            selectedFilter = ReviewFilter.AllCards,
            selectedFilterTitle = textProvider.allCardsTitle(),
            remainingCount = 0,
            totalCount = 0,
            reviewedInSessionCount = 0,
            isAnswerVisible = false,
            currentCardIdForEditing = null,
            preparedCurrentCard = null,
            preparedNextCard = null,
            availableDeckFilters = emptyList(),
            availableEffortFilters = emptyList(),
            availableTagFilters = emptyList(),
            reviewProgressBadge = createEmptyReviewProgressBadgeState(),
            isPreviewLoading = false,
            previewItems = emptyList(),
            hasMorePreviewCards = true,
            emptyState = null,
            previewErrorMessage = "",
            errorMessage = "",
            isNotificationPermissionPromptVisible = false,
            isHardAnswerReminderVisible = false
        )
    )

    init {
        observeWorkspaceChanges()
        observeResolvedFilterChanges()
        observePresentedCardChanges()
        observeAutoSyncDrivenReviewChanges()
    }

    fun selectFilter(reviewFilter: ReviewFilter) {
        val nextReviewFilterGeneration = nextReviewFilterGenerationAfterSelection(
            requestedFilter = draftState.value.requestedFilter,
            selectedFilter = reviewFilter,
            currentFilterGeneration = reviewFilterGeneration
        )
        if (nextReviewFilterGeneration == reviewFilterGeneration) {
            return
        }

        reviewFilterGeneration = nextReviewFilterGeneration
        lastObservedReviewSessionSignature = null
        ownedReviewSubmissions = emptyMap()
        draftState.update { state ->
            applyReviewFilterChange(
                state = state,
                reviewFilter = reviewFilter
            )
        }
        persistSelectedReviewFilter(reviewFilter = reviewFilter)
        onReviewNotificationsChanged(ReviewNotificationsReconcileTrigger.FILTER_CHANGED)
    }

    private fun persistSelectedReviewFilter(reviewFilter: ReviewFilter) {
        val workspaceId = activeWorkspaceId ?: return
        reviewPreferencesStore.saveSelectedReviewFilter(
            workspaceId = workspaceId,
            reviewFilter = reviewFilter
        )
    }

    fun revealAnswer() {
        val currentCardId = uiState.value.preparedCurrentCard?.card?.cardId ?: return
        draftState.update { state ->
            state.copy(
                revealedCardId = currentCardId,
                errorMessage = ""
            )
        }
    }

    fun dismissErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }

    fun dismissNotificationPermissionPrompt() {
        draftState.update { state ->
            state.copy(isNotificationPermissionPromptVisible = false)
        }
        reviewNotificationsStore.savePromptState(
            state = NotificationPermissionPromptState(
                hasShownPrePrompt = true,
                hasRequestedSystemPermission = false,
                hasDismissedPrePrompt = true
            )
        )
    }

    fun continueNotificationPermissionPrompt() {
        draftState.update { state ->
            state.copy(isNotificationPermissionPromptVisible = false)
        }
        reviewNotificationsStore.savePromptState(
            state = NotificationPermissionPromptState(
                hasShownPrePrompt = true,
                hasRequestedSystemPermission = true,
                hasDismissedPrePrompt = false
            )
        )
    }

    /**
     * Closes the hard-answer reminder without affecting the saved review result.
     */
    fun dismissHardAnswerReminder() {
        draftState.update { state ->
            state.copy(isHardAnswerReminderVisible = false)
        }
    }

    fun onScreenVisible() {
        viewModelScope.launch {
            progressRepository.refreshSummaryIfInvalidated()
        }
    }

    fun handleNotificationPermissionGranted() {
        onNotificationPermissionGranted()
    }

    fun startPreview() {
        val currentState = draftState.value
        if (currentState.isPreviewLoading) {
            return
        }

        draftState.update { state ->
            state.copy(
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = true,
                previewErrorMessage = ""
            )
        }
        loadPreviewPage(offset = 0, replaceCards = true)
    }

    fun loadNextPreviewPageIfNeeded(itemCardId: String) {
        val currentState = draftState.value
        if (currentState.isPreviewLoading) {
            return
        }
        if (currentState.hasMorePreviewCards.not()) {
            return
        }
        if (currentState.previewCards.lastOrNull()?.cardId != itemCardId) {
            return
        }

        draftState.update { state ->
            state.copy(
                isPreviewLoading = true,
                previewErrorMessage = ""
            )
        }
        loadPreviewPage(
            offset = currentState.nextPreviewOffset,
            replaceCards = false
        )
    }

    fun retryPreview() {
        startPreview()
    }

    fun rateCard(rating: ReviewRating) {
        val currentCard = uiState.value.preparedCurrentCard?.card ?: return
        val cardId = currentCard.cardId
        val optimisticPreparedCurrentCard = uiState.value.preparedNextCard
        val nextPresentedCard = optimisticPreparedCurrentCard?.card
        val operationWorkspaceGeneration = workspaceGeneration
        val submittedSessionContext = captureReviewSubmissionSessionContext()
        val reviewedAtMillis = System.currentTimeMillis()
        val pendingReviewedCard = PendingReviewedCard(
            cardId = cardId,
            updatedAtMillis = currentCard.updatedAtMillis
        )
        ownedReviewSubmissions = ownedReviewSubmissions + (
            pendingReviewedCard to OwnedReviewSubmission(
                pendingReviewedCard = pendingReviewedCard,
                reviewedCard = currentCard,
                presentedCard = nextPresentedCard,
                observationState = OwnedReviewSubmissionObservationState.LOCAL_WRITE_PENDING
            )
        )

        draftState.update { state ->
            state.copy(
                presentedCard = nextPresentedCard,
                revealedCardId = null,
                pendingReviewedCards = state.pendingReviewedCards + pendingReviewedCard,
                optimisticPreparedCurrentCard = optimisticPreparedCurrentCard,
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = false,
                previewErrorMessage = "",
                errorMessage = ""
            )
        }

        viewModelScope.launch {
            try {
                reviewRepository.recordReview(
                    cardId = cardId,
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis
                )
                if (operationWorkspaceGeneration != workspaceGeneration) {
                    return@launch
                }
                val currentSessionContext = captureReviewSubmissionSessionContext()
                val isCurrentSubmissionContext = isCurrentReviewSubmissionContext(
                    submittedContext = submittedSessionContext,
                    currentContext = currentSessionContext
                )
                draftState.update { state ->
                    applySuccessfulReviewSubmission(
                        state = state,
                        submittedContext = submittedSessionContext,
                        currentContext = currentSessionContext,
                        pendingReviewedCard = pendingReviewedCard
                    )
                }
                ownedReviewSubmissions = if (isCurrentSubmissionContext) {
                    markOwnedReviewSubmissionCommitPendingObservation(
                        ownedReviewSubmissions = ownedReviewSubmissions,
                        pendingReviewedCard = pendingReviewedCard
                    )
                } else {
                    ownedReviewSubmissions - pendingReviewedCard
                }
                val didShowHardAnswerReminder = if (isCurrentSubmissionContext) {
                    updateHardAnswerReminderState(
                        rating = rating,
                        reviewedAtMillis = reviewedAtMillis
                    )
                } else {
                    false
                }
                handleSuccessfulReviewRecorded(
                    reviewedAtMillis = reviewedAtMillis,
                    shouldShowNotificationPermissionPrePrompt = isCurrentSubmissionContext
                        && didShowHardAnswerReminder.not()
                )
            } catch (error: Throwable) {
                if (error is CancellationException) {
                    throw error
                }
                if (operationWorkspaceGeneration != workspaceGeneration) {
                    return@launch
                }
                val currentSessionContextBeforeLookup = captureReviewSubmissionSessionContext()
                val rollbackLookup = resolveFailedReviewSubmissionRollback(
                    submittedContext = submittedSessionContext,
                    currentContextBeforeLookup = currentSessionContextBeforeLookup,
                    cardId = cardId,
                    loadRollbackCard = reviewRepository::loadReviewCardForRollback,
                    captureCurrentContext = ::captureReviewSubmissionSessionContext
                )
                if (operationWorkspaceGeneration != workspaceGeneration) {
                    return@launch
                }
                draftState.update { state ->
                    applyFailedReviewSubmission(
                        state = state,
                        submittedContext = submittedSessionContext,
                        currentContext = rollbackLookup.currentContext,
                        rollbackCard = rollbackLookup.rollbackCard,
                        pendingReviewedCard = pendingReviewedCard,
                        errorMessage = error.message ?: textProvider.reviewCouldNotBeSaved
                    )
                }
                ownedReviewSubmissions = ownedReviewSubmissions - pendingReviewedCard
            }
        }
    }

    private fun captureReviewSubmissionSessionContext(): ReviewSubmissionSessionContext {
        val observedState = reviewSessionState.value
        return ReviewSubmissionSessionContext(
            requestedFilter = draftState.value.requestedFilter,
            observedRequestedFilter = observedState.requestedFilter,
            selectedFilter = observedState.sessionSnapshot.selectedFilter,
            sessionGeneration = reviewSessionGeneration,
            filterGeneration = reviewFilterGeneration
        )
    }

    /**
     * Updates the in-memory review window and returns true only when the simple
     * threshold and cooldown rules both pass.
     */
    private fun updateHardAnswerReminderState(
        rating: ReviewRating,
        reviewedAtMillis: Long
    ): Boolean {
        recentReviewRatings = appendRecentReviewRatings(
            recentReviewRatings = recentReviewRatings,
            nextRating = rating
        )

        if (rating != ReviewRating.HARD) {
            return false
        }
        if (shouldShowHardAnswerReminder(recentReviewRatings = recentReviewRatings).not()) {
            return false
        }
        if (isHardAnswerReminderOnCooldown(
                lastShownAtMillis = hardAnswerReminderLastShownAtMillis,
                nowMillis = reviewedAtMillis
            )) {
            return false
        }

        hardAnswerReminderLastShownAtMillis = reviewedAtMillis
        reviewPreferencesStore.saveHardAnswerReminderLastShownAt(timestampMillis = reviewedAtMillis)
        draftState.update { state ->
            state.copy(isHardAnswerReminderVisible = true)
        }
        return true
    }

    /**
     * Records successful review bookkeeping and optionally shows the notification pre-prompt.
     */
    private suspend fun handleSuccessfulReviewRecorded(
        reviewedAtMillis: Long,
        shouldShowNotificationPermissionPrePrompt: Boolean
    ) {
        val nowMillis = System.currentTimeMillis()
        reviewNotificationsStore.saveLastActiveAtMillis(timestampMillis = nowMillis)
        val nextReviewCount = reviewNotificationsStore.loadSuccessfulReviewCount() + 1
        reviewNotificationsStore.saveSuccessfulReviewCount(count = nextReviewCount)
        val reviewCount = maxOf(nextReviewCount, reviewRepository.countRecordedReviews())
        onReviewNotificationsChanged(ReviewNotificationsReconcileTrigger.REVIEW_RECORDED)
        onSuccessfulReviewRecorded(reviewedAtMillis)

        if (shouldShowNotificationPermissionPrePrompt.not()) {
            return
        }

        val promptState = reviewNotificationsStore.loadPromptState()
        if (hasEnoughReviewHistoryForNotificationPrompt(reviewCount = reviewCount).not()) {
            return
        }
        if (promptState.hasShownPrePrompt || promptState.hasRequestedSystemPermission || promptState.hasDismissedPrePrompt) {
            return
        }
        if (shouldShowNotificationPermissionPrePrompt().not()) {
            return
        }

        draftState.update { state ->
            state.copy(isNotificationPermissionPromptVisible = true)
        }
        reviewNotificationsStore.savePromptState(
            state = NotificationPermissionPromptState(
                hasShownPrePrompt = true,
                hasRequestedSystemPermission = false,
                hasDismissedPrePrompt = false
            )
        )
    }

    private fun loadPreviewPage(offset: Int, replaceCards: Boolean) {
        val requestedFilter = uiState.value.selectedFilter
        val pendingReviewedCards = draftState.value.pendingReviewedCards
        val operationWorkspaceGeneration = workspaceGeneration

        viewModelScope.launch {
            try {
                val page = reviewRepository.loadReviewTimelinePage(
                    selectedFilter = requestedFilter,
                    pendingReviewedCards = pendingReviewedCards,
                    offset = offset,
                    limit = reviewPreviewPageSize
                )
                if (operationWorkspaceGeneration != workspaceGeneration) {
                    return@launch
                }

                draftState.update { state ->
                    val mergedCards = if (replaceCards) {
                        page.cards
                    } else {
                        (state.previewCards + page.cards).distinctBy { card ->
                            card.cardId
                        }
                    }

                    state.copy(
                        previewCards = mergedCards,
                        nextPreviewOffset = mergedCards.size,
                        hasMorePreviewCards = page.hasMoreCards,
                        isPreviewLoading = false,
                        previewErrorMessage = ""
                    )
                }
            } catch (error: Throwable) {
                if (error is CancellationException) {
                    throw error
                }
                if (operationWorkspaceGeneration != workspaceGeneration) {
                    return@launch
                }
                draftState.update { state ->
                    state.copy(
                        isPreviewLoading = false,
                        previewErrorMessage = error.message ?: textProvider.reviewQueueCouldNotBeLoaded
                    )
                }
            }
        }
    }

    private fun observeAutoSyncDrivenReviewChanges() {
        viewModelScope.launch {
            autoSyncEventRepository.observeAutoSyncEvents().collect { event ->
                when (event) {
                    is AutoSyncEvent.Requested -> {
                        handleAutoSyncRequested(request = event.request)
                    }

                    is AutoSyncEvent.Completed -> {
                        handleAutoSyncCompleted(completion = event.completion)
                    }
                }
            }
        }
    }

    private fun observeWorkspaceChanges() {
        viewModelScope.launch {
            workspaceState.collect { workspace ->
                val workspaceId = workspace?.workspaceId
                if (workspaceId == activeWorkspaceId) {
                    return@collect
                }

                activeWorkspaceId = workspaceId
                workspaceGeneration += 1L
                reviewFilterGeneration += 1L
                lastObservedReviewSessionSignature = null
                ownedReviewSubmissions = emptyMap()
                recentReviewRatings = emptyList()
                val restoredFilter = if (workspaceId == null) {
                    ReviewFilter.AllCards
                } else {
                    reviewPreferencesStore.loadSelectedReviewFilter(workspaceId = workspaceId)
                }

                draftState.value = makeWorkspaceScopedDraftState(reviewFilter = restoredFilter)
            }
        }
    }

    private fun observeResolvedFilterChanges() {
        viewModelScope.launch {
            combine(reviewSessionState, workspaceState) { reviewSessionState, workspace ->
                reviewSessionState to workspace?.workspaceId
            }.collect { (reviewSessionState, workspaceId) ->
                val sessionSnapshot = reviewSessionState.sessionSnapshot
                if (workspaceId == null || sessionSnapshot.isLoading) {
                    return@collect
                }

                val requestedFilter = draftState.value.requestedFilter
                if (reviewSessionState.requestedFilter != requestedFilter) {
                    return@collect
                }
                if (requestedFilter == sessionSnapshot.selectedFilter) {
                    return@collect
                }

                reviewFilterGeneration += 1L
                lastObservedReviewSessionSignature = null
                ownedReviewSubmissions = emptyMap()
                draftState.update { state ->
                    applyResolvedReviewFilter(
                        state = state,
                        reviewFilter = sessionSnapshot.selectedFilter
                    )
                }
                reviewPreferencesStore.saveSelectedReviewFilter(
                    workspaceId = workspaceId,
                    reviewFilter = sessionSnapshot.selectedFilter
                )
            }
        }
    }

    private fun observePresentedCardChanges() {
        viewModelScope.launch {
            reviewSessionState.collect { observedState ->
                val sessionSnapshot = observedState.sessionSnapshot
                if (sessionSnapshot.isLoading) {
                    return@collect
                }
                val currentState = draftState.value
                if (observedState.requestedFilter != currentState.requestedFilter) {
                    return@collect
                }

                val nextObservedSignature = makeObservedReviewSessionSignature(observedState = observedState)
                val ownedSuppression = findOwnedReviewSessionObservationSuppression(
                    previousSignature = lastObservedReviewSessionSignature,
                    nextSignature = nextObservedSignature,
                    state = currentState,
                    ownedReviewSubmissions = ownedReviewSubmissions
                )
                if (
                    lastObservedReviewSessionSignature != null
                    && lastObservedReviewSessionSignature != nextObservedSignature
                    && ownedSuppression == null
                ) {
                    reviewSessionGeneration += 1L
                }
                if (ownedSuppression != null) {
                    ownedReviewSubmissions = ownedReviewSubmissions - ownedSuppression.consumedPendingReviewedCards
                }
                lastObservedReviewSessionSignature = nextObservedSignature

                draftState.update { state ->
                    if (observedState.requestedFilter != state.requestedFilter) {
                        return@update state
                    }

                    val nextPresentedCard = sessionSnapshot.presentedCard
                    if (nextPresentedCard == state.presentedCard) {
                        return@update state
                    }

                    state.copy(
                        presentedCard = nextPresentedCard,
                        revealedCardId = if (state.revealedCardId == nextPresentedCard?.cardId) {
                            state.revealedCardId
                        } else {
                            null
                        },
                        optimisticPreparedCurrentCard = if (state.optimisticPreparedCurrentCard?.card?.cardId == nextPresentedCard?.cardId) {
                            state.optimisticPreparedCurrentCard
                        } else {
                            null
                        }
                    )
                }
            }
        }
    }

    private fun handleAutoSyncRequested(request: AutoSyncRequest) {
        if (request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.REVIEW) {
            return
        }

        pendingAutoSyncRequestId = request.requestId
        visibleAutoSyncChangeSignatureAtStart = makeVisibleAutoSyncChangeSignature(
            sessionSnapshot = reviewSessionState.value.sessionSnapshot,
            preparedCurrentCard = uiState.value.preparedCurrentCard
        )
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val visibleSignatureBeforeSync = visibleAutoSyncChangeSignatureAtStart
        visibleAutoSyncChangeSignatureAtStart = null

        if (completion.outcome !is AutoSyncOutcome.Succeeded) {
            return
        }
        if (completion.request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.REVIEW) {
            return
        }

        reconcileReviewAfterSuccessfulAutoSync(
            visibleSignatureBeforeSync = visibleSignatureBeforeSync,
            sessionSnapshot = reviewSessionState.value.sessionSnapshot
        )
    }

    private fun reconcileReviewAfterSuccessfulAutoSync(
        visibleSignatureBeforeSync: VisibleAutoSyncChangeSignature?,
        sessionSnapshot: ReviewSessionSnapshot
    ) {
        if (visibleSignatureBeforeSync == null) {
            return
        }
        val displayedCurrentCardAfterSync = resolveDisplayedCurrentCard(
            sessionCards = sessionSnapshot.cards,
            presentedCard = sessionSnapshot.presentedCard
        )
        val preparedCurrentCardAfterSync = prepareDisplayedSessionCardPresentation(
            displayedCard = displayedCurrentCardAfterSync,
            answerOptionsByCardId = sessionSnapshot.answerOptionsByCardId,
            textProvider = textProvider
        )
        val nextVisibleChangeSignature = makeVisibleAutoSyncChangeSignature(
            sessionSnapshot = sessionSnapshot,
            preparedCurrentCard = preparedCurrentCardAfterSync
        )
        if (visibleSignatureBeforeSync == nextVisibleChangeSignature) {
            return
        }
        if (nextVisibleChangeSignature == lastVisibleAutoSyncChangeSignature) {
            return
        }

        draftState.update { state ->
            val nextPresentedCard = sessionSnapshot.presentedCard
            state.copy(
                presentedCard = nextPresentedCard,
                revealedCardId = if (state.revealedCardId == nextPresentedCard?.cardId) {
                    state.revealedCardId
                } else {
                    null
                },
                // Auto-sync must rebuild the visible card from the fresh review
                // snapshot so same-card content changes are rendered immediately.
                optimisticPreparedCurrentCard = null,
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = false,
                previewErrorMessage = ""
            )
        }
        lastVisibleAutoSyncChangeSignature = nextVisibleChangeSignature
        messageController.showMessage(message = textProvider.reviewUpdatedOnAnotherDeviceMessage)
    }
}

private fun makeVisibleAutoSyncChangeSignature(
    sessionSnapshot: ReviewSessionSnapshot,
    preparedCurrentCard: PreparedReviewCardPresentation?
): VisibleAutoSyncChangeSignature {
    return VisibleAutoSyncChangeSignature(
        selectedFilterTitle = sessionSnapshot.selectedFilterTitle,
        reviewCardIds = sessionSnapshot.cards.map(ReviewCard::cardId),
        preparedCurrentCard = preparedCurrentCard,
        remainingCount = sessionSnapshot.remainingCount,
        totalCount = sessionSnapshot.totalCount,
        hasMoreCards = sessionSnapshot.hasMoreCards,
        availableDeckFilters = sessionSnapshot.availableDeckFilters,
        availableEffortFilters = sessionSnapshot.availableEffortFilters,
        availableTagFilters = sessionSnapshot.availableTagFilters
    )
}

private object NoOpReviewNotificationsStore : ReviewNotificationsStore {
    override fun loadSettings(workspaceId: String) = throw UnsupportedOperationException("Notifications store is unavailable.")
    override fun saveSettings(workspaceId: String, settings: com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsSettings) = Unit
    override fun loadPromptState(): NotificationPermissionPromptState = defaultNotificationPermissionPromptState()
    override fun savePromptState(state: NotificationPermissionPromptState) = Unit
    override fun loadSuccessfulReviewCount(): Int = 0
    override fun saveSuccessfulReviewCount(count: Int) = Unit
    override fun loadLastActiveAtMillis(): Long? = null
    override fun saveLastActiveAtMillis(timestampMillis: Long) = Unit
    override fun clearLastActiveAtMillis() = Unit
    override fun loadScheduledPayloads(workspaceId: String) = emptyList<com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload>()
    override fun saveScheduledPayloads(workspaceId: String, payloads: List<com.flashcardsopensourceapp.data.local.notifications.ScheduledReviewNotificationPayload>) = Unit
}

fun createReviewViewModelFactory(
    reviewRepository: ReviewRepository,
    progressRepository: ProgressRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    reviewNotificationsStore: ReviewNotificationsStore,
    shouldShowNotificationPermissionPrePrompt: () -> Boolean,
    onReviewNotificationsChanged: (ReviewNotificationsReconcileTrigger) -> Unit,
    onSuccessfulReviewRecorded: (Long) -> Unit,
    onNotificationPermissionGranted: () -> Unit,
    reviewPreferencesStore: ReviewPreferencesStore,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    workspaceRepository: WorkspaceRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            val application = requireApplication()
            ReviewViewModel(
                reviewRepository = reviewRepository,
                progressRepository = progressRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                reviewNotificationsStore = reviewNotificationsStore,
                shouldShowNotificationPermissionPrePrompt = shouldShowNotificationPermissionPrePrompt,
                onReviewNotificationsChanged = onReviewNotificationsChanged,
                onSuccessfulReviewRecorded = onSuccessfulReviewRecorded,
                onNotificationPermissionGranted = onNotificationPermissionGranted,
                reviewPreferencesStore = reviewPreferencesStore,
                visibleAppScreenRepository = visibleAppScreenRepository,
                workspaceRepository = workspaceRepository,
                textProvider = reviewTextProvider(context = application)
            )
        }
    }
}

private fun makeWorkspaceScopedDraftState(reviewFilter: ReviewFilter): ReviewDraftState {
    return ReviewDraftState(
        requestedFilter = reviewFilter,
        presentedCard = null,
        revealedCardId = null,
        reviewedInSessionCount = 0,
        pendingReviewedCards = emptySet(),
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

private fun applyReviewFilterChange(
    state: ReviewDraftState,
    reviewFilter: ReviewFilter
): ReviewDraftState {
    return state.copy(
        requestedFilter = reviewFilter,
        presentedCard = null,
        revealedCardId = null,
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

private fun applyResolvedReviewFilter(
    state: ReviewDraftState,
    reviewFilter: ReviewFilter
): ReviewDraftState {
    return state.copy(
        requestedFilter = reviewFilter,
        presentedCard = null,
        revealedCardId = null,
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false,
        isHardAnswerReminderVisible = false
    )
}

internal fun nextReviewFilterGenerationAfterSelection(
    requestedFilter: ReviewFilter,
    selectedFilter: ReviewFilter,
    currentFilterGeneration: Long
): Long {
    if (requestedFilter == selectedFilter) {
        return currentFilterGeneration
    }

    return currentFilterGeneration + 1L
}

private fun makeObservedReviewSessionSignature(
    observedState: ObservedReviewSessionState
): ObservedReviewSessionSignature {
    val sessionSnapshot = observedState.sessionSnapshot
    return ObservedReviewSessionSignature(
        requestedFilter = observedState.requestedFilter,
        selectedFilter = sessionSnapshot.selectedFilter,
        selectedFilterTitle = sessionSnapshot.selectedFilterTitle,
        reviewCards = sessionSnapshot.cards,
        presentedCard = sessionSnapshot.presentedCard,
        dueCount = sessionSnapshot.dueCount,
        remainingCount = sessionSnapshot.remainingCount,
        totalCount = sessionSnapshot.totalCount,
        hasMoreCards = sessionSnapshot.hasMoreCards,
        availableDeckFilters = sessionSnapshot.availableDeckFilters,
        availableEffortFilters = sessionSnapshot.availableEffortFilters,
        availableTagFilters = sessionSnapshot.availableTagFilters
    )
}

internal fun shouldAdvanceReviewSessionGeneration(
    previousSignature: ObservedReviewSessionSignature?,
    nextSignature: ObservedReviewSessionSignature,
    state: ReviewDraftState,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): Boolean {
    val previous = previousSignature ?: return false
    if (previous == nextSignature) {
        return false
    }
    return findOwnedReviewSessionObservationSuppression(
        previousSignature = previous,
        nextSignature = nextSignature,
        state = state,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) == null
}

internal fun findOwnedReviewSessionObservationSuppression(
    previousSignature: ObservedReviewSessionSignature?,
    nextSignature: ObservedReviewSessionSignature,
    state: ReviewDraftState,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewSessionObservationSuppression? {
    val previous = previousSignature ?: return null
    if (previous == nextSignature) {
        return null
    }
    if (hasSameReviewSessionIdentity(
            previousSignature = previous,
            nextSignature = nextSignature,
        ).not()
    ) {
        return null
    }

    return findOwnedReviewQueueObservationSuppression(
        previousSignature = previous,
        nextSignature = nextSignature,
        state = state,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) ?: findOwnedReviewCommitObservationSuppression(
        previousSignature = previous,
        nextSignature = nextSignature,
        ownedReviewSubmissions = ownedReviewSubmissions
    )
}

private fun hasSameReviewSessionIdentity(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature
): Boolean {
    return previousSignature.requestedFilter == nextSignature.requestedFilter &&
        previousSignature.selectedFilter == nextSignature.selectedFilter &&
        previousSignature.selectedFilterTitle == nextSignature.selectedFilterTitle &&
        previousSignature.totalCount == nextSignature.totalCount
}

private fun findOwnedReviewQueueObservationSuppression(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    state: ReviewDraftState,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewSessionObservationSuppression? {
    if (nextSignature.presentedCard != state.presentedCard) {
        return null
    }
    val removedSubmissions = findOwnedReviewSubmissionsRemovedFromQueue(
        previousCards = previousSignature.reviewCards,
        nextCards = nextSignature.reviewCards,
        ownedReviewSubmissions = ownedReviewSubmissions
    ) ?: return null
    if (removedSubmissions.isEmpty()) {
        return null
    }
    if (removedSubmissions.any { submission ->
            submission.presentedCard == nextSignature.presentedCard
        }.not()
    ) {
        return null
    }
    val committedSubmissions = removedSubmissions.filter { submission ->
        submission.observationState == OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
    }
    if (isOwnedReviewCountChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            queueSubmissionCount = removedSubmissions.size,
            committedSubmissionCount = committedSubmissions.size
        ).not()
    ) {
        return null
    }
    if (isOwnedReviewFilterOptionChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            committedReviewedCards = committedSubmissions.map(OwnedReviewSubmission::reviewedCard)
        ).not()
    ) {
        return null
    }

    return OwnedReviewSessionObservationSuppression(
        consumedPendingReviewedCards = committedSubmissions.map { submission ->
            submission.pendingReviewedCard
        }.toSet()
    )
}

private fun findOwnedReviewCommitObservationSuppression(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): OwnedReviewSessionObservationSuppression? {
    if (previousSignature.reviewCards != nextSignature.reviewCards) {
        return null
    }
    if (previousSignature.presentedCard != nextSignature.presentedCard) {
        return null
    }
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    val remainingCountDelta = previousSignature.remainingCount - nextSignature.remainingCount
    val observedReviewCount = maxOf(dueCountDelta, remainingCountDelta)
    if (observedReviewCount <= 0) {
        return null
    }
    val observableOwnedSubmissions = ownedReviewSubmissions.values.filter { submission ->
        submission.observationState == OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
    }
    if (observedReviewCount > observableOwnedSubmissions.size) {
        return null
    }

    val submissionCombinations = makeOwnedReviewSubmissionCombinations(
        ownedReviewSubmissions = observableOwnedSubmissions,
        size = observedReviewCount
    )
    val matchingSubmissions = submissionCombinations.firstOrNull { submissions ->
        isOwnedReviewCountChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            queueSubmissionCount = submissions.size,
            committedSubmissionCount = submissions.size
        ) && isOwnedReviewFilterOptionChange(
            previousSignature = previousSignature,
            nextSignature = nextSignature,
            committedReviewedCards = submissions.map(OwnedReviewSubmission::reviewedCard)
        )
    } ?: return null

    return OwnedReviewSessionObservationSuppression(
        consumedPendingReviewedCards = matchingSubmissions.map { submission ->
            submission.pendingReviewedCard
        }.toSet()
    )
}

/** Returns null if `nextCards` introduces a card not in `previousCards`, since the canonical queue must only shrink between observations during owned reviews. */
private fun findOwnedReviewSubmissionsRemovedFromQueue(
    previousCards: List<ReviewCard>,
    nextCards: List<ReviewCard>,
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>
): List<OwnedReviewSubmission>? {
    val ownedReviewSubmissionsByCardId = ownedReviewSubmissions.values.associateBy { submission ->
        submission.reviewedCard.cardId
    }
    val removedSubmissions = mutableListOf<OwnedReviewSubmission>()
    var nextCardIndex: Int = 0
    previousCards.forEach { previousCard ->
        val nextCard = nextCards.getOrNull(index = nextCardIndex)
        if (nextCard == previousCard) {
            nextCardIndex += 1
        } else {
            val ownedSubmission = ownedReviewSubmissionsByCardId[previousCard.cardId] ?: return null
            removedSubmissions.add(ownedSubmission)
        }
    }

    return removedSubmissions
}

private const val maxOwnedReviewSubmissionCombinationInputSize: Int = 8

private fun makeOwnedReviewSubmissionCombinations(
    ownedReviewSubmissions: List<OwnedReviewSubmission>,
    size: Int
): List<List<OwnedReviewSubmission>> {
    // Guard against combinatorial blowup: the recursion grows as C(n, size).
    // Skip suppression entirely when the input set exceeds the bound rather
    // than risk freezing the UI thread when many submissions queue up.
    if (ownedReviewSubmissions.size > maxOwnedReviewSubmissionCombinationInputSize) {
        return emptyList()
    }
    if (size == 0) {
        return listOf(emptyList())
    }
    if (ownedReviewSubmissions.size < size) {
        return emptyList()
    }

    val firstSubmission = ownedReviewSubmissions.first()
    val remainingSubmissions = ownedReviewSubmissions.drop(n = 1)
    val combinationsWithFirst = makeOwnedReviewSubmissionCombinations(
        ownedReviewSubmissions = remainingSubmissions,
        size = size - 1
    ).map { combination ->
        listOf(firstSubmission) + combination
    }
    val combinationsWithoutFirst = makeOwnedReviewSubmissionCombinations(
        ownedReviewSubmissions = remainingSubmissions,
        size = size
    )

    return combinationsWithFirst + combinationsWithoutFirst
}

private fun isOwnedReviewCountChange(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    queueSubmissionCount: Int,
    committedSubmissionCount: Int
): Boolean {
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    val remainingCountDelta = previousSignature.remainingCount - nextSignature.remainingCount
    if (dueCountDelta < 0 || dueCountDelta > committedSubmissionCount) {
        return false
    }
    if (remainingCountDelta < 0 || remainingCountDelta > queueSubmissionCount) {
        return false
    }

    return dueCountDelta > 0 || remainingCountDelta > 0
}

private fun isOwnedReviewFilterOptionChange(
    previousSignature: ObservedReviewSessionSignature,
    nextSignature: ObservedReviewSessionSignature,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    val dueCountDelta = previousSignature.dueCount - nextSignature.dueCount
    if (dueCountDelta == 0) {
        return previousSignature.availableDeckFilters == nextSignature.availableDeckFilters &&
            previousSignature.availableEffortFilters == nextSignature.availableEffortFilters &&
            previousSignature.availableTagFilters == nextSignature.availableTagFilters
    }

    return hasOwnedDeckFilterOptionChange(
        previousOptions = previousSignature.availableDeckFilters,
        nextOptions = nextSignature.availableDeckFilters,
        committedReviewedCards = committedReviewedCards
    ) && hasOwnedEffortFilterOptionChange(
        previousOptions = previousSignature.availableEffortFilters,
        nextOptions = nextSignature.availableEffortFilters,
        committedReviewedCards = committedReviewedCards
    ) && hasOwnedTagFilterOptionChange(
        previousOptions = previousSignature.availableTagFilters,
        nextOptions = nextSignature.availableTagFilters,
        committedReviewedCards = committedReviewedCards
    )
}

private fun hasOwnedDeckFilterOptionChange(
    previousOptions: List<ReviewDeckFilterOption>,
    nextOptions: List<ReviewDeckFilterOption>,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    if (previousOptions.size != nextOptions.size) {
        return false
    }

    val nextOptionsByDeckId = nextOptions.associateBy { option ->
        option.deckId
    }
    return previousOptions.all { previousOption ->
        val nextOption = nextOptionsByDeckId[previousOption.deckId] ?: return false
        val countDelta = previousOption.totalCount - nextOption.totalCount
        nextOption.title == previousOption.title &&
            countDelta >= 0 &&
            countDelta <= committedReviewedCards.size
    }
}

private fun hasOwnedEffortFilterOptionChange(
    previousOptions: List<ReviewEffortFilterOption>,
    nextOptions: List<ReviewEffortFilterOption>,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    if (previousOptions.size != nextOptions.size) {
        return false
    }

    val nextOptionsByEffort = nextOptions.associateBy { option ->
        option.effortLevel
    }
    return previousOptions.all { previousOption ->
        val nextOption = nextOptionsByEffort[previousOption.effortLevel] ?: return false
        val expectedDelta = committedReviewedCards.count { reviewedCard ->
            previousOption.effortLevel == reviewedCard.effortLevel
        }
        nextOption.title == previousOption.title &&
            previousOption.totalCount - nextOption.totalCount == expectedDelta
    }
}

private fun hasOwnedTagFilterOptionChange(
    previousOptions: List<ReviewTagFilterOption>,
    nextOptions: List<ReviewTagFilterOption>,
    committedReviewedCards: List<ReviewCard>
): Boolean {
    val previousOptionsByTag = previousOptions.associateBy { option ->
        option.tag
    }
    val nextOptionsByTag = nextOptions.associateBy { option ->
        option.tag
    }
    if (nextOptionsByTag.keys.any { tag ->
            previousOptionsByTag.containsKey(tag).not()
        }
    ) {
        return false
    }
    val committedReviewTags = committedReviewedCards.flatMap { reviewedCard ->
        reviewedCard.tags
    }

    return previousOptions.all { previousOption ->
        val expectedDelta = committedReviewTags.count { tag ->
            tag == previousOption.tag
        }
        val expectedCount = previousOption.totalCount - expectedDelta
        val nextOption = nextOptionsByTag[previousOption.tag]
        if (expectedCount <= 0) {
            nextOption == null
        } else {
            nextOption?.totalCount == expectedCount
        }
    }
}

internal fun markOwnedReviewSubmissionCommitPendingObservation(
    ownedReviewSubmissions: Map<PendingReviewedCard, OwnedReviewSubmission>,
    pendingReviewedCard: PendingReviewedCard
): Map<PendingReviewedCard, OwnedReviewSubmission> {
    val ownedReviewSubmission = ownedReviewSubmissions[pendingReviewedCard] ?: return ownedReviewSubmissions
    return ownedReviewSubmissions + (
        pendingReviewedCard to ownedReviewSubmission.copy(
            observationState = OwnedReviewSubmissionObservationState.COMMIT_PENDING_OBSERVATION
        )
    )
}

internal suspend fun resolveFailedReviewSubmissionRollback(
    submittedContext: ReviewSubmissionSessionContext,
    currentContextBeforeLookup: ReviewSubmissionSessionContext,
    cardId: String,
    loadRollbackCard: suspend (ReviewFilter, String) -> ReviewCard?,
    captureCurrentContext: () -> ReviewSubmissionSessionContext
): FailedReviewSubmissionRollbackLookup {
    if (isCurrentReviewSubmissionContext(
            submittedContext = submittedContext,
            currentContext = currentContextBeforeLookup
        ).not()
    ) {
        return FailedReviewSubmissionRollbackLookup(
            currentContext = currentContextBeforeLookup,
            rollbackCard = null
        )
    }

    val rollbackCard = try {
        loadRollbackCard(
            currentContextBeforeLookup.selectedFilter,
            cardId
        )
    } catch (error: Throwable) {
        if (error is CancellationException) {
            throw error
        }
        null
    }

    return FailedReviewSubmissionRollbackLookup(
        currentContext = captureCurrentContext(),
        rollbackCard = rollbackCard
    )
}

internal fun isCurrentReviewSubmissionContext(
    submittedContext: ReviewSubmissionSessionContext,
    currentContext: ReviewSubmissionSessionContext
): Boolean {
    return submittedContext == currentContext
}

internal fun applySuccessfulReviewSubmission(
    state: ReviewDraftState,
    submittedContext: ReviewSubmissionSessionContext,
    currentContext: ReviewSubmissionSessionContext,
    pendingReviewedCard: PendingReviewedCard
): ReviewDraftState {
    val pendingReviewedCards = clearPendingReviewedCard(
        pendingReviewedCards = state.pendingReviewedCards,
        pendingReviewedCard = pendingReviewedCard
    )
    if (isCurrentReviewSubmissionContext(
            submittedContext = submittedContext,
            currentContext = currentContext
        ).not()
    ) {
        return state.copy(pendingReviewedCards = pendingReviewedCards)
    }

    return state.copy(
        reviewedInSessionCount = state.reviewedInSessionCount + 1,
        pendingReviewedCards = pendingReviewedCards,
        optimisticPreparedCurrentCard = null
    )
}

internal fun applyFailedReviewSubmission(
    state: ReviewDraftState,
    submittedContext: ReviewSubmissionSessionContext,
    currentContext: ReviewSubmissionSessionContext,
    rollbackCard: ReviewCard?,
    pendingReviewedCard: PendingReviewedCard,
    errorMessage: String
): ReviewDraftState {
    val pendingReviewedCards = clearPendingReviewedCard(
        pendingReviewedCards = state.pendingReviewedCards,
        pendingReviewedCard = pendingReviewedCard
    )
    if (isCurrentReviewSubmissionContext(
            submittedContext = submittedContext,
            currentContext = currentContext
        ).not()
    ) {
        return state.copy(pendingReviewedCards = pendingReviewedCards)
    }
    val validRollbackCard = rollbackCard ?: return state.copy(
        pendingReviewedCards = pendingReviewedCards,
        errorMessage = errorMessage
    )

    return state.copy(
        presentedCard = validRollbackCard,
        pendingReviewedCards = pendingReviewedCards,
        optimisticPreparedCurrentCard = null,
        errorMessage = errorMessage
    )
}

private fun resolveReviewEmptyState(
    selectedFilter: ReviewFilter,
    remainingCount: Int,
    totalCount: Int,
    workspaceCardCount: Int
): ReviewEmptyState? {
    if (remainingCount > 0) {
        return null
    }

    if (totalCount > 0) {
        return ReviewEmptyState.SESSION_COMPLETE
    }

    if (workspaceCardCount == 0) {
        return ReviewEmptyState.NO_CARDS_YET
    }

    return if (selectedFilter == ReviewFilter.AllCards) {
        ReviewEmptyState.SESSION_COMPLETE
    } else {
        ReviewEmptyState.FILTER_EMPTY
    }
}

private fun CreationExtras.requireApplication(): android.app.Application {
    return checkNotNull(this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY])
}

private fun loadingReviewSessionSnapshot(textProvider: ReviewTextProvider): ReviewSessionSnapshot {
    return ReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        selectedFilterTitle = textProvider.allCardsTitle(),
        cards = emptyList(),
        presentedCard = null,
        answerOptions = emptyList(),
        nextAnswerOptions = emptyList(),
        answerOptionsByCardId = emptyMap(),
        dueCount = 0,
        remainingCount = 0,
        totalCount = 0,
        hasMoreCards = false,
        availableDeckFilters = emptyList(),
        availableEffortFilters = emptyList(),
        availableTagFilters = emptyList(),
        isLoading = true
    )
}

internal fun resolveDisplayedCurrentCard(
    sessionCards: List<ReviewCard>,
    presentedCard: ReviewCard?
): ReviewCard? {
    val presentedCardId = presentedCard?.cardId
    return sessionCards.firstOrNull { card ->
        card.cardId == presentedCardId
    } ?: presentedCard ?: sessionCards.firstOrNull()
}

internal fun buildDisplayedReviewQueue(
    sessionCards: List<ReviewCard>,
    displayedCurrentCard: ReviewCard?
): List<ReviewCard> {
    if (displayedCurrentCard == null) {
        return sessionCards
    }

    return buildList {
        add(displayedCurrentCard)
        sessionCards.forEach { card ->
            if (card.cardId != displayedCurrentCard.cardId) {
                add(card)
            }
        }
    }
}

internal fun resolveDisplayedSessionAnswerOptions(
    displayedCard: ReviewCard?,
    answerOptionsByCardId: Map<String, List<ReviewAnswerOption>>
): List<ReviewAnswerOption>? {
    val card = displayedCard ?: return null
    return answerOptionsByCardId[card.cardId]
}

private fun prepareDisplayedSessionCardPresentation(
    displayedCard: ReviewCard?,
    answerOptionsByCardId: Map<String, List<ReviewAnswerOption>>,
    textProvider: ReviewTextProvider
): PreparedReviewCardPresentation? {
    val card = displayedCard ?: return null
    val answerOptions = requireNotNull(
        resolveDisplayedSessionAnswerOptions(
            displayedCard = card,
            answerOptionsByCardId = answerOptionsByCardId
        )
    ) {
        "Review answer options are missing for displayed card: ${card.cardId}"
    }
    require(answerOptions.isNotEmpty()) {
        "Review answer options are empty for displayed card: ${card.cardId}"
    }

    return prepareReviewCardPresentation(
        card = card,
        answerOptions = answerOptions,
        textProvider = textProvider
    )
}
