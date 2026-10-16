package com.flashcardsopensourceapp.feature.settings.account.methods

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodIntent
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountProviderMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialNonce
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProviderAvailability
import com.flashcardsopensourceapp.data.local.model.cloud.cloudAppleReturnUri
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInMethodButton

@Composable
fun AccountMethodsRoute(viewModel: AccountMethodsViewModel, onBack: () -> Unit) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val launchApple: (String) -> Unit = { CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(it)) }
    val close: () -> Unit = { if (state.demoAccount) onBack() else viewModel.cancel(onBack) }
    BackHandler(enabled = state.linked) { if (!state.busy) close() }
    val browserAvailable = remember(context) {
        Intent(Intent.ACTION_VIEW, Uri.parse("https://auth.nibomo.com")).resolveActivity(context.packageManager) != null
    }
    val available = buildList {
        val google = state.availability?.google
        if (google is CloudSocialProviderAvailability.Native && google.nonce == CloudSocialNonce.RAW) add(CloudSignInMethod.GOOGLE)
        if (state.availability?.email?.available == true) add(CloudSignInMethod.EMAIL)
        val apple = state.availability?.apple
        if (apple is CloudSocialProviderAvailability.Browser && apple.nativeReturnUri == cloudAppleReturnUri &&
            apple.start == "/api/social/apple/start" && browserAvailable) add(CloudSignInMethod.APPLE)
    }
    val pending = state.pending
    val awaitingCode = pending?.phase == CloudAccountMethodPhase.EMAIL_CODE ||
        (pending?.phase == CloudAccountMethodPhase.MAILBOX && pending.mailboxCodeRequested)
    LaunchedEffect(pending?.localId, awaitingCode) { if (awaitingCode) viewModel.codeFormShown() }
    SettingsScreenScaffold(title = stringResource(R.string.settings_methods_title),
        onBack = if (state.linked) close else onBack, isBackEnabled = !state.busy) { padding ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(20.dp)
            .testTag("account_methods_screen"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (state.busy) CircularProgressIndicator(Modifier.testTag("account_methods_loading"))
            if (state.error.isNotEmpty()) Text(state.error, color = MaterialTheme.colorScheme.error)
            if (!state.linked) {
                Text(stringResource(R.string.settings_methods_sign_in))
                return@Column
            }
            if (state.demoAccount) {
                Text(stringResource(R.string.settings_methods_demo), modifier = Modifier.testTag("account_methods_demo"))
                return@Column
            }
            OutlinedButton(onClick = viewModel::refresh, enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().testTag("account_methods_refresh")) {
                Text(stringResource(R.string.settings_methods_refresh))
            }
            state.methods?.let { methods ->
                methods.methods.sortedBy { if (it.target.provider == CloudSocialProvider.GOOGLE) 0 else 1 }.forEach { method ->
                    AccountMethodStatus(method)
                }
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(stringResource(R.string.settings_methods_emails), style = MaterialTheme.typography.titleMedium)
                        Text(stringResource(R.string.settings_methods_read_only))
                        if (methods.verifiedRecoveryEmails.isEmpty()) Text(stringResource(R.string.settings_methods_no_emails))
                        methods.verifiedRecoveryEmails.forEach { Text(it) }
                    }
                }
            }
            if (state.mutationConfirmed) Text(stringResource(R.string.settings_methods_confirmed),
                modifier = Modifier.testTag("account_methods_confirmed"))
            if (state.restartRequired) Text(stringResource(R.string.settings_methods_fresh))
            when {
                pending == null -> {
                    Text(stringResource(R.string.settings_methods_verify_current))
                    available.filter { method -> method == CloudSignInMethod.EMAIL || state.methods?.methods?.any {
                        it.active && !it.revocationPending && it.target.provider.signInMethod() == method
                    } == true }.forEach { method ->
                        CloudSignInMethodButton(method, null, state.busy || state.methods == null,
                            { viewModel.reauthenticate(method, context, launchApple) })
                    }
                }
                !state.restartRequired && pending.phase == CloudAccountMethodPhase.PROOF_READY -> {
                    Text(stringResource(R.string.settings_methods_choose_change))
                    listOf(CloudSocialProvider.GOOGLE, CloudSocialProvider.APPLE).forEach { provider ->
                        val listed = state.methods?.methods?.filter { it.target.provider == provider }
                        val usable = provider.signInMethod() in available
                        if (listed?.isEmpty() == true && usable) {
                            Text(stringResource(R.string.settings_methods_link))
                            CloudSignInMethodButton(provider.signInMethod(), null, state.busy,
                                { viewModel.link(provider, context, launchApple) })
                        }
                        listed?.forEach { method ->
                            if (method.revocationPending) Text(stringResource(R.string.settings_methods_cleanup))
                            else if (method.active) UnlinkMethodButton(method, state.busy) { viewModel.unlink(method.target) }
                            else if (usable) {
                                Text(stringResource(R.string.settings_methods_reenable))
                                CloudSignInMethodButton(provider.signInMethod(), null, state.busy,
                                    { viewModel.reenable(method.target, context, launchApple) })
                            }
                        }
                    }
                }
                !state.restartRequired && pending.phase == CloudAccountMethodPhase.MAILBOX && !pending.mailboxCodeRequested -> {
                    Text(stringResource(R.string.settings_auth_mailbox_body))
                    OutlinedTextField(value = state.email, onValueChange = viewModel::email,
                        enabled = !state.busy, singleLine = true,
                        label = { Text(stringResource(R.string.settings_sign_in_email_title)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                        modifier = Modifier.fillMaxWidth().testTag("account_methods_mailbox_email"))
                    Button(onClick = viewModel::sendMailboxCode, enabled = !state.busy && state.email.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().testTag("account_methods_mailbox_send")) {
                        Text(stringResource(R.string.settings_sign_in_send_code_button))
                    }
                }
                !state.restartRequired && awaitingCode -> {
                    Text(stringResource(R.string.settings_methods_code_body))
                    OutlinedTextField(value = state.code, onValueChange = viewModel::code,
                        enabled = !state.busy, singleLine = true,
                        label = { Text(stringResource(R.string.settings_auth_mailbox_code)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                        modifier = Modifier.fillMaxWidth().testTag("account_methods_code"))
                    Button(onClick = viewModel::verifyCode, enabled = !state.busy && state.code.length in 6..8,
                        modifier = Modifier.fillMaxWidth().testTag("account_methods_verify")) {
                        Text(stringResource(R.string.settings_sign_in_verify_button))
                    }
                    Text(stringResource(R.string.settings_auth_mailbox_restart))
                }
                !state.restartRequired && pending.phase == CloudAccountMethodPhase.PROVIDER -> {
                    Text(stringResource(R.string.settings_auth_browser_waiting))
                    Text(stringResource(if (pending.intent == CloudAccountMethodIntent.REAUTH)
                        R.string.settings_methods_verify_current else R.string.settings_methods_new_provider))
                }
                !state.restartRequired && pending.phase == CloudAccountMethodPhase.LINK_READY -> {
                    Text(stringResource(R.string.settings_methods_new_provider))
                    Button(onClick = viewModel::confirmLink, enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().testTag("account_methods_confirm_link")) {
                        Text(stringResource(R.string.settings_methods_link))
                    }
                }
                !state.restartRequired && pending.phase == CloudAccountMethodPhase.APPLE_PROVED -> {
                    Text(stringResource(R.string.settings_methods_new_provider))
                    Button(onClick = viewModel::resumeAppleReenable, enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth().testTag("account_methods_resume_apple")) {
                        Text(stringResource(R.string.settings_methods_reenable))
                    }
                }
            }
            if (pending != null || state.restartRequired) TextButton(onClick = { viewModel.cancel {} }, enabled = !state.busy,
                modifier = Modifier.testTag("account_methods_restart")) {
                Text(stringResource(R.string.settings_auth_start_again))
            }
        }
    }
}

@Composable
private fun AccountMethodStatus(method: CloudAccountProviderMethod) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(if (method.target.provider == CloudSocialProvider.GOOGLE)
                R.string.settings_auth_google else R.string.settings_auth_apple), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.settings_methods_generation, method.target.generation))
            Text(stringResource(when {
                method.revocationPending -> R.string.settings_methods_cleanup
                method.active -> R.string.settings_methods_active
                else -> R.string.settings_methods_disabled
            }))
        }
    }
}

