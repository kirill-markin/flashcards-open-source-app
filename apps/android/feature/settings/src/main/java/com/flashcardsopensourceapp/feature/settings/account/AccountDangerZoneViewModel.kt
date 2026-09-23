package com.flashcardsopensourceapp.feature.settings.account

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.core.observability.analytics.Analytics
import com.flashcardsopensourceapp.core.ui.nextAppTechnicalErrorReportId
import com.flashcardsopensourceapp.core.ui.renderTechnicalErrorDetails
import com.flashcardsopensourceapp.data.local.model.cloud.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.cloud.CloudAccountState
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.accountDeletionConfirmationText
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private data class AccountDangerZoneDraftState(
    val confirmationText: String,
    val errorMessage: String,
    val errorTechnicalDetails: String?,
    val errorTechnicalDetailsReportId: String?,
    val showDeleteConfirmation: Boolean,
    /**
     * The window between the person confirming and the deletion request being dispatched, which the
     * analytics drain occupies. `AccountDeletionState` only turns `InProgress` once the repository
     * has marked it, so without this the screen would sit idle for the length of the drain on a
     * control somebody just pressed.
     */
    val isPreparingDeletion: Boolean
)

class AccountDangerZoneViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val analytics: Analytics,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = AccountDangerZoneDraftState(
            confirmationText = "",
            errorMessage = "",
            errorTechnicalDetails = null,
            errorTechnicalDetailsReportId = null,
            showDeleteConfirmation = false,
            isPreparingDeletion = false
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
            isDeleting = deletionState == AccountDeletionState.InProgress || draft.isPreparingDeletion,
            deleteState = when (deletionState) {
                is AccountDeletionState.Failed -> DestructiveActionState.FAILED
                AccountDeletionState.InProgress -> DestructiveActionState.IN_PROGRESS
                AccountDeletionState.Hidden -> if (draft.isPreparingDeletion) {
                    DestructiveActionState.IN_PROGRESS
                } else {
                    DestructiveActionState.IDLE
                }
            },
            errorMessage = when (deletionState) {
                is AccountDeletionState.Failed -> strings.get(R.string.settings_account_danger_zone_delete_failed)
                AccountDeletionState.Hidden,
                AccountDeletionState.InProgress -> draft.errorMessage
            },
            errorTechnicalDetails = when (deletionState) {
                is AccountDeletionState.Failed -> renderTechnicalErrorDetails(
                    errorType = "AccountDeletionState.Failed",
                    message = deletionState.message
                )
                AccountDeletionState.Hidden,
                AccountDeletionState.InProgress -> draft.errorTechnicalDetails
            },
            errorTechnicalDetailsReportId = when (deletionState) {
                is AccountDeletionState.Failed -> deletionState.technicalDetailsReportId
                AccountDeletionState.Hidden,
                AccountDeletionState.InProgress -> draft.errorTechnicalDetailsReportId
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
            errorTechnicalDetails = null,
            errorTechnicalDetailsReportId = null,
            successMessage = "",
            showDeleteConfirmation = false
        )
    )

    fun requestDeleteConfirmation() {
        draftState.update { state ->
            state.copy(
                showDeleteConfirmation = true,
                errorMessage = "",
                errorTechnicalDetails = null,
                errorTechnicalDetailsReportId = null
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
                errorMessage = "",
                errorTechnicalDetails = null,
                errorTechnicalDetailsReportId = null
            )
        }
    }

    /**
     * Runs on [viewModelScope] rather than on the caller's, and deliberately: the caller is a
     * composable's `rememberCoroutineScope`, which a configuration change disposes, and the drain
     * below suspends for up to two seconds. A cancellation there would abandon the deletion after
     * the wait the person already paid for it. This ViewModel is scoped to the `NavBackStackEntry`,
     * which survives a configuration change.
     */
    fun deleteAccount() {
        // Read from the draft, which this ViewModel writes directly, rather than from `uiState`.
        // `uiState` is a `combine(...).stateIn(...)` whose emission is dispatched on
        // [viewModelScope], so it lags a draft write by a dispatch even once it is being collected,
        // and before its first emission it still holds `initialValue`. Both are the wrong answer
        // for a re-entrancy guard on the thread that is about to launch the work.
        //
        // The guard is also checked here, on the caller's thread, while `runDeleteAccount` sets the
        // flag inside the coroutine below, and that is only safe because [viewModelScope] dispatches
        // on `Dispatchers.Main.immediate`: the launched body runs eagerly on this same thread up to
        // its first suspension, and the `isPreparingDeletion = true` update happens before any.
        //
        // The same `uiState.value` read remains in the other settings view models — the workspace
        // reset, delete and rename confirmations — and is deliberately left alone: those guard a
        // typed confirmation string against a slower-changing state, and their worst double press
        // repeats a local write. The two presses that now sit behind a bounded drain are different:
        // this one starts an irreversible account deletion, and the sign-out next to it writes an
        // append-only analytics row that a second press would duplicate with no way to repair it.
        if (draftState.value.isPreparingDeletion) {
            return
        }

        viewModelScope.launch {
            runDeleteAccount()
        }
    }

    private suspend fun runDeleteAccount(): Boolean {
        if (draftState.value.confirmationText != accountDeletionConfirmationText(strings = strings)) {
            draftState.update { state ->
                state.copy(
                    errorMessage = strings.get(R.string.settings_account_danger_zone_confirmation_required),
                    errorTechnicalDetails = null,
                    errorTechnicalDetailsReportId = null
                )
            }
            return false
        }

        return try {
            // The last moment this install's queued events can be delivered. Once the request
            // inside `beginAccountDeletion()` returns, the ingest answers `410 ACCOUNT_DELETED` for
            // this credential before it reads the batch body, so a drain on the far side provably
            // delivers nothing while still costing a wait on a pressed control.
            //
            // Nothing is reported here: `signed_out(account_deleted)` could not be delivered
            // either, and writing it anyway would leave a row whose only way to survive is to lose
            // the race with the identity rotation and be filed under the next person.
            //
            // The flag stays set across `beginAccountDeletion()` as well as the drain, and is
            // dropped only once one of the three outcomes below has replaced it: released between
            // the two, `deleteState` would go IN_PROGRESS, IDLE, IN_PROGRESS again while the person
            // watches, and the request itself would run with no in-progress state on the screen at
            // all. On the success path the repository's own `InProgress` takes over — on a separate
            // emission, so there is one dispatch where neither is set and the controls are briefly
            // live again. That window is left open rather than closed by holding the flag: this
            // press writes no analytics row of its own, so a press landing inside it costs a
            // repeated request and nothing append-only, while a held flag would keep `isDeleting`
            // true over a later `Failed` and leave the person no way to retry.
            draftState.update { state -> state.copy(isPreparingDeletion = true) }
            analytics.drainBeforeIdentityTeardown()
            cloudAccountRepository.beginAccountDeletion()
            draftState.update { state ->
                state.copy(
                    confirmationText = "",
                    errorMessage = "",
                    errorTechnicalDetails = null,
                    errorTechnicalDetailsReportId = null,
                    showDeleteConfirmation = false,
                    isPreparingDeletion = false
                )
            }
            true
        } catch (error: CancellationException) {
            // Only reachable when this ViewModel is cleared, which takes the screen with it. The
            // draft is restored anyway, because `isPreparingDeletion` drives the screen's
            // in-progress state and a stuck `true` would leave every control disabled.
            draftState.update { state -> state.copy(isPreparingDeletion = false) }
            throw error
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    errorMessage = strings.get(R.string.settings_account_danger_zone_delete_failed),
                    errorTechnicalDetails = renderTechnicalErrorDetails(error = error),
                    errorTechnicalDetailsReportId = nextAppTechnicalErrorReportId(
                        source = "account-danger-zone-delete"
                    ),
                    isPreparingDeletion = false
                )
            }
            false
        }
    }

}

fun createAccountDangerZoneViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    analytics: Analytics,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountDangerZoneViewModel(
                cloudAccountRepository = cloudAccountRepository,
                analytics = analytics,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
