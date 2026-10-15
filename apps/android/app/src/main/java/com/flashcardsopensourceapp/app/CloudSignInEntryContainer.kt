package com.flashcardsopensourceapp.app

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInViewModel
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInEntryRoute
import com.flashcardsopensourceapp.feature.settings.R as SettingsR

@Composable
internal fun CloudSignInEntryContainer(
    viewModel: CloudSignInViewModel,
    onSendCode: () -> Unit,
    onPostAuth: () -> Unit,
    onShowTechnicalDetails: (String, String) -> Unit,
    onBack: () -> Unit
) {
    val application = LocalContext.current.applicationContext as FlashcardsApplication
    val returned by application.appleSignInReturnState.collectAsStateWithLifecycle()
    val state by viewModel.providerSignIn.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(returned, state.busy, state.methods) {
        val candidate = returned as? AppleSignInReturnState.Accepted
        if (candidate != null && !state.busy && state.methods != null) {
            viewModel.providerSignIn.returned(candidate.pending)
            application.consumeAppleSignInReturn()
        }
    }
    CloudSignInEntryRoute(viewModel, onSendCode, onPostAuth, onShowTechnicalDetails, onBack)
    if (returned == AppleSignInReturnState.StorageFailed || returned == AppleSignInReturnState.Rejected) {
        CloudAppleReturnErrorDialog(returned, application::retryAppleSignInReturn, application::consumeAppleSignInReturn)
    }
}

@Composable
internal fun CloudAppleReturnErrorDialog(
    returned: AppleSignInReturnState,
    onRetry: () -> Unit,
    onClose: () -> Unit
) {
    val storageFailed = returned == AppleSignInReturnState.StorageFailed ||
        returned == AppleSignInReturnState.OwnershipStorageFailed
    AlertDialog(
        onDismissRequest = onClose,
        title = { Text(stringResource(SettingsR.string.settings_auth_return_title)) },
        text = { Text(stringResource(if (storageFailed)
            SettingsR.string.settings_auth_return_storage_failed else SettingsR.string.settings_auth_return_rejected)) },
        confirmButton = {
            if (storageFailed) TextButton(
                onClick = onRetry,
                modifier = Modifier.testTag("cloud_apple_return_retry")) {
                Text(stringResource(SettingsR.string.settings_auth_retry))
            }
        },
        dismissButton = {
            TextButton(onClick = onClose,
                modifier = Modifier.testTag("cloud_apple_return_close")) {
                Text(stringResource(SettingsR.string.settings_auth_close))
            }
        }
    )
}
