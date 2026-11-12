package com.flashcardsopensourceapp.feature.review

import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.SingletonImageLoader
import com.flashcardsopensourceapp.core.observability.AndroidReviewReactionStage
import com.flashcardsopensourceapp.core.observability.AppObservability
import com.flashcardsopensourceapp.core.ui.bidiWrap
import com.flashcardsopensourceapp.core.ui.currentResourceLocale
import com.flashcardsopensourceapp.data.local.model.cards.normalizeTagKey
import com.flashcardsopensourceapp.data.local.model.media.MediaAssetDownloadUrl
import com.flashcardsopensourceapp.data.local.model.media.ReviewMediaAssetFile
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.data.local.model.review.makeReviewTagFilter
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionLottieConfigurationStore
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionOverlay
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionEvent
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionSlot
import com.flashcardsopensourceapp.feature.review.reaction.finishReviewReactionSlot
import com.flashcardsopensourceapp.feature.review.reaction.makeRandomReadyReviewReactionEvent
import com.flashcardsopensourceapp.feature.review.reaction.playPreparedReviewReactionSlot
import com.flashcardsopensourceapp.feature.review.reaction.playRequestedReviewReactionSlot
import com.flashcardsopensourceapp.feature.review.reaction.prepareReviewReactionSlot
import com.flashcardsopensourceapp.feature.review.reaction.reviewReactionMotionModeFromAnimatorSettings
import com.flashcardsopensourceapp.feature.review.reaction.reviewReactionRatingToPrepare
import com.flashcardsopensourceapp.feature.review.reaction.stopReviewReactionSlots
import com.flashcardsopensourceapp.feature.review.onboarding.FirstReviewOnboardingOverlay
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionMotionMode
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    workspaceId: String?,
    reviewReactionLottieConfigurationStore: ReviewReactionLottieConfigurationStore,
    reviewReactionAnimationsEnabled: Boolean,
    firstReviewOnboardingCompleted: Boolean?,
    isFirstReviewOnboardingSurfaceAvailable: Boolean,
    observability: AppObservability,
    onSelectFilter: (String, ReviewFilter, ReviewFilter) -> Unit,
    onOpenPreview: () -> Unit,
    onOpenCurrentCard: (String) -> Unit,
    onOpenCurrentCardWithAi: (
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>
    ) -> Unit,
    onOpenDeckManagement: () -> Unit,
    onOpenTagManagement: () -> Unit,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit,
    onLoadManagedMediaFile: suspend (String) -> ReviewMediaAssetFile,
    onLoadManagedMediaDownloadUrl: suspend (String) -> MediaAssetDownloadUrl,
    onConsumeRelocationTarget: (String?, Boolean) -> ReviewRelocationTarget?,
    onRevealAnswer: () -> Unit,
    onRateAgain: (reactionPlayed: Boolean) -> Unit,
    onRateHard: (reactionPlayed: Boolean) -> Unit,
    onRateGood: (reactionPlayed: Boolean) -> Unit,
    onRateEasy: (reactionPlayed: Boolean) -> Unit,
    onDismissHardAnswerReminder: () -> Unit,
    onDismissErrorMessage: () -> Unit,
    notificationPermissionPromptContinueAction: NotificationPermissionPromptContinueAction,
    onDismissNotificationPermissionPrompt: () -> Unit,
    onContinueNotificationPermissionPrompt: () -> Unit,
    onOpenLeaderboard: () -> Unit,
    onOpenProgress: () -> Unit,
    onScreenVisible: () -> Unit,
    onReviewSurfaceBusyChanged: (Boolean) -> Unit,
    onFilterSheetVisibilityChanged: (Boolean) -> Unit
) {
    var filterSheetTransaction by rememberSaveable(
        stateSaver = reviewFilterSheetTransactionSaver
    ) {
        mutableStateOf(
            value = closedReviewFilterSheetTransaction(
                workspaceId = workspaceId,
                selection = uiState.requestedFilter
            )
        )
    }
    var appliedFilterTitle by remember {
        mutableStateOf<AppliedReviewFilterTitle?>(value = null)
    }
    var speechErrorMessage by remember { mutableStateOf(value = "") }
    var tagFilterRequest by remember {
        mutableStateOf<ReviewTagFilterRequest?>(value = null)
    }
    var reviewReactionSlots by remember {
        mutableStateOf<List<ReviewReactionSlot>>(value = emptyList())
    }
    var reviewReactionRatedCardId by remember { mutableStateOf<String?>(value = null) }
    // A rating whose prepared slot was consumed plays a fresh variant built after the next card shows.
    var reviewReactionRequestedEvent by remember { mutableStateOf<ReviewReactionEvent?>(value = null) }
    var isReviewReactionSpentSlotRebuildAllowed by remember { mutableStateOf(value = true) }
    var isReviewPointerDown by remember { mutableStateOf(value = false) }
    val snackbarHostState = remember { SnackbarHostState() }
    val configuration = LocalConfiguration.current
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val lifecycleState by lifecycleOwner.lifecycle.currentStateFlow.collectAsState()
    val view = LocalView.current
    var hasWindowFocus by remember(view) { mutableStateOf(view.hasWindowFocus()) }
    DisposableEffect(view) {
        val observer = android.view.ViewTreeObserver.OnWindowFocusChangeListener { focused -> hasWindowFocus = focused }
        view.viewTreeObserver.addOnWindowFocusChangeListener(observer)
        onDispose { view.viewTreeObserver.removeOnWindowFocusChangeListener(observer) }
    }
    val reviewReactionMotionMode = reviewReactionMotionModeFromAnimatorSettings()
    var guideRoot by remember { mutableStateOf<LayoutCoordinates?>(null) }
    var guideTarget by remember(workspaceId, uiState.preparedCurrentCard?.card?.cardId, uiState.isAnswerVisible) {
        mutableStateOf<LayoutCoordinates?>(null)
    }
    var guideBounds by remember(workspaceId, uiState.preparedCurrentCard?.card?.cardId, uiState.isAnswerVisible) {
        mutableStateOf<Rect?>(null)
    }
    var guideViewport by remember { mutableStateOf(Size.Zero) }
    fun updateGuideBounds() {
        val root = guideRoot
        val target = guideTarget
        guideBounds = if (root != null && target != null && root.isAttached && target.isAttached) {
            val bounds = root.localBoundingBoxOf(target, clipBounds = false)
            val viewport = Rect(0f, 0f, root.size.width.toFloat(), root.size.height.toFloat())
            bounds.takeIf { it.width > 0f && it.height > 0f && viewport.contains(it.topLeft) && viewport.contains(it.bottomRight) }
        } else {
            null
        }
    }
    val reviewSpeechFallbackLanguageTag = configuration.locales[0].toLanguageTag()
    val currentScreenVisibleAction = rememberUpdatedState(newValue = onScreenVisible)
    val reviewSpeechUnavailableMessage = stringResource(R.string.review_speech_unavailable)
    val reviewSpeechController = remember(context, observability) {
        ReviewSpeechController(
            context = context,
            unavailableMessage = reviewSpeechUnavailableMessage,
            observability = observability
        )
    }
    val currentLoadManagedMediaFile = rememberUpdatedState(newValue = onLoadManagedMediaFile)
    // Outlives each image-set effect below, so a rating cancels only the jobs the preparer drops.
    val reviewImagePreparationScope = rememberCoroutineScope()
    val reviewImagePreparer = remember(context, reviewImagePreparationScope) {
        ReviewImagePreparer(
            context = context,
            imageLoader = SingletonImageLoader.get(context),
            preparationScope = reviewImagePreparationScope,
            loadManagedMediaFile = { mediaAssetId -> currentLoadManagedMediaFile.value(mediaAssetId) }
        )
    }
    val reviewImageAssetsToPrepare = reviewImageAssetsToPrepare(
        currentCard = uiState.preparedCurrentCard,
        nextCard = uiState.preparedNextCard
    )
    LaunchedEffect(reviewImagePreparer, reviewImageAssetsToPrepare) {
        reviewImagePreparer.prepareOnly(mediaAssets = reviewImageAssetsToPrepare)
    }
    val isReviewSurfaceBusy = filterSheetTransaction.isVisible || tagFilterRequest != null ||
        uiState.isHardAnswerReminderVisible || uiState.isNotificationPermissionPromptVisible
    SideEffect { onReviewSurfaceBusyChanged(isReviewSurfaceBusy) }
    DisposableEffect(Unit) {
        onDispose { onReviewSurfaceBusyChanged(true) }
    }
    // Filter options and deck due counts load only while the sheet is open.
    DisposableEffect(filterSheetTransaction.isVisible) {
        onFilterSheetVisibilityChanged(filterSheetTransaction.isVisible)
        onDispose { onFilterSheetVisibilityChanged(false) }
    }

    fun dismissReviewReactions(): Unit {
        reviewReactionSlots = stopReviewReactionSlots(slots = reviewReactionSlots)
        reviewReactionRequestedEvent = null
        // A touch-down may become a rating click, so the slot it stopped waits for the next card.
        isReviewReactionSpentSlotRebuildAllowed = false
    }

    /** Returns whether this rating scheduled a reaction. */
    fun playReviewReaction(rating: ReviewRating): Boolean {
        if (reviewReactionAnimationsEnabled.not()) {
            return false
        }

        reviewReactionRatedCardId = uiState.preparedCurrentCard?.card?.cardId
        val playingSlots: List<ReviewReactionSlot>? = playPreparedReviewReactionSlot(
            slots = reviewReactionSlots,
            rating = rating
        )
        if (playingSlots != null) {
            reviewReactionSlots = playingSlots
            reviewReactionRequestedEvent = null
        } else {
            // Picking a variant only reads readiness; the build waits for the frame after the next card.
            reviewReactionRequestedEvent = makeRandomReadyReviewReactionEvent(
                rating = rating,
                configurationStore = reviewReactionLottieConfigurationStore
            ) ?: run {
                reviewReactionLottieConfigurationStore.record(stage = AndroidReviewReactionStage.UNAVAILABLE_SKIPPED, variant = null)
                return false
            }
            reviewReactionSlots = stopReviewReactionSlots(slots = reviewReactionSlots)
        }
        return true
    }
    // The loaded session names the previous filter until Room emits the next one, so the title names the choice.
    fun selectFilterFromSheet(
        openingWorkspaceId: String,
        openingSelection: ReviewFilter,
        selection: ReviewFilter
    ): Unit {
        val deckTitle: String? = when (selection) {
            is ReviewFilter.Deck -> uiState.availableDeckFilters.firstOrNull { deck ->
                deck.deckId == selection.deckId
            }?.title
            else -> ""
        }
        appliedFilterTitle = deckTitle?.let { title ->
            AppliedReviewFilterTitle(
                uiStateAtSelection = uiState,
                filter = selection,
                title = reviewTextProvider(context = context).filterTitle(
                    selectedFilter = selection,
                    deckTitle = title
                )
            )
        }
        onSelectFilter(openingWorkspaceId, openingSelection, selection)
    }

    fun finalizeFilterSheetSelection(): Unit {
        val transaction: ReviewFilterSheetTransaction = filterSheetTransaction
        if (transaction.isVisible.not()) {
            return
        }

        filterSheetTransaction = closedReviewFilterSheetTransaction(
            workspaceId = workspaceId,
            selection = uiState.requestedFilter
        )
        val openingWorkspaceId: String = transaction.workspaceId ?: return
        if (transaction.draftSelection != transaction.openingSelection) {
            selectFilterFromSheet(
                openingWorkspaceId = openingWorkspaceId,
                openingSelection = transaction.openingSelection,
                selection = transaction.draftSelection
            )
        }
    }

    // Applies while the sheet is still hiding, so the filter title updates at once.
    fun applyFilterSheetSelection(selection: ReviewFilter): Unit {
        val transaction: ReviewFilterSheetTransaction = filterSheetTransaction
        val openingWorkspaceId: String = transaction.workspaceId ?: return
        filterSheetTransaction = transaction.copy(
            openingSelection = selection,
            draftSelection = selection
        )
        if (selection != transaction.openingSelection) {
            selectFilterFromSheet(
                openingWorkspaceId = openingWorkspaceId,
                openingSelection = transaction.openingSelection,
                selection = selection
            )
        }
    }
    val onRateAgainWithReaction: () -> Unit = {
        onRateAgain(playReviewReaction(rating = ReviewRating.AGAIN))
    }
    val onRateHardWithReaction: () -> Unit = {
        onRateHard(playReviewReaction(rating = ReviewRating.HARD))
    }
    val onRateGoodWithReaction: () -> Unit = {
        onRateGood(playReviewReaction(rating = ReviewRating.GOOD))
    }
    val onRateEasyWithReaction: () -> Unit = {
        onRateEasy(playReviewReaction(rating = ReviewRating.EASY))
    }

    LaunchedEffect(uiState.errorMessage) {
        if (uiState.errorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = uiState.errorMessage)
        onDismissErrorMessage()
    }

    // The rated card's replacement must be on screen before its reaction starts or is built.
    val isReviewReactionPlaybackStartAllowed: Boolean =
        uiState.preparedCurrentCard?.card?.cardId != reviewReactionRatedCardId
    val currentIsReviewReactionPlaybackStartAllowed by rememberUpdatedState(
        newValue = isReviewReactionPlaybackStartAllowed
    )

    // A new card on screen lets spent slots rebuild; the builder below starts a frame later.
    LaunchedEffect(uiState.preparedCurrentCard?.card?.cardId) {
        isReviewReactionSpentSlotRebuildAllowed = true
    }

    LaunchedEffect(reviewReactionRequestedEvent) {
        val event: ReviewReactionEvent = reviewReactionRequestedEvent ?: return@LaunchedEffect
        snapshotFlow { currentIsReviewReactionPlaybackStartAllowed }.first { isAllowed -> isAllowed }
        withFrameNanos { }
        reviewReactionSlots = playRequestedReviewReactionSlot(slots = reviewReactionSlots, event = event)
        reviewReactionRequestedEvent = null
    }

    LaunchedEffect(reviewReactionAnimationsEnabled, reviewReactionLottieConfigurationStore) {
        if (reviewReactionAnimationsEnabled.not()) {
            reviewReactionSlots = stopReviewReactionSlots(slots = reviewReactionSlots)
            reviewReactionRequestedEvent = null
            // Release one frame later, so the frame that hides a reaction never disposes it.
            withFrameNanos { }
            reviewReactionSlots = emptyList()
            return@LaunchedEffect
        }

        fun ratingToPrepare(): ReviewRating? {
            if (
                isReviewPointerDown
                || reviewReactionRequestedEvent != null
                || currentIsReviewReactionPlaybackStartAllowed.not()
            ) {
                return null
            }
            return reviewReactionRatingToPrepare(
                slots = reviewReactionSlots,
                isSpentSlotRebuildAllowed = isReviewReactionSpentSlotRebuildAllowed,
                configurationStore = reviewReactionLottieConfigurationStore
            )
        }

        // Each build changes the next rating to prepare, so this builds at most one slot per frame.
        snapshotFlow { ratingToPrepare() }.collectLatest { rating ->
            if (rating == null) {
                return@collectLatest
            }

            // Builds wait for a later frame than the state that allowed them, and re-read state so
            // a touch or rating in this frame defers them.
            withFrameNanos { }
            val currentRating: ReviewRating = ratingToPrepare() ?: return@collectLatest
            reviewReactionSlots = prepareReviewReactionSlot(
                slots = reviewReactionSlots,
                rating = currentRating,
                configurationStore = reviewReactionLottieConfigurationStore
            )
        }
    }

    LaunchedEffect(workspaceId, uiState.requestedFilter, uiState.isLoading) {
        val transaction: ReviewFilterSheetTransaction = filterSheetTransaction
        if (
            transaction.isVisible
            && uiState.isLoading.not()
            && (
                transaction.workspaceId != workspaceId
                    || transaction.openingSelection != uiState.requestedFilter
                )
        ) {
            filterSheetTransaction = closedReviewFilterSheetTransaction(
                workspaceId = workspaceId,
                selection = uiState.requestedFilter
            )
        }
    }

    // A reload would make "Change filter" a no-op, so the dialog closes instead of lingering.
    LaunchedEffect(workspaceId, uiState.requestedFilter, uiState.isLoading) {
        val request: ReviewTagFilterRequest = tagFilterRequest ?: return@LaunchedEffect
        if (
            uiState.isLoading
            || request.workspaceId != workspaceId
            || request.openingFilter != uiState.requestedFilter
        ) {
            tagFilterRequest = null
        }
    }

    LaunchedEffect(speechErrorMessage) {
        if (speechErrorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = speechErrorMessage)
        speechErrorMessage = ""
    }

    LaunchedEffect(uiState.preparedCurrentCard?.card?.cardId) {
        reviewSpeechController.stop()
    }

    LaunchedEffect(uiState.isAnswerVisible) {
        if (uiState.isAnswerVisible.not() && reviewSpeechController.activeSide == ReviewSpeechSide.BACK) {
            reviewSpeechController.stop()
        }
    }

    DisposableEffect(reviewSpeechController) {
        // Binding the engine on open keeps the first tap from waiting for it.
        reviewSpeechController.warmUp(fallbackLanguageTag = reviewSpeechFallbackLanguageTag)
        onDispose {
            reviewSpeechController.release()
        }
    }

    DisposableEffect(lifecycleOwner) {
        if (shouldTriggerInitialReviewProgressLoad(lifecycleState = lifecycleOwner.lifecycle.currentState)) {
            currentScreenVisibleAction.value()
        }

        val observer = LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                currentScreenVisibleAction.value()
            }
        }

        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    // The sheet's tag rows apply on close, so the title names that draft at once, as a deck choice does.
    val filterSheetDraft: ReviewFilter = filterSheetTransaction.draftSelection
    val pendingFilterTitle: String? = if (
        filterSheetTransaction.isVisible
        && filterSheetTransaction.workspaceId == workspaceId
        && filterSheetDraft != filterSheetTransaction.openingSelection
    ) {
        // A deck choice applies at once, so a draft that differs from the opening selection is never a deck.
        reviewTextProvider(context = context).filterTitle(
            selectedFilter = filterSheetDraft,
            deckTitle = uiState.selectedFilterTitle
        )
    } else {
        appliedFilterTitle?.takeIf { applied ->
            isAppliedReviewFilterTitleCurrent(applied = applied, uiState = uiState)
        }?.title
    }
    LaunchedEffect(uiState, appliedFilterTitle) {
        val applied: AppliedReviewFilterTitle = appliedFilterTitle ?: return@LaunchedEffect
        if (isAppliedReviewFilterTitleCurrent(applied = applied, uiState = uiState).not()) {
            appliedFilterTitle = null
        }
    }

    Scaffold(
        topBar = {
            ReviewTopBar(
                isLoading = uiState.isLoading,
                remainingCount = if (
                    workspaceId != null && uiState.sessionWorkspaceId == workspaceId &&
                    !uiState.isRequestedFilterSessionPending && pendingFilterTitle == null
                ) {
                    uiState.remainingCount
                } else {
                    0
                },
                totalCount = uiState.totalCount,
                reviewLeaderboardBadge = uiState.reviewLeaderboardBadge,
                reviewProgressBadge = uiState.reviewProgressBadge,
                selectedFilterTitle = pendingFilterTitle ?: uiState.selectedFilterTitle,
                onOpenFilter = {
                    if (workspaceId != null && uiState.isLoading.not()) {
                        filterSheetTransaction = openReviewFilterSheetTransaction(
                            workspaceId = workspaceId,
                            selection = uiState.requestedFilter
                        )
                    }
                },
                onOpenPreview = onOpenPreview,
                onOpenLeaderboard = onOpenLeaderboard,
                onOpenProgress = onOpenProgress
            )
        },
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState)
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .onGloballyPositioned { coordinates ->
                    guideRoot = coordinates
                    guideViewport = Size(coordinates.size.width.toFloat(), coordinates.size.height.toFloat())
                    updateGuideBounds()
                }
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(
                            requireUnconsumed = false,
                            pass = PointerEventPass.Initial
                        )
                        isReviewPointerDown = true
                        dismissReviewReactions()
                        try {
                            do {
                                val event = awaitPointerEvent(pass = PointerEventPass.Initial)
                            } while (event.changes.any { change -> change.pressed })
                        } finally {
                            isReviewPointerDown = false
                        }
                    }
                }
        ) {
            ReviewContent(
                uiState = uiState,
                activeSpeechSide = reviewSpeechController.activeSide,
                onOpenCurrentCard = onOpenCurrentCard,
                onOpenCurrentCardWithAi = onOpenCurrentCardWithAi,
                onCreateCard = onCreateCard,
                onCreateCardWithAi = onCreateCardWithAi,
                onSwitchToAllCards = onSwitchToAllCards,
                reviewImagePreparer = reviewImagePreparer,
                onLoadManagedMediaDownloadUrl = onLoadManagedMediaDownloadUrl,
                onConsumeRelocationTarget = onConsumeRelocationTarget,
                onToggleFrontSpeech = {
                    uiState.preparedCurrentCard?.let { currentCard ->
                        reviewSpeechController.toggleSpeech(
                            side = ReviewSpeechSide.FRONT,
                            speakableText = currentCard.frontSpeakableText,
                            fallbackLanguageTag = reviewSpeechFallbackLanguageTag,
                            onError = { message ->
                                speechErrorMessage = message
                            }
                        )
                    }
                },
                onToggleBackSpeech = {
                    uiState.preparedCurrentCard?.let { currentCard ->
                        reviewSpeechController.toggleSpeech(
                            side = ReviewSpeechSide.BACK,
                            speakableText = currentCard.backSpeakableText,
                            fallbackLanguageTag = reviewSpeechFallbackLanguageTag,
                            onError = { message ->
                                speechErrorMessage = message
                            }
                        )
                    }
                },
                onRequestTagFilter = { tag ->
                    if (workspaceId != null && uiState.isLoading.not()) {
                        tagFilterRequest = ReviewTagFilterRequest(
                            workspaceId = workspaceId,
                            openingFilter = uiState.requestedFilter,
                            tag = tag,
                            currentFilterLabel = reviewTagFilterDialogCurrentFilterLabel(
                                selectedFilter = uiState.selectedFilter,
                                selectedFilterTitle = uiState.selectedFilterTitle,
                                locale = currentResourceLocale(resources = context.resources)
                            ),
                            isTagAlreadySelected = isSingleTagReviewFilter(
                                filter = uiState.selectedFilter,
                                tag = tag
                            )
                        )
                    }
                },
                onOpenTags = onOpenTagManagement,
                modifier = Modifier.padding(
                    top = innerPadding.calculateTopPadding(),
                    bottom = innerPadding.calculateBottomPadding() + reviewContentBottomPadding(
                        hasCurrentCard = uiState.preparedCurrentCard != null,
                        isAnswerVisible = uiState.isAnswerVisible
                    )
                ),
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = 16.dp,
                    end = 16.dp,
                    bottom = 0.dp
                )
            )

            if (uiState.isLoading.not() && uiState.preparedCurrentCard != null) {
                ReviewBottomActionOverlay(
                    modifier = Modifier.align(Alignment.BottomCenter),
                    currentCard = uiState.preparedCurrentCard,
                    isAnswerVisible = uiState.isAnswerVisible,
                    bottomInsetPadding = innerPadding.calculateBottomPadding() + reviewBottomOverlayBottomPadding,
                    onRevealAnswer = onRevealAnswer,
                    onGuideTargetPositioned = { coordinates ->
                        guideTarget = coordinates
                        updateGuideBounds()
                    },
                    onRateAgain = onRateAgainWithReaction,
                    onRateHard = onRateHardWithReaction,
                    onRateGood = onRateGoodWithReaction,
                    onRateEasy = onRateEasyWithReaction
                )
            }

            val targetBounds = guideBounds
            if (firstReviewOnboardingCompleted == false && !uiState.isLoading &&
                uiState.preparedCurrentCard != null && !isReviewSurfaceBusy &&
                isFirstReviewOnboardingSurfaceAvailable && hasWindowFocus &&
                lifecycleState == androidx.lifecycle.Lifecycle.State.RESUMED &&
                guideTarget?.isAttached == true && targetBounds != null
            ) {
                FirstReviewOnboardingOverlay(
                    target = targetBounds,
                    viewport = guideViewport,
                    availableTop = with(LocalDensity.current) { (innerPadding.calculateTopPadding() + 8.dp).toPx() },
                    animationsEnabled = reviewReactionMotionMode == ReviewReactionMotionMode.STANDARD,
                    modifier = Modifier.matchParentSize()
                )
            }

            ReviewReactionOverlay(
                modifier = Modifier.matchParentSize(),
                slots = reviewReactionSlots,
                isPlaybackStartAllowed = isReviewReactionPlaybackStartAllowed,
                motionMode = reviewReactionMotionMode,
                configurationStore = reviewReactionLottieConfigurationStore,
                onEventFinished = { eventId ->
                    reviewReactionSlots = finishReviewReactionSlot(slots = reviewReactionSlots, eventId = eventId)
                    if (isReviewPointerDown.not()) {
                        isReviewReactionSpentSlotRebuildAllowed = true
                    }
                }
            )
        }
    }

    if (
        workspaceId != null
        && filterSheetTransaction.isVisible
        && filterSheetTransaction.workspaceId == workspaceId
    ) {
        ReviewFilterSheet(
            selectedFilter = filterSheetTransaction.draftSelection,
            availableDeckFilters = uiState.availableDeckFilters,
            availableTagFilters = uiState.availableTagFilters,
            areFilterOptionsLoaded = uiState.areFilterOptionsLoaded,
            onDismiss = ::finalizeFilterSheetSelection,
            onApplyFilter = ::applyFilterSheetSelection,
            onToggleTag = { tagName ->
                val nextFilter = toggleReviewTagFilter(
                    selectedFilter = filterSheetTransaction.draftSelection,
                    toggledTagName = tagName
                )
                filterSheetTransaction = filterSheetTransaction.copy(
                    draftSelection = nextFilter
                )
            },
            onManageDecks = {
                finalizeFilterSheetSelection()
                onOpenDeckManagement()
            }
        )
    }

    tagFilterRequest?.let { request ->
        ReviewTagFilterDialog(
            request = request,
            onConfirm = {
                tagFilterRequest = null
                onSelectFilter(
                    request.workspaceId,
                    request.openingFilter,
                    makeReviewTagFilter(tagNames = listOf(request.tag))
                )
            },
            onDismiss = {
                tagFilterRequest = null
            }
        )
    }

    if (uiState.isHardAnswerReminderVisible) {
        HardAnswerReminderDialog(
            onDismissRequest = onDismissHardAnswerReminder
        )
    }

    if (uiState.isNotificationPermissionPromptVisible) {
        NotificationPermissionPromptDialog(
            continueAction = notificationPermissionPromptContinueAction,
            onContinue = onContinueNotificationPermissionPrompt,
            onDismiss = onDismissNotificationPermissionPrompt
        )
    }
}

