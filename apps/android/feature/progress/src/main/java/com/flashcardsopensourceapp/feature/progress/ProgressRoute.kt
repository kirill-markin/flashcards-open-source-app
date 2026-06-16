package com.flashcardsopensourceapp.feature.progress

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.feature.progress.sections.ErrorCard
import com.flashcardsopensourceapp.feature.progress.sections.GuidanceCard
import com.flashcardsopensourceapp.feature.progress.sections.LeaderboardSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.LoadingCard
import com.flashcardsopensourceapp.feature.progress.sections.ReviewScheduleSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.ReviewsSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.StreakSectionCard

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressRoute(
    uiState: ProgressUiState,
    friendInvitationUiState: ProgressFriendInvitationUiState,
    streakScrollRequestId: Long?,
    onStreakScrollRequestConsumed: (Long) -> Unit,
    leaderboardScrollRequestId: Long?,
    onLeaderboardScrollRequestConsumed: (Long) -> Unit,
    onScreenVisible: () -> Unit,
    onRetry: () -> Unit,
    onSelectLeaderboardWindow: (ProgressLeaderboardWindowKey) -> Unit,
    onCreateFriendInvitation: (String) -> Unit,
    onClearFriendInvitationFailure: () -> Unit,
    onFriendInvitationShared: (Long) -> Unit,
    onOpenSignIn: () -> Unit,
    onOpenLeaderboardSettings: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val listState = rememberLazyListState()
    val currentScreenVisibleAction = rememberUpdatedState(newValue = onScreenVisible)
    val currentStreakScrollRequestConsumed = rememberUpdatedState(
        newValue = onStreakScrollRequestConsumed
    )
    val currentLeaderboardScrollRequestConsumed = rememberUpdatedState(
        newValue = onLeaderboardScrollRequestConsumed
    )

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

    LaunchedEffect(streakScrollRequestId, uiState) {
        val requestId = streakScrollRequestId ?: return@LaunchedEffect
        uiState as? ProgressUiState.Loaded ?: return@LaunchedEffect

        listState.animateScrollToItem(index = progressStreakItemIndex())
        currentStreakScrollRequestConsumed.value(requestId)
    }

    LaunchedEffect(leaderboardScrollRequestId, uiState) {
        val requestId = leaderboardScrollRequestId ?: return@LaunchedEffect
        uiState as? ProgressUiState.Loaded ?: return@LaunchedEffect

        listState.animateScrollToItem(index = progressLeaderboardItemIndex())
        currentLeaderboardScrollRequestConsumed.value(requestId)
    }

    LaunchedEffect(friendInvitationUiState) {
        val createdState = friendInvitationUiState as? ProgressFriendInvitationUiState.Created
            ?: return@LaunchedEffect
        val shareIntent = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, createdState.inviteUrl)
        context.startActivity(
            Intent.createChooser(
                shareIntent,
                context.getString(R.string.progress_friend_invite_share_title)
            )
        )
        onFriendInvitationShared(createdState.shareId)
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
            state = listState,
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
                        LeaderboardSectionCard(
                            uiState = uiState.leaderboardSection,
                            friendInvitationUiState = friendInvitationUiState,
                            onSelectWindow = onSelectLeaderboardWindow,
                            onCreateFriendInvitation = onCreateFriendInvitation,
                            onClearFriendInvitationFailure = onClearFriendInvitationFailure,
                            onOpenSignIn = onOpenSignIn,
                            onOpenLeaderboardSettings = onOpenLeaderboardSettings
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

internal fun progressStreakItemIndex(): Int {
    return 0
}

internal fun progressLeaderboardItemIndex(): Int {
    return 1
}

internal fun shouldTriggerInitialProgressLoad(
    lifecycleState: Lifecycle.State
): Boolean {
    return lifecycleState == Lifecycle.State.RESUMED
}
