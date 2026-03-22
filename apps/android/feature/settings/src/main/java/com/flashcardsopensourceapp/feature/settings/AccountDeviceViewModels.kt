package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudOtpChallenge
import com.flashcardsopensourceapp.data.local.model.CloudSendCodeResult
import com.flashcardsopensourceapp.data.local.model.CloudServiceConfiguration
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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private data class AccountStatusDraftState(
    val errorMessage: String,
    val isSubmitting: Boolean
)

class AccountStatusViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = AccountStatusDraftState(
            errorMessage = "",
            isSubmitting = false
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
                com.flashcardsopensourceapp.data.local.model.SyncStatus.Idle -> metadata.syncStatusText
                com.flashcardsopensourceapp.data.local.model.SyncStatus.Syncing -> "Syncing"
            },
            lastSuccessfulSync = formatTimestampLabel(syncStatus.lastSuccessfulSyncAtMillis),
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
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
            isLinked = false,
            isLinkingReady = false,
            errorMessage = "",
            isSubmitting = false
        )
    )

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

    suspend fun logout() {
        draftState.update { state -> state.copy(isSubmitting = true, errorMessage = "") }
        try {
            cloudAccountRepository.logout()
            draftState.update { state -> state.copy(isSubmitting = false, errorMessage = "") }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    errorMessage = error.message ?: "Logout failed."
                )
            }
        }
    }
}

private data class CurrentWorkspaceDraftState(
    val isLoading: Boolean,
    val isSwitching: Boolean,
    val errorMessage: String,
    val workspaces: List<CloudWorkspaceSummary>
)

class CurrentWorkspaceViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    workspaceRepository: WorkspaceRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = CurrentWorkspaceDraftState(
            isLoading = false,
            isSwitching = false,
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
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
            isLoading = draft.isLoading,
            isSwitching = draft.isSwitching,
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
            isLinked = false,
            isLinkingReady = false,
            isLoading = false,
            isSwitching = false,
            errorMessage = "",
            workspaces = emptyList()
        )
    )

    suspend fun loadWorkspaces() {
        draftState.update { state -> state.copy(isLoading = true, errorMessage = "") }
        try {
            val workspaces = cloudAccountRepository.listLinkedWorkspaces()
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    errorMessage = "",
                    workspaces = workspaces
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isLoading = false,
                    errorMessage = error.message ?: "Could not load linked workspaces."
                )
            }
        }
    }

    suspend fun switchWorkspace(selection: CloudWorkspaceLinkSelection) {
        draftState.update { state -> state.copy(isSwitching = true, errorMessage = "") }
        try {
            cloudAccountRepository.switchLinkedWorkspace(selection)
            syncRepository.syncNow()
            draftState.update { state -> state.copy(isSwitching = false, errorMessage = "") }
            loadWorkspaces()
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSwitching = false,
                    errorMessage = error.message ?: "Workspace switch failed."
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

private data class CloudSignInDraftState(
    val email: String,
    val code: String,
    val challenge: CloudOtpChallenge?,
    val isSendingCode: Boolean,
    val isVerifyingCode: Boolean,
    val errorMessage: String
)

class CloudSignInViewModel(
    private val cloudAccountRepository: CloudAccountRepository
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = CloudSignInDraftState(
            email = "",
            code = "",
            challenge = null,
            isSendingCode = false,
            isVerifyingCode = false,
            errorMessage = ""
        )
    )

    val uiState: StateFlow<CloudSignInUiState> = draftState.mapToStateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        transform = { draft ->
            CloudSignInUiState(
                email = draft.email,
                code = draft.code,
                isSendingCode = draft.isSendingCode,
                isVerifyingCode = draft.isVerifyingCode,
                errorMessage = draft.errorMessage,
                challengeEmail = draft.challenge?.email
            )
        },
        initialValue = CloudSignInUiState(
            email = "",
            code = "",
            isSendingCode = false,
            isVerifyingCode = false,
            errorMessage = "",
            challengeEmail = null
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
                            challenge = result.challenge
                        )
                    }
                    true
                }

                is CloudSendCodeResult.Verified -> {
                    draftState.update { state ->
                        state.copy(
                            isSendingCode = false,
                            errorMessage = "This account flow currently expects one-time code verification.",
                            challenge = null
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

    suspend fun verifyCode(): List<CloudWorkspaceSummary> {
        val challenge = requireNotNull(draftState.value.challenge) {
            "Request a sign-in code first."
        }
        draftState.update { state -> state.copy(isVerifyingCode = true, errorMessage = "") }
        return try {
            val workspaces = cloudAccountRepository.verifyCode(
                challenge = challenge,
                code = draftState.value.code
            )
            draftState.update { state -> state.copy(isVerifyingCode = false, errorMessage = "") }
            workspaces
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isVerifyingCode = false,
                    errorMessage = error.message ?: "Could not verify the code."
                )
            }
            emptyList()
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
    syncRepository: SyncRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountStatusViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                workspaceRepository = workspaceRepository
            )
        }
    }
}

fun createCurrentWorkspaceViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CurrentWorkspaceViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                workspaceRepository = workspaceRepository
            )
        }
    }
}

fun createCloudSignInViewModelFactory(cloudAccountRepository: CloudAccountRepository): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            CloudSignInViewModel(cloudAccountRepository = cloudAccountRepository)
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
        CloudAccountState.GUEST -> "Guest"
        CloudAccountState.LINKED -> "Linked"
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