/** Captured when a tag chip is tapped, so the dialog variant and wording stay fixed while it is open. */
private data class ReviewTagFilterRequest(
    val workspaceId: String,
    val openingFilter: ReviewFilter,
    val tag: String,
    val currentFilterLabel: String,
    val isTagAlreadySelected: Boolean
)

private fun isSingleTagReviewFilter(filter: ReviewFilter, tag: String): Boolean {
    return filter is ReviewFilter.Tags
        && filter.tags.size == 1
        && normalizeTagKey(tag = filter.tags.single()) == normalizeTagKey(tag = tag)
}

@Composable
private fun ReviewTagFilterDialog(
    request: ReviewTagFilterRequest,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val locale = currentResourceLocale(resources = context.resources)
    val wrappedTag = bidiWrap(text = request.tag, locale = locale)

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(stringResource(id = R.string.review_tag_filter_dialog_title))
        },
        text = {
            Text(
                if (request.isTagAlreadySelected) {
                    stringResource(id = R.string.review_tag_filter_dialog_already_selected_body, wrappedTag)
                } else {
                    stringResource(
                        id = R.string.review_tag_filter_dialog_change_body,
                        bidiWrap(text = request.currentFilterLabel, locale = locale),
                        wrappedTag
                    )
                }
            )
        },
        confirmButton = {
            if (request.isTagAlreadySelected) {
                TextButton(onClick = onDismiss) {
                    Text(stringResource(id = R.string.review_ok))
                }
            } else {
                TextButton(onClick = onConfirm) {
                    Text(stringResource(id = R.string.review_tag_filter_dialog_confirm))
                }
            }
        },
        dismissButton = if (request.isTagAlreadySelected) {
            null
        } else {
            {
                TextButton(onClick = onDismiss) {
                    Text(stringResource(id = R.string.review_cancel))
                }
            }
        }
    )
}

private data class AppliedReviewFilterTitle(
    val uiStateAtSelection: ReviewUiState,
    val filter: ReviewFilter,
    val title: String
)

/**
 * The title stays while the view model has not emitted since the selection, and then while the requested
 * filter's session is loading. It is keyed on that load, not on the filters differing, because a resolved
 * filter may never equal the requested one.
 */
private fun isAppliedReviewFilterTitleCurrent(
    applied: AppliedReviewFilterTitle,
    uiState: ReviewUiState
): Boolean {
    return uiState === applied.uiStateAtSelection
        || (uiState.requestedFilter == applied.filter && uiState.isRequestedFilterSessionPending)
}
