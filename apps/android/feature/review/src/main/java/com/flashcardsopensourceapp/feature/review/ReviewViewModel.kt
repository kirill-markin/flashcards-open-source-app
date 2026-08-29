package com.flashcardsopensourceapp.feature.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.VisibleAppScreen
import com.flashcardsopensourceapp.core.ui.VisibleAppScreenRepository
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPrompt
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsPromptOutcome
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsReviewAnswerFailureReason
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile
import com.flashcardsopensourceapp.data.local.model.review.PendingReviewedCard
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.review.ReviewSessionSnapshot
import com.flashcardsopensourceapp.data.local.notifications.NotificationPermissionPromptState
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsReconcileTrigger
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.notifications.reviewNotificationPermissionPromptThreshold
import com.flashcardsopensourceapp.data.local.review.ReviewPreferencesStore
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncCompletion
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEvent
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncEventRepository
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncOutcome
import com.flashcardsopensourceapp.data.local.repository.sync.AutoSyncRequest
import com.flashcardsopensourceapp.data.local.repository.ProgressRepository
import com.flashcardsopensourceapp.data.local.repository.ReviewRepository
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.getAndUpdate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.IOException
import java.net.SocketTimeoutException

private const val maxAnalyticsReviewFailureCauseDepth: Int = 8

private fun hasEnoughReviewHistoryForNotificationPrompt(reviewCount: Int): Boolean {
    return reviewCount >= reviewNotificationPermissionPromptThreshold
}

