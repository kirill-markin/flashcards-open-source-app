package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.AgentApiKeyConnection
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudGuestUpgradeMode
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkContext
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceLinkSelection
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceSummary
import com.flashcardsopensourceapp.data.local.model.WorkspaceExportData
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private data class AccountStatusDraftState(
    val errorMessage: String,
    val isSubmitting: Boolean,
    val showLogoutConfirmation: Boolean
)

class AccountStatusViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = AccountStatusDraftState(
            errorMessage = "",
            isSubmitting = false,
            showLogoutConfirmation = false
        )
    )

    val uiState: StateFlow<AccountStatusUiState> = combine(
        workspaceRepository.observeAppMetadata(),
        cloudAccountRepository.observeCloudSettings(),
        syncRepository.observeSyncStatus(),
        draftState
    ) { metadata, cloudSettings, syncStatus, draft ->
        AccountStatusUiState(
            workspaceName = metadata.workspaceName,
            cloudStatusTitle = displayCloudAccountStateTitle(cloudState = cloudSettings.cloudState),
            linkedEmail = cloudSettings.linkedEmail,
            deviceId = cloudSettings.deviceId,
            syncStatusText = when (val status = syncStatus.status) {
                is com.flashcardsopensourceapp.data.local.model.SyncStatus.Failed -> status.message
                com.flashcardsopensourceapp.data.local.model.SyncStatus.Idle -> when (cloudSettings.cloudState) {
                    CloudAccountState.GUEST -> "Guest AI session"
                    else -> metadata.syncStatusText
                }
                com.flashcardsopensourceapp.data.local.model.SyncStatus.Syncing -> "Syncing"
            },
            lastSuccessfulSync = formatTimestampLabel(syncStatus.lastSuccessfulSyncAtMillis),
            isGuest = cloudSettings.cloudState == CloudAccountState.GUEST,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
            showLogoutConfirmation = draft.showLogoutConfirmation,
            errorMessage = draft.errorMessage,
            isSubmitting = draft.isSubmitting
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AccountStatusUiState(
            workspaceName = "Loading...",
            cloudStatusTitle = "Loading...",
            linkedEmail = null,
            deviceId = "Loading...",
            syncStatusText = "Loading...",
            lastSuccessfulSync = "Never",
            isGuest = false,
            isLinked = false,
            isLinkingReady = false,
            showLogoutConfirmation = false,
            errorMessage = "",
            isSubmitting = false
        )
    )

    fun requestLogoutConfirmation() {
        draftState.update { state ->
            state.copy(
                showLogoutConfirmation = true,
                errorMessage = ""
            )
        }
    }

    fun dismissLogoutConfirmation() {
        draftState.update { state ->
            state.copy(showLogoutConfirmation = false)
        }
    }

    suspend fun syncNow() {
        draftState.update { state -> state.copy(isSubmitting = true, errorMessage = "") }
        try {
            syncRepository.syncNow()
            draftState.update { state -> state.copy(isSubmitting = false, errorMessage = "") }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    errorMessage = error.message ?: "Cloud sync failed."
                )
            }
        }
    }

    suspend fun confirmLogout() {
        draftState.update { state ->
            state.copy(
                isSubmitting = true,
                showLogoutConfirmation = false,
                errorMessage = ""
            )
        }
        try {
            cloudAccountRepository.logout()
            draftState.update { state -> state.copy(isSubmitting = false, errorMessage = "") }
            messageController.showMessage(message = "Logged out. This device is disconnected.")
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    showLogoutConfirmation = false,
                    errorMessage = error.message ?: "Logout failed."
                )
            }
        }
    }
}

private sealed interface CurrentWorkspaceRetryAction {
    data class CompleteLink(
        val selection: CloudWorkspaceLinkSelection
    ) : CurrentWorkspaceRetryAction

    data class SyncOnly(
        val workspaceTitle: String
    ) : CurrentWorkspaceRetryAction
}

