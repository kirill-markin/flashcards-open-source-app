package com.flashcardsopensourceapp.feature.settings.cloud.signIn

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsHoveredAsState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.PlainTooltip
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TooltipBox
import androidx.compose.material3.TooltipDefaults
import androidx.compose.material3.rememberTooltipState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.zIndex
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProviderAvailability
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialNonce
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSuccessfulSignInHint
import com.flashcardsopensourceapp.data.local.model.cloud.cloudAppleReturnUri
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsScreenScaffold

@Composable
fun CloudSignInEntryRoute(
    viewModel: CloudSignInViewModel,
    onSendCode: () -> Unit,
    onPostAuth: () -> Unit,
    onShowTechnicalDetails: (String, String) -> Unit,
    onBack: () -> Unit
) {
    val controller = viewModel.providerSignIn
    val state by controller.uiState.collectAsStateWithLifecycle()
    val emailState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val goBack: () -> Unit = {
        if (state.step == CloudSignInEntryStep.EMAIL) controller.anotherMethod()
        else controller.close(onBack)
    }
    BackHandler { if (!state.busy && !emailState.isSendingCode) goBack() }
    LaunchedEffect(controller) { controller.load() }
    LaunchedEffect(state.step, state.codeRequested) {
        if (state.step == CloudSignInEntryStep.MAILBOX && state.codeRequested) controller.mailboxFormShown()
    }
    LaunchedEffect(state.prepared) {
        if (state.prepared) {
            controller.consumePrepared()
            onPostAuth()
        }
    }
    if (state.step == CloudSignInEntryStep.EMAIL) {
        CloudSignInEmailRoute(emailState, viewModel::updateEmail, onSendCode, onShowTechnicalDetails,
            goBack)
        return
    }
    SettingsScreenScaffold(
        title = stringResource(R.string.settings_auth_entry_title),
        onBack = goBack,
        isBackEnabled = !state.busy
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(padding).padding(20.dp)
                .testTag("cloud_sign_in_methods"),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            if (state.busy) CircularProgressIndicator(modifier = Modifier.testTag("cloud_sign_in_loading"))
            if (state.error.isNotEmpty()) {
                if (state.cleanupPending) {
                    Card(modifier = Modifier.fillMaxWidth().testTag("cloud_sign_in_cleanup_pending")) {
                        Text(state.error, modifier = Modifier.padding(20.dp))
                    }
                } else Text(state.error, color = MaterialTheme.colorScheme.error)
                val technicalDetails = state.errorTechnicalDetails
                val reportId = state.errorTechnicalDetailsReportId
                if (technicalDetails != null && reportId != null) {
                    TextButton(onClick = { onShowTechnicalDetails(technicalDetails, reportId) },
                        modifier = Modifier.testTag("cloud_sign_in_provider_error_details")) {
                        Text(stringResource(R.string.settings_sign_in_error_show_details))
                    }
                }
            }
            if (state.step == CloudSignInEntryStep.MAILBOX) {
                Text(stringResource(R.string.settings_auth_mailbox_body))
                OutlinedTextField(
                    value = state.email, onValueChange = controller::email,
                    label = { Text(stringResource(R.string.settings_sign_in_email_title)) },
                    enabled = !state.busy && !state.codeRequested && !state.requiresRestart,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("cloud_social_mailbox_email")
                )
                if (state.codeRequested) {
                    OutlinedTextField(value = state.code, onValueChange = controller::code,
                        label = { Text(stringResource(R.string.settings_auth_mailbox_code)) },
                        enabled = !state.busy && !state.requiresRestart, singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("cloud_social_mailbox_code"))
                    Button(onClick = controller::verifyMailboxCode,
                        enabled = !state.busy && !state.requiresRestart && state.code.length in 6..8,
                        modifier = Modifier.fillMaxWidth().testTag("cloud_social_mailbox_verify")) {
                        Text(stringResource(R.string.settings_sign_in_verify_button))
                    }
                    Text(stringResource(R.string.settings_auth_mailbox_restart))
                } else {
                    Button(onClick = controller::sendMailboxCode,
                        enabled = !state.busy && !state.requiresRestart && state.email.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().testTag("cloud_social_mailbox_send")) {
                        Text(stringResource(R.string.settings_sign_in_send_code_button))
                    }
                }
                TextButton(onClick = controller::anotherMethod, enabled = !state.busy,
                    modifier = Modifier.testTag("cloud_sign_in_restart")) {
                    Text(stringResource(R.string.settings_auth_start_again))
                }
                return@Column
            }
            if (state.step == CloudSignInEntryStep.PROVIDER) {
                Text(stringResource(R.string.settings_auth_browser_waiting))
                TextButton(onClick = controller::anotherMethod, enabled = !state.busy,
                    modifier = Modifier.testTag("cloud_sign_in_restart")) {
                    Text(stringResource(R.string.settings_auth_start_again))
                }
                return@Column
            }
            val google = state.methods?.google
            if (google is CloudSocialProviderAvailability.Native && google.nonce == CloudSocialNonce.RAW) {
                CloudSignInMethodButton(CloudSignInMethod.GOOGLE, state.hint, state.busy,
                    { controller.google(context) })
            }
            if (state.methods?.email?.available == true) {
                CloudSignInMethodButton(CloudSignInMethod.EMAIL, state.hint, state.busy,
                    controller::selectEmail)
            }
            val apple = state.methods?.apple
            val browserAvailable = remember(context) {
                Intent(Intent.ACTION_VIEW, Uri.parse("https://auth.nibomo.com"))
                    .resolveActivity(context.packageManager) != null
            }
            if (apple is CloudSocialProviderAvailability.Browser &&
                apple.nativeReturnUri == cloudAppleReturnUri && apple.start == "/api/social/apple/start" && browserAvailable) {
                CloudSignInMethodButton(CloudSignInMethod.APPLE, state.hint, state.busy,
                    { controller.apple { url -> CustomTabsIntent.Builder().build().launchUrl(context, Uri.parse(url)) } })
            }
            if (state.methods == null && !state.busy) TextButton(onClick = controller::load,
                modifier = Modifier.testTag("cloud_sign_in_retry_methods")) {
                Text(stringResource(R.string.settings_auth_retry))
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CloudSignInMethodButton(
    method: CloudSignInMethod,
    hint: CloudSuccessfulSignInHint?,
    busy: Boolean,
    onSignIn: () -> Unit
) {
    val remembered = hint?.takeIf { it.method == method }
    val email = remembered?.successfulEmail
    var expanded by remember(email) { mutableStateOf(false) }
    val label = stringResource(when (method) {
        CloudSignInMethod.GOOGLE -> R.string.settings_auth_google
        CloudSignInMethod.EMAIL -> R.string.settings_auth_email
        CloudSignInMethod.APPLE -> R.string.settings_auth_apple
    })
    val tooltip = rememberTooltipState()
    val hintInteractions = remember { MutableInteractionSource() }
    val hintHovered by hintInteractions.collectIsHoveredAsState()
    LaunchedEffect(hintHovered, busy, expanded, email) {
        if (hintHovered && !busy && !expanded && email != null) tooltip.show()
        else tooltip.dismiss()
    }
    val containerColor = when (method) {
        CloudSignInMethod.APPLE -> Color.Black
        CloudSignInMethod.GOOGLE -> Color.White
        CloudSignInMethod.EMAIL -> MaterialTheme.colorScheme.surfaceContainerHigh
    }
    val contentColor = when (method) {
        CloudSignInMethod.APPLE -> Color.White
        CloudSignInMethod.GOOGLE -> Color(0xFF1F1F1F)
        CloudSignInMethod.EMAIL -> MaterialTheme.colorScheme.onSurface
    }
    TooltipBox(
        positionProvider = TooltipDefaults.rememberPlainTooltipPositionProvider(),
        state = tooltip,
        enableUserInput = false,
        modifier = Modifier.fillMaxWidth().zIndex(if (remembered != null) 1f else 0f),
        tooltip = { if (email != null) PlainTooltip { Text(maskSignInEmail(email)) } }
    ) {
        Box(Modifier.fillMaxWidth()) {
            Button(
                onClick = onSignIn, enabled = !busy,
                colors = ButtonDefaults.buttonColors(
                    containerColor = containerColor,
                    contentColor = contentColor,
                    disabledContainerColor = containerColor,
                    disabledContentColor = contentColor.copy(alpha = 0.38f)
                ),
                border = BorderStroke(1.dp, if (method == CloudSignInMethod.GOOGLE) Color(0xFF747775)
                    else MaterialTheme.colorScheme.outlineVariant),
                shape = MaterialTheme.shapes.small,
                modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
                    .testTag("cloud_sign_in_method_${method.name.lowercase(java.util.Locale.ROOT)}")
            ) {
                if (method == CloudSignInMethod.EMAIL) {
                    Icon(Icons.Outlined.Email, contentDescription = null, tint = contentColor,
                        modifier = Modifier.size(24.dp).alpha(if (busy) 0.38f else 1f))
                } else {
                    Icon(painterResource(if (method == CloudSignInMethod.GOOGLE) R.drawable.auth_google
                        else R.drawable.auth_apple), contentDescription = null,
                        tint = if (method == CloudSignInMethod.GOOGLE) Color.Unspecified else contentColor,
                        modifier = Modifier.size(24.dp).alpha(if (busy) 0.38f else 1f))
                }
                Spacer(Modifier.width(12.dp))
                Text(label)
            }
            if (remembered != null) {
                Box(Modifier.align(Alignment.TopEnd).offset(y = (-24).dp)) {
                    TextButton(onClick = { tooltip.dismiss(); expanded = !expanded && email != null }, enabled = !busy,
                        interactionSource = hintInteractions,
                        modifier = Modifier.testTag("cloud_sign_in_last_used")) {
                        Badge { Text(stringResource(R.string.settings_auth_last_used)) }
                    }
                    DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                        if (email != null) {
                            Text(maskSignInEmail(email), modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                        }
                    }
                }
            }
        }
    }
}

private fun maskSignInEmail(email: String): String {
    val local = email.substringBefore('@')
    return local.take(1) + "…@" + email.substringAfter('@')
}
