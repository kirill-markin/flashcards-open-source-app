package com.flashcardsopensourceapp.feature.settings.account

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.AccountDeletionState
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.accountDeletionConfirmationText
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

private data class AccountDangerZoneDraftState(
    val confirmationText: String,
    val errorMessage: String,
    val showDeleteConfirmation: Boolean
)

class AccountDangerZoneViewModel(
    private val cloudAccountRepository: CloudAccountRepository,
    private val strings: SettingsStringResolver
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
        if (uiState.value.confirmationText != accountDeletionConfirmationText(strings = strings)) {
            draftState.update { state ->
                state.copy(
                    errorMessage = strings.get(R.string.settings_account_danger_zone_confirmation_required)
                )
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
                    errorMessage = error.message ?: strings.get(R.string.settings_account_danger_zone_delete_failed)
                )
            }
            false
        }
    }
}

fun createAccountDangerZoneViewModelFactory(
    cloudAccountRepository: CloudAccountRepository,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            AccountDangerZoneViewModel(
                cloudAccountRepository = cloudAccountRepository,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