private data class CurrentWorkspaceDraftState(
    val operation: CurrentWorkspaceOperation,
    val pendingWorkspaceTitle: String?,
    val retryAction: CurrentWorkspaceRetryAction?,
    val errorMessage: String,
    val workspaces: List<CloudWorkspaceSummary>
)

class CurrentWorkspaceViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = CurrentWorkspaceDraftState(
            operation = CurrentWorkspaceOperation.IDLE,
            pendingWorkspaceTitle = null,
            retryAction = null,
            errorMessage = "",
            workspaces = emptyList()
        )
    )

    val uiState: StateFlow<CurrentWorkspaceUiState> = combine(
        workspaceRepository.observeAppMetadata(),
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { metadata, cloudSettings, draft ->
        CurrentWorkspaceUiState(
            cloudStatusTitle = displayCloudAccountStateTitle(cloudState = cloudSettings.cloudState),
            currentWorkspaceName = metadata.currentWorkspaceName,
            linkedEmail = cloudSettings.linkedEmail,
            isGuest = cloudSettings.cloudState == CloudAccountState.GUEST,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
            isLoading = draft.operation == CurrentWorkspaceOperation.LOADING,
            isSwitching = draft.operation == CurrentWorkspaceOperation.SWITCHING
                || draft.operation == CurrentWorkspaceOperation.SYNCING,
            operation = draft.operation,
            pendingWorkspaceTitle = draft.pendingWorkspaceTitle,
            canRetryLastWorkspaceAction = draft.retryAction != null,
            errorMessage = draft.errorMessage,
            workspaces = buildCurrentWorkspaceItems(
                currentWorkspaceName = metadata.currentWorkspaceName,
                workspaces = draft.workspaces
            )
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = CurrentWorkspaceUiState(
            cloudStatusTitle = "Loading...",
            currentWorkspaceName = "Loading...",
            linkedEmail = null,
            isGuest = false,
            isLinked = false,
            isLinkingReady = false,
            isLoading = false,
            isSwitching = false,
            operation = CurrentWorkspaceOperation.IDLE,
            pendingWorkspaceTitle = null,
            canRetryLastWorkspaceAction = false,
            errorMessage = "",
            workspaces = emptyList()
        )
    )

    suspend fun loadWorkspaces() {
        val cloudSettings = cloudAccountRepository.observeCloudSettings().first()
        if (cloudSettings.cloudState != CloudAccountState.LINKED) {
            messageController.showMessage(
                message = if (cloudSettings.cloudState == CloudAccountState.GUEST) {
                    "Create an account or log in to upgrade Guest AI before managing workspaces."
                } else {
                    "Sign in to load linked workspaces."
                }
            )
            return
        }

        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.LOADING,
                errorMessage = ""
            )
        }
        try {
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = "",
                    workspaces = workspaces
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = error.message ?: "Could not load linked workspaces."
                )
            }
        }
    }

    suspend fun switchWorkspace(selection: CloudWorkspaceLinkSelection) {
        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.SWITCHING,
                pendingWorkspaceTitle = workspaceSelectionTitle(
                    selection = selection,
                    workspaces = state.workspaces
                ),
                retryAction = CurrentWorkspaceRetryAction.CompleteLink(selection = selection),
                errorMessage = ""
            )
        }
        try {
            val workspace = cloudAccountRepository.switchLinkedWorkspace(selection)
            runWorkspaceSync(workspaceTitle = workspace.name)
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = error.message ?: "Workspace switch failed."
                )
            }
        }
    }

    suspend fun retryLastWorkspaceAction() {
        when (val retryAction = draftState.value.retryAction) {
            null -> Unit
            is CurrentWorkspaceRetryAction.CompleteLink -> switchWorkspace(selection = retryAction.selection)
            is CurrentWorkspaceRetryAction.SyncOnly -> runWorkspaceSync(workspaceTitle = retryAction.workspaceTitle)
        }
    }

    private suspend fun runWorkspaceSync(workspaceTitle: String) {
        draftState.update { state ->
            state.copy(
                operation = CurrentWorkspaceOperation.SYNCING,
                pendingWorkspaceTitle = workspaceTitle,
                retryAction = CurrentWorkspaceRetryAction.SyncOnly(workspaceTitle = workspaceTitle),
                errorMessage = ""
            )
        }

        try {
            syncRepository.syncNow()
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    pendingWorkspaceTitle = null,
                    retryAction = null,
                    errorMessage = "",
                    workspaces = workspaces
                )
            }
            messageController.showMessage(message = "Current workspace is now $workspaceTitle.")
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    operation = CurrentWorkspaceOperation.IDLE,
                    errorMessage = error.message ?: "Workspace sync failed."
                )
            }
        }
    }
}

