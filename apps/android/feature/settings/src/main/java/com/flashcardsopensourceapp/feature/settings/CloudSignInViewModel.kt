package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private sealed interface CloudPostAuthRetryAction {
    data class CompleteCloudLink(
        val authAttemptId: Long,
        val linkContext: CloudWorkspaceLinkContext,
        val selection: CloudWorkspaceLinkSelection
    ) : CloudPostAuthRetryAction

    data class CompleteGuestUpgrade(
        val authAttemptId: Long,
        val linkContext: CloudWorkspaceLinkContext,
        val selection: CloudWorkspaceLinkSelection
    ) : CloudPostAuthRetryAction

    data class SyncOnly(
        val authAttemptId: Long,
        val workspaceTitle: String
    ) : CloudPostAuthRetryAction
}

private data class CloudSignInDraftState(
    val authAttemptId: Long,
    val email: String,
    val code: String,
    val challenge: CloudOtpChallenge?,
    val linkContext: CloudWorkspaceLinkContext?,
    val isSendingCode: Boolean,
    val isVerifyingCode: Boolean,
    val errorMessage: String,
    val pendingSelection: CloudWorkspaceLinkSelection?,
    val processingTitle: String,
    val processingMessage: String,
    val postAuthErrorMessage: String,
    val retryAction: CloudPostAuthRetryAction?,
    val completionToken: Long?
)

class CloudSignInViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = CloudSignInDraftState(
            authAttemptId = 0L,
            email = "",
            code = "",
            challenge = null,
            linkContext = null,
            isSendingCode = false,
            isVerifyingCode = false,
            errorMessage = "",
            pendingSelection = null,
            processingTitle = "",
            processingMessage = "",
            postAuthErrorMessage = "",
            retryAction = null,
            completionToken = null
        )
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
            challengeEmail = null
        )
    )

    val postAuthUiState: StateFlow<CloudPostAuthUiState> = draftState.mapToStateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        transform = { draft ->
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
                workspaces = buildCloudPostAuthWorkspaceItems(
                    preferredWorkspaceId = draft.linkContext?.preferredWorkspaceId,
                    workspaces = draft.linkContext?.workspaces ?: emptyList()
                ),
                pendingWorkspaceTitle = draft.pendingSelection?.let { selection ->
                    workspaceSelectionTitle(
                        selection = selection,
                        workspaces = draft.linkContext?.workspaces ?: emptyList()
                    )
                },
                processingTitle = draft.processingTitle,
                processingMessage = draft.processingMessage,
                errorMessage = draft.postAuthErrorMessage,
                canRetry = draft.retryAction != null,
                canLogout = draft.linkContext != null,
                completionToken = draft.completionToken
            )
        },
        initialValue = CloudPostAuthUiState(
            mode = CloudPostAuthMode.IDLE,
            verifiedEmail = null,
            isGuestUpgrade = false,
            workspaces = emptyList(),
            pendingWorkspaceTitle = null,
            processingTitle = "",
            processingMessage = "",
            errorMessage = "",
            canRetry = false,
            canLogout = false,
            completionToken = null
        )
    )

    fun updateEmail(email: String) {
        draftState.update { state -> state.copy(email = email, errorMessage = "") }
    }

    fun updateCode(code: String) {
        draftState.update { state -> state.copy(code = code, errorMessage = "") }
    }

    private fun nextAuthAttemptId(state: CloudSignInDraftState): Long {
        return state.authAttemptId + 1L
    }

    private fun isCurrentAuthAttempt(authAttemptId: Long): Boolean {
        return draftState.value.authAttemptId == authAttemptId
    }

    private fun buildPendingSelection(linkContext: CloudWorkspaceLinkContext): CloudWorkspaceLinkSelection? {
        return buildAutomaticWorkspaceSelection(
            preferredWorkspaceId = linkContext.preferredWorkspaceId,
            workspaces = linkContext.workspaces
        )
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

        draftState.update { state ->
            if (state.authAttemptId != authAttemptId) {
                return@update state
            }
            state.copy(
                isSendingCode = isSendingCode,
                isVerifyingCode = isVerifyingCode,
                errorMessage = "",
                challenge = null,
                linkContext = linkContext,
                pendingSelection = buildPendingSelection(linkContext),
                processingTitle = "",
                processingMessage = "",
                postAuthErrorMessage = "",
                retryAction = null,
                completionToken = null
            )
        }
        return true
    }

    suspend fun sendCode(): CloudSendCodeNavigationOutcome {
        val authAttemptId = nextAuthAttemptId(draftState.value)
        draftState.update { state ->
            state.copy(
                authAttemptId = authAttemptId,
                code = "",
                challenge = null,
                linkContext = null,
                isSendingCode = true,
                isVerifyingCode = false,
                errorMessage = "",
                pendingSelection = null,
                processingTitle = "",
                processingMessage = "",
                postAuthErrorMessage = "",
                retryAction = null,
                completionToken = null
            )
        }
        return try {
            when (val result = cloudAccountRepository.sendCode(draftState.value.email)) {
                is CloudSendCodeResult.OtpRequired -> {
                    if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                        return CloudSendCodeNavigationOutcome.NoNavigation
                    }
                    draftState.update { state ->
                        if (state.authAttemptId != authAttemptId) {
                            return@update state
                        }
                        state.copy(
                            isSendingCode = false,
                            errorMessage = "",
                            challenge = result.challenge,
                            linkContext = null,
                            pendingSelection = null,
                            completionToken = null
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
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return CloudSendCodeNavigationOutcome.NoNavigation
            }
            draftState.update { state ->
                if (state.authAttemptId != authAttemptId) {
                    return@update state
                }
                state.copy(
                    isSendingCode = false,
                    errorMessage = error.message ?: "Could not send the sign-in code."
                )
            }
            CloudSendCodeNavigationOutcome.NoNavigation
        }
    }

    suspend fun verifyCode(): Boolean {
        val challenge = requireNotNull(draftState.value.challenge) {
            "Request a sign-in code first."
        }
        val authAttemptId = nextAuthAttemptId(draftState.value)
        draftState.update { state ->
            state.copy(
                authAttemptId = authAttemptId,
                linkContext = null,
                isSendingCode = false,
                isVerifyingCode = true,
                errorMessage = "",
                pendingSelection = null,
                processingTitle = "",
                processingMessage = "",
                postAuthErrorMessage = "",
                retryAction = null,
                completionToken = null
            )
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
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return false
            }
            draftState.update { state ->
                if (state.authAttemptId != authAttemptId) {
                    return@update state
                }
                state.copy(
                    isVerifyingCode = false,
                    errorMessage = error.message ?: "Could not verify the code."
                )
            }
            false
        }
    }

    suspend fun completePendingPostAuthIfNeeded() {
        val state = draftState.value
        val selection = state.pendingSelection ?: return
        val linkContext = state.linkContext ?: return
        if (isPostAuthProcessing(state = state) || state.postAuthErrorMessage.isNotEmpty()) {
            return
        }
        completePostAuth(
            authAttemptId = state.authAttemptId,
            linkContext = linkContext,
            selection = selection
        )
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

    suspend fun logoutAfterPostAuthFailure() {
        cloudAccountRepository.logout()
        clearPostAuthState()
        messageController.showMessage(message = "Signed-in setup was cancelled. This device is disconnected.")
    }

    fun acknowledgePostAuthCompletion() {
        draftState.update { state ->
            state.copy(completionToken = null)
        }
    }

    private fun isPostAuthProcessing(state: CloudSignInDraftState): Boolean {
        return state.processingTitle.isNotEmpty()
    }

    private suspend fun completePostAuth(
        authAttemptId: Long,
        linkContext: CloudWorkspaceLinkContext,
        selection: CloudWorkspaceLinkSelection
    ) {
        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        if (isPostAuthProcessing(state = draftState.value)) {
            return
        }

        val requiresGuestUpgrade = linkContext.guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED
        val isGuestUpgrade = linkContext.guestUpgradeMode != null
        draftState.update { state ->
            if (state.authAttemptId != authAttemptId) {
                return@update state
            }
            state.copy(
                pendingSelection = null,
                processingTitle = if (isGuestUpgrade) {
                    "Upgrading guest account"
                } else {
                    "Linking workspace"
                },
                processingMessage = if (isGuestUpgrade) {
                    "Preparing your Guest AI session for a linked Android cloud account."
                } else {
                    "Preparing your cloud workspace on this Android device."
                },
                postAuthErrorMessage = "",
                retryAction = if (requiresGuestUpgrade) {
                    CloudPostAuthRetryAction.CompleteGuestUpgrade(
                        authAttemptId = authAttemptId,
                        linkContext = linkContext,
                        selection = selection
                    )
                } else {
                    CloudPostAuthRetryAction.CompleteCloudLink(
                        authAttemptId = authAttemptId,
                        linkContext = linkContext,
                        selection = selection
                    )
                }
            )
        }

        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        try {
            val workspace = if (requiresGuestUpgrade) {
                cloudAccountRepository.completeGuestUpgrade(
                    linkContext = linkContext,
                    selection = selection
                )
            } else {
                cloudAccountRepository.completeCloudLink(
                    linkContext = linkContext,
                    selection = selection
                )
            }
            runPostAuthSyncOnly(
                authAttemptId = authAttemptId,
                workspaceTitle = workspace.name
            )
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return
            }
            draftState.update { state ->
                if (state.authAttemptId != authAttemptId) {
                    return@update state
                }
                state.copy(
                    processingTitle = "",
                    processingMessage = "",
                    postAuthErrorMessage = error.message ?: if (requiresGuestUpgrade) {
                        "Guest account upgrade failed."
                    } else {
                        "Cloud workspace setup failed."
                    }
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

        if (isPostAuthProcessing(state = draftState.value) && draftState.value.processingTitle == "Syncing workspace") {
            return
        }

        draftState.update { state ->
            if (state.authAttemptId != authAttemptId) {
                return@update state
            }
            state.copy(
                processingTitle = "Syncing workspace",
                processingMessage = "Keep this screen open while Android finishes the initial cloud sync.",
                postAuthErrorMessage = "",
                retryAction = CloudPostAuthRetryAction.SyncOnly(
                    authAttemptId = authAttemptId,
                    workspaceTitle = workspaceTitle
                )
            )
        }

        if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
            return
        }

        try {
            syncRepository.syncNow()
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return
            }
            draftState.update { state ->
                if (state.authAttemptId != authAttemptId) {
                    return@update state
                }
                state.copy(
                    email = "",
                    code = "",
                    challenge = null,
                    linkContext = null,
                    pendingSelection = null,
                    processingTitle = "",
                    processingMessage = "",
                    postAuthErrorMessage = "",
                    retryAction = null,
                    completionToken = System.currentTimeMillis()
                )
            }
            messageController.showMessage(message = "Signed in and synced $workspaceTitle.")
        } catch (error: Exception) {
            if (isCurrentAuthAttempt(authAttemptId = authAttemptId).not()) {
                return
            }
            draftState.update { state ->
                if (state.authAttemptId != authAttemptId) {
                    return@update state
                }
                state.copy(
                    processingTitle = "",
                    processingMessage = "",
                    postAuthErrorMessage = error.message ?: "Initial sync failed."
                )
            }
        }
    }

    private fun clearPostAuthState() {
        draftState.update { state ->
            state.copy(
                authAttemptId = nextAuthAttemptId(state),
                email = "",
                code = "",
                challenge = null,
                linkContext = null,
                isSendingCode = false,
                isVerifyingCode = false,
                pendingSelection = null,
                processingTitle = "",
                processingMessage = "",
                postAuthErrorMessage = "",
                retryAction = null,
                completionToken = null,
                errorMessage = ""
            )
        }
    }
}

fun createCloudSignInViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CloudSignInViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController
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
