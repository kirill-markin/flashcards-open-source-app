package com.flashcardsopensourceapp.feature.review

import androidx.compose.material3.AlertDialog
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.flashcardsopensourceapp.data.local.model.ReviewFilter
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    onSelectFilter: (ReviewFilter) -> Unit,
    onOpenPreview: () -> Unit,
    onOpenCurrentCard: (String) -> Unit,
    onOpenCurrentCardWithAi: (
        cardId: String,
        frontText: String,
        backText: String,
        tags: List<String>,
        effortLevel: com.flashcardsopensourceapp.data.local.model.EffortLevel
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
    onOpenProgress: () -> Unit,
    onScreenVisible: () -> Unit
) {
    var isFilterSheetVisible by remember { mutableStateOf(value = false) }
    var speechErrorMessage by remember { mutableStateOf(value = "") }
    val snackbarHostState = remember { SnackbarHostState() }
    val configuration = LocalConfiguration.current
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val reviewSpeechFallbackLanguageTag =
        (configuration.locales[0] ?: Locale.getDefault()).toLanguageTag()
    val currentScreenVisibleAction = rememberUpdatedState(newValue = onScreenVisible)
    val reviewSpeechController = remember(context) {
        ReviewSpeechController(
            context = context,
            unavailableMessage = context.getString(R.string.review_speech_unavailable)
        )
    }

    LaunchedEffect(uiState.errorMessage) {
        if (uiState.errorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = uiState.errorMessage)
        onDismissErrorMessage()
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
                onOpenProgress = onOpenProgress
            )
        },
        snackbarHost = {
            SnackbarHost(hostState = snackbarHostState)
        }
    ) { innerPadding ->
        Box(modifier = Modifier.fillMaxSize()) {
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
                    onRateAgain = onRateAgain,
                    onRateHard = onRateHard,
                    onRateGood = onRateGood,
                    onRateEasy = onRateEasy
                )
            }
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
