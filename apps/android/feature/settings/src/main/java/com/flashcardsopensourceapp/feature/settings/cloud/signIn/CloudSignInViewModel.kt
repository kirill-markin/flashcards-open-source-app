package com.flashcardsopensourceapp.feature.settings.cloud.signIn

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.nextAppTechnicalErrorReportId
import com.flashcardsopensourceapp.core.ui.renderTechnicalErrorDetails
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCredentialRecoveryRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.cloud.CloudWorkspacePostAuthRoute
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.buildCloudPostAuthWorkspaceItems
import com.flashcardsopensourceapp.feature.settings.cloud.credentialRecovery.buildCloudPostAuthPendingSelection
import com.flashcardsopensourceapp.feature.settings.cloud.credentialRecovery.cloudPostAuthRecoveryErrorMessage
import com.flashcardsopensourceapp.feature.settings.cloud.credentialRecovery.cloudPostAuthRecoveryExceptionMessage
import com.flashcardsopensourceapp.feature.settings.cloud.workspaceSelectionTitle
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthFailureAction
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthMode
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthRetryAction
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.CloudPostAuthUiState
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.canRunCloudPostAuthFailureAction
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.cloudPostAuthFailureActionLabel
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.completeCloudPostAuthSyncOnly
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.completeCloudPostAuthWorkspaceSelection
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.failCloudPostAuth
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.finishCloudPostAuthSuccess
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.isCloudPostAuthProcessing
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.isInvalidCloudCredentialRecovery
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.prepareCloudPostAuthGuestLocalRecovery
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.prepareCloudPostAuthSyncOnly
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.prepareCloudPostAuthWorkspaceCompletion
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.requiresCloudGuestUpgrade
import com.flashcardsopensourceapp.feature.settings.cloud.postAuth.resolveCloudPostAuthFailureAction
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private val cloudSendCodeUserCorrectableErrorCodes: Set<String> = setOf(
    "INVALID_EMAIL",
    "RATE_LIMITED"
)

private val cloudVerifyCodeUserCorrectableErrorCodes: Set<String> = setOf(
    "OTP_CHALLENGE_CONSUMED",
    "OTP_CODE_INVALID",
    "OTP_SESSION_EXPIRED",
    "OTP_TOO_MANY_ATTEMPTS",
    "OTP_VERIFY_FAILED"
)

class CloudSignInViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = initialCloudSignInDraftState()
    )

    val uiState: StateFlow<CloudSignInUiState> = draftState.mapToStateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        transform = { draft ->
            CloudSignInUiState(
                email = draft.email,
                code = draft.code,
                isGuestUpgrade = draft.linkContext?.guestUpgradeMode != null,
                isSendingCode = draft.isSendingCode,
                isVerifyingCode = draft.isVerifyingCode,
                errorMessage = draft.errorMessage,
                errorTechnicalDetails = draft.errorTechnicalDetails,
                errorTechnicalDetailsReportId = draft.errorTechnicalDetailsReportId,
                challengeEmail = draft.challenge?.email
            )
        },
        initialValue = CloudSignInUiState(
            email = "",
            code = "",
            isGuestUpgrade = false,
            isSendingCode = false,
            isVerifyingCode = false,
            errorMessage = "",
            errorTechnicalDetails = null,
            errorTechnicalDetailsReportId = null,
            challengeEmail = null
        )
    )

    val postAuthUiState: StateFlow<CloudPostAuthUiState> = draftState.mapToStateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        transform = { draft ->
            val isGuestLocalRecovery = draft.linkContext?.postAuthRoute ==
                CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY
            CloudPostAuthUiState(
                mode = when {
                    draft.postAuthErrorMessage.isNotEmpty() -> CloudPostAuthMode.FAILED
                    draft.processingTitle.isNotEmpty() -> CloudPostAuthMode.PROCESSING
                    draft.pendingSelection != null -> CloudPostAuthMode.READY_TO_AUTO_LINK
                    draft.linkContext != null -> CloudPostAuthMode.CHOOSE_WORKSPACE
                    else -> CloudPostAuthMode.IDLE
                },
                verifiedEmail = draft.linkContext?.email,
                isGuestUpgrade = draft.linkContext?.guestUpgradeMode != null,
                isGuestLocalRecovery = isGuestLocalRecovery,
                workspaces = if (isGuestLocalRecovery) {
                    emptyList()
                } else {
                    buildCloudPostAuthWorkspaceItems(
                        preferredWorkspaceId = draft.linkContext?.preferredWorkspaceId,
                        workspaces = draft.linkContext?.workspaces ?: emptyList(),
                        strings = strings,
                        allowCreateNew = draft.linkContext?.postAuthRoute == CloudWorkspacePostAuthRoute.NONE
                    )
                },
                pendingWorkspaceTitle = if (isGuestLocalRecovery) {
                    null
                } else {
                    draft.pendingSelection?.let { selection ->
                        workspaceSelectionTitle(
                            selection = selection,
                            workspaces = draft.linkContext?.workspaces ?: emptyList(),
                            strings = strings
                        )
                    }
                },
                processingTitle = draft.processingTitle,
                processingMessage = draft.processingMessage,
                errorMessage = draft.postAuthErrorMessage,
                errorTechnicalDetails = draft.postAuthErrorTechnicalDetails,
                errorTechnicalDetailsReportId = draft.postAuthErrorTechnicalDetailsReportId,
                canRetry = draft.retryAction != null && draft.postAuthRecoveryBlocked.not(),
                canLogout = canRunCloudPostAuthFailureAction(draft = draft),
                failureActionLabel = cloudPostAuthFailureActionLabel(
                    resetAllowed = draft.postAuthResetAllowed,
                    strings = strings
                ),
                completionToken = draft.completionToken
            )
        },
        initialValue = CloudPostAuthUiState(
            mode = CloudPostAuthMode.IDLE,
            verifiedEmail = null,
            isGuestUpgrade = false,
            isGuestLocalRecovery = false,
            workspaces = emptyList(),
            pendingWorkspaceTitle = null,
            processingTitle = "",
            processingMessage = "",
            errorMessage = "",
            errorTechnicalDetails = null,
            errorTechnicalDetailsReportId = null,
            canRetry = false,
            canLogout = false,
            failureActionLabel = strings.get(R.string.settings_logout),
            completionToken = null
        )
    )

    fun updateEmail(email: String) {
        draftState.update { state ->
            updateCloudSignInEmail(state = state, email = email)
        }
    }

    fun updateCode(code: String) {
        draftState.update { state ->
            updateCloudSignInCode(state = state, code = code)
        }
    }

    private fun nextAuthAttemptId(state: CloudSignInDraftState): Long {
        return nextCloudAuthAttemptId(state = state)
    }

    private fun technicalDetailsReportIdFor(
        source: String,
        technicalDetails: String?
    ): String? {
        if (technicalDetails.isNullOrBlank()) {
            return null
        }
        return nextAppTechnicalErrorReportId(source = source)
    }

    private fun CloudSignInErrorPresentation.withTechnicalDetailsReportId(
        source: String
    ): CloudSignInErrorPresentation {
        return copy(
            technicalDetailsReportId = technicalDetailsReportIdFor(
                source = source,
                technicalDetails = technicalDetails
            )
        )
    }

    private fun isCurrentAuthAttempt(authAttemptId: Long): Boolean {
        return draftState.value.authAttemptId == authAttemptId
    }

    private fun publishVerifiedLinkContext(
        authAttemptId: Long,
        linkContext: CloudWorkspaceLinkContext,
        isSendingCode: Boolean,
        isVerifyingCode: Boolean
    ): Boolean {
        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return false
        }

        val pendingSelection = buildCloudPostAuthPendingSelection(linkContext = linkContext)
        val recoveryErrorMessage = cloudPostAuthRecoveryErrorMessage(
            linkContext = linkContext,
            pendingSelection = pendingSelection,
            strings = strings
        )
        draftState.update { state ->
            publishCloudVerifiedLinkContext(
                state = state,
                authAttemptId = authAttemptId,
                linkContext = linkContext,
                pendingSelection = pendingSelection,
                recoveryErrorMessage = recoveryErrorMessage,
                isSendingCode = isSendingCode,
                isVerifyingCode = isVerifyingCode
            )
        }
        return true
    }

    suspend fun sendCode(): CloudSendCodeNavigationOutcome {
        val authAttemptId = nextAuthAttemptId(draftState.value)
        draftState.update { state ->
            startCloudSendCodeAttempt(state = state, authAttemptId = authAttemptId)
        }
        return try {
            when (val result = cloudAccountRepository.sendCode(draftState.value.email)) {
                is CloudSendCodeResult.OtpRequired -> {
                    if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                        return CloudSendCodeNavigationOutcome.NoNavigation
                    }
                    draftState.update { state ->
                        acceptCloudOtpChallenge(
                            state = state,
                            authAttemptId = authAttemptId,
                            challenge = result.challenge
                        )
                    }
                    CloudSendCodeNavigationOutcome.OtpRequired
                }

                is CloudSendCodeResult.Verified -> {
                    val linkContext = cloudAccountRepository.prepareVerifiedSignIn(result.credentials)
                    val didPublish = publishVerifiedLinkContext(
                        authAttemptId = authAttemptId,
                        linkContext = linkContext,
                        isSendingCode = false,
                        isVerifyingCode = false
                    )
                    if (didPublish) {
                        CloudSendCodeNavigationOutcome.Verified
                    } else {
                        CloudSendCodeNavigationOutcome.NoNavigation
                    }
                }
            }
        } catch (error: CancellationException) {
            draftState.update { state ->
                cancelCloudSendCodeAttempt(state = state, authAttemptId = authAttemptId)
            }
            throw error
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return CloudSendCodeNavigationOutcome.NoNavigation
            }
            val errorPresentation = createSendCodeErrorPresentation(
                error = error,
                strings = strings
            ).withTechnicalDetailsReportId(source = "cloud-sign-in-send-code")
            draftState.update { state ->
                failCloudSendCode(
                    state = state,
                    authAttemptId = authAttemptId,
                    errorPresentation = errorPresentation
                )
            }
            CloudSendCodeNavigationOutcome.NoNavigation
        }
    }

    suspend fun verifyCode(): Boolean {
        val challenge = requireNotNull(draftState.value.challenge) {
            strings.get(R.string.settings_sign_in_request_code_first)
        }
        val authAttemptId = nextAuthAttemptId(draftState.value)
        draftState.update { state ->
            startCloudVerifyCodeAttempt(state = state, authAttemptId = authAttemptId)
        }
        return try {
            val linkContext = cloudAccountRepository.verifyCode(
                challenge = challenge,
                code = draftState.value.code
            )
            publishVerifiedLinkContext(
                authAttemptId = authAttemptId,
                linkContext = linkContext,
                isSendingCode = false,
                isVerifyingCode = false
            )
        } catch (error: CancellationException) {
            draftState.update { state ->
                cancelCloudVerifyCodeAttempt(state = state, authAttemptId = authAttemptId)
            }
            throw error
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return false
            }
            val errorPresentation = createVerifyCodeErrorPresentation(
                error = error,
                strings = strings
            ).withTechnicalDetailsReportId(source = "cloud-sign-in-verify-code")
            draftState.update { state ->
                failCloudVerifyCode(
                    state = state,
                    authAttemptId = authAttemptId,
                    errorPresentation = errorPresentation
                )
            }
            false
        }
    }

    suspend fun completePendingPostAuthIfNeeded() {
        val state = draftState.value
        val selection = state.pendingSelection ?: return
        val linkContext = state.linkContext ?: return
        if (isCloudPostAuthProcessing(state = state) || state.postAuthErrorMessage.isNotEmpty()) {
            return
        }
        completePostAuth(
            authAttemptId = state.authAttemptId,
            linkContext = linkContext,
            selection = selection
        )
    }

    fun startCompletePendingPostAuthIfNeeded() {
        viewModelScope.launch {
            completePendingPostAuthIfNeeded()
        }
    }

    suspend fun selectPostAuthWorkspace(selection: CloudWorkspaceLinkSelection) {
        val state = draftState.value
        val linkContext = state.linkContext ?: return
        completePostAuth(
            authAttemptId = state.authAttemptId,
            linkContext = linkContext,
            selection = selection
        )
    }

    fun startSelectPostAuthWorkspace(selection: CloudWorkspaceLinkSelection) {
        viewModelScope.launch {
            selectPostAuthWorkspace(selection = selection)
        }
    }

    suspend fun retryPostAuth() {
        val currentAttemptId = draftState.value.authAttemptId
        when (val retryAction = draftState.value.retryAction) {
            null -> Unit
            is CloudPostAuthRetryAction.CompleteCloudLink -> {
                if (retryAction.authAttemptId != currentAttemptId) {
                    return
                }
                completePostAuth(
                    authAttemptId = retryAction.authAttemptId,
                    linkContext = retryAction.linkContext,
                    selection = retryAction.selection
                )
            }
            is CloudPostAuthRetryAction.CompleteGuestUpgrade -> {
                if (retryAction.authAttemptId != currentAttemptId) {
                    return
                }
                completePostAuth(
                    authAttemptId = retryAction.authAttemptId,
                    linkContext = retryAction.linkContext,
                    selection = retryAction.selection
                )
            }
            is CloudPostAuthRetryAction.CompleteGuestLocalRecovery -> {
                if (retryAction.authAttemptId != currentAttemptId) {
                    return
                }
                completeGuestLocalRecovery(
                    authAttemptId = retryAction.authAttemptId,
                    linkContext = retryAction.linkContext
                )
            }
            is CloudPostAuthRetryAction.SyncOnly -> {
                if (retryAction.authAttemptId != currentAttemptId) {
                    return
                }
                runPostAuthSyncOnly(
                    authAttemptId = retryAction.authAttemptId,
                    workspaceTitle = retryAction.workspaceTitle
                )
            }
        }
    }

    fun startRetryPostAuth() {
        viewModelScope.launch {
            retryPostAuth()
        }
    }

    suspend fun runPostAuthFailureAction() {
        when (resolveCloudPostAuthFailureAction(draft = draftState.value) ?: return) {
            CloudPostAuthFailureAction.RESET_INVALID_RECOVERY -> {
                cloudAccountRepository.resetInvalidCloudCredentialRecoveryState()
                clearPostAuthState()
                messageController.showMessage(
                    message = strings.get(R.string.settings_post_auth_invalid_recovery_state_cleared_message)
                )
            }

            CloudPostAuthFailureAction.LOGOUT -> {
                cloudAccountRepository.logout()
                clearPostAuthState()
                messageController.showMessage(
                    message = strings.get(R.string.settings_sign_in_cancelled_message)
                )
            }
        }
    }

    fun cancelSignIn() {
        clearPostAuthState()
    }

    fun acknowledgePostAuthCompletion() {
        draftState.update { state ->
            acknowledgeCloudPostAuthCompletion(state = state)
        }
    }

    private suspend fun completePostAuth(
        authAttemptId: Long,
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) {
        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        if (isCloudPostAuthProcessing(state = draftState.value)) {
            return
        }

        if (linkContext.postAuthRoute == CloudWorkspacePostAuthRoute.GUEST_LOCAL_RECOVERY) {
            require(selection == CloudWorkspaceLinkSelection.CreateNew) {
                "Guest local recovery must create the recovered linked workspace."
            }
            completeGuestLocalRecovery(
                authAttemptId = authAttemptId,
                linkContext = linkContext
            )
            return
        }

        draftState.update { state ->
            prepareCloudPostAuthWorkspaceCompletion(
                state = state,
                authAttemptId = authAttemptId,
                linkContext = linkContext,
                selection = selection,
                strings = strings
            )
        }

        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        try {
            val completion = completeCloudPostAuthWorkspaceSelection(
                cloudAccountRepository = cloudAccountRepository,
                linkContext = linkContext,
                selection = selection
            )
            if (completion.requiresInitialSync) {
                runPostAuthSyncOnly(
                    authAttemptId = authAttemptId,
                    workspaceTitle = completion.workspaceTitle
                )
            } else {
                finishPostAuthSuccess(
                    authAttemptId = authAttemptId,
                    workspaceTitle = completion.workspaceTitle
                )
            }
        } catch (error: CancellationException) {
            failPostAuthCancellationIfStillProcessing(
                authAttemptId = authAttemptId,
                errorMessage = if (requiresCloudGuestUpgrade(linkContext = linkContext)) {
                    strings.get(R.string.settings_post_auth_guest_upgrade_failed)
                } else {
                    strings.get(R.string.settings_post_auth_setup_failed)
                }
            )
            throw error
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return
            }
            val recoveryError = error as? CloudCredentialRecoveryRequiredException
            val errorPresentation = if (recoveryError != null) {
                CloudPostAuthErrorPresentation(
                    message = cloudPostAuthRecoveryExceptionMessage(error = recoveryError, strings = strings),
                    technicalDetails = null,
                    technicalDetailsReportId = null
                )
            } else {
                val technicalDetails = technicalDetailsFor(error = error)
                CloudPostAuthErrorPresentation(
                    message = if (requiresCloudGuestUpgrade(linkContext = linkContext)) {
                        strings.get(R.string.settings_post_auth_guest_upgrade_failed)
                    } else {
                        strings.get(R.string.settings_post_auth_setup_failed)
                    },
                    technicalDetails = technicalDetails,
                    technicalDetailsReportId = technicalDetailsReportIdFor(
                        source = "cloud-post-auth-complete",
                        technicalDetails = technicalDetails
                    )
                )
            }
            draftState.update { state ->
                failCloudPostAuth(
                    state = state,
                    authAttemptId = authAttemptId,
                    errorMessage = errorPresentation.message,
                    errorTechnicalDetails = errorPresentation.technicalDetails,
                    errorTechnicalDetailsReportId = errorPresentation.technicalDetailsReportId,
                    recoveryErrorBlocked = recoveryError != null,
                    postAuthResetAllowed = isInvalidCloudCredentialRecovery(error = recoveryError)
                )
            }
        }
    }

    private suspend fun completeGuestLocalRecovery(
        authAttemptId: Long,
        linkContext: CloudWorkspaceLinkContext
    ) {
        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        if (isCloudPostAuthProcessing(state = draftState.value)) {
            return
        }

        draftState.update { state ->
            prepareCloudPostAuthGuestLocalRecovery(
                state = state,
                authAttemptId = authAttemptId,
                linkContext = linkContext,
                strings = strings
            )
        }

        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        try {
            val completion = completeCloudPostAuthWorkspaceSelection(
                cloudAccountRepository = cloudAccountRepository,
                linkContext = linkContext,
                selection = CloudWorkspaceLinkSelection.CreateNew
            )
            finishPostAuthSuccess(
                authAttemptId = authAttemptId,
                workspaceTitle = completion.workspaceTitle
            )
        } catch (error: CancellationException) {
            failPostAuthCancellationIfStillProcessing(
                authAttemptId = authAttemptId,
                errorMessage = strings.get(R.string.settings_post_auth_guest_local_recovery_failed)
            )
            throw error
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return
            }
            val recoveryError = error as? CloudCredentialRecoveryRequiredException
            val errorPresentation = if (recoveryError != null) {
                CloudPostAuthErrorPresentation(
                    message = cloudPostAuthRecoveryExceptionMessage(error = recoveryError, strings = strings),
                    technicalDetails = null,
                    technicalDetailsReportId = null
                )
            } else {
                val technicalDetails = technicalDetailsFor(error = error)
                CloudPostAuthErrorPresentation(
                    message = strings.get(R.string.settings_post_auth_guest_local_recovery_failed),
                    technicalDetails = technicalDetails,
                    technicalDetailsReportId = technicalDetailsReportIdFor(
                        source = "cloud-post-auth-guest-local-recovery",
                        technicalDetails = technicalDetails
                    )
                )
            }
            draftState.update { state ->
                failCloudPostAuth(
                    state = state,
                    authAttemptId = authAttemptId,
                    errorMessage = errorPresentation.message,
                    errorTechnicalDetails = errorPresentation.technicalDetails,
                    errorTechnicalDetailsReportId = errorPresentation.technicalDetailsReportId,
                    recoveryErrorBlocked = recoveryError != null,
                    postAuthResetAllowed = isInvalidCloudCredentialRecovery(error = recoveryError)
                )
            }
        }
    }

    private suspend fun runPostAuthSyncOnly(
        authAttemptId: Long,
        workspaceTitle: String
    ) {
        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        if (
            isCloudPostAuthProcessing(state = draftState.value) &&
            draftState.value.processingTitle == strings.get(R.string.settings_post_auth_syncing_title)
        ) {
            return
        }

        draftState.update { state ->
            prepareCloudPostAuthSyncOnly(
                state = state,
                authAttemptId = authAttemptId,
                workspaceTitle = workspaceTitle,
                strings = strings
            )
        }

        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        try {
            completeCloudPostAuthSyncOnly(syncRepository = syncRepository)
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return
            }
            finishPostAuthSuccess(
                authAttemptId = authAttemptId,
                workspaceTitle = workspaceTitle
            )
        } catch (error: CancellationException) {
            failPostAuthCancellationIfStillProcessing(
                authAttemptId = authAttemptId,
                errorMessage = strings.get(R.string.settings_post_auth_sync_failed)
            )
            throw error
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return
            }
            val recoveryError = error as? CloudCredentialRecoveryRequiredException
            val errorPresentation = if (recoveryError != null) {
                CloudPostAuthErrorPresentation(
                    message = cloudPostAuthRecoveryExceptionMessage(error = recoveryError, strings = strings),
                    technicalDetails = null,
                    technicalDetailsReportId = null
                )
            } else {
                val technicalDetails = technicalDetailsFor(error = error)
                CloudPostAuthErrorPresentation(
                    message = strings.get(R.string.settings_post_auth_sync_failed),
                    technicalDetails = technicalDetails,
                    technicalDetailsReportId = technicalDetailsReportIdFor(
                        source = "cloud-post-auth-sync",
                        technicalDetails = technicalDetails
                    )
                )
            }
            draftState.update { state ->
                failCloudPostAuth(
                    state = state,
                    authAttemptId = authAttemptId,
                    errorMessage = errorPresentation.message,
                    errorTechnicalDetails = errorPresentation.technicalDetails,
                    errorTechnicalDetailsReportId = errorPresentation.technicalDetailsReportId,
                    recoveryErrorBlocked = recoveryError != null,
                    postAuthResetAllowed = isInvalidCloudCredentialRecovery(error = recoveryError)
                )
            }
        }
    }

    private fun failPostAuthCancellationIfStillProcessing(
        authAttemptId: Long,
        errorMessage: String
    ) {
        draftState.update { state ->
            if (state.authAttemptId != authAttemptId || state.processingTitle.isEmpty()) {
                state
            } else {
                failCloudPostAuth(
                    state = state,
                    authAttemptId = authAttemptId,
                    errorMessage = errorMessage,
                    errorTechnicalDetails = null,
                    errorTechnicalDetailsReportId = null,
                    recoveryErrorBlocked = false,
                    postAuthResetAllowed = false
                )
            }
        }
    }

    private fun finishPostAuthSuccess(
        authAttemptId: Long,
        workspaceTitle: String
    ) {
        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }
        draftState.update { state ->
            finishCloudPostAuthSuccess(
                state = state,
                authAttemptId = authAttemptId,
                completionToken = System.currentTimeMillis()
            )
        }
        messageController.showMessage(
            message = strings.get(R.string.settings_post_auth_signed_in_and_synced, workspaceTitle)
        )
    }

    private fun clearPostAuthState() {
        draftState.update { state ->
            clearCloudPostAuthDraftState(state = state)
        }
    }
}