@OptIn(ExperimentalCoroutinesApi::class)
class ReviewViewModel(
    private val reviewRepository: ReviewRepository,
    private val progressRepository: ProgressRepository,
    private val autoSyncEventRepository: AutoSyncEventRepository,
    private val messageController: TransientMessageController,
    private val technicalErrorController: AppTechnicalErrorController,
    private val reviewNotificationsStore: ReviewNotificationsStore,
    private val shouldShowNotificationPermissionPrePrompt: () -> Boolean,
    private val onReviewNotificationsChanged: (ReviewNotificationsReconcileTrigger) -> Unit,
    private val onSuccessfulReviewRecorded: suspend (Long) -> Unit,
    private val onStoreReviewOpportunity: suspend () -> Boolean,
    private val onAutomaticFeedbackPromptCandidate: () -> Unit,
    private val onNotificationPermissionGranted: () -> Unit,
    private val reviewPreferencesStore: ReviewPreferencesStore,
    private val analytics: Analytics,
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
    // Eagerly, because the auto-sync handlers only ever read this through [StateFlow.value]: a
    // lazily started wrapper would have no subscriber and stay stuck on [VisibleAppScreen.OTHER].
    private val visibleAppScreenState = visibleAppScreenRepository.observeVisibleAppScreen().stateIn(
        scope = viewModelScope,
        started = SharingStarted.Eagerly,
        initialValue = VisibleAppScreen.OTHER
    )
    private val workspaceState = workspaceRepository.observeWorkspace().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = null
    )
    val workspaceId: StateFlow<String?> = workspaceState.map { workspace ->
        workspace?.workspaceId
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = null
    )
    private val appMetadataState = workspaceRepository.observeAppMetadata().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = initialReviewAppMetadataSummary(textProvider = textProvider)
    )
    private val progressBadgeInputsState = combine(
        progressRepository.observeSummarySnapshot(),
        progressRepository.observeLeaderboardSnapshot()
    ) { progressSummarySnapshot, progressLeaderboardSnapshot ->
        progressSummarySnapshot to progressLeaderboardSnapshot
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = null to null
    )
    private val reviewMediaAssetsState = reviewRepository.observeReviewMediaAssets().stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = emptyList()
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
    private var handledPresentedCardId: String? = null
    private var handledAnswerRevealCardId: String? = null
    /** Fixed-size in-memory review history for the current review session only. */
    private var recentReviewRatings: List<ReviewRating> = emptyList()
    /** Device-level cooldown timestamp for the hard-answer reminder. */
    private var hardAnswerReminderLastShownAtMillis: Long? = reviewPreferencesStore.loadHardAnswerReminderLastShownAt()

    val uiState: StateFlow<ReviewUiState> = combine(
        reviewSessionState,
        draftState,
        appMetadataState,
        progressBadgeInputsState,
        reviewMediaAssetsState
    ) { reviewSessionState, state, appMetadata, progressBadgeInputs, mediaAssets ->
        mapToReviewUiState(
            sessionSnapshot = reviewSessionState.sessionSnapshot,
            state = state,
            appMetadata = appMetadata,
            progressSummarySnapshot = progressBadgeInputs.first,
            progressLeaderboardSnapshot = progressBadgeInputs.second,
            mediaAssets = mediaAssets,
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
        observeNotificationPermissionPromptVisibility()
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

    fun selectFilterForWorkspaceIfUnchanged(
        workspaceId: String,
        openingFilter: ReviewFilter,
        reviewFilter: ReviewFilter
    ) {
        if (
            workspaceId != activeWorkspaceId
            || draftState.value.requestedFilter != openingFilter
            || uiState.value.isLoading
            || reviewFilter == openingFilter
        ) {
            return
        }

        selectFilter(reviewFilter = reviewFilter)
    }

    fun selectFilterForHandoff(reviewFilter: ReviewFilter): Boolean {
        if (activeWorkspaceId == null) {
            return false
        }

        selectFilter(reviewFilter = reviewFilter)
        return true
    }

    private fun persistSelectedReviewFilter(reviewFilter: ReviewFilter) {
        val workspaceId = activeWorkspaceId ?: return
        reviewPreferencesStore.saveSelectedReviewFilter(
            workspaceId = workspaceId,
            reviewFilter = reviewFilter
        )
    }

    /**
     * The flip, and the only producer of `review_card_revealed`.
     *
     * It is reported from the user's action rather than from an effect that observes the revealed
     * state, because an observer runs again on every recomposition and on every configuration
     * change, and it also runs for the *next* card at the moment that card is presented. Being a
     * plain call on the view model, this survives rotation without a saved slot: the view model
     * outlives the composition, so the flip is one call whatever the UI does around it.
     *
     * The guard is the presentation, not the card. [ReviewDraftState.revealedCardId] is cleared
     * whenever a different card takes the head of the queue and by every answer that is submitted,
     * so tapping reveal twice on one presentation reports once, while a card that comes back around
     * — an `again` that returns it to the head — is a new presentation and reports again. A guard
     * remembering the last card reported would go silent on exactly that case.
     */
    fun revealAnswer() {
        val currentCardId = uiState.value.preparedCurrentCard?.card?.cardId ?: return
        val previousState: ReviewDraftState = draftState.getAndUpdate { state ->
            state.copy(
                revealedCardId = currentCardId,
                errorMessage = ""
            )
        }
        if (previousState.revealedCardId == currentCardId) {
            return
        }
        analytics.track(event = AnalyticsEvent.ReviewCardRevealed)
    }

    fun consumeReviewRelocationTarget(
        presentedCardId: String?,
        isAnswerVisible: Boolean
    ): ReviewRelocationTarget? {
        if (presentedCardId != handledPresentedCardId) {
            handledPresentedCardId = presentedCardId
            handledAnswerRevealCardId = if (isAnswerVisible) presentedCardId else null
            return if (presentedCardId == null) null else ReviewRelocationTarget.FRONT
        }

        if (isAnswerVisible.not()) {
            handledAnswerRevealCardId = null
            return null
        }
        if (presentedCardId == null || handledAnswerRevealCardId == presentedCardId) {
            return null
        }

        handledAnswerRevealCardId = presentedCardId
        return ReviewRelocationTarget.BACK
    }

    fun dismissErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }

    fun dismissNotificationPermissionPrompt() {
        // `dismissed`, not `snoozed`: the stored state closes this pre-prompt for good rather than
        // scheduling it to return.
        reportNotificationPermissionPromptAnswer(outcome = AnalyticsPromptOutcome.DISMISSED)
        closeNotificationPermissionPrompt()
        reviewNotificationsStore.savePromptState(
            state = NotificationPermissionPromptState(
                hasShownPrePrompt = true,
                hasRequestedSystemPermission = false,
                hasDismissedPrePrompt = true
            )
        )
    }

    fun continueNotificationPermissionPrompt() {
        // Accepting our own prompt is a different fact from what the OS dialog that follows answers,
        // which the caller reports as `permission_prompt_answered`. A person can accept here and
        // still deny there, and that gap is the reason both events exist.
        reportNotificationPermissionPromptAnswer(outcome = AnalyticsPromptOutcome.ACCEPTED)
        closeNotificationPermissionPrompt()
        reviewNotificationsStore.savePromptState(
            state = NotificationPermissionPromptState(
                hasShownPrePrompt = true,
                hasRequestedSystemPermission = true,
                hasDismissedPrePrompt = false
            )
        )
    }

    private fun closeNotificationPermissionPrompt() {
        draftState.update { state ->
            state.copy(isNotificationPermissionPromptVisible = false)
        }
    }

    /**
     * Reports the answer to the pre-prompt, and only when a visible prompt is what is being
     * answered, so a second tap arriving before the dialog is off screen reports once.
     *
     * Called before [closeNotificationPermissionPrompt] on purpose. That flip is also the surface
     * change back to `review`, which [observeNotificationPermissionPromptVisibility] emits off the
     * flag, so closing first would file the answer behind the person's departure from the prompt and
     * a strictly sequenced funnel would read it as arriving after they left. Both handlers run on
     * the main thread with no suspension between the read and the flip, so the read is as good a
     * guard against a double tap as consuming the flag atomically was.
     *
     * The surface change itself stays with [observeNotificationPermissionPromptVisibility], which
     * sees every way the prompt closes rather than only the two a person can take.
     */
    private fun reportNotificationPermissionPromptAnswer(outcome: AnalyticsPromptOutcome) {
        if (draftState.value.isNotificationPermissionPromptVisible.not()) {
            return
        }

        analytics.track(
            event = AnalyticsEvent.PromptAnswered(
                prompt = AnalyticsPrompt.NOTIFICATIONS_PRE_PROMPT,
                outcome = outcome
            )
        )
    }

    /**
     * Both surface edges of the notifications pre-prompt, taken from the visibility flag itself.
     *
     * The pre-prompt is a surface of its own in the catalog — a screen a person has to answer before
     * anything else continues — so its showing and its closing are both surface changes. They are
     * reported from here rather than from the app-wide route tracker because this view model owns
     * the prompt's visibility and the route does not change while it is up.
     *
     * Keyed on the transition rather than on the call sites that produce it, because answering is
     * not the only way it closes. A workspace change rebuilds the whole draft state, and both filter
     * paths clear the flag as part of starting a new session — one of them, the resolved-filter
     * correction, with no user action at all. Reported from the answer handlers instead, every one
     * of those would end the person's stream on `notifications_pre_prompt` while they are back on
     * review, and, because a repeat of the same surface is collapsed, would also swallow their next
     * genuine arrival there. A fifth teardown added later is covered by construction.
     *
     * The first value is dropped: the flag starts false, and this runs from `init`, long before any
     * review can be answered, so the only `false` this could see at that point is the initial one.
     * Being a view-model state transition, each edge happens once no matter how the composition is
     * rebuilt around it.
     */
    private fun observeNotificationPermissionPromptVisibility() {
        viewModelScope.launch {
            draftState
                .map { state -> state.isNotificationPermissionPromptVisible }
                .distinctUntilChanged()
                .drop(count = 1)
                .collect { isPromptVisible ->
                    val visitedSurface: AnalyticsSurface = if (isPromptVisible) {
                        AnalyticsSurface.NOTIFICATIONS_PRE_PROMPT
                    } else {
                        AnalyticsSurface.REVIEW
                    }
                    analytics.track(event = AnalyticsEvent.ScreenViewed(screen = visitedSurface))
                }
        }
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
        viewModelScope.launch {
            progressRepository.refreshLeaderboardForReviewShortcut()
        }
    }

    suspend fun loadManagedMediaDownloadUrl(mediaAssetId: String): MediaAssetDownloadUrl {
        return reviewRepository.loadReviewMediaAssetDownloadUrl(mediaAssetId = mediaAssetId)
    }

    suspend fun loadManagedMediaFile(mediaAssetId: String): ReviewMediaAssetFile {
        return reviewRepository.loadReviewMediaAssetFile(mediaAssetId = mediaAssetId)
    }

    fun handleNotificationPermissionGranted() {
        onNotificationPermissionGranted()
    }

    fun refreshPreview() {
        draftState.update(::applyStartReviewPreview)
        loadPreviewPage(offset = 0, replaceCards = true)
    }

    fun ensurePreviewStarted() {
        val currentState = draftState.value
        if (shouldEnsureReviewPreviewStarted(state = currentState).not()) {
            return
        }

        refreshPreview()
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
        refreshPreview()
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
                val shouldRequestPostReviewPrompt = isCurrentSubmissionContext && didShowHardAnswerReminder.not()
                handleSuccessfulReviewRecorded(
                    reviewedAtMillis = reviewedAtMillis,
                    canEvaluatePostReviewPrompts = shouldRequestPostReviewPrompt
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
                        errorMessage = textProvider.reviewCouldNotBeSaved
                    )
                }
                analytics.track(
                    event = AnalyticsEvent.ReviewAnswerFailed(
                        reason = analyticsReviewAnswerFailureReason(error = error)
                    )
                )
                technicalErrorController.showTechnicalError(
                    error = makeAppTechnicalError(
                        title = textProvider.technicalErrorTitle,
                        message = textProvider.reviewCouldNotBeSaved,
                        throwable = error
                    ),
                    throwable = error
                )
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
     * Records successful review bookkeeping and evaluates lightweight post-review prompts.
     */
    private suspend fun handleSuccessfulReviewRecorded(
        reviewedAtMillis: Long,
        canEvaluatePostReviewPrompts: Boolean
    ) {
        val nowMillis = System.currentTimeMillis()
        reviewNotificationsStore.saveLastActiveAtMillis(timestampMillis = nowMillis)
        val nextReviewCount = reviewNotificationsStore.loadSuccessfulReviewCount() + 1
        reviewNotificationsStore.saveSuccessfulReviewCount(count = nextReviewCount)
        val reviewCount = maxOf(nextReviewCount, reviewRepository.countRecordedReviews())
        onReviewNotificationsChanged(ReviewNotificationsReconcileTrigger.REVIEW_RECORDED)
        onSuccessfulReviewRecorded(reviewedAtMillis)

        if (canEvaluatePostReviewPrompts.not()) {
            return
        }
        if (isReviewPromptVisible()) {
            return
        }

        val didStartStoreReviewRequest = onStoreReviewOpportunity()
        if (didStartStoreReviewRequest) {
            return
        }

        val promptState = reviewNotificationsStore.loadPromptState()
        if (
            hasEnoughReviewHistoryForNotificationPrompt(reviewCount = reviewCount) &&
            promptState.hasShownPrePrompt.not() &&
            promptState.hasRequestedSystemPermission.not() &&
            promptState.hasDismissedPrePrompt.not() &&
            shouldShowNotificationPermissionPrePrompt()
        ) {
            // The showing half of the prompt rides on the flag, reported by
            // `observeNotificationPermissionPromptVisibility`. Recording only the answer, as the
            // retired onboarding event did, leaves no denominator and therefore no rate to compute.
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
            return
        }

        onAutomaticFeedbackPromptCandidate()
    }

    private fun isReviewPromptVisible(): Boolean {
        val state = draftState.value
        return state.isNotificationPermissionPromptVisible || state.isHardAnswerReminderVisible
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
                        errorMessage = textProvider.reviewQueueCouldNotBeLoaded
                    )
                }
                technicalErrorController.showTechnicalError(
                    error = makeAppTechnicalError(
                        title = textProvider.technicalErrorTitle,
                        message = textProvider.reviewQueueCouldNotBeLoaded,
                        throwable = error
                    ),
                    throwable = error
                )
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
                val resolvedFilterToApply = reviewFilterResolutionToApply(
                    requestedFilter = requestedFilter,
                    resolvedFilter = sessionSnapshot.selectedFilter,
                    availableTagFilters = sessionSnapshot.availableTagFilters
                ) ?: return@collect

                reviewFilterGeneration += 1L
                lastObservedReviewSessionSignature = null
                ownedReviewSubmissions = emptyMap()
                draftState.update { state ->
                    applyResolvedReviewFilter(
                        state = state,
                        reviewFilter = resolvedFilterToApply
                    )
                }
                reviewPreferencesStore.saveSelectedReviewFilter(
                    workspaceId = workspaceId,
                    reviewFilter = resolvedFilterToApply
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
            mediaAssetsById = reviewMediaAssetsState.value.associateBy { mediaAsset ->
                mediaAsset.mediaAssetId
            },
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

/** Maps a failed review submission onto the closed reason set the server catalog declares. */
private fun analyticsReviewAnswerFailureReason(error: Throwable): AnalyticsReviewAnswerFailureReason {
    var currentError: Throwable? = error
    var depth = 0
    while (currentError != null && depth < maxAnalyticsReviewFailureCauseDepth) {
        val inspectedError: Throwable = currentError
        when (inspectedError) {
            is SyncBlockedException -> return AnalyticsReviewAnswerFailureReason.SYNC_CONFLICT
            is SocketTimeoutException -> return AnalyticsReviewAnswerFailureReason.TIMEOUT
            is IOException -> return AnalyticsReviewAnswerFailureReason.OFFLINE
            is CloudRemoteException -> {
                if (
                    inspectedError.syncConflict != null ||
                    inspectedError.errorCode?.trim()?.uppercase() == "SYNC_WORKSPACE_FORK_REQUIRED"
                ) {
                    return AnalyticsReviewAnswerFailureReason.SYNC_CONFLICT
                }
                return when (inspectedError.statusCode) {
                    408, 504 -> AnalyticsReviewAnswerFailureReason.TIMEOUT
                    409 -> AnalyticsReviewAnswerFailureReason.SYNC_CONFLICT
                    else -> AnalyticsReviewAnswerFailureReason.SERVER_ERROR
                }
            }
            else -> Unit
        }
        currentError = inspectedError.cause
        depth += 1
    }
    return AnalyticsReviewAnswerFailureReason.SERVER_ERROR
}

fun createReviewViewModelFactory(
    reviewRepository: ReviewRepository,
    progressRepository: ProgressRepository,
    autoSyncEventRepository: AutoSyncEventRepository,
    messageController: TransientMessageController,
    technicalErrorController: AppTechnicalErrorController,
    reviewNotificationsStore: ReviewNotificationsStore,
    shouldShowNotificationPermissionPrePrompt: () -> Boolean,
    onReviewNotificationsChanged: (ReviewNotificationsReconcileTrigger) -> Unit,
    onSuccessfulReviewRecorded: suspend (Long) -> Unit,
    onStoreReviewOpportunity: suspend () -> Boolean,
    onAutomaticFeedbackPromptCandidate: () -> Unit,
    onNotificationPermissionGranted: () -> Unit,
    reviewPreferencesStore: ReviewPreferencesStore,
    analytics: Analytics,
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
                technicalErrorController = technicalErrorController,
                reviewNotificationsStore = reviewNotificationsStore,
                shouldShowNotificationPermissionPrePrompt = shouldShowNotificationPermissionPrePrompt,
                onReviewNotificationsChanged = onReviewNotificationsChanged,
                onSuccessfulReviewRecorded = onSuccessfulReviewRecorded,
                onStoreReviewOpportunity = onStoreReviewOpportunity,
                onAutomaticFeedbackPromptCandidate = onAutomaticFeedbackPromptCandidate,
                onNotificationPermissionGranted = onNotificationPermissionGranted,
                reviewPreferencesStore = reviewPreferencesStore,
                analytics = analytics,
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
