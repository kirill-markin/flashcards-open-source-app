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
import com.flashcardsopensourceapp.feature.settings.account.methods.AccountMethodsRoute
import com.flashcardsopensourceapp.feature.settings.account.methods.AccountMethodsViewModel
import com.flashcardsopensourceapp.feature.settings.R as SettingsR

@Composable
internal fun AccountMethodsContainer(viewModel: AccountMethodsViewModel, onBack: () -> Unit) {
    val application = LocalContext.current.applicationContext as FlashcardsApplication
    val returned by application.appleSignInReturnState.collectAsStateWithLifecycle()
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    LaunchedEffect(returned, state.busy, state.linked) {
        val candidate = returned as? AppleSignInReturnState.ManagementAccepted
        if (candidate != null && !state.busy && state.linked) {
            viewModel.returned(candidate.pending, application::consumeAppleSignInReturn)
        }
    }
    AccountMethodsRoute(viewModel, onBack)
    if (returned == AppleSignInReturnState.ManagementRejected || returned == AppleSignInReturnState.ManagementStorageFailed) {
        val storageFailed = returned == AppleSignInReturnState.ManagementStorageFailed
        AlertDialog(onDismissRequest = application::consumeAppleSignInReturn,
            title = { Text(stringResource(SettingsR.string.settings_auth_return_title)) },
            text = { Text(stringResource(if (storageFailed) SettingsR.string.settings_auth_return_storage_failed
                else SettingsR.string.settings_auth_return_rejected)) },
            confirmButton = {
                if (storageFailed) TextButton(onClick = application::retryAppleSignInReturn,
                    modifier = Modifier.testTag("account_methods_return_retry")) {
                    Text(stringResource(SettingsR.string.settings_auth_retry))
                }
            },
            dismissButton = {
                TextButton(onClick = application::consumeAppleSignInReturn,
                    modifier = Modifier.testTag("account_methods_return_close")) {
                    Text(stringResource(SettingsR.string.settings_auth_close))
                }
            })
    }
}
