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
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryState
import com.flashcardsopensourceapp.feature.settings.cloud.CloudCredentialRecoveryGateRoute
import com.flashcardsopensourceapp.feature.settings.cloud.CloudCredentialRecoveryGateStep
import com.flashcardsopensourceapp.feature.settings.cloud.CloudPostAuthUiState
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSendCodeNavigationOutcome
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInUiState
import com.flashcardsopensourceapp.feature.settings.cloud.CloudSignInViewModel
import com.flashcardsopensourceapp.feature.settings.cloud.createCloudSignInViewModelFactory
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

    LaunchedEffect(recoveryState) {
        gateStep = CloudCredentialRecoveryGateStep.OVERVIEW
        isEraseConfirmationVisible = false
        isErasing = false
        eraseErrorMessage = ""
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
        onSignIn = {
            signInViewModel.cancelSignIn()
            eraseErrorMessage = ""
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
        onRequestEraseConfirmation = {
            eraseErrorMessage = ""
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
                try {
                    appGraph.cloudAccountRepository.eraseLocalDataForCredentialRecovery()
                    signInViewModel.cancelSignIn()
                    isEraseConfirmationVisible = false
                    onRecoveryGateFinished()
                } catch (error: CancellationException) {
                    throw error
                } catch (error: Exception) {
                    eraseErrorMessage = error.message ?: eraseFailedMessage
                } finally {
                    isErasing = false
                }
            }
        }
    )
}
