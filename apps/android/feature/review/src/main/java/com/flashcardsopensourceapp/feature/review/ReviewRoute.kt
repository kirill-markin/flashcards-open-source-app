package com.flashcardsopensourceapp.feature.review

import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.flashcardsopensourceapp.data.local.model.review.ReviewFilter
import com.flashcardsopensourceapp.data.local.model.review.ReviewRating
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionEvent
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionLottieConfigurationStore
import com.flashcardsopensourceapp.feature.review.reaction.ReviewReactionOverlay
import com.flashcardsopensourceapp.feature.review.reaction.appendReviewReactionEvent
import com.flashcardsopensourceapp.feature.review.reaction.makeRandomReadyReviewReactionEvent
import com.flashcardsopensourceapp.feature.review.reaction.reviewReactionMaximumActiveEvents
import com.flashcardsopensourceapp.feature.review.reaction.reviewReactionMotionModeFromAnimatorSettings
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    reviewReactionLottieConfigurationStore: ReviewReactionLottieConfigurationStore,
    reviewReactionAnimationsEnabled: Boolean,
    onSelectFilter: (ReviewFilter) -> Unit,
    onOpenPreview: () -> Unit,
    onOpenCurrentCard: (String) -> Unit,
    onOpenCurrentCardWithAi: (
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>,
        effortLevel: com.flashcardsopensourceapp.data.local.model.scheduling.EffortLevel
    ) -> Unit,
    onOpenDeckManagement: () -> Unit,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit,
    onDismissHardAnswerReminder: () -> Unit,
    onDismissErrorMessage: () -> Unit,
    onDismissNotificationPermissionPrompt: () -> Unit,
    onContinueNotificationPermissionPrompt: () -> Unit,
    onOpenLeaderboard: () -> Unit,
    onOpenProgress: () -> Unit,
    onScreenVisible: () -> Unit
) {
    var isFilterSheetVisible by remember { mutableStateOf(value = false) }
    var speechErrorMessage by remember { mutableStateOf(value = "") }
    var activeReviewReactionEvents by remember {
        mutableStateOf<List<ReviewReactionEvent>>(value = emptyList())
    }
    val snackbarHostState = remember { SnackbarHostState() }
    val configuration = LocalConfiguration.current
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val reviewReactionMotionMode = reviewReactionMotionModeFromAnimatorSettings()
    val reviewSpeechFallbackLanguageTag =
        (configuration.locales[0] ?: Locale.getDefault()).toLanguageTag()
    val currentScreenVisibleAction = rememberUpdatedState(newValue = onScreenVisible)
    val reviewSpeechController = remember(context) {
        ReviewSpeechController(
            context = context,
            unavailableMessage = context.getString(R.string.review_speech_unavailable)
        )
    }
    fun dismissReviewReactions(): Unit {
        if (activeReviewReactionEvents.isEmpty()) {
            return
        }

        activeReviewReactionEvents = emptyList()
    }

    fun emitReviewReaction(rating: ReviewRating): Unit {
        if (reviewReactionAnimationsEnabled.not()) {
            return
        }

        val event: ReviewReactionEvent = makeRandomReadyReviewReactionEvent(
            rating = rating,
            configurationStore = reviewReactionLottieConfigurationStore
        ) ?: return

        activeReviewReactionEvents = appendReviewReactionEvent(
            events = activeReviewReactionEvents,
            event = event,
            maximumActiveEvents = reviewReactionMaximumActiveEvents
        )
    }
    val onRateAgainWithReaction: () -> Unit = {
        emitReviewReaction(rating = ReviewRating.AGAIN)
        onRateAgain()
    }
    val onRateHardWithReaction: () -> Unit = {
        emitReviewReaction(rating = ReviewRating.HARD)
        onRateHard()
    }
    val onRateGoodWithReaction: () -> Unit = {
        emitReviewReaction(rating = ReviewRating.GOOD)
        onRateGood()
    }
    val onRateEasyWithReaction: () -> Unit = {
        emitReviewReaction(rating = ReviewRating.EASY)
        onRateEasy()
    }

    LaunchedEffect(uiState.errorMessage) {
        if (uiState.errorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = uiState.errorMessage)
        onDismissErrorMessage()
    }

    LaunchedEffect(reviewReactionAnimationsEnabled) {
        if (reviewReactionAnimationsEnabled.not()) {
            activeReviewReactionEvents = emptyList()
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

    Scaffold(
        topBar = {
            ReviewTopBar(
                isLoading = uiState.isLoading,
                remainingCount = uiState.remainingCount,
                totalCount = uiState.totalCount,
                reviewProgressBadge = uiState.reviewProgressBadge,
                selectedFilterTitle = uiState.selectedFilterTitle,
                onOpenFilter = {
                    isFilterSheetVisible = true
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
                .pointerInput(Unit) {
                    awaitEachGesture {
                        awaitFirstDown(
                            requireUnconsumed = false,
                            pass = PointerEventPass.Initial
                        )
                        dismissReviewReactions()
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
                onToggleFrontSpeech = {
                    uiState.preparedCurrentCard?.let { currentCard ->
                        reviewSpeechController.toggleSpeech(
                            side = ReviewSpeechSide.FRONT,
                            sourceText = currentCard.card.frontText,
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
                            sourceText = currentCard.card.backText,
                            fallbackLanguageTag = reviewSpeechFallbackLanguageTag,
                            onError = { message ->
                                speechErrorMessage = message
                            }
                        )
                    }
                },
                contentPadding = PaddingValues(
                    start = 16.dp,
                    top = innerPadding.calculateTopPadding() + 16.dp,
                    end = 16.dp,
                    bottom = innerPadding.calculateBottomPadding() + reviewContentBottomPadding(
                        hasCurrentCard = uiState.preparedCurrentCard != null,
                        isAnswerVisible = uiState.isAnswerVisible
                    )
                )
            )

            if (uiState.isLoading.not() && uiState.preparedCurrentCard != null) {
                ReviewBottomActionOverlay(
                    modifier = Modifier.align(Alignment.BottomCenter),
                    currentCard = uiState.preparedCurrentCard,
                    isAnswerVisible = uiState.isAnswerVisible,
                    bottomInsetPadding = innerPadding.calculateBottomPadding() + reviewBottomOverlayBottomPadding,
                    onRevealAnswer = onRevealAnswer,
                    onRateAgain = onRateAgainWithReaction,
                    onRateHard = onRateHardWithReaction,
                    onRateGood = onRateGoodWithReaction,
                    onRateEasy = onRateEasyWithReaction
                )
            }

            ReviewReactionOverlay(
                modifier = Modifier.matchParentSize(),
                events = activeReviewReactionEvents,
                motionMode = reviewReactionMotionMode,
                configurationStore = reviewReactionLottieConfigurationStore,
                onEventFinished = { eventId ->
                    activeReviewReactionEvents = activeReviewReactionEvents.filter { event ->
                        event.id != eventId
                    }
                }
            )
        }
    }

    if (isFilterSheetVisible) {
        ReviewFilterSheet(
            selectedFilter = uiState.selectedFilter,
            availableDeckFilters = uiState.availableDeckFilters,
            availableEffortFilters = uiState.availableEffortFilters,
            availableTagFilters = uiState.availableTagFilters,
            onDismiss = {
                isFilterSheetVisible = false
            },
            onSelectFilter = { nextFilter ->
                onSelectFilter(nextFilter)
                isFilterSheetVisible = false
            },
            onManageDecks = {
                isFilterSheetVisible = false
                onOpenDeckManagement()
            }
        )
    }

    if (uiState.isHardAnswerReminderVisible) {
        HardAnswerReminderDialog(
            onDismissRequest = onDismissHardAnswerReminder
        )
    }

    if (uiState.isNotificationPermissionPromptVisible) {
        AlertDialog(
            onDismissRequest = onDismissNotificationPermissionPrompt,
            title = {
                androidx.compose.material3.Text(stringResource(id = R.string.review_notification_prompt_title))
            },
            text = {
                androidx.compose.material3.Text(
                    stringResource(id = R.string.review_notification_prompt_body)
                )
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = onContinueNotificationPermissionPrompt) {
                    androidx.compose.material3.Text(stringResource(id = R.string.review_continue))
                }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = onDismissNotificationPermissionPrompt) {
                    androidx.compose.material3.Text(stringResource(id = R.string.review_not_now))
                }
            }
        )
    }
}