private fun createSendCodeErrorPresentation(
    error: Exception,
    strings: SettingsStringResolver
): CloudSignInErrorPresentation {
    val expectedUserFailureMessage = expectedCloudSendCodeUserFailureMessage(
        error = error,
        strings = strings
    )
    return when {
        expectedUserFailureMessage != null -> {
            CloudSignInErrorPresentation(
                message = expectedUserFailureMessage,
                technicalDetails = null,
                technicalDetailsReportId = null
            )
        }

        isCloudTransportFailure(error = error) -> {
            CloudSignInErrorPresentation(
                message = strings.get(R.string.settings_sign_in_send_code_transport_failed),
                technicalDetails = technicalDetailsFor(error = error),
                technicalDetailsReportId = null
            )
        }

        else -> {
            CloudSignInErrorPresentation(
                message = strings.get(R.string.settings_sign_in_send_code_failed),
                technicalDetails = technicalDetailsFor(error = error),
                technicalDetailsReportId = null
            )
        }
    }
}

private fun createVerifyCodeErrorPresentation(
    error: Exception,
    strings: SettingsStringResolver
): CloudSignInErrorPresentation {
    return when {
        isExpectedCloudVerifyCodeUserFailure(error = error) -> {
            CloudSignInErrorPresentation(
                message = strings.get(R.string.settings_sign_in_verify_failed),
                technicalDetails = null,
                technicalDetailsReportId = null
            )
        }

        isCloudTransportFailure(error = error) -> {
            CloudSignInErrorPresentation(
                message = strings.get(R.string.settings_sign_in_verify_transport_failed),
                technicalDetails = technicalDetailsFor(error = error),
                technicalDetailsReportId = null
            )
        }

        else -> {
            CloudSignInErrorPresentation(
                message = strings.get(R.string.settings_sign_in_verify_failed),
                technicalDetails = technicalDetailsFor(error = error),
                technicalDetailsReportId = null
            )
        }
    }
}

