package com.flashcardsopensourceapp.feature.progress

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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.flashcardsopensourceapp.data.local.model.progress.ProgressLeaderboardWindowKey
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationDialog
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationShareEffect
import com.flashcardsopensourceapp.feature.friendinvite.FriendInvitationUiState
import com.flashcardsopensourceapp.feature.progress.sections.ErrorCard
import com.flashcardsopensourceapp.feature.progress.sections.GuidanceCard
import com.flashcardsopensourceapp.feature.progress.sections.leaderboard.LeaderboardSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.LoadingCard
import com.flashcardsopensourceapp.feature.progress.sections.leaderboard.ProgressLeaderboardProfileSheet
import com.flashcardsopensourceapp.feature.progress.sections.ReviewScheduleSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.ReviewsSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.leaderboard.StreakLeaderboardSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.StreakSectionCard
import com.flashcardsopensourceapp.feature.progress.sections.progressLeaderboardInviteDisplayNameFieldTag

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProgressRoute(
    uiState: ProgressUiState,
    friendInvitationUiState: FriendInvitationUiState,
    streakScrollRequestId: Long?,
    onStreakScrollRequestConsumed: (Long) -> Unit,
    leaderboardScrollRequestId: Long?,
    onLeaderboardScrollRequestConsumed: (Long) -> Unit,
    onScreenVisible: () -> Unit,
    onRetry: () -> Unit,
    onSelectLeaderboardWindow: (ProgressLeaderboardWindowKey) -> Unit,
    onOpenLeaderboardProfile: (ProgressLeaderboardProfileIdentityUiState) -> Unit,
    onRetryLeaderboardProfile: () -> Unit,
    onDismissLeaderboardProfile: () -> Unit,
    onCreateFriendInvitation: (String) -> Unit,
    onClearFriendInvitationFailure: () -> Unit,
    // The invitation dialog is a screen of its own to the caller, which is the only side that knows
    // what it was opened over. Reported from the two handlers that flip the state below rather than
    // from an effect watching it, so a configuration change cannot repeat either edge.
    onFriendInvitationDialogShown: () -> Unit,
    onFriendInvitationDialogDismissed: () -> Unit,
    onFriendInvitationShared: (Long) -> Unit,
    onOpenSignIn: () -> Unit,
    onOpenLeaderboardSettings: () -> Unit
) {
    val lifecycleOwner = LocalLifecycleOwner.current
    val listState = rememberLazyListState()
    // Owned here rather than by the leaderboard card, which is one `item {}` of a `LazyColumn`
    // branch that only `ProgressUiState.Loaded` renders. The series snapshot goes back to null on a
    // scope-key or time-zone change, a workspace teardown and a cache rebuild, and each of those
    // disposes that whole subtree. A dialog disposed that way never runs its dismiss handler, so the
    // `friend_invite` view would be left with no visit back to `progress` after it, and reopening it
    // on the same screen would write a second `friend_invite` in a row. Saved, not remembered, so a
    // rotation repeats neither edge.
    var isInviteDialogVisible by rememberSaveable { mutableStateOf(false) }
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

    FriendInvitationShareEffect(
        uiState = friendInvitationUiState,
        onFriendInvitationShared = onFriendInvitationShared
    )

    if (isInviteDialogVisible) {
        FriendInvitationDialog(
            uiState = friendInvitationUiState,
            displayNameFieldTag = progressLeaderboardInviteDisplayNameFieldTag,
            onCreateFriendInvitation = onCreateFriendInvitation,
            onClearFriendInvitationFailure = onClearFriendInvitationFailure,
            // The single way this dialog closes: the dismiss button, a back press, a tap outside and
            // the effect that closes it once an invitation is created all arrive here. Rendered from
            // the route rather than from the leaderboard card so that stays true — nothing the
            // loaded state does can take it off screen behind this handler's back.
            onDismiss = {
                isInviteDialogVisible = false
                onFriendInvitationDialogDismissed()
            }
        )
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
                            onSelectWindow = onSelectLeaderboardWindow,
                            onOpenProfile = onOpenLeaderboardProfile,
                            onOpenFriendInvitation = {
                                onClearFriendInvitationFailure()
                                isInviteDialogVisible = true
                                onFriendInvitationDialogShown()
                            },
                            onOpenSignIn = onOpenSignIn,
                            onOpenLeaderboardSettings = onOpenLeaderboardSettings
                        )
                    }
                    item {
                        StreakLeaderboardSectionCard(
                            uiState = uiState.streakLeaderboardSection,
                            onOpenProfile = onOpenLeaderboardProfile,
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

        val leaderboardProfileSheet = (uiState as? ProgressUiState.Loaded)?.leaderboardProfileSheet
        if (leaderboardProfileSheet != null) {
            ProgressLeaderboardProfileSheet(
                uiState = leaderboardProfileSheet,
                onDismiss = onDismissLeaderboardProfile,
                onRetry = onRetryLeaderboardProfile
            )
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
