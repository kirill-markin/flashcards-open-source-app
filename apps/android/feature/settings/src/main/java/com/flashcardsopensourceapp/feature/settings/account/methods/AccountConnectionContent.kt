package com.flashcardsopensourceapp.feature.settings.account.methods

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountMethodPhase
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSignInMethod
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSocialProvider
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInMethodButton

@Composable
internal fun AccountConnectionContent(state: AccountMethodsUiState, viewModel: AccountMethodsViewModel,
    available: List<CloudSignInMethod>, launchProvider: (CloudSocialProvider) -> Unit) {
    val pending = requireNotNull(state.pending)
    val connection = requireNotNull(pending.connection)
    var emailForm by remember(pending.localId) { mutableStateOf(false) }
    when (pending.phase) {
        CloudAccountMethodPhase.CONNECTION_SUGGESTED -> {
            Text(stringResource(R.string.settings_connection_suggestion))
            Button(onClick = viewModel::adoptConnection, enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().testTag("account_connection_adopt")) {
                Text(stringResource(R.string.settings_connection_review))
            }
        }
        CloudAccountMethodPhase.CONNECTION_TARGET -> {
            if (connection.proved) {
                Button(onClick = { viewModel.previewConnection(emptyList()) }, enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().testTag("account_connection_preview")) {
                    Text(stringResource(R.string.settings_connection_review))
                }
            } else {
                Text(stringResource(R.string.settings_connection_prove_target))
                available.forEach { method ->
                    CloudSignInMethodButton(method, null, state.busy, {
                        when (method) {
                            CloudSignInMethod.GOOGLE -> launchProvider(CloudSocialProvider.GOOGLE)
                            CloudSignInMethod.EMAIL -> emailForm = true
                            CloudSignInMethod.APPLE -> launchProvider(CloudSocialProvider.APPLE)
                        }
                    })
                }
                if (emailForm) {
                    OutlinedTextField(value = state.email, onValueChange = viewModel::email, enabled = !state.busy,
                        label = { Text(stringResource(R.string.settings_connection_target_email)) },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("account_connection_email"))
                    Button(onClick = viewModel::sendConnectionEmail, enabled = !state.busy && state.email.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().testTag("account_connection_send")) {
                        Text(stringResource(R.string.settings_sign_in_send_code_button))
                    }
                }
            }
        }
        CloudAccountMethodPhase.EMAIL_CODE -> {
            Text(stringResource(R.string.settings_connection_code_destination, requireNotNull(pending.mailboxEmail)))
            OutlinedTextField(value = state.code, onValueChange = viewModel::code, enabled = !state.busy,
                label = { Text(stringResource(R.string.settings_auth_mailbox_code)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("account_connection_code"))
            Button(onClick = viewModel::verifyCode, enabled = !state.busy && state.code.length in 6..8,
                modifier = Modifier.fillMaxWidth().testTag("account_connection_verify")) {
                Text(stringResource(R.string.settings_sign_in_verify_button))
            }
        }
        CloudAccountMethodPhase.PROVIDER -> Text(stringResource(R.string.settings_auth_browser_waiting))
        CloudAccountMethodPhase.CONNECTION_PREVIEW, CloudAccountMethodPhase.CONNECTION_CONFIRMING -> {
            val preview = requireNotNull(connection.preview)
            var requestedOmissions by remember(preview) { mutableStateOf(preview.omittedWorkspaceIds.toSet()) }
            val choicesChanged = requestedOmissions != preview.omittedWorkspaceIds.toSet()
            val selected = pending.retainedWorkspaceId?.takeIf { it in preview.workspaceIds } ?: preview.selectedWorkspaceId
            val destination = preview.workspaces.single { it.id == selected }.name
            Text(stringResource(R.string.settings_connection_destination, destination), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(R.string.settings_connection_consequences))
            preview.workspaces.forEach { workspace ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(workspace.name, style = MaterialTheme.typography.titleSmall)
                        Text(stringResource(if (workspace.id in preview.suppressedWorkspaceIds)
                            R.string.settings_connection_suppressed else R.string.settings_connection_retained))
                        if (workspace.id in preview.omissionCandidateWorkspaceIds && workspace.id != pending.retainedWorkspaceId) {
                            val checked = workspace.id in requestedOmissions
                            Row(modifier = Modifier.fillMaxWidth().testTag("account_connection_omit_${workspace.id}")
                                .toggleable(value = checked, role = Role.Checkbox,
                                    enabled = !state.busy && !state.restartRequired &&
                                        pending.phase == CloudAccountMethodPhase.CONNECTION_PREVIEW,
                                    onValueChange = { omit -> requestedOmissions = if (omit)
                                        requestedOmissions + workspace.id else requestedOmissions - workspace.id }),
                                verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(checked = checked, onCheckedChange = null,
                                    enabled = !state.busy && !state.restartRequired &&
                                        pending.phase == CloudAccountMethodPhase.CONNECTION_PREVIEW)
                                Text(stringResource(R.string.settings_connection_optional_omission))
                            }
                        }
                    }
                }
            }
            Text(stringResource(R.string.settings_connection_backing_rows))
            if (choicesChanged) {
                OutlinedButton(onClick = { viewModel.previewConnection(requestedOmissions.toList()) },
                    enabled = !state.busy && !state.restartRequired &&
                        pending.phase == CloudAccountMethodPhase.CONNECTION_PREVIEW,
                    modifier = Modifier.fillMaxWidth().testTag("account_connection_review_choices")) {
                    Text(stringResource(R.string.settings_connection_review_choices))
                }
            }
            if (pending.phase == CloudAccountMethodPhase.CONNECTION_CONFIRMING)
                Text(stringResource(R.string.settings_connection_confirm_uncertain))
            Button(onClick = viewModel::confirmConnection, enabled = !state.busy && !state.restartRequired && !choicesChanged,
                modifier = Modifier.fillMaxWidth().testTag("account_connection_confirm")) {
                Text(stringResource(if (pending.phase == CloudAccountMethodPhase.CONNECTION_CONFIRMING)
                    R.string.settings_connection_replay else R.string.settings_connection_confirm))
            }
        }
        CloudAccountMethodPhase.CONNECTED -> Text(stringResource(R.string.settings_connection_connected),
            modifier = Modifier.testTag("account_connection_connected"))
        CloudAccountMethodPhase.ALREADY_CONNECTED -> Text(stringResource(R.string.settings_connection_already),
            modifier = Modifier.testTag("account_connection_already"))
        CloudAccountMethodPhase.SUBMITTING -> {
            Text(stringResource(R.string.settings_connection_interrupted))
            OutlinedButton(onClick = viewModel::loadConnection, enabled = !state.busy,
                modifier = Modifier.fillMaxWidth().testTag("account_connection_load")) {
                Text(stringResource(R.string.settings_methods_refresh))
            }
        }
        else -> Text(stringResource(R.string.settings_connection_restart))
    }
}
