package com.flashcardsopensourceapp.feature.settings

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.SyncStatus
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
    workspaceRepository: WorkspaceRepository,
    private val strings: SettingsStringResolver
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
            workspaceName = strings.resolveWorkspaceName(workspaceName = metadata.workspaceName),
            cloudStatusTitle = displayCloudAccountStateTitle(
                cloudState = cloudSettings.cloudState,
                strings = strings
            ),
            linkedEmail = cloudSettings.linkedEmail,
            installationId = cloudSettings.installationId,
            syncStatusText = when (val status = syncStatus.status) {
                is SyncStatus.Blocked -> status.message
                is com.flashcardsopensourceapp.data.local.model.SyncStatus.Failed -> status.message
                com.flashcardsopensourceapp.data.local.model.SyncStatus.Idle -> when (cloudSettings.cloudState) {
                    CloudAccountState.GUEST -> strings.get(R.string.settings_cloud_status_guest_ai_session)
                    else -> strings.resolveAppMetadataSyncStatusText(status = metadata.syncStatus)
                }
                com.flashcardsopensourceapp.data.local.model.SyncStatus.Syncing -> strings.get(R.string.settings_sync_status_syncing)
            },
            lastSuccessfulSync = formatTimestampLabel(
                timestampMillis = syncStatus.lastSuccessfulSyncAtMillis,
                strings = strings
            ),
            isGuest = cloudSettings.cloudState == CloudAccountState.GUEST,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
            isSyncBlocked = syncStatus.status is SyncStatus.Blocked,
            syncBlockedMessage = (syncStatus.status as? SyncStatus.Blocked)?.message,
            showLogoutConfirmation = draft.showLogoutConfirmation,
            errorMessage = draft.errorMessage,
            isSubmitting = draft.isSubmitting
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = AccountStatusUiState(
            workspaceName = strings.get(R.string.settings_loading),
            cloudStatusTitle = strings.get(R.string.settings_loading),
            linkedEmail = null,
            installationId = strings.get(R.string.settings_loading),
            syncStatusText = strings.get(R.string.settings_loading),
            lastSuccessfulSync = strings.get(R.string.settings_never),
            isGuest = false,
            isLinked = false,
            isLinkingReady = false,
            isSyncBlocked = false,
            syncBlockedMessage = null,
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
                    errorMessage = error.message ?: strings.get(R.string.settings_account_status_sync_failed)
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
            messageController.showMessage(
                message = strings.get(R.string.settings_account_status_logged_out_message)
            )
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    showLogoutConfirmation = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_account_status_logout_failed)
                )
            }
        }
    }
}

fun createAccountStatusViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountStatusViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController,
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