private data class ServerSettingsDraftState(
    val customOrigin: String,
    val previewConfiguration: CloudServiceConfiguration?,
    val isApplying: Boolean,
    val errorMessage: String
)

class ServerSettingsViewModel(
    private val cloudAccountRepository: CloudAccountRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = ServerSettingsDraftState(
            customOrigin = "",
            previewConfiguration = null,
            isApplying = false,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<ServerSettingsUiState> = combine(
        cloudAccountRepository.observeServerConfiguration(),
        draftState
    ) { configuration, draft ->
        ServerSettingsUiState(
            modeTitle = when (configuration.mode) {
                com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode.OFFICIAL -> "Official"
                com.flashcardsopensourceapp.data.local.model.CloudServiceConfigurationMode.CUSTOM -> "Custom"
            },
            customOrigin = draft.customOrigin,
            apiBaseUrl = configuration.apiBaseUrl,
            authBaseUrl = configuration.authBaseUrl,
            previewApiBaseUrl = draft.previewConfiguration?.apiBaseUrl,
            previewAuthBaseUrl = draft.previewConfiguration?.authBaseUrl,
            isApplying = draft.isApplying,
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = ServerSettingsUiState(
            modeTitle = "Loading...",
            customOrigin = "",
            apiBaseUrl = "",
            authBaseUrl = "",
            previewApiBaseUrl = null,
            previewAuthBaseUrl = null,
            isApplying = false,
            errorMessage = ""
        )
    )

    suspend fun loadInitialState() {
        val configuration = cloudAccountRepository.currentServerConfiguration()
        draftState.update { state ->
            state.copy(
                customOrigin = configuration.customOrigin.orEmpty(),
                previewConfiguration = configuration.customOrigin?.let { customOrigin ->
                    try {
                        com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration(customOrigin)
                    } catch (_: IllegalArgumentException) {
                        null
                    }
                }
            )
        }
    }

    fun updateCustomOrigin(customOrigin: String) {
        draftState.update { state ->
            state.copy(
                customOrigin = customOrigin,
                previewConfiguration = try {
                    if (customOrigin.isBlank()) {
                        null
                    } else {
                        com.flashcardsopensourceapp.data.local.model.makeCustomCloudServiceConfiguration(customOrigin)
                    }
                } catch (_: IllegalArgumentException) {
                    null
                },
                errorMessage = ""
            )
        }
    }

    suspend fun applyPreviewConfiguration() {
        val previewConfiguration = requireNotNull(draftState.value.previewConfiguration) {
            "Enter a valid custom server URL."
        }
        draftState.update { state -> state.copy(isApplying = true, errorMessage = "") }
        try {
            cloudAccountRepository.applyCustomServer(previewConfiguration)
            draftState.update { state -> state.copy(isApplying = false, errorMessage = "") }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = error.message ?: "Could not apply custom server."
                )
            }
        }
    }

    suspend fun validateCustomServer() {
        draftState.update { state -> state.copy(isApplying = true, errorMessage = "") }
        try {
            val validatedConfiguration = cloudAccountRepository.validateCustomServer(draftState.value.customOrigin)
            draftState.update { state ->
                state.copy(
                    previewConfiguration = validatedConfiguration,
                    isApplying = false,
                    errorMessage = ""
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = error.message ?: "Custom server validation failed."
                )
            }
        }
    }

    suspend fun resetToOfficialServer() {
        draftState.update { state -> state.copy(isApplying = true, errorMessage = "") }
        try {
            cloudAccountRepository.resetToOfficialServer()
            draftState.update { state ->
                state.copy(
                    customOrigin = "",
                    previewConfiguration = null,
                    isApplying = false,
                    errorMessage = ""
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isApplying = false,
                    errorMessage = error.message ?: "Could not reset the official server."
                )
            }
        }
    }
}

