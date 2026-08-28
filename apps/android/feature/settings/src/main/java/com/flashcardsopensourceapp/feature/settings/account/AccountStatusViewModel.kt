package com.flashcardsopensourceapp.feature.settings.account

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.ui.AppTechnicalErrorController
import com.flashcardsopensourceapp.core.ui.TransientMessageController
import com.flashcardsopensourceapp.core.ui.makeAppTechnicalError
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSyncFailureReason
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSyncFailureReporter
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.sync.SyncStatus
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.data.local.repository.SyncRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsAttentionSummary
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.cloud.displayCloudAccountStateTitle
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.formatTimestampLabel
import com.flashcardsopensourceapp.feature.settings.makeSettingsAttentionIssues
import com.flashcardsopensourceapp.feature.settings.makeSettingsAttentionSummary
import com.flashcardsopensourceapp.feature.settings.resolveAppMetadataSyncStatusText
import com.flashcardsopensourceapp.feature.settings.resolveWorkspaceName
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import java.io.IOException
import java.net.SocketTimeoutException

private data class AccountStatusDraftState(
    val errorMessage: String,
    val isSubmitting: Boolean,
    val showLogoutConfirmation: Boolean
)

class AccountStatusViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val syncRepository: SyncRepository,
    private val messageController: TransientMessageController,
    private val technicalErrorController: AppTechnicalErrorController,
    private val syncFailureReporter: AnalyticsSyncFailureReporter,
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
        val attentionSummary: SettingsAttentionSummary = makeSettingsAttentionSummary(
            issues = makeSettingsAttentionIssues(cloudState = cloudSettings.cloudState)
        )

        AccountStatusUiState(
            workspaceName = strings.resolveWorkspaceName(workspaceName = metadata.workspaceName),
            cloudStatusTitle = displayCloudAccountStateTitle(
                cloudState = cloudSettings.cloudState,
                strings = strings
            ),
            linkedEmail = cloudSettings.linkedEmail,
            installationId = cloudSettings.installationId,
            syncStatusText = when (val status = syncStatus.status) {
                is SyncStatus.Blocked -> strings.get(R.string.settings_account_status_sync_blocked_title)
                is com.flashcardsopensourceapp.data.local.model.sync.SyncStatus.Failed -> status.message
                com.flashcardsopensourceapp.data.local.model.sync.SyncStatus.Idle -> when (cloudSettings.cloudState) {
                    CloudAccountState.GUEST -> strings.get(R.string.settings_cloud_status_guest_ai_session)
                    else -> strings.resolveAppMetadataSyncStatusText(status = metadata.syncStatus)
                }
                com.flashcardsopensourceapp.data.local.model.sync.SyncStatus.Syncing -> strings.get(R.string.settings_sync_status_syncing)
            },
            lastSuccessfulSync = formatTimestampLabel(
                timestampMillis = syncStatus.lastSuccessfulSyncAtMillis,
                strings = strings
            ),
            isGuest = cloudSettings.cloudState == CloudAccountState.GUEST,
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            isLinkingReady = cloudSettings.cloudState == CloudAccountState.LINKING_READY,
            isSyncBlocked = syncStatus.status is SyncStatus.Blocked,
            syncBlockedMessage = if (syncStatus.status is SyncStatus.Blocked) {
                strings.get(R.string.settings_account_status_sync_blocked_body)
            } else {
                null
            },
            accountStatusPrimaryActionAttentionCount = accountStatusPrimaryActionAttentionCount(
                cloudState = cloudSettings.cloudState,
                attentionSummary = attentionSummary
            ),
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
            accountStatusPrimaryActionAttentionCount = 1,
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
        val blockedMessage = uiState.value.syncBlockedMessage
        if (blockedMessage.isNullOrBlank().not()) {
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    errorMessage = blockedMessage ?: strings.get(R.string.settings_account_status_sync_blocked_body)
                )
            }
            return
        }

        try {
            syncRepository.syncNow()
            syncFailureReporter.reportSuccess()
            draftState.update { state -> state.copy(isSubmitting = false, errorMessage = "") }
        } catch (error: CancellationException) {
            throw error
        } catch (error: SyncBlockedException) {
            trackSyncFailed(error = error)
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    errorMessage = strings.get(R.string.settings_account_status_sync_blocked_body)
                )
            }
        } catch (error: Exception) {
            trackSyncFailed(error = error)
            val syncBlockedMessage = uiState.value.syncBlockedMessage
            if (syncBlockedMessage.isNullOrBlank().not()) {
                draftState.update { state ->
                    state.copy(
                        isSubmitting = false,
                        errorMessage = syncBlockedMessage ?: strings.get(R.string.settings_account_status_sync_blocked_body)
                    )
                }
                return
            }

            val errorMessage = strings.get(R.string.settings_account_status_sync_failed)
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    errorMessage = errorMessage
                )
            }
            technicalErrorController.showTechnicalError(
                error = makeAppTechnicalError(
                    title = strings.get(R.string.settings_technical_error_title),
                    message = errorMessage,
                    throwable = error
                ),
                throwable = error
            )
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
            // No analytics call belongs here. There is deliberately no flush-before-logout trigger:
            // an asynchronous flush started from this path is ordered after the credential is
            // cleared and achieves nothing. The identity boundary is handled where logout actually
            // clears the account, in `AppGraph`'s `onCloudIdentityReset` hook.
            cloudAccountRepository.logout()
            draftState.update { state -> state.copy(isSubmitting = false, errorMessage = "") }
            messageController.showMessage(
                message = strings.get(R.string.settings_account_status_logged_out_message)
            )
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            val errorMessage = strings.get(R.string.settings_account_status_logout_failed)
            draftState.update { state ->
                state.copy(
                    isSubmitting = false,
                    showLogoutConfirmation = false,
                    errorMessage = errorMessage
                )
            }
            technicalErrorController.showTechnicalError(
                error = makeAppTechnicalError(
                    title = strings.get(R.string.settings_technical_error_title),
                    message = errorMessage,
                    throwable = error
                ),
                throwable = error
            )
        }
    }

    private fun trackSyncFailed(error: Throwable) {
        syncFailureReporter.reportFailure(
            reason = analyticsSettingsSyncFailureReason(error = error),
            screen = AnalyticsSurface.SETTINGS
        )
    }
}

