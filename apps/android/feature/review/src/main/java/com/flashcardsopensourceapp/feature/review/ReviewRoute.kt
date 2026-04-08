package com.flashcardsopensourceapp.feature.review

import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
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
    onContinueNotificationPermissionPrompt: () -> Unit
) {
    var isFilterSheetVisible by remember { mutableStateOf(value = false) }
    var speechErrorMessage by remember { mutableStateOf(value = "") }
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val reviewSpeechController = remember(context) {
        ReviewSpeechController(context = context)
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

    Scaffold(
        topBar = {
            ReviewTopBar(
                selectedFilterTitle = uiState.selectedFilterTitle,
                isLoading = uiState.isLoading,
                remainingCount = uiState.remainingCount,
                totalCount = uiState.totalCount,
                onOpenFilter = {
                    isFilterSheetVisible = true
                },
                onOpenPreview = onOpenPreview
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
                            fallbackLanguageTag = Locale.getDefault().toLanguageTag(),
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
                            fallbackLanguageTag = Locale.getDefault().toLanguageTag(),
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
                androidx.compose.material3.Text("Stay on top of your cards")
            },
            text = {
                androidx.compose.material3.Text(
                    "Flashcards Open Source App can send study reminders with a card from your review queue. These notifications contain study cards only and never marketing messages."
                )
            },
            confirmButton = {
                androidx.compose.material3.TextButton(onClick = onContinueNotificationPermissionPrompt) {
                    androidx.compose.material3.Text("Continue")
                }
            },
            dismissButton = {
                androidx.compose.material3.TextButton(onClick = onDismissNotificationPermissionPrompt) {
                    androidx.compose.material3.Text("Not now")
                }
            }
        )
    }
}
