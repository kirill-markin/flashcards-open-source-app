package com.flashcardsopensourceapp.app

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.flashcardsopensourceapp.app.di.AppGraph
import com.flashcardsopensourceapp.core.ui.nextAppTechnicalErrorReportId
import com.flashcardsopensourceapp.core.ui.renderTechnicalErrorDetails
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.feature.settings.cloud.CloudCredentialRecoveryGateRoute
import com.flashcardsopensourceapp.feature.settings.cloud.CloudCredentialRecoveryGateStep
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthUiState
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInUiState
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInViewModel
import com.flashcardsopensourceapp.feature.settings.cloud.createCloudSignInViewModelFactory
import com.flashcardsopensourceapp.feature.settings.cloud.signIn.CloudSendCodeNavigationOutcome
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

@Composable
internal fun CloudCredentialRecoveryGateContainer(
    appGraph: AppGraph,
    recoveryState: CloudCredentialRecoveryState,
    isRecoveryStateActive: Boolean,
    onRecoveryGateFinished: () -> Unit
) {
    val context: Context = LocalContext.current
    val coroutineScope: CoroutineScope = rememberCoroutineScope()
    val eraseFailedMessage: String = stringResource(
        SettingsR.string.settings_cloud_recovery_gate_erase_failed
    )
    val technicalErrorDialogTitle: String = stringResource(
        R.string.technical_error_dialog_default_title
    )
    val technicalErrorDialogMessage: String = stringResource(
        R.string.technical_error_dialog_default_message
    )
    val signInViewModel: CloudSignInViewModel = viewModel(
        viewModelStoreOwner = appGraph.cloudCredentialRecoveryGateViewModelStoreOwner,
        key = "cloud_credential_recovery_sign_in",
        factory = createCloudSignInViewModelFactory(
            cloudAccountRepository = appGraph.cloudAccountRepository,
            syncRepository = appGraph.syncRepository,
            messageController = appGraph.appMessageBus,
            applicationContext = context.applicationContext
        )
    )
    val signInUiState: CloudSignInUiState by signInViewModel.uiState.collectAsStateWithLifecycle()
    val postAuthUiState: CloudPostAuthUiState by signInViewModel.postAuthUiState.collectAsStateWithLifecycle()
    var gateStep: CloudCredentialRecoveryGateStep by rememberSaveable {
        mutableStateOf(CloudCredentialRecoveryGateStep.OVERVIEW)
    }
    var isEraseConfirmationVisible: Boolean by rememberSaveable {
        mutableStateOf(false)
    }
    var isErasing: Boolean by rememberSaveable {
        mutableStateOf(false)
    }
    var eraseErrorMessage: String by rememberSaveable {
        mutableStateOf("")
    }
    var eraseErrorTechnicalDetails: String? by rememberSaveable {
        mutableStateOf(null)
    }
    var eraseErrorTechnicalDetailsReportId: String? by rememberSaveable {
        mutableStateOf(null)
    }

    LaunchedEffect(recoveryState) {
        gateStep = CloudCredentialRecoveryGateStep.OVERVIEW
        isEraseConfirmationVisible = false
        isErasing = false
        eraseErrorMessage = ""
        eraseErrorTechnicalDetails = null
        eraseErrorTechnicalDetailsReportId = null
        signInViewModel.cancelSignIn()
    }

    LaunchedEffect(postAuthUiState.completionToken) {
        if (postAuthUiState.completionToken != null) {
            onRecoveryGateFinished()
            signInViewModel.acknowledgePostAuthCompletion()
        }
    }

    fun returnToOverview() {
        signInViewModel.cancelSignIn()
        gateStep = CloudCredentialRecoveryGateStep.OVERVIEW
    }

    CloudCredentialRecoveryGateRoute(
        recoveryState = recoveryState,
        isRecoveryStateActive = isRecoveryStateActive,
        step = gateStep,
        signInUiState = signInUiState,
        postAuthUiState = postAuthUiState,
        isEraseConfirmationVisible = isEraseConfirmationVisible,
        isErasing = isErasing,
        eraseErrorMessage = eraseErrorMessage,
        eraseErrorTechnicalDetails = eraseErrorTechnicalDetails,
        eraseErrorTechnicalDetailsReportId = eraseErrorTechnicalDetailsReportId,
        onSignIn = {
            signInViewModel.cancelSignIn()
            eraseErrorMessage = ""
            eraseErrorTechnicalDetails = null
            eraseErrorTechnicalDetailsReportId = null
            isEraseConfirmationVisible = false
            gateStep = CloudCredentialRecoveryGateStep.EMAIL
        },
        onEmailChange = signInViewModel::updateEmail,
        onSendCode = {
            coroutineScope.launch {
                when (signInViewModel.sendCode()) {
                    CloudSendCodeNavigationOutcome.OtpRequired -> {
                        gateStep = CloudCredentialRecoveryGateStep.CODE
                    }
                    CloudSendCodeNavigationOutcome.Verified -> {
                        gateStep = CloudCredentialRecoveryGateStep.POST_AUTH
                    }
                    CloudSendCodeNavigationOutcome.NoNavigation -> Unit
                }
            }
        },
        onCodeChange = signInViewModel::updateCode,
        onVerifyCode = {
            coroutineScope.launch {
                if (signInViewModel.verifyCode()) {
                    gateStep = CloudCredentialRecoveryGateStep.POST_AUTH
                }
            }
        },
        onAutoContinue = {
            signInViewModel.startCompletePendingPostAuthIfNeeded()
        },
        onSelectWorkspace = { selection ->
            signInViewModel.startSelectPostAuthWorkspace(selection = selection)
        },
        onRetryPostAuth = {
            signInViewModel.startRetryPostAuth()
        },
        onBackToOverview = {
            returnToOverview()
        },
        onBackToEmail = {
            gateStep = CloudCredentialRecoveryGateStep.EMAIL
        },
        onShowTechnicalDetails = { technicalDetails, reportId ->
            appGraph.showTechnicalErrorDialog(
                reportId = reportId,
                title = technicalErrorDialogTitle,
                message = technicalErrorDialogMessage,
                technicalDetails = technicalDetails
            )
        },
        onRequestEraseConfirmation = {
            eraseErrorMessage = ""
            eraseErrorTechnicalDetails = null
            eraseErrorTechnicalDetailsReportId = null
            isEraseConfirmationVisible = true
        },
        onDismissEraseConfirmation = {
            if (isErasing.not()) {
                isEraseConfirmationVisible = false
            }
        },
        onConfirmErase = {
            coroutineScope.launch {
                isErasing = true
                eraseErrorMessage = ""
                eraseErrorTechnicalDetails = null
                eraseErrorTechnicalDetailsReportId = null
                try {
                    appGraph.cloudAccountRepository.eraseLocalDataForCredentialRecovery()
                    signInViewModel.cancelSignIn()
                    isEraseConfirmationVisible = false
                    onRecoveryGateFinished()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    eraseErrorMessage = eraseFailedMessage
                    eraseErrorTechnicalDetails = renderTechnicalErrorDetails(error = error)
                    eraseErrorTechnicalDetailsReportId = nextAppTechnicalErrorReportId(
                        source = "cloud-credential-recovery-erase"
                    )
                } finally {
                    isErasing = false
                }
            }
        }
    )
}