private fun expectedCloudSendCodeUserFailureMessage(
    error: Exception,
    strings: SettingsStringResolver
): String? {
    val remoteError = error as? CloudRemoteException ?: return null
    if (remoteError.statusCode !in 400..499) {
        return null
    }
    val errorCode = remoteError.errorCode ?: return null
    if (errorCode !in cloudSendCodeUserCorrectableErrorCodes) {
        return null
    }
    return when (errorCode) {
        "INVALID_EMAIL" -> strings.get(R.string.settings_sign_in_send_code_invalid_email)
        "RATE_LIMITED" -> strings.get(R.string.settings_sign_in_send_code_rate_limited)
        else -> strings.get(R.string.settings_sign_in_send_code_failed)
    }
}

private fun isExpectedCloudVerifyCodeUserFailure(error: Exception): Boolean {
    val remoteError = error as? CloudRemoteException ?: return false
    val errorCode = remoteError.errorCode ?: return false
    return remoteError.statusCode in 400..499 &&
        errorCode in cloudVerifyCodeUserCorrectableErrorCodes
}

private fun isCloudTransportFailure(error: Exception): Boolean {
    return error is IOException
}

private fun technicalDetailsFor(error: Exception): String {
    return renderTechnicalErrorDetails(error = error)
}

fun createCloudSignInViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CloudSignInViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}

private fun <Input, Output> Flow<Input>.mapToStateIn(
    scope: CoroutineScope,
    started: SharingStarted,
    transform: suspend (Input) -> Output,
    initialValue: Output
): StateFlow<Output> {
    return this.map(transform).stateIn(
        scope = scope,
        started = started,
        initialValue = initialValue
    )
}
