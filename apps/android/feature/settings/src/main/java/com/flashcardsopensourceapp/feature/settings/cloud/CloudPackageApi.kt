package com.flashcardsopensourceapp.feature.settings.cloud

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModelProvider
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.feature.settings.cloud.credentialRecovery.CloudCredentialRecoveryGateRoute as CloudCredentialRecoveryGateRouteImpl
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthRoute as CloudPostAuthRouteImpl
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInCodeRoute as CloudSignInCodeRouteImpl
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInEmailRoute as CloudSignInEmailRouteImpl
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInErrorCard as CloudSignInErrorCardImpl

typealias CloudCredentialRecoveryGateStep =
    com.flashcardsopensourceapp.feature.settings.cloud.credentialRecovery.CloudCredentialRecoveryGateStep
typealias CloudPostAuthMode = com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthMode
typealias CloudPostAuthUiState = com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthUiState
typealias CloudSendCodeNavigationOutcome =
    com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSendCodeNavigationOutcome
typealias CloudSignInUiState = com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInUiState
typealias CloudSignInViewModel = com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSignInViewModel

const val cloudCredentialRecoveryGateTag: String = "cloud_credential_recovery_gate"
const val cloudCredentialRecoveryGateSignInButtonTag: String =
    "cloud_credential_recovery_gate_sign_in_button"
const val cloudCredentialRecoveryGateEraseButtonTag: String =
    "cloud_credential_recovery_gate_erase_button"
const val cloudCredentialRecoveryGateEraseDialogTag: String =
    "cloud_credential_recovery_gate_erase_dialog"
const val cloudCredentialRecoveryGateConfirmEraseButtonTag: String =
    "cloud_credential_recovery_gate_confirm_erase_button"

const val cloudPostAuthExistingButtonTagPrefix: String = "cloud_post_auth_existing_button:"
const val cloudPostAuthWorkspaceRowTag: String = "cloud_post_auth_workspace_row"
const val cloudPostAuthSelectedIndicatorTagPrefix: String =
    "cloud_post_auth_selected_indicator:"

const val cloudSignInEmailFieldTag: String = "cloud_sign_in_email_field"
const val cloudSignInSendCodeButtonTag: String = "cloud_sign_in_send_code_button"

fun cloudPostAuthExistingButtonTag(workspaceId: String): String {
    return com.flashcardsopensourceapp.feature.settings.cloud.postAuth.cloudPostAuthExistingButtonTag(
        workspaceId = workspaceId
    )
}

fun cloudPostAuthSelectedIndicatorTag(workspaceId: String): String {
    return com.flashcardsopensourceapp.feature.settings.cloud.postAuth.cloudPostAuthSelectedIndicatorTag(
        workspaceId = workspaceId
    )
}

@Composable
fun CloudSignInEmailRoute(
    uiState: CloudSignInUiState,
    onEmailChange: (String) -> Unit,
    onSendCode: () -> Unit,
    onBack: () -> Unit
) {
    CloudSignInEmailRouteImpl(
        uiState = uiState,
        onEmailChange = onEmailChange,
        onSendCode = onSendCode,
        onBack = onBack
    )
}

@Composable
fun CloudSignInCodeRoute(
    uiState: CloudSignInUiState,
    onCodeChange: (String) -> Unit,
    onVerifyCode: () -> Unit,
    onBack: () -> Unit
) {
    CloudSignInCodeRouteImpl(
        uiState = uiState,
        onCodeChange = onCodeChange,
        onVerifyCode = onVerifyCode,
        onBack = onBack
    )
}

@Composable
fun CloudSignInErrorCard(
    message: String,
    technicalDetails: String?,
    modifier: Modifier
) {
    CloudSignInErrorCardImpl(
        message = message,
        technicalDetails = technicalDetails,
        modifier = modifier
    )
}

@Composable
fun CloudPostAuthRoute(
    uiState: CloudPostAuthUiState,
    onAutoContinue: () -> Unit,
    onSelectWorkspace: (CloudWorkspaceLinkSelection) -> Unit,
    onRetry: () -> Unit,
    onFailureAction: () -> Unit,
    onBack: () -> Unit,
    canNavigateBack: Boolean
) {
    CloudPostAuthRouteImpl(
        uiState = uiState,
        onAutoContinue = onAutoContinue,
        onSelectWorkspace = onSelectWorkspace,
        onRetry = onRetry,
        onFailureAction = onFailureAction,
        onBack = onBack,
        canNavigateBack = canNavigateBack
    )
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
    CloudCredentialRecoveryGateRouteImpl(
        recoveryState = recoveryState,
        isRecoveryStateActive = isRecoveryStateActive,
        step = step,
        signInUiState = signInUiState,
        postAuthUiState = postAuthUiState,
        isEraseConfirmationVisible = isEraseConfirmationVisible,
        isErasing = isErasing,
        eraseErrorMessage = eraseErrorMessage,
        onSignIn = onSignIn,
        onEmailChange = onEmailChange,
        onSendCode = onSendCode,
        onCodeChange = onCodeChange,
        onVerifyCode = onVerifyCode,
        onAutoContinue = onAutoContinue,
        onSelectWorkspace = onSelectWorkspace,
        onRetryPostAuth = onRetryPostAuth,
        onBackToOverview = onBackToOverview,
        onBackToEmail = onBackToEmail,
        onRequestEraseConfirmation = onRequestEraseConfirmation,
        onDismissEraseConfirmation = onDismissEraseConfirmation,
        onConfirmErase = onConfirmErase
    )
}

fun createCloudSignInViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return com.flashcardsopensourceapp.feature.settings.cloud.signIn.createCloudSignInViewModelFactory(
        cloudAccountRepository = cloudAccountRepository,
        syncRepository = syncRepository,
        messageController = messageController,
        applicationContext = applicationContext
    )
}
