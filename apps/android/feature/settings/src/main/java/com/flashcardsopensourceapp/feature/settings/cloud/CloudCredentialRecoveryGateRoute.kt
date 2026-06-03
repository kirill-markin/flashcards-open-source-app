package com.flashcardsopensourceapp.feature.settings.cloud

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryReason
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.feature.settings.R

const val cloudCredentialRecoveryGateTag: String = "cloud_credential_recovery_gate"
const val cloudCredentialRecoveryGateSignInButtonTag: String =
    "cloud_credential_recovery_gate_sign_in_button"
const val cloudCredentialRecoveryGateEraseButtonTag: String =
    "cloud_credential_recovery_gate_erase_button"
const val cloudCredentialRecoveryGateEraseDialogTag: String =
    "cloud_credential_recovery_gate_erase_dialog"
const val cloudCredentialRecoveryGateConfirmEraseButtonTag: String =
    "cloud_credential_recovery_gate_confirm_erase_button"

enum class CloudCredentialRecoveryGateStep {
    OVERVIEW,
    EMAIL,
    CODE,
    POST_AUTH
}

@Composable
fun CloudCredentialRecoveryGateRoute(
    recoveryState: CloudCredentialRecoveryState,
    isRecoveryStateActive: Boolean,
    step: CloudCredentialRecoveryGateStep,
    signInUiState: CloudSignInUiState,
    postAuthUiState: CloudPostAuthUiState,
    isEraseConfirmationVisible: Boolean,
    isErasing: Boolean,
    eraseErrorMessage: String,
    onSignIn: () -> Unit,
    onEmailChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onCodeChange: (String) -> Unit,
    onVerifyCode: () -> Unit,
    onAutoContinue: () -> Unit,
    onSelectWorkspace: (CloudWorkspaceLinkSelection) -> Unit,
    onRetryPostAuth: () -> Unit,
    onBackToOverview: () -> Unit,
    onBackToEmail: () -> Unit,
    onRequestEraseConfirmation: () -> Unit,
    onDismissEraseConfirmation: () -> Unit,
    onConfirmErase: () -> Unit
) {
    BackHandler(enabled = true) {
        if (isEraseConfirmationVisible) {
            if (isErasing.not()) {
                onDismissEraseConfirmation()
            }
            return@BackHandler
        }
        when (step) {
            CloudCredentialRecoveryGateStep.OVERVIEW -> Unit
            CloudCredentialRecoveryGateStep.EMAIL -> {
                if (signInUiState.isSendingCode.not()) {
                    onBackToOverview()
                }
            }
            CloudCredentialRecoveryGateStep.CODE -> {
                if (signInUiState.isVerifyingCode.not()) {
                    onBackToEmail()
                }
            }
            CloudCredentialRecoveryGateStep.POST_AUTH -> {
                if (
                    isRecoveryStateActive &&
                    postAuthUiState.mode != CloudPostAuthMode.PROCESSING &&
                    postAuthUiState.mode != CloudPostAuthMode.READY_TO_AUTO_LINK
                ) {
                    onBackToOverview()
                }
            }
        }
    }

    when (step) {
        CloudCredentialRecoveryGateStep.OVERVIEW -> {
            CloudCredentialRecoveryGateOverview(
                recoveryState = recoveryState,
                isErasing = isErasing,
                eraseErrorMessage = eraseErrorMessage,
                onSignIn = onSignIn,
                onRequestEraseConfirmation = onRequestEraseConfirmation
            )
        }

        CloudCredentialRecoveryGateStep.EMAIL -> {
            CloudSignInEmailRoute(
                uiState = signInUiState,
                onEmailChange = onEmailChange,
                onSendCode = onSendCode,
                onBack = onBackToOverview
            )
        }

        CloudCredentialRecoveryGateStep.CODE -> {
            CloudSignInCodeRoute(
                uiState = signInUiState,
                onCodeChange = onCodeChange,
                onVerifyCode = onVerifyCode,
                onBack = onBackToEmail
            )
        }

        CloudCredentialRecoveryGateStep.POST_AUTH -> {
            val gatePostAuthUiState = if (
                recoveryState.reason == CloudCredentialRecoveryReason.INVALID_STORED_STATE &&
                postAuthUiState.mode == CloudPostAuthMode.FAILED
            ) {
                postAuthUiState.copy(
                    errorMessage = stringResource(
                        R.string.settings_cloud_recovery_gate_invalid_recovery_sign_in_failed
                    ),
                    canLogout = false
                )
            } else {
                postAuthUiState.copy(canLogout = false)
            }
            CloudPostAuthRoute(
                uiState = gatePostAuthUiState,
                onAutoContinue = onAutoContinue,
                onSelectWorkspace = onSelectWorkspace,
                onRetry = onRetryPostAuth,
                onFailureAction = {},
                onBack = onBackToOverview,
                canNavigateBack = isRecoveryStateActive
            )
        }
    }

    if (isEraseConfirmationVisible) {
        CloudCredentialRecoveryEraseConfirmationDialog(
            isErasing = isErasing,
            eraseErrorMessage = eraseErrorMessage,
            onDismiss = onDismissEraseConfirmation,
            onConfirm = onConfirmErase
        )
    }
}