private sealed interface CloudPostAuthRetryAction {
    data class CompleteCloudLink(
        val selection: CloudWorkspaceLinkSelection
    ) : CloudPostAuthRetryAction

    data class CompleteGuestUpgrade(
        val selection: CloudWorkspaceLinkSelection
    ) : CloudPostAuthRetryAction

    data class SyncOnly(
        val workspaceTitle: String
    ) : CloudPostAuthRetryAction
}

private data class CloudSignInDraftState(
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
                    draft.linkContext != null && draft.linkContext.workspaces.size > 1 -> CloudPostAuthMode.CHOOSE_WORKSPACE
                    else -> CloudPostAuthMode.IDLE
                },
                verifiedEmail = draft.linkContext?.email,
                isGuestUpgrade = draft.linkContext?.guestUpgradeMode != null,
                workspaces = buildCloudPostAuthWorkspaceItems(
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

    suspend fun sendCode(): Boolean {
        draftState.update { state -> state.copy(isSendingCode = true, errorMessage = "") }
        return try {
            when (val result = cloudAccountRepository.sendCode(draftState.value.email)) {
                is CloudSendCodeResult.OtpRequired -> {
                    draftState.update { state ->
                        state.copy(
                            isSendingCode = false,
                            errorMessage = "",
                            challenge = result.challenge,
                            linkContext = null,
                            pendingSelection = null,
                            completionToken = null
                        )
                    }
                    true
                }

                is CloudSendCodeResult.Verified -> {
                    draftState.update { state ->
                        state.copy(
                            isSendingCode = false,
                            errorMessage = "This account flow currently expects one-time code verification.",
                            challenge = null,
                            linkContext = null,
                            pendingSelection = null
                        )
                    }
                    false
                }
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSendingCode = false,
                    errorMessage = error.message ?: "Could not send the sign-in code."
                )
            }
            false
        }
    }

    suspend fun verifyCode(): Boolean {
        val challenge = requireNotNull(draftState.value.challenge) {
            "Request a sign-in code first."
        }
        draftState.update { state -> state.copy(isVerifyingCode = true, errorMessage = "") }
        return try {
            val linkContext = cloudAccountRepository.verifyCode(
                challenge = challenge,
                code = draftState.value.code
            )
            draftState.update { state ->
                state.copy(
                    isVerifyingCode = false,
                    errorMessage = "",
                    linkContext = linkContext,
                    pendingSelection = when (linkContext.workspaces.size) {
                        0 -> CloudWorkspaceLinkSelection.CreateNew
                        1 -> CloudWorkspaceLinkSelection.Existing(
                            workspaceId = linkContext.workspaces.first().workspaceId
                        )
                        else -> null
                    },
                    processingTitle = "",
                    processingMessage = "",
                    postAuthErrorMessage = "",
                    retryAction = null,
                    completionToken = null
                )
            }
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isVerifyingCode = false,
                    errorMessage = error.message ?: "Could not verify the code."
                )
            }
            false
        }
    }

    suspend fun completePendingPostAuthIfNeeded() {
        val selection = draftState.value.pendingSelection ?: return
        if (draftState.value.processingTitle.isNotEmpty() || draftState.value.postAuthErrorMessage.isNotEmpty()) {
            return
        }
        completePostAuth(selection = selection)
    }

    suspend fun selectPostAuthWorkspace(selection: CloudWorkspaceLinkSelection) {
        completePostAuth(selection = selection)
    }

    suspend fun retryPostAuth() {
        when (val retryAction = draftState.value.retryAction) {
            null -> Unit
            is CloudPostAuthRetryAction.CompleteCloudLink -> completePostAuth(selection = retryAction.selection)
            is CloudPostAuthRetryAction.CompleteGuestUpgrade -> completePostAuth(selection = retryAction.selection)
            is CloudPostAuthRetryAction.SyncOnly -> runPostAuthSyncOnly(workspaceTitle = retryAction.workspaceTitle)
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

    private suspend fun completePostAuth(selection: CloudWorkspaceLinkSelection) {
        val linkContext = requireNotNull(draftState.value.linkContext) {
            "Cloud workspace setup is unavailable."
        }
        val requiresGuestUpgrade = linkContext.guestUpgradeMode == CloudGuestUpgradeMode.MERGE_REQUIRED
        val isGuestUpgrade = linkContext.guestUpgradeMode != null
        draftState.update { state ->
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
                    CloudPostAuthRetryAction.CompleteGuestUpgrade(selection = selection)
                } else {
                    CloudPostAuthRetryAction.CompleteCloudLink(selection = selection)
                }
            )
        }

        try {
            val workspace = if (requiresGuestUpgrade) {
                cloudAccountRepository.completeGuestUpgrade(selection = selection)
            } else {
                cloudAccountRepository.completeCloudLink(selection = selection)
            }
            runPostAuthSyncOnly(workspaceTitle = workspace.name)
        } catch (error: Exception) {
            draftState.update { state ->
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

    private suspend fun runPostAuthSyncOnly(workspaceTitle: String) {
        draftState.update { state ->
            state.copy(
                processingTitle = "Syncing workspace",
                processingMessage = "Keep this screen open while Android finishes the initial cloud sync.",
                postAuthErrorMessage = "",
                retryAction = CloudPostAuthRetryAction.SyncOnly(workspaceTitle = workspaceTitle)
            )
        }

        try {
            syncRepository.syncNow()
            draftState.update { state ->
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
            draftState.update { state ->
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
                email = "",
                code = "",
                challenge = null,
                linkContext = null,
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

private data class AgentConnectionsDraftState(
    val isLoading: Boolean,
    val instructions: String,
    val errorMessage: String,
    val revokingConnectionId: String?,
    val connections: List<AgentApiKeyConnection>
)

class AgentConnectionsViewModel(
    private val cloudAccountRepository: CloudAccountRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = AgentConnectionsDraftState(
            isLoading = false,
            instructions = "",
            errorMessage = "",
            revokingConnectionId = null,
            connections = emptyList()
        )
    )

    val uiState: StateFlow<AgentConnectionsUiState> = combine(
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { cloudSettings, draft ->
        AgentConnectionsUiState(
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLoading = draft.isLoading,
            instructions = draft.instructions,
            errorMessage = draft.errorMessage,
            revokingConnectionId = draft.revokingConnectionId,
            connections = draft.connections.map(::toAgentConnectionItemUiState)
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AgentConnectionsUiState(
            isLinked = false,
            isLoading = false,
            instructions = "",
            errorMessage = "",
            revokingConnectionId = null,
            connections = emptyList()
        )
    )

    suspend fun loadConnections() {
        if (uiState.value.isLinked.not()) {
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    instructions = "",
                    errorMessage = "",
                    revokingConnectionId = null,
                    connections = emptyList()
                )
            }
            return
        }

        draftState.update { state ->
            state.copy(isLoading = true, errorMessage = "")
        }

        try {
            val result = cloudAccountRepository.listAgentConnections()
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    instructions = result.instructions,
                    errorMessage = "",
                    connections = result.connections
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    errorMessage = error.message ?: "Could not load agent connections."
                )
            }
        }
    }

    suspend fun revokeConnection(connectionId: String) {
        draftState.update { state ->
            state.copy(
                revokingConnectionId = connectionId,
                errorMessage = ""
            )
        }

        try {
            val result = cloudAccountRepository.revokeAgentConnection(connectionId = connectionId)
            val revokedConnection = result.connections.single()
            draftState.update { state ->
                state.copy(
                    instructions = result.instructions,
                    errorMessage = "",
                    revokingConnectionId = null,
                    connections = state.connections.map { connection ->
                        if (connection.connectionId == revokedConnection.connectionId) {
                            revokedConnection
                        } else {
                            connection
                        }
                    }
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    errorMessage = error.message ?: "Could not revoke the agent connection.",
                    revokingConnectionId = null
                )
            }
        }
    }
}

private data class AccountDangerZoneDraftState(
    val confirmationText: String,
    val errorMessage: String,
    val showDeleteConfirmation: Boolean
)

class AccountDangerZoneViewModel(
    private val cloudAccountRepository: CloudAccountRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = AccountDangerZoneDraftState(
            confirmationText = "",
            errorMessage = "",
            showDeleteConfirmation = false
        )
    )

    val uiState: StateFlow<AccountDangerZoneUiState> = combine(
        cloudAccountRepository.observeCloudSettings(),
        cloudAccountRepository.observeAccountDeletionState(),
        draftState
    ) { cloudSettings, deletionState, draft ->
        AccountDangerZoneUiState(
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            confirmationText = draft.confirmationText,
            isDeleting = deletionState == AccountDeletionState.InProgress,
            deleteState = when (deletionState) {
                is AccountDeletionState.Failed -> DestructiveActionState.FAILED
                AccountDeletionState.InProgress -> DestructiveActionState.IN_PROGRESS
                AccountDeletionState.Hidden -> DestructiveActionState.IDLE
            },
            errorMessage = when (deletionState) {
                is AccountDeletionState.Failed -> deletionState.message
                AccountDeletionState.Hidden,
                AccountDeletionState.InProgress -> draft.errorMessage
            },
            successMessage = "",
            showDeleteConfirmation = draft.showDeleteConfirmation
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AccountDangerZoneUiState(
            isLinked = false,
            confirmationText = "",
            isDeleting = false,
            deleteState = DestructiveActionState.IDLE,
            errorMessage = "",
            successMessage = "",
            showDeleteConfirmation = false
        )
    )

    fun requestDeleteConfirmation() {
        draftState.update { state ->
            state.copy(
                showDeleteConfirmation = true,
                errorMessage = ""
            )
        }
    }

    fun dismissDeleteConfirmation() {
        draftState.update { state ->
            state.copy(
                showDeleteConfirmation = false,
                confirmationText = ""
            )
        }
    }

    fun updateConfirmationText(value: String) {
        draftState.update { state ->
            state.copy(
                confirmationText = value,
                errorMessage = ""
            )
        }
    }

    suspend fun deleteAccount(): Boolean {
        if (uiState.value.confirmationText != accountDeletionConfirmationText) {
            draftState.update { state ->
                state.copy(errorMessage = "Enter the confirmation phrase exactly to continue.")
            }
            return false
        }

        return try {
            cloudAccountRepository.beginAccountDeletion()
            draftState.update { state ->
                state.copy(
                    confirmationText = "",
                    errorMessage = "",
                    showDeleteConfirmation = false
                )
            }
            true
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    errorMessage = error.message ?: "Account deletion failed."
                )
            }
            false
        }
    }
}

class DeviceDiagnosticsViewModel(
    workspaceRepository: WorkspaceRepository,
    appVersion: String,
    buildNumber: String
) : ViewModel() {
    val uiState: StateFlow<DeviceDiagnosticsUiState> = workspaceRepository.observeDeviceDiagnostics().map { diagnostics ->
            DeviceDiagnosticsUiState(
                workspaceName = diagnostics?.workspaceName ?: "Unavailable",
                workspaceId = diagnostics?.workspaceId ?: "Unavailable",
                appVersion = appVersion,
                buildNumber = buildNumber,
                operatingSystem = currentOperatingSystemLabel(),
                deviceModel = currentDeviceModelLabel(),
                clientLabel = "Jetpack Compose",
                storageLabel = "Room + SQLite",
                outboxEntriesCount = diagnostics?.outboxEntriesCount ?: 0,
                lastSyncCursor = diagnostics?.lastSyncCursor ?: "Unavailable",
                lastSyncAttempt = formatTimestampLabel(timestampMillis = diagnostics?.lastSyncAttemptAtMillis),
                lastSuccessfulSync = formatTimestampLabel(timestampMillis = diagnostics?.lastSuccessfulSyncAtMillis),
                lastSyncError = diagnostics?.lastSyncErrorMessage ?: "None"
            )
        }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = DeviceDiagnosticsUiState(
            workspaceName = "Loading...",
            workspaceId = "Loading...",
            appVersion = appVersion,
            buildNumber = buildNumber,
            operatingSystem = currentOperatingSystemLabel(),
            deviceModel = currentDeviceModelLabel(),
            clientLabel = "Jetpack Compose",
            storageLabel = "Room + SQLite",
            outboxEntriesCount = 0,
            lastSyncCursor = "Unavailable",
            lastSyncAttempt = "Never",
            lastSuccessfulSync = "Never",
            lastSyncError = "None"
        )
    )
}

private data class WorkspaceExportDraftState(
    val isExporting: Boolean,
    val errorMessage: String
)

class WorkspaceExportViewModel(
    private val workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = WorkspaceExportDraftState(
            isExporting = false,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<WorkspaceExportUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        draftState
    ) { overview, draft ->
        WorkspaceExportUiState(
            workspaceName = overview?.workspaceName ?: "Unavailable",
            activeCardsCount = overview?.totalCards ?: 0,
            isExporting = draft.isExporting,
            errorMessage = draft.errorMessage
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceExportUiState(
            workspaceName = "Loading...",
            activeCardsCount = 0,
            isExporting = false,
            errorMessage = ""
        )
    )

    suspend fun prepareExportData(): WorkspaceExportData? {
        draftState.update { state ->
            state.copy(
                isExporting = true,
                errorMessage = ""
            )
        }

        return try {
            val exportData = workspaceRepository.loadWorkspaceExportData()
            if (exportData == null) {
                draftState.update { state ->
                    state.copy(
                        isExporting = false,
                        errorMessage = "Workspace export is unavailable."
                    )
                }
            }
            exportData
        } catch (error: IllegalArgumentException) {
            draftState.update { state ->
                state.copy(
                    isExporting = false,
                    errorMessage = error.message ?: "Android export could not be prepared."
                )
            }
            null
        } catch (error: IllegalStateException) {
            draftState.update { state ->
                state.copy(
                    isExporting = false,
                    errorMessage = error.message ?: "Android export could not be prepared."
                )
            }
            null
        }
    }

    fun finishExport() {
        draftState.update { state ->
            state.copy(isExporting = false)
        }
    }

    fun showExportError(message: String) {
        draftState.update { state ->
            state.copy(
                isExporting = false,
                errorMessage = message
            )
        }
    }

    fun clearErrorMessage() {
        draftState.update { state ->
            state.copy(errorMessage = "")
        }
    }
}

fun createAccountStatusViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountStatusViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController,
                workspaceRepository = workspaceRepository
            )
        }
    }
}

