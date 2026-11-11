package com.flashcardsopensourceapp.app.navigation.maintenance

import android.util.Log
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.app.R
import com.flashcardsopensourceapp.data.local.cloud.remote.CloudRemoteException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceConfirmation
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenancePreview
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceRefreshException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceSignInRequiredException
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceTarget
import com.flashcardsopensourceapp.data.local.model.cloud.CloudCardMaintenanceWorkspaceChangedException
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.SyncBlockedException
import com.flashcardsopensourceapp.feature.settings.R as SettingsR
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

internal sealed interface CardMaintenanceState {
    data object Loading : CardMaintenanceState
    data object Applying : CardMaintenanceState
    data class Ready(
        val preview: CloudCardMaintenancePreview,
        val confirmationText: String,
        @StringRes val notice: Int?
    ) : CardMaintenanceState
    data class Unavailable(
        @StringRes val reason: Int,
        val canRetry: Boolean,
        val isSyncBlocked: Boolean
    ) : CardMaintenanceState
    data class RefreshNeeded(
        val affectedCardsCount: Int?,
        val isSyncing: Boolean,
        val isSyncBlocked: Boolean
    ) : CardMaintenanceState
    data class Finished(val affectedCardsCount: Int) : CardMaintenanceState
}

internal class CardMaintenanceViewModel(
    private val repository: CloudAccountRepository,
    private val target: CloudCardMaintenanceTarget,
    private val attemptId: String
) : ViewModel() {
    private val mutableState = MutableStateFlow<CardMaintenanceState>(CardMaintenanceState.Loading)
    val state = mutableState.asStateFlow()

    init {
        viewModelScope.launch { loadPreview(notice = null) }
        viewModelScope.launch {
            state.collectLatest { current ->
                if (current is CardMaintenanceState.RefreshNeeded && !current.isSyncing) {
                    val attempt = repository.observeCardMaintenanceAttempt(
                        workspaceId = target.workspaceId,
                        attemptId = attemptId
                    ).first { it?.isRefreshComplete == true }
                    if (mutableState.value == current) {
                        mutableState.value = CardMaintenanceState.Finished(
                            affectedCardsCount = requireNotNull(attempt?.affectedCardsCount)
                        )
                    }
                }
            }
        }
    }

    fun retryPreview() {
        val unavailable = mutableState.value as? CardMaintenanceState.Unavailable ?: return
        if (!unavailable.canRetry) return
        mutableState.value = CardMaintenanceState.Loading
        viewModelScope.launch { loadPreview(notice = null) }
    }

    fun updateConfirmationText(text: String) {
        val ready = mutableState.value as? CardMaintenanceState.Ready ?: return
        mutableState.value = ready.copy(confirmationText = text)
    }

    fun execute() {
        val ready = mutableState.value as? CardMaintenanceState.Ready ?: return
        if (ready.preview.affectedCardsCount <= 0 || ready.confirmationText != ready.preview.confirmationText) return
        mutableState.value = CardMaintenanceState.Applying
        viewModelScope.launch {
            try {
                val affectedCardsCount = repository.executeCardMaintenance(
                    confirmation = CloudCardMaintenanceConfirmation(
                        attemptId = attemptId,
                        target = target,
                        confirmationText = ready.confirmationText,
                        previewFingerprint = ready.preview.previewFingerprint
                    )
                )
                mutableState.value = CardMaintenanceState.Finished(affectedCardsCount = affectedCardsCount)
            } catch (error: CancellationException) {
                throw error
            } catch (error: CloudCardMaintenanceRefreshException) {
                Log.w("CardMaintenance", "Workspace sync failed after confirmed card maintenance.", error)
                mutableState.value = CardMaintenanceState.RefreshNeeded(
                    affectedCardsCount = error.affectedCardsCount,
                    isSyncing = false,
                    isSyncBlocked = error.cause is SyncBlockedException
                )
            } catch (error: CloudRemoteException) {
                when (error.errorCode) {
                    "CARD_MAINTENANCE_PREVIEW_CHANGED", "CARD_MAINTENANCE_TARGET_NOT_FOUND" ->
                        loadPreview(notice = R.string.card_maintenance_preview_changed)
                    "CARD_MAINTENANCE_CONFIRMATION_INVALID" ->
                        loadPreview(notice = R.string.card_maintenance_confirmation_invalid)
                    else -> reportExecuteFailure(error = error)
                }
            } catch (error: Exception) {
                reportExecuteFailure(error = error)
            }
        }
    }

    fun retrySync() {
        val pending = mutableState.value as? CardMaintenanceState.RefreshNeeded ?: return
        if (pending.isSyncing || pending.isSyncBlocked) return
        mutableState.value = pending.copy(isSyncing = true)
        viewModelScope.launch {
            try {
                repository.refreshCardMaintenanceWorkspace(workspaceId = target.workspaceId, attemptId = attemptId)
                val count = repository.loadCardMaintenanceAttempt(workspaceId = target.workspaceId, attemptId = attemptId)
                    ?.takeIf { it.isRefreshComplete }?.affectedCardsCount ?: pending.affectedCardsCount
                mutableState.value = if (count == null) {
                    CardMaintenanceState.Unavailable(
                        reason = R.string.card_maintenance_execute_unverified,
                        canRetry = true,
                        isSyncBlocked = false
                    )
                } else {
                    CardMaintenanceState.Finished(affectedCardsCount = count)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (error is CloudCardMaintenanceSignInRequiredException) {
                    reportFailure(error = error, fallback = R.string.card_maintenance_execute_unverified)
                } else {
                    Log.w("CardMaintenance", "Workspace sync retry failed after card maintenance.", error)
                    mutableState.value = pending.copy(isSyncBlocked = error is SyncBlockedException)
                }
            }
        }
    }

    private suspend fun loadPreview(@StringRes notice: Int?) {
        mutableState.value = CardMaintenanceState.Loading
        try {
            if (restoreAttempt(isSyncBlocked = false)) return
            val preview = repository.previewCardMaintenance(target = target)
            mutableState.value = CardMaintenanceState.Ready(preview = preview, confirmationText = "", notice = notice)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            reportFailure(error = error, fallback = R.string.card_maintenance_preview_failed)
        }
    }

    private fun reportExecuteFailure(error: Exception) {
        if (restoreAttempt(isSyncBlocked = error is SyncBlockedException)) {
            Log.w("CardMaintenance", "Could not verify the card maintenance result.", error)
        } else {
            reportFailure(error = error, fallback = R.string.card_maintenance_execute_unverified)
        }
    }

    private fun restoreAttempt(isSyncBlocked: Boolean): Boolean {
        val attempt = repository.loadCardMaintenanceAttempt(workspaceId = target.workspaceId, attemptId = attemptId)
            ?: return false
        mutableState.value = if (attempt.isRefreshComplete) {
            CardMaintenanceState.Finished(affectedCardsCount = requireNotNull(attempt.affectedCardsCount))
        } else {
            CardMaintenanceState.RefreshNeeded(
                affectedCardsCount = attempt.affectedCardsCount,
                isSyncing = false,
                isSyncBlocked = isSyncBlocked
            )
        }
        return true
    }

    private fun reportFailure(error: Exception, @StringRes fallback: Int) {
        Log.w("CardMaintenance", "Could not verify card maintenance state.", error)
        val reason = when {
            error is SyncBlockedException ->
                SettingsR.string.settings_account_status_sync_blocked_body
            error is CloudCardMaintenanceSignInRequiredException ->
                R.string.card_maintenance_sign_in
            error is CloudCardMaintenanceWorkspaceChangedException ->
                R.string.card_maintenance_workspace_changed
            error is CloudRemoteException && error.errorCode == "CARD_MAINTENANCE_TARGET_NOT_FOUND" ->
                R.string.card_maintenance_target_unavailable
            error is CloudRemoteException && error.statusCode == 401 ->
                R.string.card_maintenance_sign_in
            error is CloudRemoteException && error.statusCode == 403 ->
                R.string.card_maintenance_access_denied
            else -> fallback
        }
        mutableState.value = CardMaintenanceState.Unavailable(
            reason = reason,
            canRetry = reason == fallback,
            isSyncBlocked = error is SyncBlockedException
        )
    }
}

internal fun createCardMaintenanceViewModelFactory(
    repository: CloudAccountRepository,
    target: CloudCardMaintenanceTarget,
    attemptId: String
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer { CardMaintenanceViewModel(repository = repository, target = target, attemptId = attemptId) }
    }
}
