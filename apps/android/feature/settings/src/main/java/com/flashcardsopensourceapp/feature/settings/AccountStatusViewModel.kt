package com.flashcardsopensourceapp.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
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
            installationId = cloudSettings.installationId,
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
            installationId = "Loading...",
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