@Composable
private fun UnlinkMethodButton(method: CloudAccountProviderMethod, busy: Boolean, onUnlink: () -> Unit) {
    var confirm by remember(method.target) { mutableStateOf(false) }
    val provider = stringResource(if (method.target.provider == CloudSocialProvider.GOOGLE)
        R.string.settings_auth_google else R.string.settings_auth_apple)
    OutlinedButton(onClick = { confirm = true }, enabled = !busy,
        modifier = Modifier.fillMaxWidth().testTag("account_methods_unlink_${method.target.provider.name.lowercase(java.util.Locale.ROOT)}")) {
        Text(stringResource(R.string.settings_methods_unlink_named, provider))
    }
    if (confirm) AlertDialog(onDismissRequest = { if (!busy) confirm = false },
        title = { Text(stringResource(R.string.settings_methods_unlink_named, provider)) },
        text = { Text(stringResource(R.string.settings_methods_last_usable)) },
        confirmButton = { TextButton(onClick = { confirm = false; onUnlink() }, enabled = !busy) {
            Text(stringResource(R.string.settings_methods_unlink))
        } },
        dismissButton = { TextButton(onClick = { confirm = false }, enabled = !busy) {
            Text(stringResource(R.string.settings_cancel))
        } })
}

private fun CloudSocialProvider.signInMethod(): CloudSignInMethod = when (this) {
    CloudSocialProvider.GOOGLE -> CloudSignInMethod.GOOGLE
    CloudSocialProvider.APPLE -> CloudSignInMethod.APPLE
}
