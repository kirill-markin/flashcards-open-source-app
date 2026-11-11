package com.flashcardsopensourceapp.wear.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.wear.compose.foundation.lazy.TransformingLazyColumn
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnItemScope
import androidx.wear.compose.foundation.lazy.TransformingLazyColumnScope
import androidx.wear.compose.foundation.lazy.rememberTransformingLazyColumnState
import androidx.wear.compose.material3.AlertDialog
import androidx.wear.compose.material3.AlertDialogDefaults
import androidx.wear.compose.material3.Button
import androidx.wear.compose.material3.ButtonDefaults
import androidx.wear.compose.material3.CircularProgressIndicator
import androidx.wear.compose.material3.ListHeader
import androidx.wear.compose.material3.ListHeaderDefaults
import androidx.wear.compose.material3.MaterialTheme
import androidx.wear.compose.material3.ScreenScaffold
import androidx.wear.compose.material3.SurfaceTransformation
import androidx.wear.compose.material3.Text
import androidx.wear.compose.material3.lazy.TransformationSpec
import androidx.wear.compose.material3.lazy.rememberTransformationSpec
import androidx.wear.compose.material3.lazy.transformedHeight
import com.flashcardsopensourceapp.wear.R
import com.flashcardsopensourceapp.wear.review.WearReviewScreen
import com.flashcardsopensourceapp.wear.review.WearReviewViewModel
import com.flashcardsopensourceapp.wear.session.WearSessionFailureMessage
import com.flashcardsopensourceapp.wear.session.WearSessionState
import com.flashcardsopensourceapp.wear.session.WearSessionViewModel

@Composable
fun WearRootScreen(viewModel: WearSessionViewModel, reviewViewModelFactory: ViewModelProvider.Factory) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val isRequestingHandoff by viewModel.isRequestingHandoff.collectAsStateWithLifecycle()

    when (val currentState = state) {
        WearSessionState.NotConnected -> WearSessionMessageScreen(
            title = stringResource(R.string.wear_session_open_phone_app),
            message = stringResource(R.string.wear_session_not_connected_message),
            isRequestingHandoff = isRequestingHandoff,
            onRetry = viewModel::refreshFromPhone
        )

        WearSessionState.Connecting -> WearSessionProgressScreen(
            label = stringResource(R.string.wear_session_connecting)
        )

        WearSessionState.Syncing -> WearSessionProgressScreen(
            label = stringResource(R.string.wear_session_syncing)
        )

        WearSessionState.Ready -> {
            // Created on the first Ready, once the local database is open.
            val reviewViewModel: WearReviewViewModel = viewModel(factory = reviewViewModelFactory)
            WearReviewScreen(viewModel = reviewViewModel)
        }

        is WearSessionState.SwitchBlocked -> WearSwitchBlockedScreen(
            unsyncedRatingCount = currentState.unsyncedRatingCount,
            isRequestingHandoff = isRequestingHandoff,
            onRetry = viewModel::refreshFromPhone,
            onDiscardAndSwitch = viewModel::discardUnsyncedRatingsAndSwitch
        )

        is WearSessionState.Failed -> WearSessionMessageScreen(
            title = failureMessageText(message = currentState.message),
            message = null,
            isRequestingHandoff = isRequestingHandoff,
            onRetry = viewModel::refreshFromPhone
        )
    }
}

@Composable
private fun failureMessageText(message: WearSessionFailureMessage): String {
    return when (message) {
        WearSessionFailureMessage.OpenPhoneApp -> stringResource(R.string.wear_session_open_phone_app)
        WearSessionFailureMessage.UpdateRequired -> stringResource(R.string.wear_session_update_required)
        is WearSessionFailureMessage.ErrorText -> message.text
    }
}

@Composable
private fun WearSessionProgressScreen(label: String) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            CircularProgressIndicator()
            Text(text = label, textAlign = TextAlign.Center)
        }
    }
}

@Composable
private fun WearSessionMessageScreen(
    title: String,
    message: String?,
    isRequestingHandoff: Boolean,
    onRetry: () -> Unit
) {
    WearScrollingScreen { transformationSpec ->
        item {
            WearSessionTitle(text = title, transformationSpec = transformationSpec)
        }
        if (message != null) {
            item {
                WearSessionMessage(text = message, transformationSpec = transformationSpec)
            }
        }
        item {
            WearRetryButton(
                isRequestingHandoff = isRequestingHandoff,
                transformationSpec = transformationSpec,
                onRetry = onRetry
            )
        }
    }
}