fun createCurrentWorkspaceViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CurrentWorkspaceViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController,
                workspaceRepository = workspaceRepository
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

fun createAgentConnectionsViewModelFactory(cloudAccountRepository: CloudAccountRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AgentConnectionsViewModel(cloudAccountRepository = cloudAccountRepository)
        }
    }
}

fun createAccountDangerZoneViewModelFactory(cloudAccountRepository: CloudAccountRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountDangerZoneViewModel(cloudAccountRepository = cloudAccountRepository)
        }
    }
}

fun createServerSettingsViewModelFactory(cloudAccountRepository: CloudAccountRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            ServerSettingsViewModel(cloudAccountRepository = cloudAccountRepository)
        }
    }
}

fun createDeviceDiagnosticsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    appVersion: String,
    buildNumber: String
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            DeviceDiagnosticsViewModel(
                workspaceRepository = workspaceRepository,
                appVersion = appVersion,
                buildNumber = buildNumber
            )
        }
    }
}

fun createWorkspaceExportViewModelFactory(workspaceRepository: WorkspaceRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceExportViewModel(workspaceRepository = workspaceRepository)
        }
    }
}

private fun displayCloudAccountStateTitle(cloudState: CloudAccountState): String {
    return when (cloudState) {
        CloudAccountState.DISCONNECTED -> "Disconnected"
        CloudAccountState.LINKING_READY -> "Choose workspace"
        CloudAccountState.GUEST -> "Guest AI"
        CloudAccountState.LINKED -> "Linked"
    }
}

