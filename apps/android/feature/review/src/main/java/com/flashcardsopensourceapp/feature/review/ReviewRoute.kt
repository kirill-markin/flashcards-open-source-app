package com.flashcardsopensourceapp.feature.review

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.ReviewFilter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReviewRoute(
    uiState: ReviewUiState,
    onSelectFilter: (ReviewFilter) -> Unit,
    onOpenPreview: () -> Unit,
    onOpenCurrentCard: (String) -> Unit,
    onOpenDeckManagement: () -> Unit,
    onCreateCard: () -> Unit,
    onCreateCardWithAi: () -> Unit,
    onSwitchToAllCards: () -> Unit,
    onRevealAnswer: () -> Unit,
    onRateAgain: () -> Unit,
    onRateHard: () -> Unit,
    onRateGood: () -> Unit,
    onRateEasy: () -> Unit,
    onDismissErrorMessage: () -> Unit
) {
    var isFilterSheetVisible by remember { mutableStateOf(value = false) }
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.errorMessage) {
        if (uiState.errorMessage.isEmpty()) {
            return@LaunchedEffect
        }

        snackbarHostState.showSnackbar(message = uiState.errorMessage)
        onDismissErrorMessage()
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
                onOpenCurrentCard = onOpenCurrentCard,
                onCreateCard = onCreateCard,
                onCreateCardWithAi = onCreateCardWithAi,
                onSwitchToAllCards = onSwitchToAllCards,
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
}
