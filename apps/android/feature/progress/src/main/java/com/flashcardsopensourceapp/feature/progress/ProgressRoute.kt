package com.flashcardsopensourceapp.feature.progress

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressRoute(
    uiState: ProgressUiState,
    onScreenVisible: () -> Unit,
    onRetry: () -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val currentScreenVisibleAction = rememberUpdatedState(newValue = onScreenVisible)

    DisposableEffect(lifecycleOwner) {
        if (shouldTriggerInitialProgressLoad(lifecycleState = lifecycleOwner.lifecycle.currentState)) {
            currentScreenVisibleAction.value()
        }

        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
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
            TopAppBar(
                title = {
                    Text(stringResource(id = R.string.progress_title))
                }
            )
        }
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 16.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 24.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            when (uiState) {
                ProgressUiState.Loading -> {
                    item {
                        LoadingCard()
                    }
                }

                ProgressUiState.SignInRequired -> {
                    item {
                        GuidanceCard(
                            title = stringResource(id = R.string.progress_sign_in_required_title),
                            message = stringResource(id = R.string.progress_sign_in_required_message)
                        )
                    }
                }

                ProgressUiState.Unavailable -> {
                    item {
                        GuidanceCard(
                            title = stringResource(id = R.string.progress_unavailable_title),
                            message = stringResource(id = R.string.progress_unavailable_message)
                        )
                    }
                }

                is ProgressUiState.Error -> {
                    item {
                        ErrorCard(
                            message = uiState.message,
                            onRetry = onRetry
                        )
                    }
                }

                is ProgressUiState.Loaded -> {
                    item {
                        StreakSectionCard(
                            summary = uiState.summary,
                            uiState = uiState.streakSection
                        )
                    }
                    item {
                        ReviewsSectionCard(
                            uiState = uiState.reviewsSection
                        )
                    }
                    val reviewScheduleSection = uiState.reviewScheduleSection
                    if (reviewScheduleSection != null) {
                        item {
                            ReviewScheduleSectionCard(
                                uiState = reviewScheduleSection
                            )
                        }
                    }
                }
            }
        }
    }
}

internal fun shouldTriggerInitialProgressLoad(
    lifecycleState: Lifecycle.State
): Boolean {
    return lifecycleState == Lifecycle.State.RESUMED
}