@Composable
private fun CloudCredentialRecoveryGateOverview(
    recoveryState: CloudCredentialRecoveryState,
    isErasing: Boolean,
    eraseErrorMessage: String,
    onSignIn: () -> Unit,
    onRequestEraseConfirmation: () -> Unit
) {
    Scaffold(
        modifier = Modifier.testTag(tag = cloudCredentialRecoveryGateTag)
    ) { innerPadding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                top = innerPadding.calculateTopPadding() + 24.dp,
                end = 16.dp,
                bottom = innerPadding.calculateBottomPadding() + 24.dp
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize()
        ) {
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        modifier = Modifier.padding(20.dp)
                    ) {
                        Text(
                            text = stringResource(
                                id = cloudCredentialRecoveryGateTitleResId(
                                    reason = recoveryState.reason
                                )
                            ),
                            style = MaterialTheme.typography.headlineSmall
                        )
                        Text(
                            text = stringResource(
                                id = cloudCredentialRecoveryGateBodyResId(
                                    reason = recoveryState.reason
                                )
                            ),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            if (eraseErrorMessage.isNotEmpty()) {
                item {
                    CloudSignInErrorCard(
                        message = eraseErrorMessage,
                        technicalDetails = null,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            }

            item {
                Button(
                    onClick = onSignIn,
                    enabled = isErasing.not(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = cloudCredentialRecoveryGateSignInButtonTag)
                ) {
                    Text(stringResource(R.string.settings_cloud_recovery_gate_sign_in_button))
                }
            }

            item {
                OutlinedButton(
                    onClick = onRequestEraseConfirmation,
                    enabled = isErasing.not(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = cloudCredentialRecoveryGateEraseButtonTag)
                ) {
                    Text(stringResource(R.string.settings_cloud_recovery_gate_erase_button))
                }
            }
        }
    }
}

@Composable
private fun CloudCredentialRecoveryEraseConfirmationDialog(
    isErasing: Boolean,
    eraseErrorMessage: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    AlertDialog(
        onDismissRequest = {
            if (isErasing.not()) {
                onDismiss()
            }
        },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                enabled = isErasing.not(),
                colors = ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                ),
                modifier = Modifier.testTag(tag = cloudCredentialRecoveryGateConfirmEraseButtonTag)
            ) {
                Text(
                    if (isErasing) {
                        stringResource(R.string.settings_cloud_recovery_gate_erasing)
                    } else {
                        stringResource(R.string.settings_cloud_recovery_gate_erase_button)
                    }
                )
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = isErasing.not()
            ) {
                Text(stringResource(R.string.settings_cancel))
            }
        },
        title = {
            Text(stringResource(R.string.settings_cloud_recovery_gate_erase_dialog_title))
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(R.string.settings_cloud_recovery_gate_erase_dialog_body))
                if (isErasing) {
                    CircularProgressIndicator()
                }
                if (eraseErrorMessage.isNotEmpty()) {
                    Text(
                        text = eraseErrorMessage,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        },
        modifier = Modifier.testTag(tag = cloudCredentialRecoveryGateEraseDialogTag)
    )
}

private fun cloudCredentialRecoveryGateTitleResId(reason: CloudCredentialRecoveryReason): Int {
    return when (reason) {
        CloudCredentialRecoveryReason.GUEST_SESSION_MISSING -> {
            R.string.settings_cloud_recovery_gate_guest_session_missing_title
        }
        CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING -> {
            R.string.settings_cloud_recovery_gate_linked_credentials_missing_title
        }
        CloudCredentialRecoveryReason.INVALID_STORED_STATE -> {
            R.string.settings_cloud_recovery_gate_invalid_stored_state_title
        }
    }
}

private fun cloudCredentialRecoveryGateBodyResId(reason: CloudCredentialRecoveryReason): Int {
    return when (reason) {
        CloudCredentialRecoveryReason.GUEST_SESSION_MISSING -> {
            R.string.settings_cloud_recovery_gate_guest_session_missing_body
        }
        CloudCredentialRecoveryReason.LINKED_CREDENTIALS_MISSING -> {
            R.string.settings_cloud_recovery_gate_linked_credentials_missing_body
        }
        CloudCredentialRecoveryReason.INVALID_STORED_STATE -> {
            R.string.settings_cloud_recovery_gate_invalid_stored_state_body
        }
    }
}