private const val maxAnalyticsSyncFailureCauseDepth: Int = 8

/** Maps a manual sync failure onto the closed reason set the server catalog declares. */
private fun analyticsSettingsSyncFailureReason(error: Throwable): AnalyticsSyncFailureReason {
    var currentError: Throwable? = error
    var depth = 0
    while (currentError != null && depth < maxAnalyticsSyncFailureCauseDepth) {
        val inspectedError: Throwable = currentError
        when (inspectedError) {
            is SyncBlockedException -> return AnalyticsSyncFailureReason.CONFLICT
            is SocketTimeoutException -> return AnalyticsSyncFailureReason.TIMEOUT
            is IOException -> return AnalyticsSyncFailureReason.OFFLINE
            is CloudRemoteException -> {
                if (
                    inspectedError.syncConflict != null ||
                    inspectedError.errorCode?.trim()?.uppercase() == "SYNC_WORKSPACE_FORK_REQUIRED"
                ) {
                    return AnalyticsSyncFailureReason.CONFLICT
                }
                return when (inspectedError.statusCode) {
                    401, 403 -> AnalyticsSyncFailureReason.UNAUTHORIZED
                    408, 504 -> AnalyticsSyncFailureReason.TIMEOUT
                    409 -> AnalyticsSyncFailureReason.CONFLICT
                    else -> AnalyticsSyncFailureReason.SERVER_ERROR
                }
            }
            else -> Unit
        }
        currentError = inspectedError.cause
        depth += 1
    }
    return AnalyticsSyncFailureReason.SERVER_ERROR
}

private fun accountStatusPrimaryActionAttentionCount(
    cloudState: CloudAccountState,
    attentionSummary: SettingsAttentionSummary
): Int {
    if (cloudState == CloudAccountState.LINKING_READY) {
        return 0
    }

    return attentionSummary.accountStatusPrimaryActionCount
}

fun createAccountStatusViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    syncRepository: SyncRepository,
    messageController: TransientMessageController,
    technicalErrorController: AppTechnicalErrorController,
    syncFailureReporter: AnalyticsSyncFailureReporter,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountStatusViewModel(
                cloudAccountRepository = cloudAccountRepository,
                syncRepository = syncRepository,
                messageController = messageController,
                technicalErrorController = technicalErrorController,
                syncFailureReporter = syncFailureReporter,
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
