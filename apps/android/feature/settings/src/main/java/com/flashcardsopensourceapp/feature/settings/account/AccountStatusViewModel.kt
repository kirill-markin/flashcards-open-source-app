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
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsEvent
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSignedOutReason
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSurface
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSyncFailureReason
import com.flashcardsopensourceapp.core.observability.analytics.AnalyticsSyncFailureReporter
import com.flashcardsopensourceapp.core.observability.analytics.PendingSignOutReport
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
import kotlinx.coroutines.launch
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
    private val analytics: Analytics,
    private val pendingSignOutReport: PendingSignOutReport,
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
                    errorMessage = blockedMessage
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
                        errorMessage = syncBlockedMessage
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

    /**
     * Runs on [viewModelScope] rather than on the caller's, and deliberately.
     *
     * The caller is a composable's `rememberCoroutineScope`, which a configuration change — a
     * rotation, a dark-mode toggle, a locale change, a multi-window resize — disposes along with the
     * composition. The bounded drain below suspends for up to two seconds, so a cancellation there
     * would land after the `signed_out` row was emitted and delivered and before `logout()` ran:
     * the person would stay signed in with no error, and their eventual sign-out would write a
     * second permanent row into an append-only table. This ViewModel is scoped to the
     * `NavBackStackEntry`, which survives the configuration change, so the emit and the teardown
     * cannot be separated by one.
     */
    fun confirmLogout() {
        // Read from the draft, which this ViewModel writes directly, rather than from `uiState`.
        // `uiState` is a `combine(...).stateIn(...)` whose emission is dispatched on
        // [viewModelScope], so it lags a draft write by a dispatch even while it is being collected,
        // and before its first emission it still holds `initialValue`. It does not revert to that
        // initial value when the last collector goes away — `WhileSubscribed` keeps the replay cache
        // by default — so staleness rather than reversion is what makes it the wrong read here. The
        // same `uiState.value` guard is left in place in the workspace view models, for the reason
        // given in `AccountDangerZoneViewModel.deleteAccount`.
        //
        // The guard is checked on the caller's thread while `runLogout` sets `isSubmitting` inside
        // the coroutine launched below, and that is only safe because of something invisible here:
        // `viewModelScope` dispatches on `Dispatchers.Main.immediate`, so the launched body runs
        // eagerly on this same thread up to its first real suspension — and the first statement is
        // the `isSubmitting = true` update. A second tap therefore always sees `true`. Moving this
        // launch onto any other dispatcher, or putting anything suspending in front of that update,
        // opens a double-press window that ends in two `signed_out` rows for one departure.
        if (draftState.value.isSubmitting) {
            return
        }

        viewModelScope.launch {
            runLogout()
        }
    }

    private suspend fun runLogout() {
        draftState.update { state ->
            state.copy(
                isSubmitting = true,
                showLogoutConfirmation = false,
                errorMessage = ""
            )
        }
        try {
            // The deliberate sign-out, reported here and not at the teardown: one press is one row.
            // The drain that follows is the last moment this and everything else queued can leave,
            // because the boundary inside `logout()` rotates `anonymous_id` and discards the queue
            // — see `AppGraph`'s `onCloudIdentityReset` hook. `isSubmitting` is already true, so the
            // screen shows the wait, and the bound inside the client keeps it short.
            //
            // [PendingSignOutReport] is the one marker this design keeps, and it guards a single
            // narrow case: `logout()` can throw, the screen restores itself and invites another
            // press, and the row for the first press has already left. It is process-wide rather
            // than per view model because the retry is often made on the *other* sign-out control,
            // the one inside the sign-in flow, which would otherwise write a second permanent row
            // for the same departure. It keys on nothing the teardown clears, and the identity
            // boundary releases it once the credentials are gone.
            if (pendingSignOutReport.claim()) {
                analytics.track(
                    event = AnalyticsEvent.SignedOut(
                        reason = AnalyticsSignedOutReason.USER_INITIATED,
                        screen = AnalyticsSurface.SETTINGS
                    )
                )
            }
            analytics.drainBeforeIdentityTeardown()
            cloudAccountRepository.logout()
            draftState.update { state -> state.copy(isSubmitting = false, errorMessage = "") }
            messageController.showMessage(
                message = strings.get(R.string.settings_account_status_logged_out_message)
            )
        } catch (error: CancellationException) {
            // Only reachable when this ViewModel itself is cleared, which takes the screen with it.
            // The draft is still restored, because `isSubmitting` gates every control on the screen
            // including Back, and a stuck `true` would brick it.
            draftState.update { state -> state.copy(isSubmitting = false) }
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
    analytics: Analytics,
    pendingSignOutReport: PendingSignOutReport,
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
                analytics = analytics,
                pendingSignOutReport = pendingSignOutReport,
                syncFailureReporter = syncFailureReporter,
                workspaceRepository = workspaceRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