private fun workspaceSelectionTitle(
    selection: CloudWorkspaceLinkSelection,
    workspaces: List<CloudWorkspaceSummary>
): String {
    return when (selection) {
        is CloudWorkspaceLinkSelection.Existing -> workspaces.firstOrNull { workspace ->
            workspace.workspaceId == selection.workspaceId
        }?.name ?: "Selected workspace"
        CloudWorkspaceLinkSelection.CreateNew -> "New workspace"
    }
}

private fun buildCurrentWorkspaceItems(
    currentWorkspaceName: String,
    workspaces: List<CloudWorkspaceSummary>
): List<CurrentWorkspaceItemUiState> {
    val items = workspaces.map { workspace ->
        CurrentWorkspaceItemUiState(
            workspaceId = workspace.workspaceId,
            title = workspace.name,
            subtitle = formatTimestampLabel(workspace.createdAtMillis),
            isSelected = workspace.isSelected || workspace.name == currentWorkspaceName,
            isCreateNew = false
        )
    }
    return items + CurrentWorkspaceItemUiState(
        workspaceId = "create-new",
        title = "Create new workspace",
        subtitle = "Start a new linked workspace in the cloud",
        isSelected = false,
        isCreateNew = true
    )
}

private fun buildCloudPostAuthWorkspaceItems(
    workspaces: List<CloudWorkspaceSummary>
): List<CurrentWorkspaceItemUiState> {
    return workspaces.map { workspace ->
        CurrentWorkspaceItemUiState(
            workspaceId = workspace.workspaceId,
            title = workspace.name,
            subtitle = formatTimestampLabel(workspace.createdAtMillis),
            isSelected = false,
            isCreateNew = false
        )
    } + CurrentWorkspaceItemUiState(
        workspaceId = "create-new",
        title = "Create new workspace",
        subtitle = "Start a new linked workspace in the cloud",
        isSelected = false,
        isCreateNew = true
    )
}

private fun <Input, Output> Flow<Input>.mapToStateIn(
    scope: kotlinx.coroutines.CoroutineScope,
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

private fun toAgentConnectionItemUiState(connection: AgentApiKeyConnection): AgentConnectionItemUiState {
    return AgentConnectionItemUiState(
        connectionId = connection.connectionId,
        label = connection.label,
        createdAtLabel = formatTimestampLabel(timestampMillis = connection.createdAtMillis),
        lastUsedAtLabel = formatTimestampLabel(timestampMillis = connection.lastUsedAtMillis),
        revokedAtLabel = formatTimestampLabel(timestampMillis = connection.revokedAtMillis),
        isRevoked = connection.revokedAtMillis != null
    )
}
