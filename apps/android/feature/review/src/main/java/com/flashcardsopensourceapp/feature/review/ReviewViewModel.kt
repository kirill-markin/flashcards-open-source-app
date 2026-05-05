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
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.notifications.NotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
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

private fun hasEnoughReviewHistoryForNotificationPrompt(reviewCount: Int): Boolean {
    return reviewCount >= reviewNotificationPermissionPromptThreshold
}

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
        value = makeWorkspaceScopedDraftState(reviewFilter = ReviewFilter.AllCards)
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
        initialValue = initialReviewAppMetadataSummary(textProvider = textProvider)
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
        mapToReviewUiState(
            sessionSnapshot = reviewSessionState.sessionSnapshot,
            state = state,
            appMetadata = appMetadata,
            progressSummarySnapshot = progressSummarySnapshot,
            textProvider = textProvider
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = initialReviewUiState(textProvider = textProvider)
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
        if (shouldStartReviewPreview(state = currentState).not()) {
            return
        }

        draftState.update(::applyStartReviewPreview)
        loadPreviewPage(offset = 0, replaceCards = true)
    }

    fun loadNextPreviewPageIfNeeded(itemCardId: String) {
        val currentState = draftState.value
        if (
            shouldLoadNextReviewPreviewPage(
                state = currentState,
                itemCardId = itemCardId
            ).not()
        ) {
            return
        }

        draftState.update(::applyReviewPreviewPageLoading)
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
            applyOptimisticReviewSubmission(
                state = state,
                nextPresentedCard = nextPresentedCard,
                pendingReviewedCard = pendingReviewedCard,
                optimisticPreparedCurrentCard = optimisticPreparedCurrentCard
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
        val decision = reduceHardAnswerReminderDecision(
            recentReviewRatings = recentReviewRatings,
            nextRating = rating,
            reviewedAtMillis = reviewedAtMillis,
            lastShownAtMillis = hardAnswerReminderLastShownAtMillis
        )
        recentReviewRatings = decision.recentReviewRatings
        if (decision.shouldShowReminder.not()) {
            return false
        }

        val nextLastShownAtMillis = checkNotNull(decision.nextLastShownAtMillis)
        hardAnswerReminderLastShownAtMillis = nextLastShownAtMillis
        reviewPreferencesStore.saveHardAnswerReminderLastShownAt(timestampMillis = nextLastShownAtMillis)
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
                    applyLoadedReviewPreviewPage(
                        state = state,
                        page = page,
                        replaceCards = replaceCards
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
                    applyFailedReviewPreviewPage(
                        state = state,
                        errorMessage = error.message ?: textProvider.reviewQueueCouldNotBeLoaded
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
        if (
            shouldShowVisibleAutoSyncChangeMessage(
                visibleSignatureBeforeSync = visibleSignatureBeforeSync,
                nextVisibleChangeSignature = nextVisibleChangeSignature,
                lastVisibleAutoSyncChangeSignature = lastVisibleAutoSyncChangeSignature
            ).not()
        ) {
            return
        }

        draftState.update { state ->
            applySuccessfulAutoSyncReviewState(
                state = state,
                sessionSnapshot = sessionSnapshot
            )
        }
        lastVisibleAutoSyncChangeSignature = nextVisibleChangeSignature
        messageController.showMessage(message = textProvider.reviewUpdatedOnAnotherDeviceMessage)
    }
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

private fun CreationExtras.requireApplication(): android.app.Application {
    return checkNotNull(this[ViewModelProvider.AndroidViewModelFactory.APPLICATION_KEY])
}