@Composable
private fun WearSwitchBlockedScreen(
    unsyncedRatingCount: Int,
    isRequestingHandoff: Boolean,
    onRetry: () -> Unit,
    onDiscardAndSwitch: () -> Unit
) {
    var isDiscardConfirmationVisible by rememberSaveable { mutableStateOf(false) }
    // A refresh hides the buttons and would ignore a confirm during it, so the dialog closes with them.
    LaunchedEffect(isRequestingHandoff) {
        if (isRequestingHandoff) {
            isDiscardConfirmationVisible = false
        }
    }
    val discardTitle = stringResource(R.string.wear_session_switch_blocked_discard)

    WearScrollingScreen { transformationSpec ->
        item {
            WearSessionTitle(
                text = pluralStringResource(
                    R.plurals.wear_session_switch_blocked_title,
                    unsyncedRatingCount,
                    unsyncedRatingCount
                ),
                transformationSpec = transformationSpec
            )
        }
        item {
            WearSessionMessage(
                text = stringResource(R.string.wear_session_switch_blocked_message),
                transformationSpec = transformationSpec
            )
        }
        item {
            WearRetryButton(
                isRequestingHandoff = isRequestingHandoff,
                transformationSpec = transformationSpec,
                onRetry = onRetry
            )
        }
        if (isRequestingHandoff.not()) {
            item {
                Button(
                    onClick = { isDiscardConfirmationVisible = true },
                    modifier = Modifier
                        .fillMaxWidth()
                        .transformedHeight(this, transformationSpec)
                        .minimumVerticalContentPadding(ButtonDefaults.minimumVerticalListContentPadding),
                    transformation = SurfaceTransformation(transformationSpec),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError
                    )
                ) {
                    Text(text = discardTitle)
                }
            }
        }
    }

    AlertDialog(
        visible = isDiscardConfirmationVisible,
        onDismissRequest = { isDiscardConfirmationVisible = false },
        confirmButton = {
            AlertDialogDefaults.ConfirmButton(
                onClick = {
                    isDiscardConfirmationVisible = false
                    onDiscardAndSwitch()
                }
            )
        },
        title = {
            Text(
                text = pluralStringResource(
                    R.plurals.wear_session_switch_blocked_discard_confirmation_title,
                    unsyncedRatingCount,
                    unsyncedRatingCount
                )
            )
        },
        text = {
            Text(text = stringResource(R.string.wear_session_switch_blocked_discard_confirmation_message))
        }
    )
}

@Composable
private fun WearScrollingScreen(content: TransformingLazyColumnScope.(TransformationSpec) -> Unit) {
    val listState = rememberTransformingLazyColumnState()
    val transformationSpec = rememberTransformationSpec()
    ScreenScaffold(scrollState = listState) { contentPadding ->
        TransformingLazyColumn(state = listState, contentPadding = contentPadding) {
            content(transformationSpec)
        }
    }
}

@Composable
private fun TransformingLazyColumnItemScope.WearSessionTitle(text: String, transformationSpec: TransformationSpec) {
    ListHeader(
        modifier = Modifier
            .fillMaxWidth()
            .transformedHeight(this, transformationSpec)
            .minimumVerticalContentPadding(ListHeaderDefaults.minimumTopListContentPadding),
        transformation = SurfaceTransformation(transformationSpec)
    ) {
        // A header stops at three lines; a failure message is shown whole.
        Text(text = text, textAlign = TextAlign.Center, maxLines = Int.MAX_VALUE)
    }
}

@Composable
private fun TransformingLazyColumnItemScope.WearSessionMessage(text: String, transformationSpec: TransformationSpec) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .transformedListItem(itemScope = this, transformationSpec = transformationSpec)
            .padding(bottom = 4.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall,
        textAlign = TextAlign.Center
    )
}

/** The refresh runs in place of the button, so a tap always shows that it was taken. */
@Composable
private fun TransformingLazyColumnItemScope.WearRetryButton(
    isRequestingHandoff: Boolean,
    transformationSpec: TransformationSpec,
    onRetry: () -> Unit
) {
    if (isRequestingHandoff) {
        CircularProgressIndicator()
    } else {
        Button(
            onClick = onRetry,
            modifier = Modifier
                .fillMaxWidth()
                .transformedHeight(this, transformationSpec)
                .minimumVerticalContentPadding(ButtonDefaults.minimumVerticalListContentPadding),
            transformation = SurfaceTransformation(transformationSpec)
        ) {
            Text(text = stringResource(R.string.wear_retry))
        }
    }
}
