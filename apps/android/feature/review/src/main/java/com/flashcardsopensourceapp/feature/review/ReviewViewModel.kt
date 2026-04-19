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
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
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

private data class ReviewDraftState(
    val requestedFilter: ReviewFilter,
    val presentedCardId: String?,
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

private data class ObservedReviewSessionState(
    val requestedFilter: ReviewFilter,
    val sessionSnapshot: ReviewSessionSnapshot
)

private data class VisibleAutoSyncChangeSignature(
    val reviewCardIds: List<String>,
    val preparedCurrentCard: PreparedReviewCardPresentation?
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
            presentedCardId = null,
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
            pendingReviewedCards = state.pendingReviewedCards
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
    private var reviewCardIdsAtAutoSyncStart: List<String>? = null
    private var preparedCurrentCardAtAutoSyncStart: PreparedReviewCardPresentation? = null
    private var lastVisibleAutoSyncChangeSignature: VisibleAutoSyncChangeSignature? = null
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
        val displayedCurrentCard = resolveDisplayedCurrentCard(
            sessionCards = sessionSnapshot.cards,
            presentedCardId = state.presentedCardId
        )
        val displayedQueue = buildDisplayedReviewQueue(
            sessionCards = sessionSnapshot.cards,
            displayedCurrentCardId = displayedCurrentCard?.cardId
        )
        val sessionPreparedCurrentCard = prepareDisplayedSessionCardPresentation(
            displayedCard = displayedCurrentCard,
            sessionCards = sessionSnapshot.cards,
            headAnswerOptions = sessionSnapshot.answerOptions,
            secondAnswerOptions = sessionSnapshot.nextAnswerOptions,
            textProvider = textProvider
        )
        val currentPreparedCard = if (
            state.optimisticPreparedCurrentCard != null
            && state.optimisticPreparedCurrentCard.card.cardId == displayedCurrentCard?.cardId
        ) {
            state.optimisticPreparedCurrentCard
        } else {
            sessionPreparedCurrentCard
        }
        val displayedNextCard = displayedQueue.getOrNull(index = 1)
        val preparedNextCard = prepareDisplayedSessionCardPresentation(
            displayedCard = displayedNextCard,
            sessionCards = sessionSnapshot.cards,
            headAnswerOptions = sessionSnapshot.answerOptions,
            secondAnswerOptions = sessionSnapshot.nextAnswerOptions,
            textProvider = textProvider
        )
        val emptyState = resolveReviewEmptyState(
            selectedFilter = sessionSnapshot.selectedFilter,
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
        val nextPresentedCardId = optimisticPreparedCurrentCard?.card?.cardId
        val operationWorkspaceGeneration = workspaceGeneration
        val reviewedAtMillis = System.currentTimeMillis()

        draftState.update { state ->
            state.copy(
                presentedCardId = nextPresentedCardId,
                revealedCardId = null,
                pendingReviewedCards = state.pendingReviewedCards + PendingReviewedCard(
                    cardId = cardId,
                    updatedAtMillis = currentCard.updatedAtMillis
                ),
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
                draftState.update { state ->
                    state.copy(
                        reviewedInSessionCount = state.reviewedInSessionCount + 1,
                        optimisticPreparedCurrentCard = null
                    )
                }
                val didShowHardAnswerReminder = updateHardAnswerReminderState(
                    rating = rating,
                    reviewedAtMillis = reviewedAtMillis
                )
                handleSuccessfulReviewRecorded(
                    reviewedAtMillis = reviewedAtMillis,
                    shouldShowNotificationPermissionPrePrompt = didShowHardAnswerReminder.not()
                )
            } catch (error: Throwable) {
                if (operationWorkspaceGeneration != workspaceGeneration) {
                    return@launch
                }
                draftState.update { state ->
                    state.copy(
                        presentedCardId = cardId,
                        pendingReviewedCards = state.pendingReviewedCards - PendingReviewedCard(
                            cardId = cardId,
                            updatedAtMillis = currentCard.updatedAtMillis
                        ),
                        optimisticPreparedCurrentCard = null,
                        errorMessage = error.message ?: textProvider.reviewCouldNotBeSaved
                    )
                }
            }
        }
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
    private fun handleSuccessfulReviewRecorded(
        reviewedAtMillis: Long,
        shouldShowNotificationPermissionPrePrompt: Boolean
    ) {
        val nowMillis = System.currentTimeMillis()
        reviewNotificationsStore.saveLastActiveAtMillis(timestampMillis = nowMillis)
        val nextReviewCount = reviewNotificationsStore.loadSuccessfulReviewCount() + 1
        reviewNotificationsStore.saveSuccessfulReviewCount(count = nextReviewCount)
        onReviewNotificationsChanged(ReviewNotificationsReconcileTrigger.REVIEW_RECORDED)
        onSuccessfulReviewRecorded(reviewedAtMillis)

        if (shouldShowNotificationPermissionPrePrompt.not()) {
            return
        }

        val promptState = reviewNotificationsStore.loadPromptState()
        if (nextReviewCount < reviewNotificationPermissionPromptThreshold) {
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

                draftState.update { state ->
                    if (observedState.requestedFilter != state.requestedFilter) {
                        return@update state
                    }

                    val nextPresentedCardId = resolvePresentedCardId(
                        sessionCards = sessionSnapshot.cards,
                        currentPresentedCardId = state.presentedCardId
                    )
                    if (nextPresentedCardId == state.presentedCardId) {
                        return@update state
                    }

                    state.copy(
                        presentedCardId = nextPresentedCardId,
                        revealedCardId = if (state.revealedCardId == nextPresentedCardId) {
                            state.revealedCardId
                        } else {
                            null
                        },
                        optimisticPreparedCurrentCard = if (state.optimisticPreparedCurrentCard?.card?.cardId == nextPresentedCardId) {
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
        reviewCardIdsAtAutoSyncStart = reviewSessionState.value.sessionSnapshot.cards.map(ReviewCard::cardId)
        preparedCurrentCardAtAutoSyncStart = uiState.value.preparedCurrentCard
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val reviewCardIdsBeforeSync = reviewCardIdsAtAutoSyncStart
        reviewCardIdsAtAutoSyncStart = null
        val currentPreparedCardBeforeSync = preparedCurrentCardAtAutoSyncStart
        preparedCurrentCardAtAutoSyncStart = null

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
            reviewCardIdsBeforeSync = reviewCardIdsBeforeSync,
            sessionSnapshot = reviewSessionState.value.sessionSnapshot,
            currentPreparedCardBeforeSync = currentPreparedCardBeforeSync
        )
    }

    private fun reconcileReviewAfterSuccessfulAutoSync(
        reviewCardIdsBeforeSync: List<String>?,
        sessionSnapshot: ReviewSessionSnapshot,
        currentPreparedCardBeforeSync: PreparedReviewCardPresentation?
    ) {
        val reviewCardIdsAfterSync = sessionSnapshot.cards.map(ReviewCard::cardId)
        if (reviewCardIdsBeforeSync == null) {
            return
        }
        val currentPresentedCardId = draftState.value.presentedCardId
        val displayedCurrentCardAfterSync = resolveDisplayedCurrentCard(
            sessionCards = sessionSnapshot.cards,
            presentedCardId = currentPresentedCardId
        )
        val preparedCurrentCardAfterSync = prepareDisplayedSessionCardPresentation(
            displayedCard = displayedCurrentCardAfterSync,
            sessionCards = sessionSnapshot.cards,
            headAnswerOptions = sessionSnapshot.answerOptions,
            secondAnswerOptions = sessionSnapshot.nextAnswerOptions,
            textProvider = textProvider
        )
        val didReviewQueueChange = reviewCardIdsBeforeSync != reviewCardIdsAfterSync
        val didVisibleCurrentCardChange = currentPreparedCardBeforeSync != null
            && preparedCurrentCardAfterSync != null
            && currentPreparedCardBeforeSync.card.cardId == preparedCurrentCardAfterSync.card.cardId
            && currentPreparedCardBeforeSync != preparedCurrentCardAfterSync
        if (didReviewQueueChange.not() && didVisibleCurrentCardChange.not()) {
            return
        }
        val nextVisibleChangeSignature = VisibleAutoSyncChangeSignature(
            reviewCardIds = reviewCardIdsAfterSync,
            preparedCurrentCard = preparedCurrentCardAfterSync
        )
        if (nextVisibleChangeSignature == lastVisibleAutoSyncChangeSignature) {
            return
        }

        draftState.update { state ->
            val nextPresentedCardId = resolvePresentedCardId(
                sessionCards = sessionSnapshot.cards,
                currentPresentedCardId = state.presentedCardId
            )
            state.copy(
                presentedCardId = nextPresentedCardId,
                revealedCardId = if (state.revealedCardId == nextPresentedCardId) {
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
        presentedCardId = null,
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
        presentedCardId = null,
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
        presentedCardId = null,
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

private fun resolveReviewEmptyState(
    selectedFilter: ReviewFilter,
    totalCount: Int,
    workspaceCardCount: Int
): ReviewEmptyState? {
    if (totalCount > 0) {
        return null
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
        answerOptions = emptyList(),
        nextAnswerOptions = emptyList(),
        remainingCount = 0,
        totalCount = 0,
        availableDeckFilters = emptyList(),
        availableEffortFilters = emptyList(),
        availableTagFilters = emptyList(),
        isLoading = true
    )
}

private fun resolvePresentedCardId(
    sessionCards: List<ReviewCard>,
    currentPresentedCardId: String?
): String? {
    val hasPresentedCard = sessionCards.any { card ->
        card.cardId == currentPresentedCardId
    }
    if (hasPresentedCard) {
        return currentPresentedCardId
    }

    return sessionCards.firstOrNull()?.cardId
}

private fun resolveDisplayedCurrentCard(
    sessionCards: List<ReviewCard>,
    presentedCardId: String?
): ReviewCard? {
    return sessionCards.firstOrNull { card ->
        card.cardId == presentedCardId
    } ?: sessionCards.firstOrNull()
}

private fun buildDisplayedReviewQueue(
    sessionCards: List<ReviewCard>,
    displayedCurrentCardId: String?
): List<ReviewCard> {
    if (displayedCurrentCardId == null) {
        return sessionCards
    }

    val displayedCurrentCard = sessionCards.firstOrNull { card ->
        card.cardId == displayedCurrentCardId
    } ?: return sessionCards

    return buildList {
        add(displayedCurrentCard)
        sessionCards.forEach { card ->
            if (card.cardId != displayedCurrentCardId) {
                add(card)
            }
        }
    }
}

private fun prepareDisplayedSessionCardPresentation(
    displayedCard: ReviewCard?,
    sessionCards: List<ReviewCard>,
    headAnswerOptions: List<ReviewAnswerOption>,
    secondAnswerOptions: List<ReviewAnswerOption>,
    textProvider: ReviewTextProvider
): PreparedReviewCardPresentation? {
    val card = displayedCard ?: return null
    val cardIndex = sessionCards.indexOfFirst { sessionCard ->
        sessionCard.cardId == card.cardId
    }

    val answerOptions = when (cardIndex) {
        0 -> headAnswerOptions
        1 -> secondAnswerOptions
        else -> return null
    }

    return prepareReviewCardPresentation(
        card = card,
        answerOptions = answerOptions,
        textProvider = textProvider
    )
}
