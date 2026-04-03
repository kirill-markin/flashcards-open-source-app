package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.data.local.model.ReviewCard
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.ReviewRating
import com.flashcardsopensourceapp.data.local.model.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.notifications.NotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.defaultNotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.reviewNotificationPermissionPromptThreshold
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.AutoSyncRequest
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
private const val reviewUpdatedOnAnotherDeviceMessage: String = "This review updated on another device."

private data class ReviewDraftState(
    val requestedFilter: ReviewFilter,
    val revealedCardId: String?,
    val reviewedInSessionCount: Int,
    val pendingReviewedCardIds: Set<String>,
    val optimisticPreparedCurrentCard: PreparedReviewCardPresentation?,
    val previewCards: List<ReviewCard>,
    val nextPreviewOffset: Int,
    val hasMorePreviewCards: Boolean,
    val isPreviewLoading: Boolean,
    val previewErrorMessage: String,
    val errorMessage: String,
    val isNotificationPermissionPromptVisible: Boolean
)

private data class ObservedReviewSessionState(
    val requestedFilter: ReviewFilter,
    val sessionSnapshot: ReviewSessionSnapshot
)

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModel(
    private val reviewRepository: ReviewRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val shouldShowNotificationPermissionPrePrompt: () -> Boolean,
    private val onReviewNotificationsChanged: () -> Unit,
    private val onNotificationPermissionGranted: () -> Unit,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    constructor(
        reviewRepository: ReviewRepository,
        autoSyncEventRepository: AutoSyncEventRepository,
        messageController: TransientMessageController,
        reviewPreferencesStore: ReviewPreferencesStore,
        visibleAppScreenRepository: VisibleAppScreenRepository,
        workspaceRepository: WorkspaceRepository
    ) : this(
        reviewRepository = reviewRepository,
        autoSyncEventRepository = autoSyncEventRepository,
        messageController = messageController,
        reviewNotificationsStore = NoOpReviewNotificationsStore,
        shouldShowNotificationPermissionPrePrompt = { false },
        onReviewNotificationsChanged = {},
        onNotificationPermissionGranted = {},
        reviewPreferencesStore = reviewPreferencesStore,
        visibleAppScreenRepository = visibleAppScreenRepository,
        workspaceRepository = workspaceRepository
    )

    private val draftState = MutableStateFlow(
        value = ReviewDraftState(
            requestedFilter = ReviewFilter.AllCards,
            revealedCardId = null,
            reviewedInSessionCount = 0,
            pendingReviewedCardIds = emptySet(),
            optimisticPreparedCurrentCard = null,
            previewCards = emptyList(),
            nextPreviewOffset = 0,
            hasMorePreviewCards = true,
            isPreviewLoading = false,
            previewErrorMessage = "",
            errorMessage = "",
            isNotificationPermissionPromptVisible = false
        )
    )

    private val reviewSessionState = draftState.flatMapLatest { state ->
        reviewRepository.observeReviewSession(
            selectedFilter = state.requestedFilter,
            pendingReviewedCardIds = state.pendingReviewedCardIds
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
            sessionSnapshot = loadingReviewSessionSnapshot()
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
            currentWorkspaceName = "Loading...",
            workspaceName = "Loading...",
            deckCount = 0,
            cardCount = 0,
            localStorageLabel = "Room + SQLite",
            syncStatusText = "Loading..."
        )
    )

    private var pendingAutoSyncRequestId: String? = null
    private var reviewCardIdsAtAutoSyncStart: List<String>? = null
    private var lastVisibleAutoSyncChangeSignature: List<String>? = null
    private var activeWorkspaceId: String? = null
    private var workspaceGeneration: Long = 0L

    val uiState: StateFlow<ReviewUiState> = combine(
        reviewSessionState,
        draftState,
        appMetadataState
    ) { reviewSessionState, state, appMetadata ->
        val sessionSnapshot = reviewSessionState.sessionSnapshot
        val sessionCurrentCard = sessionSnapshot.cards.firstOrNull()
        val sessionPreparedCurrentCard = sessionCurrentCard?.let { card ->
            prepareReviewCardPresentation(
                card = card,
                answerOptions = sessionSnapshot.answerOptions
            )
        }
        val currentPreparedCard = if (
            state.optimisticPreparedCurrentCard != null
            && sessionPreparedCurrentCard?.card?.cardId != state.optimisticPreparedCurrentCard.card.cardId
        ) {
            state.optimisticPreparedCurrentCard
        } else {
            sessionPreparedCurrentCard
        }
        val preparedNextCard = if (currentPreparedCard?.card?.cardId == sessionPreparedCurrentCard?.card?.cardId) {
            sessionSnapshot.cards.getOrNull(index = 1)?.let { card ->
                prepareReviewCardPresentation(
                    card = card,
                    answerOptions = sessionSnapshot.nextAnswerOptions
                )
            }
        } else {
            null
        }
        val emptyState = resolveReviewEmptyState(
            selectedFilter = sessionSnapshot.selectedFilter,
            totalCount = sessionSnapshot.totalCount,
            workspaceCardCount = appMetadata.cardCount
        )

        ReviewUiState(
            isLoading = sessionSnapshot.isLoading,
            selectedFilter = sessionSnapshot.selectedFilter,
            selectedFilterTitle = sessionSnapshot.selectedFilterTitle,
            remainingCount = sessionSnapshot.remainingCount,
            totalCount = sessionSnapshot.totalCount,
            reviewedInSessionCount = state.reviewedInSessionCount,
            isAnswerVisible = state.revealedCardId == currentPreparedCard?.card?.cardId,
            currentCardIdForEditing = currentPreparedCard?.card?.cardId,
            preparedCurrentCard = currentPreparedCard,
            preparedNextCard = preparedNextCard,
            availableDeckFilters = sessionSnapshot.availableDeckFilters,
            availableTagFilters = sessionSnapshot.availableTagFilters,
            isPreviewLoading = state.isPreviewLoading,
            previewItems = buildReviewPreviewItems(
                cards = state.previewCards,
                currentCardId = currentPreparedCard?.card?.cardId
            ),
            hasMorePreviewCards = state.hasMorePreviewCards,
            emptyState = emptyState,
            previewErrorMessage = state.previewErrorMessage,
            errorMessage = state.errorMessage,
            isNotificationPermissionPromptVisible = state.isNotificationPermissionPromptVisible
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = ReviewUiState(
            isLoading = true,
            selectedFilter = ReviewFilter.AllCards,
            selectedFilterTitle = "All cards",
            remainingCount = 0,
            totalCount = 0,
            reviewedInSessionCount = 0,
            isAnswerVisible = false,
            currentCardIdForEditing = null,
            preparedCurrentCard = null,
            preparedNextCard = null,
            availableDeckFilters = emptyList(),
            availableTagFilters = emptyList(),
            isPreviewLoading = false,
            previewItems = emptyList(),
            hasMorePreviewCards = true,
            emptyState = null,
            previewErrorMessage = "",
            errorMessage = "",
            isNotificationPermissionPromptVisible = false
        )
    )

    init {
        observeWorkspaceChanges()
        observeResolvedFilterChanges()
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
        onReviewNotificationsChanged()
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
        val operationWorkspaceGeneration = workspaceGeneration

        draftState.update { state ->
            state.copy(
                revealedCardId = null,
                pendingReviewedCardIds = state.pendingReviewedCardIds + cardId,
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
                    reviewedAtMillis = System.currentTimeMillis()
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
                handleSuccessfulReviewRecorded()
            } catch (error: Throwable) {
                if (operationWorkspaceGeneration != workspaceGeneration) {
                    return@launch
                }
                draftState.update { state ->
                    state.copy(
                        pendingReviewedCardIds = state.pendingReviewedCardIds - cardId,
                        optimisticPreparedCurrentCard = null,
                        errorMessage = error.message ?: "Review could not be saved."
                    )
                }
            }
        }
    }

    private fun handleSuccessfulReviewRecorded() {
        val nextReviewCount = reviewNotificationsStore.loadSuccessfulReviewCount() + 1
        reviewNotificationsStore.saveSuccessfulReviewCount(count = nextReviewCount)
        onReviewNotificationsChanged()

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
        val pendingReviewedCardIds = draftState.value.pendingReviewedCardIds
        val operationWorkspaceGeneration = workspaceGeneration

        viewModelScope.launch {
            try {
                val page = reviewRepository.loadReviewTimelinePage(
                    selectedFilter = requestedFilter,
                    pendingReviewedCardIds = pendingReviewedCardIds,
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
                        previewErrorMessage = error.message ?: "Review queue could not be loaded."
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

    private fun handleAutoSyncRequested(request: AutoSyncRequest) {
        if (request.allowsVisibleChangeMessage.not()) {
            return
        }
        if (visibleAppScreenState.value != VisibleAppScreen.REVIEW) {
            return
        }

        pendingAutoSyncRequestId = request.requestId
        reviewCardIdsAtAutoSyncStart = reviewSessionState.value.sessionSnapshot.cards.map(ReviewCard::cardId)
    }

    private fun handleAutoSyncCompleted(completion: AutoSyncCompletion) {
        if (completion.request.requestId != pendingAutoSyncRequestId) {
            return
        }

        pendingAutoSyncRequestId = null
        val reviewCardIdsBeforeSync = reviewCardIdsAtAutoSyncStart
        reviewCardIdsAtAutoSyncStart = null

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
            sessionSnapshot = reviewSessionState.value.sessionSnapshot
        )
    }

    private fun reconcileReviewAfterSuccessfulAutoSync(
        reviewCardIdsBeforeSync: List<String>?,
        sessionSnapshot: ReviewSessionSnapshot
    ) {
        val reviewCardIdsAfterSync = sessionSnapshot.cards.map(ReviewCard::cardId)
        if (reviewCardIdsBeforeSync == null) {
            return
        }
        if (reviewCardIdsBeforeSync == reviewCardIdsAfterSync) {
            return
        }
        if (reviewCardIdsAfterSync == lastVisibleAutoSyncChangeSignature) {
            return
        }

        val postSyncCurrentCardId = reviewCardIdsAfterSync.firstOrNull()
        draftState.update { state ->
            state.copy(
                revealedCardId = if (state.revealedCardId == postSyncCurrentCardId) {
                    state.revealedCardId
                } else {
                    null
                },
                optimisticPreparedCurrentCard = if (state.optimisticPreparedCurrentCard?.card?.cardId == postSyncCurrentCardId) {
                    state.optimisticPreparedCurrentCard
                } else {
                    null
                },
                previewCards = emptyList(),
                nextPreviewOffset = 0,
                hasMorePreviewCards = true,
                isPreviewLoading = false,
                previewErrorMessage = ""
            )
        }
        lastVisibleAutoSyncChangeSignature = reviewCardIdsAfterSync
        messageController.showMessage(message = reviewUpdatedOnAnotherDeviceMessage)
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
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    reviewNotificationsStore: ReviewNotificationsStore,
    shouldShowNotificationPermissionPrePrompt: () -> Boolean,
    onReviewNotificationsChanged: () -> Unit,
    onNotificationPermissionGranted: () -> Unit,
    reviewPreferencesStore: ReviewPreferencesStore,
    visibleAppScreenRepository: VisibleAppScreenRepository,
    workspaceRepository: WorkspaceRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ReviewViewModel(
                reviewRepository = reviewRepository,
                autoSyncEventRepository = autoSyncEventRepository,
                messageController = messageController,
                reviewNotificationsStore = reviewNotificationsStore,
                shouldShowNotificationPermissionPrePrompt = shouldShowNotificationPermissionPrePrompt,
                onReviewNotificationsChanged = onReviewNotificationsChanged,
                onNotificationPermissionGranted = onNotificationPermissionGranted,
                reviewPreferencesStore = reviewPreferencesStore,
                visibleAppScreenRepository = visibleAppScreenRepository,
                workspaceRepository = workspaceRepository
            )
        }
    }
}

private fun makeWorkspaceScopedDraftState(reviewFilter: ReviewFilter): ReviewDraftState {
    return ReviewDraftState(
        requestedFilter = reviewFilter,
        revealedCardId = null,
        reviewedInSessionCount = 0,
        pendingReviewedCardIds = emptySet(),
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false
    )
}

private fun applyReviewFilterChange(
    state: ReviewDraftState,
    reviewFilter: ReviewFilter
): ReviewDraftState {
    return state.copy(
        requestedFilter = reviewFilter,
        revealedCardId = null,
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false
    )
}

private fun applyResolvedReviewFilter(
    state: ReviewDraftState,
    reviewFilter: ReviewFilter
): ReviewDraftState {
    return state.copy(
        requestedFilter = reviewFilter,
        revealedCardId = null,
        optimisticPreparedCurrentCard = null,
        previewCards = emptyList(),
        nextPreviewOffset = 0,
        hasMorePreviewCards = true,
        isPreviewLoading = false,
        previewErrorMessage = "",
        errorMessage = "",
        isNotificationPermissionPromptVisible = false
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

private fun loadingReviewSessionSnapshot(): ReviewSessionSnapshot {
    return ReviewSessionSnapshot(
        selectedFilter = ReviewFilter.AllCards,
        selectedFilterTitle = "All cards",
        cards = emptyList(),
        answerOptions = emptyList(),
        nextAnswerOptions = emptyList(),
        remainingCount = 0,
        totalCount = 0,
        availableDeckFilters = emptyList(),
        availableTagFilters = emptyList(),
        isLoading = true
    )
}
