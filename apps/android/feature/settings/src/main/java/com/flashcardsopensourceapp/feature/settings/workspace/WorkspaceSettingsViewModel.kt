package com.flashcardsopensourceapp.feature.settings.workspace

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.flashcardsopensourceapp.data.local.model.CloudAccountState
import com.flashcardsopensourceapp.data.local.model.CloudWorkspaceResetProgressPreview
import com.flashcardsopensourceapp.data.local.notifications.ReviewNotificationsStore
import com.flashcardsopensourceapp.data.local.repository.CloudAccountRepository
import com.flashcardsopensourceapp.data.local.repository.WorkspaceRepository
import com.flashcardsopensourceapp.feature.settings.DestructiveActionState
import com.flashcardsopensourceapp.feature.settings.R
import com.flashcardsopensourceapp.feature.settings.SettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.createSettingsStringResolver
import com.flashcardsopensourceapp.feature.settings.workspaceResetProgressConfirmationText
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private data class WorkspaceSettingsDraftState(
    val errorMessage: String,
    val successMessage: String,
    val resetConfirmationText: String,
    val resetState: DestructiveActionState,
    val isResetPreviewLoading: Boolean,
    val showResetConfirmation: Boolean,
    val showResetPreviewAlert: Boolean,
    val resetProgressPreview: CloudWorkspaceResetProgressPreview?
)

class WorkspaceSettingsViewModel(
    workspaceRepository: WorkspaceRepository,
    private val cloudAccountRepository: CloudAccountRepository,
    reviewNotificationsStore: ReviewNotificationsStore,
    private val strings: SettingsStringResolver
) : ViewModel() {
    private val draftState = MutableStateFlow(
        value = WorkspaceSettingsDraftState(
            errorMessage = "",
            successMessage = "",
            resetConfirmationText = "",
            resetState = DestructiveActionState.IDLE,
            isResetPreviewLoading = false,
            showResetConfirmation = false,
            showResetPreviewAlert = false,
            resetProgressPreview = null
        )
    )

    val uiState: StateFlow<WorkspaceSettingsUiState> = combine(
        workspaceRepository.observeWorkspaceOverview(),
        workspaceRepository.observeWorkspaceSchedulerSettings(),
        workspaceRepository.observeWorkspace(),
        cloudAccountRepository.observeCloudSettings(),
        draftState
    ) { overview, schedulerSettings, workspace, cloudSettings, draft ->
        WorkspaceSettingsUiState(
            workspaceName = overview?.workspaceName ?: strings.get(R.string.settings_unavailable),
            deckCount = overview?.deckCount ?: 0,
            totalCards = overview?.totalCards ?: 0,
            tagCount = overview?.tagsCount ?: 0,
            notificationsSummary = workspace?.let { currentWorkspace ->
                if (reviewNotificationsStore.loadSettings(workspaceId = currentWorkspace.workspaceId).isEnabled) {
                    strings.get(R.string.settings_on)
                } else {
                    strings.get(R.string.settings_off)
                }
            } ?: strings.get(R.string.settings_unavailable),
            schedulerSummary = schedulerSettings?.let { settings ->
                formatWorkspaceSchedulerSummary(settings = settings, strings = strings)
            } ?: strings.get(R.string.settings_unavailable),
            exportSummary = strings.get(R.string.settings_export_csv_summary),
            isLinked = cloudSettings.cloudState == CloudAccountState.LINKED,
            errorMessage = draft.errorMessage,
            successMessage = draft.successMessage,
            resetConfirmationText = draft.resetConfirmationText,
            resetState = draft.resetState,
            isResetPreviewLoading = draft.isResetPreviewLoading,
            showResetConfirmation = draft.showResetConfirmation,
            showResetPreviewAlert = draft.showResetPreviewAlert,
            resetProgressPreview = draft.resetProgressPreview
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000L),
        initialValue = WorkspaceSettingsUiState(
            workspaceName = strings.get(R.string.settings_loading),
            deckCount = 0,
            totalCards = 0,
            tagCount = 0,
            notificationsSummary = strings.get(R.string.settings_loading),
            schedulerSummary = strings.get(R.string.settings_loading),
            exportSummary = strings.get(R.string.settings_export_csv_summary),
            isLinked = false,
            errorMessage = "",
            successMessage = "",
            resetConfirmationText = "",
            resetState = DestructiveActionState.IDLE,
            isResetPreviewLoading = false,
            showResetConfirmation = false,
            showResetPreviewAlert = false,
            resetProgressPreview = null
        )
    )

    fun openResetConfirmation() {
        draftState.update { state ->
            state.copy(
                errorMessage = "",
                successMessage = "",
                resetConfirmationText = "",
                resetState = DestructiveActionState.IDLE,
                isResetPreviewLoading = false,
                showResetConfirmation = true,
                showResetPreviewAlert = false,
                resetProgressPreview = null
            )
        }
    }

    fun dismissResetConfirmation() {
        draftState.update { state ->
            state.copy(
                resetConfirmationText = "",
                resetState = DestructiveActionState.IDLE,
                isResetPreviewLoading = false,
                showResetConfirmation = false,
                showResetPreviewAlert = false,
                resetProgressPreview = null,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun updateResetConfirmationText(value: String) {
        draftState.update { state ->
            state.copy(
                resetConfirmationText = value,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun requestResetProgressAsync() {
        viewModelScope.launch {
            requestResetProgress()
        }
    }

    private suspend fun requestResetProgress() {
        if (uiState.value.resetConfirmationText != workspaceResetProgressConfirmationText(strings = strings)) {
            draftState.update { state ->
                state.copy(errorMessage = strings.get(R.string.settings_workspace_reset_confirmation_required))
            }
            return
        }

        draftState.update { state ->
            state.copy(
                errorMessage = "",
                successMessage = "",
                isResetPreviewLoading = true,
                showResetConfirmation = false,
                showResetPreviewAlert = false,
                resetProgressPreview = null,
                resetState = DestructiveActionState.IDLE
            )
        }

        try {
            val resetProgressPreview = cloudAccountRepository.loadCurrentWorkspaceResetProgressPreview()
            draftState.update { state ->
                state.copy(
                    isResetPreviewLoading = false,
                    resetConfirmationText = "",
                    resetProgressPreview = resetProgressPreview,
                    showResetPreviewAlert = true,
                    showResetConfirmation = false
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    isResetPreviewLoading = false,
                    showResetConfirmation = true,
                    showResetPreviewAlert = false,
                    errorMessage = error.message ?: strings.get(R.string.settings_workspace_reset_preview_failed)
                )
            }
        }
    }

    fun dismissResetPreviewAlert() {
        draftState.update { state ->
            state.copy(
                showResetPreviewAlert = false,
                resetProgressPreview = null,
                resetState = DestructiveActionState.IDLE,
                errorMessage = "",
                successMessage = ""
            )
        }
    }

    fun resetProgressAsync() {
        viewModelScope.launch {
            resetProgress()
        }
    }

    private suspend fun resetProgress() {
        val resetProgressPreview = requireNotNull(uiState.value.resetProgressPreview) {
            "Workspace reset progress preview is required before executing the reset."
        }
        if (
            uiState.value.resetConfirmationText.isNotEmpty() &&
            uiState.value.resetConfirmationText != workspaceResetProgressConfirmationText(strings = strings)
        ) {
            draftState.update { state ->
                state.copy(errorMessage = strings.get(R.string.settings_workspace_reset_confirmation_required))
            }
            return
        }

        draftState.update { state ->
            state.copy(
                errorMessage = "",
                successMessage = "",
                resetState = DestructiveActionState.IN_PROGRESS
            )
        }

        try {
            val result = cloudAccountRepository.resetCurrentWorkspaceProgress(
                confirmationText = resetProgressPreview.confirmationText
            )
            draftState.update { state ->
                state.copy(
                    resetConfirmationText = "",
                    resetState = DestructiveActionState.IDLE,
                    isResetPreviewLoading = false,
                    showResetConfirmation = false,
                    showResetPreviewAlert = false,
                    resetProgressPreview = null,
                    errorMessage = "",
                    successMessage = strings.get(
                        R.string.settings_workspace_reset_success,
                        result.cardsResetCount
                    )
                )
            }
        } catch (error: Exception) {
            draftState.update { state ->
                state.copy(
                    resetState = DestructiveActionState.FAILED,
                    errorMessage = error.message ?: strings.get(R.string.settings_workspace_reset_failed),
                    successMessage = ""
                )
            }
        }
    }
}

fun createWorkspaceSettingsViewModelFactory(
    workspaceRepository: WorkspaceRepository,
    cloudAccountRepository: CloudAccountRepository,
    reviewNotificationsStore: ReviewNotificationsStore,
    applicationContext: Context
): ViewModelProvider.Factory {
    return viewModelFactory {
        initializer {
            WorkspaceSettingsViewModel(
                workspaceRepository = workspaceRepository,
                cloudAccountRepository = cloudAccountRepository,
                reviewNotificationsStore = reviewNotificationsStore,
                strings = createSettingsStringResolver(context = applicationContext)
            )
        }
    }
}
